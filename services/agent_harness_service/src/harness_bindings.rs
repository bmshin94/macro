//! Postgres adapters for harness-keyed runtime routing.
//!
//! Composition-root adapters: [`PgHarnessBindings`] answers "which registered
//! harness serves this bot right now" for session binding, and
//! [`PgHarnessPresence`] writes the attach/detach bookkeeping the harness
//! settings page reads connection state from.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use agent_harness::domain::ports::{HarnessBindings, HarnessPresence};
use bot_id::BotId;
use connection_gateway_client::ConnectionGatewayClient;
use harness_id::HarnessId;
use harnesses::domain::ports::HarnessRepo;
use model_entity::EntityType;
use sqlx::PgPool;

/// [`HarnessBindings`] over the `agent_configs` table.
#[derive(Clone)]
pub struct PgHarnessBindings {
    pool: PgPool,
}

impl PgHarnessBindings {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl HarnessBindings for PgHarnessBindings {
    async fn harness_for(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        let harness_id = sqlx::query_scalar!(
            r#"
            SELECT ac.harness_id
            FROM agent_configs ac
            JOIN harnesses h ON h.id = ac.harness_id
            WHERE ac.bot_id = $1 AND h.deleted_at IS NULL
            "#,
            bot.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(harness_id.flatten().map(HarnessId::new_from_uuid))
    }
}

/// [`HarnessPresence`] over the `harnesses` table.
pub struct PgHarnessPresence<R> {
    repo: R,
    gateway: Arc<ConnectionGatewayClient>,
}

impl<R: HarnessRepo> PgHarnessPresence<R> {
    /// Record presence through the owning repository and notify its viewers.
    pub fn new(repo: R, gateway: Arc<ConnectionGatewayClient>) -> Self {
        Self { repo, gateway }
    }

    async fn update(&self, harness: HarnessId, connected: bool) -> anyhow::Result<()> {
        let recipients = self
            .repo
            .record_presence(harness, connected)
            .await
            .map_err(Into::into)?;
        if recipients.is_empty() {
            return Ok(());
        }
        self.gateway
            .batch_send_message(
                "harnesses_invalidation".to_owned(),
                serde_json::json!({}),
                recipients
                    .into_iter()
                    .map(|user| EntityType::User.with_entity_string(user))
                    .collect(),
            )
            .await?;
        Ok(())
    }
}

impl<R: HarnessRepo> HarnessPresence for PgHarnessPresence<R> {
    fn connected(self: Arc<Self>, harness: HarnessId) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let result = self.update(harness, true).await;
            if let Err(error) = result {
                tracing::error!(error = ?error, %harness, "failed to record harness attach");
            }
        })
    }

    fn disconnected(
        self: Arc<Self>,
        harness: HarnessId,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            let result = self.update(harness, false).await;
            if let Err(error) = result {
                tracing::error!(error = ?error, %harness, "failed to record harness detach");
            }
        })
    }
}
