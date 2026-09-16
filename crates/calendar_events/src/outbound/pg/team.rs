//! Team calendar sharing queries: the per-user sharing policy and the
//! teammate views it governs.
//!
//! Teammate reads source each event from the teammate's own primary
//! calendar copy — a shared calendar's re-import flattens the type and
//! brackets the title, and an event on a calendar they merely subscribe to
//! belongs to that calendar's owner — on an account that is not disabled.
//! `DISTINCT ON` collapses the same provider event synced through more than
//! one of the teammate's inboxes before the limit, so duplicates never eat
//! page slots or skew the caller's truncation detection.
//!
//! "Team" is singular by schema: `team_user` is unique per user, so the
//! membership self-join cannot span teams.

#[cfg(test)]
mod test;

use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    event_status, event_transparency, event_type, event_visibility, fetch_attendees,
    fetch_override_attendees, report, row_time,
};
use crate::domain::models::{
    OccurrenceRange, TeamCalendarMember, TeamCalendarOccurrence, TeamCalendarOccurrenceDetails,
    TeamCalendarSharing,
};

/// Parse a stored sharing value. The column is check-constrained to the
/// closed set, so an unknown value is a schema/code drift bug, not data.
pub(super) fn parse_sharing(value: &str) -> Result<TeamCalendarSharing, Report> {
    value
        .parse::<TeamCalendarSharing>()
        .map_err(|error| rootcause::report!(error).into())
}

/// The sharing policy stored for `user_id`, or the default.
pub(super) async fn team_calendar_sharing(
    pool: &PgPool,
    user_id: &str,
) -> Result<TeamCalendarSharing, Report> {
    let stored = sqlx::query_scalar!(
        r#"SELECT sharing FROM calendar_team_sharing WHERE user_id = $1"#,
        user_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(report)?;
    stored
        .as_deref()
        .map(parse_sharing)
        .unwrap_or(Ok(TeamCalendarSharing::default()))
}

/// Store `user_id`'s sharing policy, replacing any earlier value.
pub(super) async fn set_team_calendar_sharing(
    pool: &PgPool,
    user_id: &str,
    sharing: TeamCalendarSharing,
) -> Result<(), Report> {
    sqlx::query!(
        r#"
        INSERT INTO calendar_team_sharing (user_id, sharing, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (user_id) DO UPDATE
            SET sharing = EXCLUDED.sharing,
                updated_at = now()
        "#,
        user_id,
        sharing.as_str(),
    )
    .execute(pool)
    .await
    .map_err(report)?;
    Ok(())
}

/// The requester's teammates with their sharing policy and whether an
/// enabled calendar account backs it.
pub(super) async fn list_team_calendar_members(
    pool: &PgPool,
    requester_id: &str,
) -> Result<Vec<TeamCalendarMember>, Report> {
    let rows = sqlx::query!(
        r#"
        SELECT
            teammate.user_id,
            COALESCE(sharing.sharing, 'all') AS "sharing!",
            EXISTS (
                SELECT 1
                FROM calendar_accounts account
                WHERE account.owner_id = teammate.user_id
                  AND account.sync_status <> 'disabled'
            ) AS "has_calendar!"
        FROM team_user membership
        JOIN team_user teammate ON teammate.team_id = membership.team_id
        LEFT JOIN calendar_team_sharing sharing ON sharing.user_id = teammate.user_id
        WHERE membership.user_id = $1
          AND teammate.user_id <> $1
        ORDER BY teammate.user_id
        "#,
        requester_id,
    )
    .fetch_all(pool)
    .await
    .map_err(report)?;
    rows.into_iter()
        .map(|row| {
            Ok(TeamCalendarMember {
                user_id: row.user_id,
                sharing: parse_sharing(&row.sharing)?,
                has_calendar: row.has_calendar,
            })
        })
        .collect()
}

/// Teammates' primary-calendar occurrences overlapping the viewport, with
/// details unmasked and each owner's sharing policy attached. Teammates who
/// share nothing are excluded here so their rows never leave the database.
pub(super) async fn list_team_occurrences(
    pool: &PgPool,
    requester_id: &str,
    range: OccurrenceRange,
    owner_ids: Option<&[String]>,
    limit: u16,
) -> Result<Vec<TeamCalendarOccurrence>, Report> {
    let rows = sqlx::query!(
        r#"
        SELECT
            owner_id AS "owner_id!",
            event_id AS "event_id!",
            ical_uid AS "ical_uid!",
            occurrence_key AS "occurrence_key!",
            recurrence_id,
            sharing AS "sharing!",
            title AS "title!",
            description,
            location,
            conference_url,
            organizer_email,
            organizer_name,
            status AS "status!",
            visibility AS "visibility!",
            transparency AS "transparency!",
            event_type AS "event_type!",
            time_zone,
            occurrence_starts_at AS "occurrence_starts_at?",
            occurrence_ends_at AS "occurrence_ends_at?",
            occurrence_start_date AS "occurrence_start_date?",
            occurrence_end_date AS "occurrence_end_date?"
        FROM (
            SELECT DISTINCT ON (event.owner_id, event.ical_uid, occurrence.occurrence_key)
                event.owner_id,
                occurrence.event_id,
                event.ical_uid,
                occurrence.occurrence_key,
                occurrence.recurrence_id,
                COALESCE(sharing.sharing, 'all') AS sharing,
                COALESCE(override.title, source.title) AS title,
                COALESCE(override.description, source.description) AS description,
                COALESCE(override.location, source.location) AS location,
                event.conference_url,
                event.organizer_email,
                event.organizer_name,
                COALESCE(override.status, event.status) AS status,
                source.visibility,
                source.transparency,
                source.event_type,
                event.time_zone,
                occurrence.starts_at AS occurrence_starts_at,
                occurrence.ends_at AS occurrence_ends_at,
                occurrence.start_date AS occurrence_start_date,
                occurrence.end_date AS occurrence_end_date,
                COALESCE(
                    occurrence.starts_at,
                    occurrence.start_date::timestamp AT TIME ZONE 'UTC'
                ) AS occurrence_ordering
            FROM calendar_event_occurrences occurrence
            JOIN calendar_events event ON event.id = occurrence.event_id
            JOIN calendar_event_sources source ON source.event_id = event.id
            JOIN calendars calendar
              ON calendar.id = source.calendar_id
             AND calendar.is_primary
             AND NOT calendar.is_deleted
            JOIN calendar_accounts account
              ON account.id = source.account_id
             AND account.sync_status <> 'disabled'
            LEFT JOIN calendar_event_overrides override
              ON override.event_id = occurrence.event_id
             AND override.recurrence_id = occurrence.recurrence_id
            LEFT JOIN calendar_team_sharing sharing ON sharing.user_id = event.owner_id
            WHERE occurrence.owner_id IN (
                    SELECT teammate.user_id
                    FROM team_user membership
                    JOIN team_user teammate ON teammate.team_id = membership.team_id
                    WHERE membership.user_id = $1
                      AND teammate.user_id <> $1
              )
              AND ($6::text[] IS NULL OR event.owner_id = ANY($6))
              AND COALESCE(sharing.sharing, 'all') <> 'none'
              AND event.status <> 'cancelled'
              AND NOT occurrence.is_cancelled
              AND (
                    occurrence.timed_span && tstzrange($2, $3, '[)')
                    OR occurrence.day_span && daterange($4, $5, '[)')
              )
            ORDER BY
                event.owner_id,
                event.ical_uid,
                occurrence.occurrence_key,
                occurrence.event_id,
                source.source_sequence DESC,
                source.source_updated_at DESC,
                source.id DESC
        ) occurrence
        ORDER BY
            occurrence.occurrence_ordering,
            occurrence.event_id,
            occurrence.occurrence_key
        LIMIT $7
        "#,
        requester_id,
        range.starts_at,
        range.ends_at,
        range.start_date,
        range.end_date,
        owner_ids,
        i64::from(limit),
    )
    .fetch_all(pool)
    .await
    .map_err(report)?;
    let event_ids: Vec<Uuid> = rows.iter().map(|row| row.event_id).collect();
    let (attendees, override_attendees) = futures::try_join!(
        fetch_attendees(pool, &event_ids),
        fetch_override_attendees(pool, &event_ids),
    )?;
    rows.into_iter()
        .map(|row| {
            // An exception's attendee list replaces the series list for that
            // occurrence alone, as on the owner's own occurrence read.
            let attendees = row
                .recurrence_id
                .as_ref()
                .and_then(|recurrence_id| {
                    override_attendees.get(&(row.event_id, recurrence_id.clone()))
                })
                .or_else(|| attendees.get(&row.event_id))
                .cloned()
                .unwrap_or_default();
            Ok(TeamCalendarOccurrence {
                owner_id: row.owner_id,
                event_id: row.event_id,
                ical_uid: row.ical_uid,
                occurrence_key: row.occurrence_key,
                time: row_time(
                    row.occurrence_starts_at,
                    row.occurrence_ends_at,
                    row.occurrence_start_date,
                    row.occurrence_end_date,
                    row.time_zone,
                )?,
                status: event_status(&row.status),
                transparency: event_transparency(&row.transparency),
                event_type: event_type(&row.event_type),
                visibility: event_visibility(&row.visibility),
                sharing: parse_sharing(&row.sharing)?,
                details: Some(TeamCalendarOccurrenceDetails {
                    title: row.title,
                    description: row.description,
                    location: row.location,
                    conference_url: row.conference_url,
                    organizer_email: row.organizer_email,
                    organizer_name: row.organizer_name,
                    attendees,
                }),
            })
        })
        .collect()
}
