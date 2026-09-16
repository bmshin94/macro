//! Shared event processing for agent trigger consumers: channel messages
//! and routine run requests, each turned into agent-session events.

#[cfg(test)]
mod test;

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::ports::AgentSessionRepo;
use ai_routines::{AiRoutineMacroEvent, AiRoutineTopicEvent};
use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use macro_event_broker::{EventBrokerError, MacroEvent as _, MacroEventBroker};

use super::broker_events::{AgentSessionMacroEvent, AgentTriggerEventName, NewAgentSessionEvent};
use super::service::{
    AgentBotLookup, AgentTriggerService, ChannelParticipationLookup, ExplicitReplyExtractor,
    ImplicitTriggerJudge, TeamMembershipLookup, ThreadHistory,
};

/// Failure while evaluating or publishing one channel event.
#[derive(Debug, thiserror::Error)]
pub enum ProcessChannelEventError {
    /// Trigger evaluation could not read its session or bot context.
    #[error(transparent)]
    Evaluate(#[from] AgentSessionError),
    /// A yielded event could not be queued for publication.
    #[error(transparent)]
    Publish(#[from] EventBrokerError),
    /// The publication task stopped before reporting its result.
    #[error("agent event publication task failed")]
    PublishTask(#[source] tokio::task::JoinError),
}

/// Evaluate and publish all agent triggers yielded by one channel event.
///
/// Transport adapters retain ownership of decode and offset commit so their
/// `kafka.process` span can cover the complete record lifecycle.
pub async fn process_channel_event<Repo, Bots, Teams, Channels, Replies, Judge, History, Broker>(
    trigger: &AgentTriggerService<Repo, Bots, Teams, Channels, Replies, Judge, History>,
    publisher: &Broker,
    event: &ChannelMacroEvent,
) -> Result<(), ProcessChannelEventError>
where
    Repo: AgentSessionRepo,
    Bots: AgentBotLookup,
    Teams: TeamMembershipLookup,
    Channels: ChannelParticipationLookup,
    Replies: ExplicitReplyExtractor,
    Judge: ImplicitTriggerJudge,
    History: ThreadHistory,
    Broker: MacroEventBroker,
{
    let ChannelTopicEvent::MessagePosted(posted) = &event.event().event else {
        return Ok(());
    };
    tracing::Span::current().record("macro.event.type", "channel.message_posted");

    let yielded_events = trigger.evaluate(posted).await?;
    tracing::info!(
        message_id = %posted.message_id,
        yielded_count = yielded_events.len(),
        "agent trigger evaluated channel message"
    );
    if yielded_events.is_empty() {
        tracing::debug!(message_id = %posted.message_id, "agent trigger yielded no event");
    }
    for yielded in yielded_events {
        let event_type: &'static str = AgentTriggerEventName::from(&yielded.event().event).into();
        tracing::info!(
            macro.event.id = %yielded.event().event_id,
            macro.event.type = event_type,
            "agent trigger yielded event"
        );
        publisher
            .send_event(&yielded)?
            .await
            .map_err(ProcessChannelEventError::PublishTask)??;
    }

    Ok(())
}

/// Failure while publishing the session open a routine run asks for.
#[derive(Debug, thiserror::Error)]
pub enum ProcessRoutineEventError {
    /// The session event could not be queued for publication.
    #[error(transparent)]
    Publish(#[from] EventBrokerError),
    /// The publication task stopped before reporting its result.
    #[error("agent event publication task failed")]
    PublishTask(#[source] tokio::task::JoinError),
}

/// Turn one routine run request into the agent-session event that opens its
/// session, and publish it.
///
/// Nothing to evaluate: a routine is its owner's standing instruction to run,
/// so every request yields exactly one open. As with channel events, the
/// transport adapter keeps decode and offset commit.
pub async fn process_routine_event<Broker>(
    publisher: &Broker,
    event: &AiRoutineMacroEvent,
) -> Result<(), ProcessRoutineEventError>
where
    Broker: MacroEventBroker,
{
    let routine_event = &event.event().event;
    tracing::Span::current().record("macro.event.type", routine_event.name());
    let AiRoutineTopicEvent::RunRequested(request) = routine_event;

    let yielded =
        AgentSessionMacroEvent::new_session(NewAgentSessionEvent::Routine(request.clone()));
    let event_type: &'static str = AgentTriggerEventName::from(&yielded.event().event).into();
    tracing::info!(
        routine_id = %request.routine_id,
        macro.event.id = %yielded.event().event_id,
        macro.event.type = event_type,
        "agent trigger yielded event for a routine run"
    );
    publisher
        .send_event(&yielded)?
        .await
        .map_err(ProcessRoutineEventError::PublishTask)??;

    Ok(())
}
