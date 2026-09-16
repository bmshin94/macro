//! Trigger consumer: channel messages and routine run requests in,
//! agent-session trigger events out.

use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::processing::{process_channel_event, process_routine_event};
use agent_trigger::domain::service::AgentTriggerService;
use agent_trigger::outbound::{
    BotRepoAgentLookup, ChannelThreadHistory, FastModelTriggerJudge, LexicalExplicitReplyExtractor,
};
use ai_routines::AiRoutineMacroEvent;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::domain::broker_events::ChannelMacroEvent;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use lexical_client::LexicalClient;
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_service_urls::LexicalServiceUrl;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::PgPool;
use tokio::time::{Duration, sleep};
use tracing::Instrument as _;

struct AgentTriggerConsumerGroup;

impl GroupName for AgentTriggerConsumerGroup {
    const GROUP_NAME: &'static str = "agent-trigger-service";
}

macro_event_broker::declare_topics!(DeclaredTriggerEvent: ChannelMacroEvent, AiRoutineMacroEvent);

type TriggerKafkaAdapter = KafkaConsumerAdapter<AgentTriggerConsumerGroup, DeclaredTriggerEvent>;
type TriggerConsumer = MacroEventConsumerService<DeclaredTriggerEvent, TriggerKafkaAdapter>;

fn commit_message(consumer: &TriggerConsumer, message: &BorrowedMessage<'_>) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit agent trigger offset: {error:?}"))
}

/// Keeps the trigger consumer running across transient failures.
pub async fn supervise(pool: PgPool, kafka_brokers: String, internal_api_key: String) {
    loop {
        if let Err(error) = run(
            pool.clone(),
            kafka_brokers.clone(),
            internal_api_key.clone(),
        )
        .await
        {
            tracing::error!(error = ?error, "agent trigger stopped; restarting");
            sleep(Duration::from_secs(1)).await;
        }
    }
}

async fn run(pool: PgPool, kafka_brokers: String, internal_api_key: String) -> anyhow::Result<()> {
    let lexical = LexicalClient::new(internal_api_key, LexicalServiceUrl::new()?.to_string());
    let trigger = AgentTriggerService::new(
        PgAgentSessionRepo::new(pool.clone()),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        LexicalExplicitReplyExtractor::new(lexical),
        FastModelTriggerJudge::new(ai_usage::pg_recorder(pool.clone())),
        ChannelThreadHistory::new(PgChannelsRepo::new(pool)),
    );
    let publisher = MacroEventBrokerService::new(
        KafkaEventPublisher::new(&kafka_brokers)?,
        macro_event_broker::GlobalSpawner,
    );
    let consumer = KafkaEventConsumer::<AgentTriggerConsumerGroup>::from_env(&kafka_brokers)?;
    let consumer = KafkaConsumerAdapter::<AgentTriggerConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredTriggerEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to agent trigger topics: {error:?}")
        })?;
    let consumer = TriggerConsumer::new(consumer);

    tracing::info!(
        topics = ?DeclaredTriggerEvent::topics(),
        group = AgentTriggerConsumerGroup::GROUP_NAME,
        "agent trigger listening"
    );

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(error) => {
                tracing::error!(error = ?error, "failed to receive agent trigger event");
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let span = consumer_span(message.inner(), AgentTriggerConsumerGroup::GROUP_NAME);
        let result = async {
            let kafka_message = message.inner();
            let decoded = match message.decode_payload() {
                Ok(decoded) => decoded,
                Err(error) => {
                    record_span_error(&tracing::Span::current(), &error);
                    tracing::error!(
                        error = ?error,
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable agent trigger event"
                    );
                    commit_message(&consumer, kafka_message)?;
                    return Ok::<(), anyhow::Error>(());
                }
            };

            match decoded {
                DeclaredTriggerEvent::ChannelMacroEvent(event) => {
                    tracing::Span::current().record(
                        "macro.event.id",
                        tracing::field::display(event.event().event_id),
                    );
                    process_channel_event(&trigger, &publisher, &event).await?;
                }
                DeclaredTriggerEvent::AiRoutineMacroEvent(event) => {
                    tracing::Span::current().record(
                        "macro.event.id",
                        tracing::field::display(event.event().event_id),
                    );
                    process_routine_event(&publisher, &event).await?;
                }
            }
            commit_message(&consumer, kafka_message)?;
            Ok(())
        }
        .instrument(span.clone())
        .await;
        if let Err(error) = &result {
            record_span_error(&span, error);
        }
        result?;
    }
}
