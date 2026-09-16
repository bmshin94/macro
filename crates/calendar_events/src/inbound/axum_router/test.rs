use super::*;
use chrono::TimeZone;

#[test]
fn midnight_end_uses_the_same_exclusive_date() {
    let end = Utc.with_ymd_and_hms(2026, 7, 25, 0, 0, 0).unwrap();

    assert_eq!(default_end_date(end), NaiveDate::from_ymd_opt(2026, 7, 25));
}

#[test]
fn timed_end_includes_the_end_day_for_all_day_overlap() {
    let end = Utc.with_ymd_and_hms(2026, 7, 25, 18, 30, 0).unwrap();

    assert_eq!(default_end_date(end), NaiveDate::from_ymd_opt(2026, 7, 26));
}

#[test]
fn occurrence_limit_rejects_zero_and_values_above_the_public_maximum() {
    assert!(query_limits(Some(0)).is_err());
    assert!(query_limits(Some(2001)).is_err());
}

#[test]
fn occurrence_limit_reserves_one_repository_row_for_truncation_detection() {
    assert_eq!(query_limits(Some(2000)).unwrap(), (2000, 2001));
    assert_eq!(query_limits(None).unwrap(), (1000, 1001));
}

#[test]
fn occurrence_cursor_round_trips_equal_start_tie_breakers() {
    let cursor = CalendarOccurrenceCursor {
        starts_at: Utc.with_ymd_and_hms(2026, 7, 25, 12, 0, 0).unwrap(),
        event_id: uuid::Uuid::now_v7(),
        occurrence_key: "same-start-instance".to_string(),
    };
    let encoded = Base64Str::encode_json(cursor.clone()).type_erase();

    assert_eq!(decode_cursor(Some(encoded)).unwrap(), Some(cursor));
    assert!(decode_cursor(Some("not-base64".to_string())).is_err());
}

#[test]
fn mention_preview_items_serialize_the_preview_contract() {
    let event_id = uuid::Uuid::now_v7();
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 19, 19, 0, 0).unwrap();
    let accessible = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::Access,
        event: Some(CalendarMentionEvent {
            viewer_event_id: event_id,
            title: "Smart Macro Discussion".to_string(),
            time: crate::domain::models::EventTime::Timed {
                starts_at,
                ends_at: starts_at + chrono::Duration::minutes(90),
                time_zone: Some("America/New_York".to_string()),
            },
            occurrence_key: Some(starts_at.to_rfc3339()),
            is_recurring: false,
            location: None,
            organizer_email: Some("teo@example.com".to_string()),
            organizer_name: None,
            attendee_count: 3,
            updated_at: starts_at,
        }),
    };
    let json = serde_json::to_value(&accessible).unwrap();
    assert_eq!(json["type"], "access");
    assert_eq!(json["eventId"], event_id.to_string());
    assert_eq!(json["event"]["viewerEventId"], event_id.to_string());
    assert_eq!(json["event"]["time"]["kind"], "timed");
    assert_eq!(json["event"]["attendeeCount"], 3);

    let no_access = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::NoAccess,
        event: None,
    };
    let json = serde_json::to_value(&no_access).unwrap();
    assert_eq!(json["type"], "no_access");
    assert!(json.get("event").is_none());

    let deleted = CalendarMentionPreviewItem {
        event_id,
        kind: CalendarMentionPreviewKind::DoesNotExist,
        event: None,
    };
    assert_eq!(
        serde_json::to_value(&deleted).unwrap()["type"],
        "does_not_exist"
    );
}

#[test]
fn team_calendar_items_omit_withheld_details() {
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 20, 10, 0, 0).unwrap();
    let time = EventTime::Timed {
        starts_at,
        ends_at: starts_at + chrono::Duration::hours(1),
        time_zone: None,
    };
    let event_id = uuid::Uuid::now_v7();
    let shared = TeamCalendarOccurrenceItem {
        owner_id: "macro|open@example.com".to_string(),
        event_id,
        occurrence_key: starts_at.to_rfc3339(),
        time: time.clone(),
        status: EventStatus::Confirmed,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        sharing: TeamCalendarSharing::All,
        details: Some(TeamCalendarEventDetails {
            title: "Budget review".to_string(),
            description: None,
            location: Some("Room 4".to_string()),
            conference_url: None,
            organizer_email: None,
            organizer_name: None,
            attendees: Vec::new(),
        }),
    };
    let json = serde_json::to_value(&shared).unwrap();
    assert_eq!(json["ownerId"], "macro|open@example.com");
    assert_eq!(json["eventId"], event_id.to_string());
    assert_eq!(json["sharing"], "all");
    assert_eq!(json["eventType"], "default");
    assert_eq!(json["details"]["title"], "Budget review");
    assert_eq!(json["details"]["location"], "Room 4");
    assert!(json["details"].get("description").is_none());

    let busy_only = TeamCalendarOccurrenceItem {
        owner_id: "macro|busy@example.com".to_string(),
        event_id,
        occurrence_key: starts_at.to_rfc3339(),
        time,
        status: EventStatus::Tentative,
        transparency: EventTransparency::Opaque,
        event_type: EventType::OutOfOffice,
        sharing: TeamCalendarSharing::BusyOnly,
        details: None,
    };
    let json = serde_json::to_value(&busy_only).unwrap();
    assert_eq!(json["sharing"], "busy_only");
    assert_eq!(json["status"], "tentative");
    assert_eq!(json["eventType"], "out_of_office");
    assert!(json.get("details").is_none(), "no detail key leaks through");

    let response = TeamCalendarResponse {
        members: vec![TeamCalendarMemberItem {
            user_id: "macro|busy@example.com".to_string(),
            sharing: TeamCalendarSharing::None,
            has_calendar: false,
        }],
        items: Vec::new(),
        has_more: false,
    };
    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(json["members"][0]["sharing"], "none");
    assert_eq!(json["members"][0]["hasCalendar"], false);
    assert_eq!(json["hasMore"], false);
}
