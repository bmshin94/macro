use super::super::PgCalendarRepository;
use super::super::test::{
    insert_link, insert_team, insert_user, july_2026_range, ooo_upsert, provider_ids, timed_upsert,
};
use crate::domain::{
    models::{EventTransparency, EventType, TeamCalendarSharing},
    ports::CalendarRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_sharing_defaults_to_all_and_round_trips(pool: PgPool) {
    let user = "macro|sharer@example.com";
    insert_user(&pool, user).await;
    let repo = PgCalendarRepository::new(pool);

    assert_eq!(
        repo.team_calendar_sharing(user).await.unwrap(),
        TeamCalendarSharing::All
    );
    for sharing in [
        TeamCalendarSharing::BusyOnly,
        TeamCalendarSharing::None,
        TeamCalendarSharing::All,
    ] {
        repo.set_team_calendar_sharing(user, sharing).await.unwrap();
        assert_eq!(repo.team_calendar_sharing(user).await.unwrap(), sharing);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_members_report_sharing_and_calendar_presence(pool: PgPool) {
    let requester = "macro|requester@example.com";
    let connected = "macro|connected@example.com";
    let unconnected = "macro|unconnected@example.com";
    let outsider = "macro|outsider@example.com";
    insert_team(&pool, requester, &[requester, connected, unconnected]).await;
    insert_team(&pool, outsider, &[outsider]).await;
    let connected_link = insert_link(&pool, connected).await;
    let repo = PgCalendarRepository::new(pool);
    provider_ids(&repo, connected_link).await;
    repo.set_team_calendar_sharing(unconnected, TeamCalendarSharing::BusyOnly)
        .await
        .unwrap();

    let members = repo.list_team_calendar_members(requester).await.unwrap();

    let summary: Vec<_> = members
        .iter()
        .map(|member| (member.user_id.as_str(), member.sharing, member.has_calendar))
        .collect();
    assert_eq!(
        summary,
        vec![
            (connected, TeamCalendarSharing::All, true),
            (unconnected, TeamCalendarSharing::BusyOnly, false),
        ]
    );

    assert!(
        repo.list_team_calendar_members(outsider)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_occurrences_return_teammates_primary_events_with_details(pool: PgPool) {
    let requester = "macro|viewer@example.com";
    let teammate = "macro|teammate@example.com";
    let outsider = "macro|outsider@example.com";
    insert_team(&pool, requester, &[requester, teammate]).await;
    insert_team(&pool, outsider, &[outsider]).await;
    let requester_link = insert_link(&pool, requester).await;
    let teammate_link = insert_link(&pool, teammate).await;
    let outsider_link = insert_link(&pool, outsider).await;
    let repo = PgCalendarRepository::new(pool);
    let requester_provider = provider_ids(&repo, requester_link).await;
    let teammate_provider = provider_ids(&repo, teammate_link).await;
    let outsider_provider = provider_ids(&repo, outsider_link).await;
    repo.upsert_event_fixture(timed_upsert(
        requester,
        requester_link,
        requester_provider,
        "own@example.com",
        "My own meeting",
        1,
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        teammate,
        teammate_link,
        teammate_provider,
        "teammate@example.com",
        "Design review",
        1,
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        outsider,
        outsider_link,
        outsider_provider,
        "outsider@example.com",
        "Elsewhere",
        1,
    ))
    .await
    .unwrap();

    let rows = repo
        .list_team_occurrences(requester, july_2026_range(), None, 100)
        .await
        .unwrap();

    assert_eq!(rows.len(), 2, "both occurrences of the teammate's series");
    for row in &rows {
        assert_eq!(row.owner_id, teammate);
        assert_eq!(row.sharing, TeamCalendarSharing::All);
        assert_eq!(row.transparency, EventTransparency::Opaque);
        assert_eq!(row.event_type, EventType::Default);
        let details = row.details.as_ref().expect("details arrive unmasked");
        assert_eq!(details.title, "Design review");
        assert_eq!(
            details.organizer_email.as_deref(),
            Some("organizer@example.com")
        );
        assert_eq!(details.attendees.len(), 1);
        assert_eq!(details.attendees[0].email, "guest@example.com");
    }

    let filtered = repo
        .list_team_occurrences(
            requester,
            july_2026_range(),
            Some(&[teammate.to_string()]),
            100,
        )
        .await
        .unwrap();
    assert_eq!(filtered.len(), 2);

    let none_selected = repo
        .list_team_occurrences(
            requester,
            july_2026_range(),
            Some(&["macro|nobody@example.com".to_string()]),
            100,
        )
        .await
        .unwrap();
    assert!(none_selected.is_empty());

    let from_outside = repo
        .list_team_occurrences(outsider, july_2026_range(), None, 100)
        .await
        .unwrap();
    assert!(from_outside.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_occurrences_and_out_of_office_honor_sharing_policy(pool: PgPool) {
    let requester = "macro|viewer@example.com";
    let hidden = "macro|hidden@example.com";
    let busy_only = "macro|busy@example.com";
    insert_team(&pool, requester, &[requester, hidden, busy_only]).await;
    let hidden_link = insert_link(&pool, hidden).await;
    let busy_link = insert_link(&pool, busy_only).await;
    let repo = PgCalendarRepository::new(pool);
    let hidden_provider = provider_ids(&repo, hidden_link).await;
    let busy_provider = provider_ids(&repo, busy_link).await;
    repo.set_team_calendar_sharing(hidden, TeamCalendarSharing::None)
        .await
        .unwrap();
    repo.set_team_calendar_sharing(busy_only, TeamCalendarSharing::BusyOnly)
        .await
        .unwrap();
    repo.upsert_event_fixture(ooo_upsert(
        hidden,
        hidden_link,
        hidden_provider,
        "hidden-ooo@example.com",
        "Secret leave",
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        hidden,
        hidden_link,
        hidden_provider,
        "hidden-meeting@example.com",
        "Secret meeting",
        1,
    ))
    .await
    .unwrap();
    repo.upsert_event_fixture(ooo_upsert(
        busy_only,
        busy_link,
        busy_provider,
        "busy-ooo@example.com",
        "Vacation",
    ))
    .await
    .unwrap();

    let rows = repo
        .list_team_occurrences(requester, july_2026_range(), None, 100)
        .await
        .unwrap();
    assert_eq!(rows.len(), 2, "only the busy-only teammate's occurrences");
    assert!(rows.iter().all(|row| row.owner_id == busy_only));
    assert!(
        rows.iter()
            .all(|row| row.sharing == TeamCalendarSharing::BusyOnly)
    );
    assert!(
        rows.iter().all(|row| row.details.is_some()),
        "the repository leaves masking to the domain service"
    );

    let out_of_office = repo
        .list_team_out_of_office(requester, july_2026_range(), 100)
        .await
        .unwrap();
    assert_eq!(out_of_office.len(), 2);
    assert!(out_of_office.iter().all(|row| row.owner_id == busy_only));
    assert!(
        out_of_office
            .iter()
            .all(|row| row.sharing == TeamCalendarSharing::BusyOnly)
    );
}
