//! Canonical team-share persistence for projects.
//!
//! Projects reuse the shared `SharePermission.team_share_*` state and the
//! `entity_access` team grant managed by `share_permission_db_utils`; this
//! module only adapts those helpers to the project repository's error type.

#[cfg(test)]
mod test;

use model_entity::{Entity, EntityType};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::models::ProjectError;

// Existing repository operations retain their SQLx error type; conditional edits
// expose domain errors so authorization conflicts reach callers without becoming 500s.
impl From<sqlx::Error> for ProjectError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

/// Map a canonical team-share failure onto the project domain error.
///
/// Stale or unexplained state surfaces as a conflict so the owner can reload
/// and retry instead of receiving a 500.
pub(super) fn map_team_share_error(error: rootcause::Report<TeamShareError>) -> ProjectError {
    match error.current_context() {
        TeamShareError::NotFound => ProjectError::NotFound("team-share project".to_string()),
        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant => {
            ProjectError::Conflict(error.to_string())
        }
        TeamShareError::InvalidAdoption
        | TeamShareError::InvalidEntity
        | TeamShareError::InvalidState
        | TeamShareError::Infrastructure => ProjectError::Internal(error.into()),
    }
}

fn project_entity(project_id: &str) -> Entity<'_> {
    EntityType::Project.with_entity_str(project_id)
}

/// Read the authoritative facts in one guarded snapshot without writing anything.
///
/// Projects never had a pre-canonical team grant, so unlike documents there is no
/// legacy adoption step here.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_team_share_facts(
    pool: &PgPool,
    project_id: &str,
) -> Result<TeamShareFacts, ProjectError> {
    let mut transaction = pool.begin().await?;
    let facts = team_share::load_facts(&mut transaction, &project_entity(project_id))
        .await
        .map_err(map_team_share_error)?;
    transaction.commit().await?;
    Ok(facts)
}

/// Apply the owner-authorized team-share command inside the edit transaction,
/// or refuse a requested team level that arrived without one.
///
/// The command must target this project and request exactly the level carried by
/// the share-permission edit; anything else is a malformed edit. Callers run
/// this before other `SharePermission` writes so the shared guard is acquired
/// before any row locks, matching the chat repository.
#[tracing::instrument(err, skip(transaction, share_permission, team_share))]
pub(super) async fn apply_team_share(
    transaction: &mut Transaction<'_, Postgres>,
    project_id: &str,
    share_permission: Option<&UpdateSharePermissionRequestV2>,
    team_share: Option<&AuthorizedTeamShareCommand>,
) -> Result<(), ProjectError> {
    let requested_level = share_permission.and_then(|p| p.team_share_access_level);
    match team_share {
        Some(command) => {
            let expected = &command.expected().entity;
            if expected.entity_type != EntityType::Project
                || expected.entity_id != project_id
                || requested_level != Some(command.target().map(|grant| grant.level.into()))
            {
                return Err(ProjectError::BadRequest(
                    "team-share command does not match patch".to_string(),
                ));
            }
            team_share::apply(transaction, command)
                .await
                .map_err(map_team_share_error)
        }
        None if requested_level.is_some() => Err(ProjectError::Unauthorized),
        None => Ok(()),
    }
}
