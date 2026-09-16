//! Axum router for calendar occurrence queries.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use models_pagination::Base64Str;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    models::{
        CalendarAttendee, CalendarEvent, CalendarMentionEvent, CalendarMentionPreview,
        CalendarMentionRequestItem, CalendarOccurrence, CalendarOccurrenceCursor,
        CalendarSyncStatus, EventStatus, EventTime, EventTransparency, EventType, OccurrenceRange,
        TeamCalendarSharing,
    },
    ports::CalendarOccurrenceService,
    service::CalendarValidationError,
};

/// Router state for authenticated calendar occurrence queries.
pub struct CalendarRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for CalendarRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> CalendarRouterState<S, Auth> {
    /// Create router state from a shared calendar service and authorization state.
    pub fn new(service: Arc<S>, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<CalendarRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &CalendarRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the authenticated calendar occurrence router.
pub fn calendar_router<S, Auth, T>(state: CalendarRouterState<S, Auth>) -> Router<T>
where
    S: CalendarOccurrenceService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/calendar-events", get(list_occurrences::<S, Auth>))
        .route("/calendar-events/", get(list_occurrences::<S, Auth>))
        .route(
            "/calendar-events/preview",
            post(mention_previews::<S, Auth>),
        )
        .route(
            "/calendar-events/team-out-of-office",
            get(list_team_out_of_office::<S, Auth>),
        )
        .route(
            "/calendar-events/team",
            get(list_team_occurrences::<S, Auth>),
        )
        .with_state(state)
}

/// Query parameters for a calendar occurrence viewport.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrenceQuery {
    /// Inclusive UTC viewport start.
    start: DateTime<Utc>,
    /// Exclusive UTC viewport end.
    end: DateTime<Utc>,
    /// Inclusive local date boundary for all-day events.
    start_date: Option<NaiveDate>,
    /// Exclusive local date boundary for all-day events.
    end_date: Option<NaiveDate>,
    /// Maximum number of occurrences, from 1 through 2,000.
    #[param(minimum = 1, maximum = 2000)]
    limit: Option<u16>,
    /// Opaque continuation cursor returned by the previous page.
    cursor: Option<String>,
}

/// One materialized occurrence paired with its stable calendar event entity.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrenceItem {
    event: CalendarEvent,
    occurrence: CalendarOccurrence,
}

/// Paginated calendar occurrence viewport response.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOccurrenceResponse {
    items: Vec<CalendarOccurrenceItem>,
    has_more: bool,
    next_cursor: Option<String>,
    /// Aggregate ingestion state; clients render a skeleton while `syncing`.
    sync_status: CalendarSyncStatus,
}

/// HTTP error returned by the calendar occurrence adapter.
#[derive(Debug)]
pub struct CalendarApiError {
    status: StatusCode,
    message: &'static str,
}

impl std::fmt::Display for CalendarApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl IntoResponse for CalendarApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "message": self.message })),
        )
            .into_response()
    }
}

/// Return calendar occurrences visible to the authenticated requester.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    get,
    path = "/calendar-events",
    tag = "calendar_events",
    params(CalendarOccurrenceQuery),
    responses(
        (status = 200, description = "Calendar occurrences in the requested viewport", body = CalendarOccurrenceResponse),
        (status = 400, description = "Invalid or unsupported calendar viewport"),
        (status = 401, description = "Authentication required"),
        (status = 500, description = "Calendar query failed"),
    )
)]
pub async fn list_occurrences<S, Auth>(
    State(state): State<CalendarRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<CalendarOccurrenceQuery>,
) -> Result<Json<CalendarOccurrenceResponse>, CalendarApiError>
where
    S: CalendarOccurrenceService,
    Auth: MacroAuthorizationService,
{
    let default_end_date = default_end_date(query.end);
    let range = OccurrenceRange {
        starts_at: query.start,
        ends_at: query.end,
        start_date: query.start_date.unwrap_or_else(|| query.start.date_naive()),
        end_date: query
            .end_date
            .or(default_end_date)
            .ok_or(CalendarApiError {
                status: StatusCode::BAD_REQUEST,
                message: "calendar end is outside the supported date range",
            })?,
    };
    let (limit, repository_limit) = query_limits(query.limit)?;
    let cursor = decode_cursor(query.cursor)?;
    let mut occurrences = state
        .service
        .list_occurrences(
            user.authorization.user.macro_user_id.as_ref(),
            range,
            cursor,
            repository_limit,
        )
        .await
        .map_err(|error| {
            if error
                .as_ref()
                .downcast_current_context::<CalendarValidationError>()
                .is_some()
            {
                return CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar range must be positive, at most 370 days, inside the maintained one-year-history/two-year-future window, with limit 1–2000",
                };
            }
            tracing::error!(error = ?error, "failed to query calendar occurrences");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query calendar occurrences",
            }
        })?;
    let sync_status = state
        .service
        .sync_status(user.authorization.user.macro_user_id.as_ref())
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to query calendar sync status");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query calendar occurrences",
            }
        })?;
    let has_more = occurrences.len() > usize::from(limit);
    occurrences.truncate(usize::from(limit));
    let next_cursor = has_more
        .then(|| occurrences.last())
        .flatten()
        .map(|(_, occurrence)| {
            Base64Str::encode_json(CalendarOccurrenceCursor::from_occurrence(occurrence))
                .type_erase()
        });
    let items = occurrences
        .into_iter()
        .map(|(event, occurrence)| CalendarOccurrenceItem { event, occurrence })
        .collect();

    Ok(Json(CalendarOccurrenceResponse {
        items,
        has_more,
        next_cursor,
        sync_status,
    }))
}

/// Query parameters for the team out-of-office viewport.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct TeamOutOfOfficeQuery {
    /// Inclusive UTC viewport start.
    start: DateTime<Utc>,
    /// Exclusive UTC viewport end.
    end: DateTime<Utc>,
    /// Inclusive local date boundary for all-day events.
    start_date: Option<NaiveDate>,
    /// Exclusive local date boundary for all-day events.
    end_date: Option<NaiveDate>,
    /// Maximum number of occurrences, from 1 through 2,000.
    #[param(minimum = 1, maximum = 2000)]
    limit: Option<u16>,
}

/// One teammate's out-of-office occurrence.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamOutOfOfficeItem {
    /// Macro user id of the teammate who is out.
    owner_id: String,
    /// The teammate's calendar event id.
    event_id: Uuid,
    /// Stable occurrence key within the event.
    occurrence_key: String,
    /// Event title, absent when the event's visibility withholds details.
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    /// Occurrence time span.
    time: EventTime,
}

/// Team out-of-office viewport response.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamOutOfOfficeResponse {
    items: Vec<TeamOutOfOfficeItem>,
    has_more: bool,
}

/// Return teammates' out-of-office occurrences in the requested viewport.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    get,
    path = "/calendar-events/team-out-of-office",
    tag = "calendar_events",
    params(TeamOutOfOfficeQuery),
    responses(
        (status = 200, description = "Teammates' out-of-office occurrences in the requested viewport", body = TeamOutOfOfficeResponse),
        (status = 400, description = "Invalid or unsupported calendar viewport"),
        (status = 401, description = "Authentication required"),
        (status = 500, description = "Calendar query failed"),
    )
)]
pub async fn list_team_out_of_office<S, Auth>(
    State(state): State<CalendarRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<TeamOutOfOfficeQuery>,
) -> Result<Json<TeamOutOfOfficeResponse>, CalendarApiError>
where
    S: CalendarOccurrenceService,
    Auth: MacroAuthorizationService,
{
    let default_end_date = default_end_date(query.end);
    let range = OccurrenceRange {
        starts_at: query.start,
        ends_at: query.end,
        start_date: query.start_date.unwrap_or_else(|| query.start.date_naive()),
        end_date: query
            .end_date
            .or(default_end_date)
            .ok_or(CalendarApiError {
                status: StatusCode::BAD_REQUEST,
                message: "calendar end is outside the supported date range",
            })?,
    };
    let (limit, repository_limit) = query_limits(query.limit)?;
    let mut occurrences = state
        .service
        .list_team_out_of_office(
            user.authorization.user.macro_user_id.as_ref(),
            range,
            repository_limit,
        )
        .await
        .map_err(|error| {
            if error
                .as_ref()
                .downcast_current_context::<CalendarValidationError>()
                .is_some()
            {
                return CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar range must be positive, at most 370 days, inside the maintained one-year-history/two-year-future window, with limit 1–2000",
                };
            }
            tracing::error!(error = ?error, "failed to query team out-of-office occurrences");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query team out-of-office occurrences",
            }
        })?;
    let has_more = occurrences.len() > usize::from(limit);
    occurrences.truncate(usize::from(limit));
    let items = occurrences
        .into_iter()
        .map(|row| TeamOutOfOfficeItem {
            owner_id: row.owner_id,
            event_id: row.event_id,
            occurrence_key: row.occurrence_key,
            title: row.title,
            time: row.time,
        })
        .collect();

    Ok(Json(TeamOutOfOfficeResponse { items, has_more }))
}

/// Query parameters for the team calendar viewport.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarQuery {
    /// Inclusive UTC viewport start.
    start: DateTime<Utc>,
    /// Exclusive UTC viewport end.
    end: DateTime<Utc>,
    /// Inclusive local date boundary for all-day events.
    start_date: Option<NaiveDate>,
    /// Exclusive local date boundary for all-day events.
    end_date: Option<NaiveDate>,
    /// Maximum number of occurrences, from 1 through 2,000.
    #[param(minimum = 1, maximum = 2000)]
    limit: Option<u16>,
}

/// One teammate and what they share with the team.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarMemberItem {
    /// Macro user id of the teammate.
    user_id: String,
    /// The teammate's sharing policy.
    sharing: TeamCalendarSharing,
    /// Whether the teammate has a connected, enabled calendar.
    has_calendar: bool,
}

/// Details of a teammate's event, present only when they share them and
/// the event is not private.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarEventDetails {
    /// Display title.
    title: String,
    /// Optional event body.
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    /// Optional location label.
    #[serde(skip_serializing_if = "Option::is_none")]
    location: Option<String>,
    /// Direct join URL when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    conference_url: Option<String>,
    /// Organizer email.
    #[serde(skip_serializing_if = "Option::is_none")]
    organizer_email: Option<String>,
    /// Organizer display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    organizer_name: Option<String>,
    /// Attendees of the teammate's copy of the event.
    attendees: Vec<CalendarAttendee>,
}

/// One occurrence from a teammate's primary calendar.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarOccurrenceItem {
    /// Macro user id of the teammate whose calendar the occurrence is on.
    owner_id: String,
    /// The teammate's calendar event id.
    event_id: Uuid,
    /// Stable occurrence key within the event.
    occurrence_key: String,
    /// Occurrence time span.
    time: EventTime,
    /// Event status: confirmed or tentative.
    status: EventStatus,
    /// Whether the occurrence blocks the teammate's availability.
    transparency: EventTransparency,
    /// Provider event type; `default` for regular events.
    event_type: EventType,
    /// The sharing policy applied to this occurrence.
    sharing: TeamCalendarSharing,
    /// Event details, absent when the teammate shares busy time only or
    /// the event's visibility withholds them.
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<TeamCalendarEventDetails>,
}

/// Team calendar viewport response.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamCalendarResponse {
    /// The requester's teammates and what each shares, whether or not they
    /// have occurrences in the viewport.
    members: Vec<TeamCalendarMemberItem>,
    /// Teammates' occurrences in the viewport, soonest first.
    items: Vec<TeamCalendarOccurrenceItem>,
    /// Whether the viewport held more occurrences than the limit.
    has_more: bool,
}

/// Return teammates' calendar occurrences in the requested viewport, with
/// each teammate's sharing policy applied.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    get,
    path = "/calendar-events/team",
    tag = "calendar_events",
    params(TeamCalendarQuery),
    responses(
        (status = 200, description = "Teammates' calendar occurrences in the requested viewport", body = TeamCalendarResponse),
        (status = 400, description = "Invalid or unsupported calendar viewport"),
        (status = 401, description = "Authentication required"),
        (status = 500, description = "Calendar query failed"),
    )
)]
pub async fn list_team_occurrences<S, Auth>(
    State(state): State<CalendarRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<TeamCalendarQuery>,
) -> Result<Json<TeamCalendarResponse>, CalendarApiError>
where
    S: CalendarOccurrenceService,
    Auth: MacroAuthorizationService,
{
    let requester_id = user.authorization.user.macro_user_id.as_ref();
    let default_end_date = default_end_date(query.end);
    let range = OccurrenceRange {
        starts_at: query.start,
        ends_at: query.end,
        start_date: query.start_date.unwrap_or_else(|| query.start.date_naive()),
        end_date: query
            .end_date
            .or(default_end_date)
            .ok_or(CalendarApiError {
                status: StatusCode::BAD_REQUEST,
                message: "calendar end is outside the supported date range",
            })?,
    };
    let (limit, repository_limit) = query_limits(query.limit)?;
    let members = state
        .service
        .list_team_calendar_members(requester_id)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "failed to query team calendar members");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query team calendar",
            }
        })?;
    let mut occurrences = state
        .service
        .list_team_occurrences(requester_id, range, None, repository_limit)
        .await
        .map_err(|error| {
            if error
                .as_ref()
                .downcast_current_context::<CalendarValidationError>()
                .is_some()
            {
                return CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar range must be positive, at most 370 days, inside the maintained one-year-history/two-year-future window, with limit 1–2000",
                };
            }
            tracing::error!(error = ?error, "failed to query team calendar occurrences");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query team calendar",
            }
        })?;
    let has_more = occurrences.len() > usize::from(limit);
    occurrences.truncate(usize::from(limit));
    let items = occurrences
        .into_iter()
        .map(|row| TeamCalendarOccurrenceItem {
            owner_id: row.owner_id,
            event_id: row.event_id,
            occurrence_key: row.occurrence_key,
            time: row.time,
            status: row.status,
            transparency: row.transparency,
            event_type: row.event_type,
            sharing: row.sharing,
            details: row.details.map(|details| TeamCalendarEventDetails {
                title: details.title,
                description: details.description,
                location: details.location,
                conference_url: details.conference_url,
                organizer_email: details.organizer_email,
                organizer_name: details.organizer_name,
                attendees: details.attendees,
            }),
        })
        .collect();
    let members = members
        .into_iter()
        .map(|member| TeamCalendarMemberItem {
            user_id: member.user_id,
            sharing: member.sharing,
            has_calendar: member.has_calendar,
        })
        .collect();

    Ok(Json(TeamCalendarResponse {
        members,
        items,
        has_more,
    }))
}

/// One mentioned event to resolve for the requester.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMentionPreviewRequestItem {
    /// Mentioned calendar event id.
    event_id: Uuid,
    /// Occurrence the mention points at, when it targets one instance.
    occurrence_key: Option<String>,
}

/// Batch calendar mention preview request.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMentionPreviewRequest {
    /// Mentioned events to resolve, at most 100.
    items: Vec<CalendarMentionPreviewRequestItem>,
}

/// Requester-relative visibility of one mentioned event.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarMentionPreviewKind {
    /// The requester holds a copy of the meeting on a visible calendar.
    Access,
    /// The event exists but is on no calendar the requester can see.
    NoAccess,
    /// No live event has this id.
    DoesNotExist,
}

/// Resolution of one mentioned event, in request order.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMentionPreviewItem {
    /// The mentioned event id, echoed from the request.
    event_id: Uuid,
    /// Visibility of the mentioned event to the requester.
    #[serde(rename = "type")]
    kind: CalendarMentionPreviewKind,
    /// Preview of the requester's own copy, present only with access.
    #[serde(skip_serializing_if = "Option::is_none")]
    event: Option<CalendarMentionEvent>,
}

/// Batch calendar mention preview response.
#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CalendarMentionPreviewResponse {
    items: Vec<CalendarMentionPreviewItem>,
}

/// Resolve mentioned calendar events to the requester's own projections.
#[tracing::instrument(skip_all, err)]
#[utoipa::path(
    post,
    path = "/calendar-events/preview",
    tag = "calendar_events",
    request_body = CalendarMentionPreviewRequest,
    responses(
        (status = 200, description = "Requester-relative previews for the mentioned events", body = CalendarMentionPreviewResponse),
        (status = 400, description = "Too many events in one request"),
        (status = 401, description = "Authentication required"),
        (status = 500, description = "Calendar query failed"),
    )
)]
pub async fn mention_previews<S, Auth>(
    State(state): State<CalendarRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<CalendarMentionPreviewRequest>,
) -> Result<Json<CalendarMentionPreviewResponse>, CalendarApiError>
where
    S: CalendarOccurrenceService,
    Auth: MacroAuthorizationService,
{
    let requested_ids: Vec<Uuid> = request.items.iter().map(|item| item.event_id).collect();
    let items = request
        .items
        .into_iter()
        .map(|item| CalendarMentionRequestItem {
            event_id: item.event_id,
            occurrence_key: item.occurrence_key,
        })
        .collect();
    let previews = state
        .service
        .mention_previews(user.authorization.user.macro_user_id.as_ref(), items)
        .await
        .map_err(|error| {
            if error
                .as_ref()
                .downcast_current_context::<CalendarValidationError>()
                .is_some()
            {
                return CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar mention previews accept at most 100 events per request",
                };
            }
            tracing::error!(error = ?error, "failed to resolve calendar mention previews");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to resolve calendar mention previews",
            }
        })?;

    // Positional pairing is only sound with one preview per requested item,
    // which the port guarantees — treat any drift as a server error rather
    // than silently mispairing.
    if previews.len() != requested_ids.len() {
        tracing::error!(
            requested = requested_ids.len(),
            resolved = previews.len(),
            "calendar mention preview resolution returned a mismatched item count"
        );
        return Err(CalendarApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: "unable to resolve calendar mention previews",
        });
    }
    let items = requested_ids
        .into_iter()
        .zip(previews)
        .map(|(event_id, preview)| match preview {
            CalendarMentionPreview::Accessible(event) => CalendarMentionPreviewItem {
                event_id,
                kind: CalendarMentionPreviewKind::Access,
                event: Some(*event),
            },
            CalendarMentionPreview::NoAccess => CalendarMentionPreviewItem {
                event_id,
                kind: CalendarMentionPreviewKind::NoAccess,
                event: None,
            },
            CalendarMentionPreview::DoesNotExist => CalendarMentionPreviewItem {
                event_id,
                kind: CalendarMentionPreviewKind::DoesNotExist,
                event: None,
            },
        })
        .collect();

    Ok(Json(CalendarMentionPreviewResponse { items }))
}

fn decode_cursor(
    cursor: Option<String>,
) -> Result<Option<CalendarOccurrenceCursor>, CalendarApiError> {
    cursor
        .map(|cursor| {
            Base64Str::new_from_string(cursor)
                .decode_json()
                .map_err(|_| CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar cursor is invalid",
                })
        })
        .transpose()
}

fn query_limits(requested: Option<u16>) -> Result<(u16, u16), CalendarApiError> {
    let limit = requested.unwrap_or(1000);
    if !(1..=2000).contains(&limit) {
        return Err(CalendarApiError {
            status: StatusCode::BAD_REQUEST,
            message: "calendar limit must be between 1 and 2000",
        });
    }
    Ok((limit, limit + 1))
}

fn default_end_date(end: DateTime<Utc>) -> Option<NaiveDate> {
    if end.time() == NaiveTime::MIN {
        Some(end.date_naive())
    } else {
        end.date_naive().succ_opt()
    }
}
