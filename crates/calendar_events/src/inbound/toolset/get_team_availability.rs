//! GetTeamAvailability tool: when teammates are busy, and when they are all
//! free, inside a window.

use std::collections::{BTreeMap, HashSet};

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rootcause::compat::boxed_error::IntoBoxedError;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CalendarToolContext, time_fields};
use crate::domain::{
    models::{
        EventTime, OccurrenceRange, TeamCalendarMember, TeamCalendarOccurrence, TeamCalendarSharing,
    },
    ports::{CalendarMutationService, CalendarOccurrenceService},
    service::CalendarValidationError,
};

/// The most teammate occurrences one call reads; wider windows report
/// truncation.
const OCCURRENCES_MAX: u16 = 2000;

/// The most busy blocks reported per teammate.
const BUSY_BLOCKS_MAX: usize = 100;

/// The most shared free windows reported.
const FREE_WINDOWS_MAX: usize = 50;

/// The most teammates one call can be narrowed to.
const USER_IDS_MAX: usize = 50;

/// One span during which a teammate is busy.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamBusyBlock {
    /// Block start: RFC 3339 UTC instant, or YYYY-MM-DD for all-day events.
    pub start: String,
    /// Exclusive block end: RFC 3339 UTC instant, or YYYY-MM-DD for all-day
    /// events.
    pub end: String,
    /// Whether the block covers whole days.
    pub is_all_day: bool,
    /// Event status: confirmed or tentative.
    pub status: String,
    /// Event title, present only when the teammate shares event details and
    /// the event is not private.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Provider event type for status-style events (out_of_office,
    /// focus_time); absent for regular events.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
}

/// One teammate's availability inside the window.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberAvailability {
    /// Macro user id of the teammate, as ListTeamMembers reports it.
    pub user_id: String,
    /// What the teammate shares with the team: `all` (details), `busy_only`
    /// (time only), or `none` (nothing — their `busy` list is always empty
    /// and they are left out of `freeWindows`).
    pub sharing: String,
    /// Whether the teammate has a calendar connected to Macro. Without one
    /// nothing is known about their time and they are left out of
    /// `freeWindows`.
    pub has_calendar: bool,
    /// Busy blocks in the window, soonest first. Transparent (free) events,
    /// working locations, and birthdays never count as busy.
    pub busy: Vec<TeamBusyBlock>,
    /// Whether more busy blocks existed than were returned.
    pub busy_truncated: bool,
}

/// A span during which every teammate counted is free.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamFreeWindow {
    /// Window start, RFC 3339 UTC.
    pub start: String,
    /// Exclusive window end, RFC 3339 UTC.
    pub end: String,
}

/// Response from the GetTeamAvailability tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetTeamAvailabilityResponse {
    /// Every teammate considered, whether or not they are busy.
    pub members: Vec<TeamMemberAvailability>,
    /// Spans inside the window when every teammate who shares a connected
    /// calendar is free, soonest first. Covers the whole window including
    /// nights and weekends; apply working hours when suggesting a time.
    pub free_windows: Vec<TeamFreeWindow>,
    /// Whether more free windows existed than were returned.
    pub free_windows_truncated: bool,
    /// Requested user ids that are not on the user's team, ignored.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unknown_user_ids: Vec<String>,
    /// IANA time zone of the user's primary calendar, for reading all-day
    /// blocks (which are treated as UTC days when computing free windows).
    pub time_zone: Option<String>,
    /// Whether the window held more teammate occurrences than were read;
    /// `freeWindows` may then be optimistic — narrow the window.
    pub truncated: bool,
    /// A human-readable summary of the result.
    pub summary: String,
}

/// Read teammates' availability in a time window.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "GetTeamAvailability",
    description = "\
Find out when the user's teammates are busy and when they are all free between two instants. \
Use it for questions like \"when is my team free this week?\", \"is Alex available Thursday \
afternoon?\", or to pick a meeting time before CreateCalendarEvent. Each teammate controls what \
the team sees: `all` shares event titles, `busy_only` shares only the time, and `none` shares \
nothing — say so rather than guessing when a teammate shares nothing or has no calendar \
connected. `freeWindows` spans the whole window, so restrict suggestions to working hours \
yourself. Keep the window narrow — a day or a week — and no wider than 370 days, within one \
year past to two years future. Pass `userIds` (from ListTeamMembers) to ask about specific \
people; omit it for the whole team."
)]
pub struct GetTeamAvailability {
    /// Inclusive window start, RFC 3339 UTC (e.g. 2026-08-20T00:00:00Z).
    #[schemars(description = "Inclusive window start, RFC 3339 UTC (e.g. 2026-08-20T00:00:00Z).")]
    pub start: DateTime<Utc>,
    /// Exclusive window end, RFC 3339 UTC.
    #[schemars(description = "Exclusive window end, RFC 3339 UTC. Must be after start.")]
    pub end: DateTime<Utc>,
    /// Teammates to consider; every teammate when omitted.
    #[schemars(
        description = "Macro user ids of the teammates to consider, as returned by ListTeamMembers. \
                       Omit to consider the whole team."
    )]
    pub user_ids: Option<Vec<String>>,
}

impl ToolAnnotated for GetTeamAvailability {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Get team availability");
}

#[async_trait]
impl<M, O> AsyncTool<CalendarToolContext<M, O>> for GetTeamAvailability
where
    M: CalendarMutationService,
    O: CalendarOccurrenceService,
{
    type Output = GetTeamAvailabilityResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CalendarToolContext<M, O>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Get team availability");

        if self.end <= self.start {
            return Err(ToolCallError {
                description: "The window is invalid: end must be after start.".to_string(),
                internal_error: anyhow::anyhow!("team availability window end precedes start"),
            });
        }
        if self
            .user_ids
            .as_ref()
            .is_some_and(|ids| ids.len() > USER_IDS_MAX)
        {
            return Err(ToolCallError {
                description: format!(
                    "Too many userIds: ask about at most {USER_IDS_MAX} teammates at once, or \
                     omit userIds for the whole team."
                ),
                internal_error: anyhow::anyhow!("team availability asked about too many users"),
            });
        }

        let requester_id = request_context.user_id.to_string();
        let range = OccurrenceRange {
            starts_at: self.start,
            ends_at: self.end,
            start_date: self.start.date_naive(),
            end_date: super::list_calendar_events::end_date_bound(self.end),
        };

        let all_members = service_context
            .occurrences
            .list_team_calendar_members(&requester_id)
            .await
            .map_err(|error| ToolCallError {
                description: "Failed to look up the user's team. Try again shortly.".to_string(),
                internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
            })?;
        let (members, unknown_user_ids) = select_members(all_members, self.user_ids.as_deref());

        // Nothing to read when no teammate was selected: an empty owner list
        // would otherwise mean "everyone" at the repository.
        let mut rows = if members.is_empty() {
            Vec::new()
        } else {
            let owner_ids: Vec<String> = members
                .iter()
                .map(|member| member.user_id.clone())
                .collect();
            service_context
                .occurrences
                .list_team_occurrences(
                    &requester_id,
                    range,
                    self.user_ids.as_ref().map(|_| owner_ids.as_slice()),
                    OCCURRENCES_MAX + 1,
                )
                .await
                .map_err(list_error)?
        };
        let truncated = rows.len() > usize::from(OCCURRENCES_MAX);
        rows.truncate(usize::from(OCCURRENCES_MAX));

        let time_zone = service_context
            .occurrences
            .primary_time_zone(&requester_id)
            .await
            .map_err(|error| ToolCallError {
                description: "Failed to resolve the user's calendar time zone. Try again shortly."
                    .to_string(),
                internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
            })?;

        let response = build_response(self.start, self.end, members, rows, unknown_user_ids);
        Ok(GetTeamAvailabilityResponse {
            time_zone,
            truncated,
            summary: build_summary(&response, truncated),
            ..response
        })
    }
}

/// Keep the teammates the request named, in team order, and report the
/// requested ids that are not teammates. Requested ids never widen the
/// result: the repository already scopes reads to the requester's team.
fn select_members(
    members: Vec<TeamCalendarMember>,
    user_ids: Option<&[String]>,
) -> (Vec<TeamCalendarMember>, Vec<String>) {
    let Some(user_ids) = user_ids else {
        return (members, Vec::new());
    };
    let requested: HashSet<&str> = user_ids.iter().map(String::as_str).collect();
    let known: HashSet<&str> = members
        .iter()
        .map(|member| member.user_id.as_str())
        .collect();
    let mut unknown: Vec<String> = user_ids
        .iter()
        .filter(|id| !known.contains(id.as_str()))
        .cloned()
        .collect();
    unknown.sort();
    unknown.dedup();
    let selected = members
        .into_iter()
        .filter(|member| requested.contains(member.user_id.as_str()))
        .collect();
    (selected, unknown)
}

/// Assemble per-teammate busy blocks and the windows when everyone counted
/// is free. Pure, so the merge logic is unit-testable without a service.
fn build_response(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    members: Vec<TeamCalendarMember>,
    rows: Vec<TeamCalendarOccurrence>,
    unknown_user_ids: Vec<String>,
) -> GetTeamAvailabilityResponse {
    let mut by_owner: BTreeMap<&str, Vec<&TeamCalendarOccurrence>> = BTreeMap::new();
    for row in rows.iter().filter(|row| row.is_busy()) {
        by_owner.entry(row.owner_id.as_str()).or_default().push(row);
    }

    let mut busy_spans: Vec<(DateTime<Utc>, DateTime<Utc>)> = Vec::new();
    let members: Vec<TeamMemberAvailability> = members
        .into_iter()
        .map(|member| {
            let counted = member.sharing != TeamCalendarSharing::None && member.has_calendar;
            let occurrences = by_owner
                .get(member.user_id.as_str())
                .map(Vec::as_slice)
                .unwrap_or_default();
            if counted {
                busy_spans.extend(occurrences.iter().map(|row| span(&row.time)));
            }
            let busy_truncated = occurrences.len() > BUSY_BLOCKS_MAX;
            let busy = occurrences
                .iter()
                .take(BUSY_BLOCKS_MAX)
                .map(|row| {
                    let (start, end, is_all_day, _) = time_fields(&row.time);
                    TeamBusyBlock {
                        start,
                        end,
                        is_all_day,
                        status: row.status.as_str().to_string(),
                        title: row.details.as_ref().map(|details| details.title.clone()),
                        event_type: (!row.event_type.is_default())
                            .then(|| row.event_type.as_str().to_string()),
                    }
                })
                .collect();
            TeamMemberAvailability {
                user_id: member.user_id,
                sharing: member.sharing.as_str().to_string(),
                has_calendar: member.has_calendar,
                busy,
                busy_truncated,
            }
        })
        .collect();

    let free = free_windows(start, end, busy_spans);
    let free_windows_truncated = free.len() > FREE_WINDOWS_MAX;
    let free_windows = free
        .into_iter()
        .take(FREE_WINDOWS_MAX)
        .map(|(start, end)| TeamFreeWindow {
            start: start.to_rfc3339(),
            end: end.to_rfc3339(),
        })
        .collect();

    GetTeamAvailabilityResponse {
        members,
        free_windows,
        free_windows_truncated,
        unknown_user_ids,
        time_zone: None,
        truncated: false,
        summary: String::new(),
    }
}

/// The instant span an occurrence occupies. All-day events span their local
/// dates read as UTC days, the best available without a per-owner zone.
fn span(time: &EventTime) -> (DateTime<Utc>, DateTime<Utc>) {
    match time {
        EventTime::Timed {
            starts_at, ends_at, ..
        } => (*starts_at, *ends_at),
        EventTime::AllDay {
            start_date,
            end_date,
        } => (
            start_date
                .and_hms_opt(0, 0, 0)
                .expect("midnight is a valid time")
                .and_utc(),
            end_date
                .and_hms_opt(0, 0, 0)
                .expect("midnight is a valid time")
                .and_utc(),
        ),
    }
}

/// The gaps inside `[start, end)` not covered by any busy span, soonest
/// first. Spans may overlap or touch; they are merged first.
pub(super) fn free_windows(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    mut busy: Vec<(DateTime<Utc>, DateTime<Utc>)>,
) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    busy.retain(|(busy_start, busy_end)| busy_end > &start && busy_start < &end);
    busy.sort();
    let mut free = Vec::new();
    let mut cursor = start;
    for (busy_start, busy_end) in busy {
        if busy_start > cursor {
            free.push((cursor, busy_start));
        }
        if busy_end > cursor {
            cursor = busy_end;
        }
    }
    if cursor < end {
        free.push((cursor, end));
    }
    free
}

/// Map a team occurrence query failure to an agent-readable tool error.
fn list_error(error: rootcause::Report) -> ToolCallError {
    let description = if error
        .as_ref()
        .downcast_current_context::<CalendarValidationError>()
        .is_some()
    {
        "The window is invalid: it must be positive, at most 370 days, and within one year past \
         to two years future."
            .to_string()
    } else {
        "Failed to query the team's calendars. Try again shortly.".to_string()
    };
    ToolCallError {
        description,
        internal_error: anyhow::Error::from_boxed(error.into_boxed_error()),
    }
}

fn build_summary(response: &GetTeamAvailabilityResponse, truncated: bool) -> String {
    let counted = response
        .members
        .iter()
        .filter(|member| member.sharing != "none" && member.has_calendar)
        .count();
    let sharing_nothing = response
        .members
        .iter()
        .filter(|member| member.sharing == "none")
        .count();
    let no_calendar = response
        .members
        .iter()
        .filter(|member| member.sharing != "none" && !member.has_calendar)
        .count();
    let mut summary = match response.members.len() {
        0 => "No teammates to check.".to_string(),
        total => format!(
            "Checked {total} teammate{}; {counted} share a connected calendar.",
            if total == 1 { "" } else { "s" }
        ),
    };
    if counted > 0 {
        summary.push_str(&format!(
            " {} free window{} when all of them are free.",
            response.free_windows.len(),
            if response.free_windows.len() == 1 {
                ""
            } else {
                "s"
            }
        ));
    }
    if sharing_nothing > 0 {
        summary.push_str(&format!(
            " {sharing_nothing} share{} nothing with the team.",
            if sharing_nothing == 1 { "s" } else { "" }
        ));
    }
    if no_calendar > 0 {
        summary.push_str(&format!(
            " {no_calendar} {} no calendar connected.",
            if no_calendar == 1 { "has" } else { "have" }
        ));
    }
    if !response.unknown_user_ids.is_empty() {
        summary.push_str(" Some requested user ids are not on the team and were ignored.");
    }
    if truncated {
        summary.push_str(
            " The window held more events than were read; free windows may be optimistic — \
             narrow the window.",
        );
    }
    summary
}
