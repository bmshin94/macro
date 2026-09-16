use std::sync::Mutex;

use ai_toolset::schema::generate_validated_input_schema;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolSet};
use chrono::{NaiveDate, TimeZone, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, CalendarEventDraft, CalendarEventPatch,
    CalendarOccurrence, CalendarSyncStatus, ConferenceChange, EventReminderOverride,
    EventReminders, EventStatus, EventTransparency, EventType, EventVisibility, OccurrenceRange,
    TeamCalendarMember, TeamCalendarOccurrence, TeamCalendarOccurrenceDetails, TeamCalendarSharing,
    VisibleCalendar,
};
use crate::domain::ports::{
    CalendarDeletionScope, CalendarMutationError, CalendarMutationService,
    CalendarOccurrenceService, CalendarRsvpScope, CalendarUpdateScope,
};

#[test]
fn tool_input_schemas_satisfy_strict_mode() {
    for (name, result) in [
        (
            "ListCalendarEvents",
            generate_validated_input_schema::<ListCalendarEvents>().map(|schema| schema.name),
        ),
        (
            "ListCalendars",
            generate_validated_input_schema::<ListCalendars>().map(|schema| schema.name),
        ),
        (
            "CreateCalendarEvent",
            generate_validated_input_schema::<CreateCalendarEvent>().map(|schema| schema.name),
        ),
        (
            "UpdateCalendarEvent",
            generate_validated_input_schema::<UpdateCalendarEvent>().map(|schema| schema.name),
        ),
        (
            "DeleteCalendarEvent",
            generate_validated_input_schema::<DeleteCalendarEvent>().map(|schema| schema.name),
        ),
        (
            "GetTeamAvailability",
            generate_validated_input_schema::<GetTeamAvailability>().map(|schema| schema.name),
        ),
    ] {
        match result {
            Ok(schema_name) => assert_eq!(schema_name, name, "schema title for {name}"),
            Err(error) => panic!("schema for {name} failed validation: {error:?}"),
        }
    }
}

#[test]
fn event_time_input_deserializes_both_shapes() {
    let timed: EventTimeInput = serde_json::from_value(serde_json::json!({
        "kind": "timed",
        "startsAt": "2026-08-20T17:00:00Z",
        "endsAt": "2026-08-20T18:00:00Z",
        "timeZone": "America/New_York",
    }))
    .unwrap();
    assert!(matches!(timed, EventTimeInput::Timed { .. }));

    let all_day: EventTimeInput = serde_json::from_value(serde_json::json!({
        "kind": "allDay",
        "startDate": "2026-08-20",
        "endDate": "2026-08-21",
    }))
    .unwrap();
    assert!(matches!(all_day, EventTimeInput::AllDay { .. }));
}

fn sample_event(recurrence_lines: Vec<String>) -> crate::domain::models::CalendarEvent {
    crate::domain::models::CalendarEvent {
        id: Uuid::from_u128(7),
        owner_id: "macro|owner@example.com".to_string(),
        ical_uid: "uid-1".to_string(),
        calendar_id: Some(Uuid::from_u128(9)),
        sources: Vec::new(),
        title: "Standup".to_string(),
        description: Some("Daily sync".to_string()),
        location: Some("Room 1".to_string()),
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: EventTime::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 18, 0, 0).unwrap(),
            time_zone: Some("America/New_York".to_string()),
        },
        recurrence_lines,
        organizer_email: Some("owner@example.com".to_string()),
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: Some("https://meet.google.com/abc".to_string()),
        conference_provider: Some(crate::domain::models::ConferenceProvider::GoogleMeet),
        sequence: 0,
        is_read_only: false,
        attendees: vec![
            CalendarAttendee {
                email: "owner@example.com".to_string(),
                display_name: None,
                response_status: AttendeeResponseStatus::Accepted,
                is_organizer: true,
                is_optional: false,
                is_self: true,
                comment: None,
            },
            CalendarAttendee {
                email: "guest@example.com".to_string(),
                display_name: None,
                response_status: AttendeeResponseStatus::NeedsAction,
                is_organizer: false,
                is_optional: true,
                is_self: false,
                comment: None,
            },
        ],
        reminders: EventReminders::default(),
        created_at: Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
    }
}

fn occurrence_of(
    event: &crate::domain::models::CalendarEvent,
    key: &str,
    is_cancelled: bool,
) -> CalendarOccurrence {
    CalendarOccurrence {
        event_id: event.id,
        occurrence_key: key.to_string(),
        recurrence_id: None,
        time: event.time.clone(),
        is_cancelled,
    }
}

type RecordedCreate = (Option<Uuid>, Option<Uuid>, CalendarEventDraft);

#[derive(Default)]
struct MockMutations {
    created: Mutex<Vec<RecordedCreate>>,
    create_error: Mutex<Option<CalendarMutationError>>,
    updated: Mutex<Vec<(Uuid, CalendarEventPatch, CalendarUpdateScope)>>,
    deleted: Mutex<Vec<(Uuid, CalendarDeletionScope)>>,
    answered: Mutex<Vec<(Uuid, AttendeeResponseStatus, CalendarRsvpScope)>>,
    calendars: Mutex<Vec<VisibleCalendar>>,
}

impl CalendarMutationService for MockMutations {
    async fn create_event(
        &self,
        _requester_id: &str,
        email_link_id: Option<Uuid>,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<crate::domain::models::CalendarEvent, CalendarMutationError> {
        if let Some(error) = self.create_error.lock().unwrap().take() {
            return Err(error);
        }
        self.created
            .lock()
            .unwrap()
            .push((email_link_id, calendar_id, draft));
        Ok(sample_event(Vec::new()))
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, CalendarMutationError> {
        Ok(self.calendars.lock().unwrap().clone())
    }

    async fn update_event(
        &self,
        _requester_id: &str,
        event_id: Uuid,
        _calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<crate::domain::models::CalendarEvent, CalendarMutationError> {
        self.updated.lock().unwrap().push((event_id, patch, scope));
        Ok(sample_event(Vec::new()))
    }

    async fn delete_event(
        &self,
        _requester_id: &str,
        event_id: Uuid,
        _calendar_id: Option<Uuid>,
        scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        self.deleted.lock().unwrap().push((event_id, scope));
        Ok(())
    }

    async fn respond_to_event(
        &self,
        _requester_id: &str,
        event_id: Uuid,
        _calendar_id: Option<Uuid>,
        response: AttendeeResponseStatus,
        scope: CalendarRsvpScope,
    ) -> Result<crate::domain::models::CalendarEvent, CalendarMutationError> {
        self.answered
            .lock()
            .unwrap()
            .push((event_id, response, scope));
        Ok(sample_event(Vec::new()))
    }

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("no calendar tool disconnects calendars")
    }

    async fn team_calendar_sharing(
        &self,
        _requester_id: &str,
    ) -> Result<crate::domain::models::TeamCalendarSharing, CalendarMutationError> {
        unreachable!("no calendar tool reads the team sharing setting")
    }

    async fn set_team_calendar_sharing(
        &self,
        _requester_id: &str,
        _sharing: crate::domain::models::TeamCalendarSharing,
    ) -> Result<crate::domain::models::TeamCalendarSharing, CalendarMutationError> {
        unreachable!("no calendar tool writes the team sharing setting")
    }
}

struct MockOccurrences {
    rows: Mutex<Vec<(crate::domain::models::CalendarEvent, CalendarOccurrence)>>,
    status: CalendarSyncStatus,
    team_members: Mutex<Vec<crate::domain::models::TeamCalendarMember>>,
    team_rows: Mutex<Vec<crate::domain::models::TeamCalendarOccurrence>>,
}

impl CalendarOccurrenceService for MockOccurrences {
    async fn list_occurrences(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        cursor: Option<crate::domain::models::CalendarOccurrenceCursor>,
        limit: u16,
    ) -> Result<Vec<(crate::domain::models::CalendarEvent, CalendarOccurrence)>, rootcause::Report>
    {
        let rows = self.rows.lock().unwrap().clone();
        let start = cursor
            .map(|cursor| {
                rows.iter()
                    .position(|(_, occurrence)| occurrence.occurrence_key == cursor.occurrence_key)
                    .map_or(rows.len(), |position| position + 1)
            })
            .unwrap_or(0);
        let mut page: Vec<_> = rows.into_iter().skip(start).collect();
        page.truncate(usize::from(limit));
        Ok(page)
    }

    async fn sync_status(
        &self,
        _requester_id: &str,
    ) -> Result<CalendarSyncStatus, rootcause::Report> {
        Ok(self.status)
    }

    async fn mention_previews(
        &self,
        _requester_id: &str,
        _items: Vec<crate::domain::models::CalendarMentionRequestItem>,
    ) -> Result<Vec<crate::domain::models::CalendarMentionPreview>, rootcause::Report> {
        unreachable!("no calendar tool resolves mention previews")
    }

    async fn list_team_out_of_office(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _limit: u16,
    ) -> Result<Vec<crate::domain::models::TeamOutOfOffice>, rootcause::Report> {
        unreachable!("no calendar tool lists team out-of-office")
    }

    async fn list_team_calendar_members(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<crate::domain::models::TeamCalendarMember>, rootcause::Report> {
        Ok(self.team_members.lock().unwrap().clone())
    }

    async fn list_team_occurrences(
        &self,
        _requester_id: &str,
        range: OccurrenceRange,
        owner_ids: Option<&[String]>,
        limit: u16,
    ) -> Result<Vec<crate::domain::models::TeamCalendarOccurrence>, rootcause::Report> {
        let mut rows: Vec<_> = self
            .team_rows
            .lock()
            .unwrap()
            .iter()
            .filter(|row| row.time.overlaps(&range))
            .filter(|row| owner_ids.is_none_or(|ids| ids.contains(&row.owner_id)))
            .cloned()
            .collect();
        rows.truncate(usize::from(limit));
        Ok(rows)
    }

    async fn primary_time_zone(
        &self,
        _requester_id: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        Ok(Some("America/New_York".to_string()))
    }
}

fn context(
    mutations: MockMutations,
    occurrences: MockOccurrences,
) -> (
    std::sync::Arc<MockMutations>,
    ServiceContext<CalendarToolContext<MockMutations, MockOccurrences>>,
) {
    let mutations = std::sync::Arc::new(mutations);
    let context = CalendarToolContext::new(mutations.clone(), std::sync::Arc::new(occurrences));
    (mutations, ServiceContext(context))
}

fn request_context() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap())
}

fn empty_occurrences() -> MockOccurrences {
    MockOccurrences {
        rows: Mutex::new(Vec::new()),
        status: CalendarSyncStatus::Ready,
        team_members: Mutex::new(Vec::new()),
        team_rows: Mutex::new(Vec::new()),
    }
}

fn create_tool_args() -> serde_json::Value {
    serde_json::json!({
        "title": "Design review",
        "time": {
            "kind": "timed",
            "startsAt": "2026-08-20T17:00:00Z",
            "endsAt": "2026-08-20T18:00:00Z",
            "timeZone": "America/New_York"
        },
        "attendees": [],
        "recurrenceLines": [],
        "addGoogleMeet": false
    })
}

#[tokio::test]
async fn ai_toolset_defers_create_without_mutating_calendar() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let args = create_tool_args();
    let pending = calendar_toolset()
        .try_tool_call(context.0, request_context(), "CreateCalendarEvent", &args)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(pending, serde_json::json!("PendingUserExecution"));
    assert!(mutations.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mcp_toolset_executes_create_directly() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let args = create_tool_args();
    let event = mcp_toolset()
        .try_tool_call(context.0, request_context(), "CreateCalendarEvent", &args)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(event["eventId"], Uuid::from_u128(7).to_string());
    assert_eq!(mutations.created.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn create_converts_input_into_a_domain_draft() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let calendar_id = Uuid::from_u128(3);

    let tool = CreateCalendarEvent {
        title: "Design review".to_string(),
        time: EventTimeInput::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 8, 22).unwrap(),
        },
        description: Some("Quarterly".to_string()),
        location: None,
        attendees: vec![AttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: true,
        }],
        recurrence_lines: vec!["RRULE:FREQ=WEEKLY".to_string()],
        calendar_id: Some(calendar_id),
        reminders: Some(EventRemindersInput {
            use_default: false,
            overrides: vec![EventReminderOverrideInput {
                method: "popup".to_string(),
                minutes: 15,
            }],
        }),
        add_google_meet: true,
        event_type: CalendarEventTypeInput::Default,
        out_of_office: None,
    };
    let response = tool.call(context, request_context()).await.unwrap();
    assert_eq!(response.event_id, Uuid::from_u128(7));

    let created = mutations.created.lock().unwrap();
    let (email_link_id, target_calendar, draft) = created.first().expect("one create call");
    assert_eq!(*email_link_id, None);
    assert_eq!(*target_calendar, Some(calendar_id));
    assert_eq!(draft.title, "Design review");
    assert_eq!(draft.attendees.len(), 1);
    assert!(draft.attendees[0].is_optional);
    assert_eq!(
        draft.recurrence_lines,
        vec!["RRULE:FREQ=WEEKLY".to_string()]
    );
    assert_eq!(draft.conference, Some(ConferenceChange::GoogleMeet));
    assert_eq!(
        draft.reminders,
        Some(EventReminders {
            use_default: false,
            overrides: vec![EventReminderOverride {
                method: "popup".to_string(),
                minutes: 15,
            }],
        })
    );
    assert!(matches!(draft.time, EventTime::AllDay { .. }));
}

#[tokio::test]
async fn create_maps_out_of_office_input_into_the_draft() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = CreateCalendarEvent {
        title: "Out".to_string(),
        time: EventTimeInput::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 18, 0, 0).unwrap(),
            time_zone: None,
        },
        description: None,
        location: None,
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        calendar_id: None,
        reminders: None,
        add_google_meet: false,
        event_type: CalendarEventTypeInput::OutOfOffice,
        out_of_office: Some(OutOfOfficeInput {
            auto_decline_mode: Some(AutoDeclineModeInput::DeclineAll),
            decline_message: Some("Away".to_string()),
        }),
    };
    tool.call(context, request_context()).await.unwrap();

    let created = mutations.created.lock().unwrap();
    let (_, _, draft) = created.first().expect("one create call");
    let out_of_office = draft
        .out_of_office
        .as_ref()
        .expect("out-of-office properties carried into the draft");
    assert_eq!(
        out_of_office.auto_decline_mode,
        crate::domain::models::OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations
    );
    assert_eq!(out_of_office.decline_message.as_deref(), Some("Away"));
}

#[tokio::test]
async fn create_rejects_out_of_office_settings_on_a_default_event() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = CreateCalendarEvent {
        title: "Regular".to_string(),
        time: EventTimeInput::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 13, 0, 0).unwrap(),
            time_zone: None,
        },
        description: None,
        location: None,
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        calendar_id: None,
        reminders: None,
        add_google_meet: false,
        event_type: CalendarEventTypeInput::Default,
        out_of_office: Some(OutOfOfficeInput::default()),
    };
    tool.call(context, request_context()).await.unwrap_err();
    assert!(mutations.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn create_surfaces_missing_calendar_as_an_actionable_error() {
    let mutations = MockMutations {
        create_error: Mutex::new(Some(CalendarMutationError::NoWritableCalendar)),
        ..Default::default()
    };
    let (_, context) = context(mutations, empty_occurrences());

    let tool = CreateCalendarEvent {
        title: "Lunch".to_string(),
        time: EventTimeInput::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 13, 0, 0).unwrap(),
            time_zone: None,
        },
        description: None,
        location: None,
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        calendar_id: None,
        reminders: None,
        add_google_meet: false,
        event_type: CalendarEventTypeInput::Default,
        out_of_office: None,
    };
    let error = tool.call(context, request_context()).await.unwrap_err();
    assert!(
        error
            .description
            .contains("not connected a Google Calendar"),
        "unexpected description: {}",
        error.description
    );
}

#[tokio::test]
async fn update_converts_input_into_a_domain_patch() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let event_id = Uuid::from_u128(11);

    let tool = UpdateCalendarEvent {
        event_id,
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: Some("Renamed".to_string()),
        description: Some(String::new()),
        location: None,
        time: None,
        attendees: Some(vec![AttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: false,
        }]),
        recurrence_lines: None,
        conference: Some(ConferenceChangeInput::Remove),
        reminders: None,
        rsvp: None,
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    let updated = mutations.updated.lock().unwrap();
    let (patched_id, patch, scope) = updated.first().expect("one update call");
    assert_eq!(*patched_id, event_id);
    assert_eq!(*scope, CalendarUpdateScope::All);
    assert_eq!(patch.title.as_deref(), Some("Renamed"));
    assert_eq!(patch.description.as_deref(), Some(""));
    assert_eq!(patch.location, None);
    assert_eq!(
        patch.attendees.as_ref().map(|attendees| attendees.len()),
        Some(1)
    );
    assert_eq!(patch.conference, Some(ConferenceChange::Removed));
    assert!(patch.out_of_office.is_none());
}

#[tokio::test]
async fn update_maps_out_of_office_settings_into_the_patch() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let event_id = Uuid::from_u128(11);

    let tool = UpdateCalendarEvent {
        event_id,
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: None,
        out_of_office: Some(OutOfOfficeInput {
            auto_decline_mode: Some(AutoDeclineModeInput::DeclineNewOnly),
            decline_message: None,
        }),
    };
    tool.call(context, request_context()).await.unwrap();

    let updated = mutations.updated.lock().unwrap();
    let (_, patch, _) = updated.first().expect("one update call");
    let out_of_office = patch
        .out_of_office
        .as_ref()
        .expect("out-of-office settings carried into the patch");
    assert_eq!(
        out_of_office.auto_decline_mode,
        crate::domain::models::OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations
    );
}

#[tokio::test]
async fn update_passes_the_selected_occurrence_scope() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let event_id = Uuid::from_u128(11);

    let tool = UpdateCalendarEvent {
        event_id,
        calendar_id: None,
        scope: UpdateScopeInput::ThisEvent,
        recurrence_id: Some("2026-08-18T20:00:00+00:00".to_string()),
        title: None,
        description: None,
        location: None,
        time: Some(EventTimeInput::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 8, 18, 20, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 8, 18, 22, 0, 0).unwrap(),
            time_zone: None,
        }),
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: None,
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    let updated = mutations.updated.lock().unwrap();
    let (_, _, scope) = updated.first().expect("one update call");
    assert_eq!(
        *scope,
        CalendarUpdateScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        }
    );
}

#[tokio::test]
async fn scoped_update_requires_a_recurrence_id() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::ThisEvent,
        recurrence_id: None,
        title: Some("Renamed".to_string()),
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: None,
        out_of_office: None,
    };
    let error = tool.call(context, request_context()).await.unwrap_err();
    assert!(error.description.contains("recurrenceId"));
    assert!(mutations.updated.lock().unwrap().is_empty());
}

/// A series-wide update carrying an occurrence key is contradictory input;
/// silently dropping the key would apply a one-occurrence intent to the
/// whole series — the exact failure scoping exists to prevent.
#[tokio::test]
async fn series_update_rejects_a_stray_recurrence_id() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: Some("2026-08-18T20:00:00+00:00".to_string()),
        title: Some("Renamed".to_string()),
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: None,
        out_of_office: None,
    };
    let error = tool.call(context, request_context()).await.unwrap_err();
    assert!(error.description.contains("this_event"));
    assert!(mutations.updated.lock().unwrap().is_empty());
}

#[tokio::test]
async fn update_carries_reminders_into_the_patch() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: Some(EventRemindersInput {
            use_default: false,
            overrides: vec![EventReminderOverrideInput {
                method: "popup".to_string(),
                minutes: 30,
            }],
        }),
        rsvp: None,
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    let updated = mutations.updated.lock().unwrap();
    let (_, patch, _) = updated.first().expect("one update call");
    assert_eq!(
        patch.reminders,
        Some(EventReminders {
            use_default: false,
            overrides: vec![EventReminderOverride {
                method: "popup".to_string(),
                minutes: 30,
            }],
        })
    );
}

/// An RSVP is a separate provider call, so a call carrying only one must not
/// also send an empty patch — the domain rejects a patch that changes nothing.
#[tokio::test]
async fn rsvp_alone_answers_without_patching() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let event_id = Uuid::from_u128(11);

    let tool = UpdateCalendarEvent {
        event_id,
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: Some(RsvpResponseInput::Declined),
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    assert!(mutations.updated.lock().unwrap().is_empty());
    let answered = mutations.answered.lock().unwrap();
    assert_eq!(
        *answered.first().expect("one rsvp call"),
        (
            event_id,
            AttendeeResponseStatus::Declined,
            CalendarRsvpScope::All
        )
    );
}

#[tokio::test]
async fn rsvp_follows_the_occurrence_scope_of_the_call() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::ThisEvent,
        recurrence_id: Some("2026-08-18T20:00:00+00:00".to_string()),
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: Some(RsvpResponseInput::Tentative),
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    let answered = mutations.answered.lock().unwrap();
    let (_, response, scope) = answered.first().expect("one rsvp call");
    assert_eq!(*response, AttendeeResponseStatus::Tentative);
    assert_eq!(
        *scope,
        CalendarRsvpScope::ThisEvent {
            recurrence_id: "2026-08-18T20:00:00+00:00".to_string(),
        }
    );
}

/// Replacing the attendee list rewrites every response on the event, so the
/// RSVP has to be recorded after the patch rather than before it.
#[tokio::test]
async fn update_answers_after_applying_the_patch() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: Some(vec![AttendeeInput {
            email: "guest@example.com".to_string(),
            is_optional: false,
        }]),
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: Some(RsvpResponseInput::Accepted),
        out_of_office: None,
    };
    tool.call(context, request_context()).await.unwrap();

    assert_eq!(mutations.updated.lock().unwrap().len(), 1);
    assert_eq!(mutations.answered.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn update_without_a_change_or_an_rsvp_is_rejected() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = UpdateCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: UpdateScopeInput::All,
        recurrence_id: None,
        title: None,
        description: None,
        location: None,
        time: None,
        attendees: None,
        recurrence_lines: None,
        conference: None,
        reminders: None,
        rsvp: None,
        out_of_office: None,
    };
    let error = tool.call(context, request_context()).await.unwrap_err();
    assert!(error.description.contains("changes nothing"));
    assert!(mutations.updated.lock().unwrap().is_empty());
    assert!(mutations.answered.lock().unwrap().is_empty());
}

#[tokio::test]
async fn scoped_deletion_requires_a_recurrence_id() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());

    let tool = DeleteCalendarEvent {
        event_id: Uuid::from_u128(11),
        calendar_id: None,
        scope: DeletionScopeInput::ThisEvent,
        recurrence_id: None,
    };
    let error = tool.call(context, request_context()).await.unwrap_err();
    assert!(error.description.contains("recurrenceId"));
    assert!(mutations.deleted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn deletion_passes_the_selected_scope() {
    let (mutations, context) = context(MockMutations::default(), empty_occurrences());
    let event_id = Uuid::from_u128(11);

    let tool = DeleteCalendarEvent {
        event_id,
        calendar_id: None,
        scope: DeletionScopeInput::ThisAndFollowing,
        recurrence_id: Some("2026-08-20T17:00:00+00:00".to_string()),
    };
    let response = tool.call(context, request_context()).await.unwrap();
    assert_eq!(response.event_id, event_id);

    let deleted = mutations.deleted.lock().unwrap();
    assert_eq!(
        deleted.first(),
        Some(&(
            event_id,
            CalendarDeletionScope::ThisAndFollowing {
                recurrence_id: "2026-08-20T17:00:00+00:00".to_string(),
            }
        ))
    );
}

#[tokio::test]
async fn list_events_maps_occurrences_and_skips_cancelled_ones() {
    let recurring = sample_event(vec!["RRULE:FREQ=DAILY".to_string()]);
    let occurrences = MockOccurrences {
        rows: Mutex::new(vec![
            (recurring.clone(), occurrence_of(&recurring, "k-1", false)),
            (recurring.clone(), occurrence_of(&recurring, "k-2", true)),
        ]),
        status: CalendarSyncStatus::Syncing,
        team_members: Mutex::new(Vec::new()),
        team_rows: Mutex::new(Vec::new()),
    };
    let (_, context) = context(MockMutations::default(), occurrences);

    let tool = ListCalendarEvents {
        start: Utc.with_ymd_and_hms(2026, 8, 20, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 8, 27, 0, 0, 0).unwrap(),
    };
    let response = tool.call(context, request_context()).await.unwrap();

    assert_eq!(response.events.len(), 1, "cancelled occurrence is skipped");
    let item = &response.events[0];
    assert_eq!(item.event_id, recurring.id);
    assert!(item.is_recurring);
    assert_eq!(item.recurrence_id.as_deref(), Some("k-1"));
    assert_eq!(item.my_response.as_deref(), Some("accepted"));
    assert_eq!(item.attendee_count, 2);
    assert!(!item.is_all_day);
    assert_eq!(response.sync_status, "syncing");
    assert!(response.summary.contains("still syncing"));
    assert!(!response.truncated);
}

#[tokio::test]
async fn list_events_reports_truncation() {
    let event = sample_event(Vec::new());
    let max = usize::from(super::list_calendar_events::OCCURRENCES_MAX);
    let rows = (0..max + 1)
        .map(|index| {
            (
                event.clone(),
                occurrence_of(&event, &format!("k-{index}"), false),
            )
        })
        .collect();
    let occurrences = MockOccurrences {
        rows: Mutex::new(rows),
        status: CalendarSyncStatus::Ready,
        team_members: Mutex::new(Vec::new()),
        team_rows: Mutex::new(Vec::new()),
    };
    let (_, context) = context(MockMutations::default(), occurrences);

    let tool = ListCalendarEvents {
        start: Utc.with_ymd_and_hms(2026, 8, 20, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 8, 27, 0, 0, 0).unwrap(),
    };
    let response = tool.call(context, request_context()).await.unwrap();
    assert_eq!(response.events.len(), max);
    assert!(response.truncated);
    assert!(response.summary.contains("narrow the window"));
}

#[tokio::test]
async fn cancelled_occurrences_do_not_count_toward_truncation() {
    let event = sample_event(Vec::new());
    let max = usize::from(super::list_calendar_events::OCCURRENCES_MAX);
    // Exactly the cap of active occurrences plus one cancelled row in the
    // middle: the first page overflows only because of the cancelled row, so
    // the tool must page past it instead of reporting truncation.
    let mut rows: Vec<_> = (0..max)
        .map(|index| {
            (
                event.clone(),
                occurrence_of(&event, &format!("k-{index}"), false),
            )
        })
        .collect();
    rows.insert(
        max / 2,
        (event.clone(), occurrence_of(&event, "k-cancelled", true)),
    );
    let occurrences = MockOccurrences {
        rows: Mutex::new(rows),
        status: CalendarSyncStatus::Ready,
        team_members: Mutex::new(Vec::new()),
        team_rows: Mutex::new(Vec::new()),
    };
    let (_, context) = context(MockMutations::default(), occurrences);

    let tool = ListCalendarEvents {
        start: Utc.with_ymd_and_hms(2026, 8, 20, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 8, 27, 0, 0, 0).unwrap(),
    };
    let response = tool.call(context, request_context()).await.unwrap();
    assert_eq!(response.events.len(), max);
    assert!(!response.truncated);
}

#[tokio::test]
async fn list_calendars_maps_visible_calendars() {
    let mutations = MockMutations {
        calendars: Mutex::new(vec![VisibleCalendar {
            id: Uuid::from_u128(3),
            email_link_id: Uuid::from_u128(4),
            email_address: "gab@example.com".to_string(),
            name: "Work".to_string(),
            color: None,
            is_primary: true,
            is_writable: true,
            is_subscription: false,
            sync_error: None,
            default_reminders: Vec::new(),
        }]),
        ..Default::default()
    };
    let (_, context) = context(mutations, empty_occurrences());

    let response = ListCalendars {}
        .call(context, request_context())
        .await
        .unwrap();
    assert_eq!(response.calendars.len(), 1);
    let calendar = &response.calendars[0];
    assert_eq!(calendar.calendar_id, Uuid::from_u128(3));
    assert_eq!(calendar.email_address, "gab@example.com");
    assert!(calendar.is_primary);
    assert!(calendar.is_writable);
    assert_eq!(response.summary, "Found 1 calendar.");
}

fn team_member(
    user_id: &str,
    sharing: TeamCalendarSharing,
    has_calendar: bool,
) -> TeamCalendarMember {
    TeamCalendarMember {
        user_id: user_id.to_string(),
        sharing,
        has_calendar,
    }
}

/// A teammate's occurrence as the domain service hands it to the tool:
/// details already withheld unless they share them.
fn team_occurrence(
    owner_id: &str,
    key: &str,
    hour: u32,
    minutes: i64,
    sharing: TeamCalendarSharing,
    title: &str,
) -> TeamCalendarOccurrence {
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 20, hour, 0, 0).unwrap();
    TeamCalendarOccurrence {
        owner_id: owner_id.to_string(),
        event_id: Uuid::now_v7(),
        ical_uid: format!("{key}@example.com"),
        occurrence_key: key.to_string(),
        time: EventTime::Timed {
            starts_at,
            ends_at: starts_at + chrono::Duration::minutes(minutes),
            time_zone: Some("UTC".to_string()),
        },
        status: EventStatus::Confirmed,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        visibility: EventVisibility::Default,
        sharing,
        details: sharing
            .shares_details()
            .then(|| TeamCalendarOccurrenceDetails {
                title: title.to_string(),
                description: None,
                location: None,
                conference_url: None,
                organizer_email: None,
                organizer_name: None,
                attendees: Vec::new(),
            }),
    }
}

fn team_occurrences(
    members: Vec<TeamCalendarMember>,
    rows: Vec<TeamCalendarOccurrence>,
) -> MockOccurrences {
    MockOccurrences {
        rows: Mutex::new(Vec::new()),
        status: CalendarSyncStatus::Ready,
        team_members: Mutex::new(members),
        team_rows: Mutex::new(rows),
    }
}

fn workday_window() -> (chrono::DateTime<Utc>, chrono::DateTime<Utc>) {
    (
        Utc.with_ymd_and_hms(2026, 8, 20, 9, 0, 0).unwrap(),
        Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap(),
    )
}

#[tokio::test]
async fn team_availability_reports_busy_blocks_and_shared_free_windows() {
    let alex = "macro|alex@example.com";
    let blair = "macro|blair@example.com";
    let casey = "macro|casey@example.com";
    let devon = "macro|devon@example.com";
    let mut free_meeting = team_occurrence(
        blair,
        "free",
        9,
        30,
        TeamCalendarSharing::BusyOnly,
        "not shown",
    );
    free_meeting.transparency = EventTransparency::Transparent;
    let mut lunch = team_occurrence(alex, "ooo", 12, 60, TeamCalendarSharing::All, "Lunch");
    lunch.event_type = EventType::OutOfOffice;
    let occurrences = team_occurrences(
        vec![
            team_member(alex, TeamCalendarSharing::All, true),
            team_member(blair, TeamCalendarSharing::BusyOnly, true),
            team_member(casey, TeamCalendarSharing::None, true),
            team_member(devon, TeamCalendarSharing::All, false),
        ],
        vec![
            team_occurrence(alex, "standup", 10, 60, TeamCalendarSharing::All, "Standup"),
            lunch,
            team_occurrence(
                blair,
                "1:1",
                14,
                60,
                TeamCalendarSharing::BusyOnly,
                "not shown",
            ),
            free_meeting,
        ],
    );
    let (_, context) = context(MockMutations::default(), occurrences);
    let (start, end) = workday_window();

    let response = GetTeamAvailability {
        start,
        end,
        user_ids: None,
    }
    .call(context, request_context())
    .await
    .unwrap();

    let by_user: std::collections::HashMap<_, _> = response
        .members
        .iter()
        .map(|member| (member.user_id.as_str(), member))
        .collect();
    assert_eq!(response.members.len(), 4);
    let alex_busy = &by_user[alex].busy;
    assert_eq!(alex_busy.len(), 2);
    assert_eq!(alex_busy[0].title.as_deref(), Some("Standup"));
    assert_eq!(alex_busy[1].event_type.as_deref(), Some("out_of_office"));
    let blair_member = by_user[blair];
    assert_eq!(blair_member.sharing, "busy_only");
    assert_eq!(
        blair_member.busy.len(),
        1,
        "a transparent event never counts as busy"
    );
    assert!(blair_member.busy[0].title.is_none());
    assert_eq!(by_user[casey].sharing, "none");
    assert!(by_user[casey].busy.is_empty());
    assert!(!by_user[devon].has_calendar);

    let windows: Vec<(String, String)> = response
        .free_windows
        .iter()
        .map(|window| (window.start.clone(), window.end.clone()))
        .collect();
    assert_eq!(
        windows,
        vec![
            (
                "2026-08-20T09:00:00+00:00".to_string(),
                "2026-08-20T10:00:00+00:00".to_string()
            ),
            (
                "2026-08-20T11:00:00+00:00".to_string(),
                "2026-08-20T12:00:00+00:00".to_string()
            ),
            (
                "2026-08-20T13:00:00+00:00".to_string(),
                "2026-08-20T14:00:00+00:00".to_string()
            ),
            (
                "2026-08-20T15:00:00+00:00".to_string(),
                "2026-08-20T17:00:00+00:00".to_string()
            ),
        ]
    );
    assert!(!response.truncated);
    assert_eq!(response.time_zone.as_deref(), Some("America/New_York"));
    assert!(
        response
            .summary
            .contains("Checked 4 teammates; 2 share a connected calendar.")
    );
    assert!(response.summary.contains("4 free windows"));
    assert!(response.summary.contains("1 shares nothing"));
    assert!(response.summary.contains("1 has no calendar connected"));
}

#[tokio::test]
async fn team_availability_narrows_to_requested_teammates_and_flags_unknown_ids() {
    let alex = "macro|alex@example.com";
    let blair = "macro|blair@example.com";
    let occurrences = team_occurrences(
        vec![
            team_member(alex, TeamCalendarSharing::All, true),
            team_member(blair, TeamCalendarSharing::All, true),
        ],
        vec![
            team_occurrence(alex, "a", 10, 60, TeamCalendarSharing::All, "Alex only"),
            team_occurrence(blair, "b", 13, 60, TeamCalendarSharing::All, "Blair only"),
        ],
    );
    let (_, context) = context(MockMutations::default(), occurrences);
    let (start, end) = workday_window();

    let response = GetTeamAvailability {
        start,
        end,
        user_ids: Some(vec![
            blair.to_string(),
            "macro|stranger@example.com".to_string(),
        ]),
    }
    .call(context, request_context())
    .await
    .unwrap();

    assert_eq!(response.members.len(), 1);
    assert_eq!(response.members[0].user_id, blair);
    assert_eq!(response.members[0].busy.len(), 1);
    assert_eq!(
        response.unknown_user_ids,
        vec!["macro|stranger@example.com".to_string()]
    );
    assert_eq!(
        response.free_windows.len(),
        2,
        "only Blair's meeting splits the window"
    );
    assert!(response.summary.contains("not on the team"));
}

#[tokio::test]
async fn team_availability_rejects_an_inverted_window() {
    let (_, context) = context(
        MockMutations::default(),
        team_occurrences(Vec::new(), Vec::new()),
    );
    let (start, end) = workday_window();

    let error = GetTeamAvailability {
        start: end,
        end: start,
        user_ids: None,
    }
    .call(context, request_context())
    .await
    .unwrap_err();

    assert!(error.description.contains("end must be after start"));
}

#[test]
fn free_windows_merge_overlapping_and_touching_busy_spans() {
    let (start, end) = workday_window();
    let at = |hour: u32, minute: u32| Utc.with_ymd_and_hms(2026, 8, 20, hour, minute, 0).unwrap();
    let busy = vec![
        (at(10, 0), at(11, 0)),
        (at(10, 30), at(11, 30)),
        (at(11, 30), at(12, 0)),
        (at(8, 0), at(9, 30)),
        (at(16, 0), at(18, 0)),
        (at(20, 0), at(21, 0)),
    ];

    let free = super::get_team_availability::free_windows(start, end, busy);

    assert_eq!(
        free,
        vec![(at(9, 30), at(10, 0)), (at(12, 0), at(16, 0))],
        "spans outside the window are clipped or dropped, adjacent spans merge"
    );
    assert_eq!(
        super::get_team_availability::free_windows(start, end, Vec::new()),
        vec![(start, end)]
    );
}
