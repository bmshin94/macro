//! The two-tier fold's contract: speculate, promote, rebase, retract.

use super::*;
use crate::domain::model::{Author, Control, ControlOutcome, MessagePart, TurnState};
use crate::testing::{TURN, parse_log, test_session};
use agent_client_protocol::schema::v1::SessionId;
use chrono::{Duration, TimeZone, Utc};
use macro_uuid::Uuid;

/// The ACP session the `TURN` fixture runs in.
const ACP_SESSION: &str = "s1";

fn cursor(index: usize) -> LogCursor {
    let index = u128::try_from(index).expect("small index");
    LogCursor {
        id: Uuid::from_u128(index + 1),
        created_at: Utc.with_ymd_and_hms(2026, 8, 13, 0, 0, 0).unwrap()
            + Duration::microseconds(i64::try_from(index).expect("small index")),
    }
}

fn rows(log: Vec<AgentSessionLog>) -> Vec<(LogCursor, AgentSessionLog)> {
    log.into_iter()
        .enumerate()
        .map(|(index, row)| (cursor(index), row))
        .collect()
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("eric@example.com").expect("test email parses")
}

/// The row the harness logs for `action` under `action_id` - built the way
/// the harness builds it, which is also how the fold speculates it.
fn logged(action: &AgentAction, action_id: AgentActionId) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: test_session(),
        user_id: Some(user()),
        content: Message::ToRuntime(
            action
                .to_runtime(&SessionId::from(ACP_SESSION), action_id.to_request_id())
                .expect("action encodes"),
        ),
    }
}

fn speculation(action: AgentAction, action_id: AgentActionId) -> FoldInput {
    FoldInput::Speculated(Speculation::new(action_id, action, Some(user())).expect("speculatable"))
}

/// A fold that has folded the whole `TURN` fixture: one closed turn.
fn settled() -> SpeculativeFold {
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(TURN))))
        .expect("snapshot");
    assert_eq!(fold.metadata().turn, TurnState::Idle);
    fold
}

/// A fold whose turn is still open: the fixture up to the agent's first chunk.
fn mid_turn() -> SpeculativeFold {
    let open: String = TURN.lines().take(5).collect::<Vec<_>>().join("\n");
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(&open))))
        .expect("snapshot");
    assert_eq!(fold.metadata().turn, TurnState::Running);
    fold
}

fn user_texts(messages: &[FoldedMessage]) -> Vec<(String, bool)> {
    messages
        .iter()
        .filter(|message| matches!(message.author, Author::User { .. }))
        .filter_map(|message| match message.parts.first() {
            Some(MessagePart::Text { text }) => Some((text.clone(), message.pending)),
            _ => None,
        })
        .collect()
}

fn is_replace(events: &[FoldEvent<'_>]) -> bool {
    matches!(
        events,
        [
            FoldEvent::MessagesReplaced(_),
            FoldEvent::MetadataUpdated(_)
        ]
    )
}

#[test]
fn nothing_is_accepted_before_a_snapshot() {
    let mut fold = SpeculativeFold::new(test_session());
    let id = AgentActionId::mint();
    assert_eq!(
        fold.push(FoldInput::Confirmed(
            cursor(0),
            logged(&AgentAction::prompt("hi"), id)
        ))
        .unwrap_err(),
        SpeculationError::NoSnapshot
    );
    assert_eq!(
        fold.push(speculation(AgentAction::prompt("hi"), id))
            .unwrap_err(),
        SpeculationError::NoSnapshot
    );
}

#[test]
fn an_elicitation_answer_cannot_be_speculated() {
    let action: AgentAction = serde_json::from_value(serde_json::json!({
        "type": "respondElicitation",
        "requestId": 3,
        "action": "decline"
    }))
    .expect("an elicitation answer");
    assert_eq!(
        Speculation::new(AgentActionId::mint(), action, None).unwrap_err(),
        SpeculationError::Unspeculatable
    );
}

#[test]
fn a_speculated_prompt_is_pending_and_the_turn_is_starting() {
    let mut fold = settled();
    let before = fold.messages().len();
    let id = AgentActionId::mint();

    let events = fold
        .push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    let message = events
        .iter()
        .find_map(|event| match event {
            FoldEvent::NewMessage(message) => Some(message.clone().into_owned()),
            _ => None,
        })
        .expect("the prompt is reported new");
    assert_eq!(message.request_id, Some(id));
    assert!(message.pending);
    assert_eq!(
        message.author,
        Author::User {
            user_id: Some(user())
        }
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, FoldEvent::MetadataUpdated(_))),
        "the turn state moved"
    );
    assert_eq!(fold.messages().len(), before + 1);
    assert_eq!(fold.metadata().turn, TurnState::Starting);
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![id]);
}

#[test]
fn the_confirmed_row_promotes_the_speculation_in_place() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(speculation(action.clone(), id)).unwrap();
    let speculated: Vec<FoldedMessage> = fold.messages().to_vec();

    let events = fold
        .push(FoldInput::Confirmed(cursor(99), logged(&action, id)))
        .unwrap();

    // Not a replace: the reader already has this message and only its
    // pending mark changes.
    assert!(!is_replace(&events));
    let reported = events
        .iter()
        .filter_map(FoldEvent::message)
        .find(|message| message.request_id == Some(id))
        .expect("the confirmed prompt is reported");
    assert!(!reported.pending);
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());

    let mut expected = speculated;
    for message in &mut expected {
        message.pending = false;
    }
    assert_eq!(fold.messages(), expected.as_slice());
    assert_eq!(fold.metadata().turn, TurnState::Running);
}

#[test]
fn a_prompt_the_harness_composed_differently_still_promotes_by_id() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    fold.push(FoldInput::Confirmed(
        cursor(99),
        logged(&AgentAction::prompt("hi\n\n<context>doc</context>"), id),
    ))
    .unwrap();

    assert_eq!(fold.pending().count(), 0);
    let (text, pending) = user_texts(fold.messages()).pop().unwrap();
    assert_eq!(text, "hi\n\n<context>doc</context>");
    assert!(!pending);
}

#[test]
fn a_foreign_row_while_pending_rebases_the_suffix_after_it() {
    let mut fold = settled();
    let mine = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("mine"), mine))
        .unwrap();

    let theirs = AgentActionId::mint();
    let events = fold
        .push(FoldInput::Confirmed(
            cursor(99),
            logged(&AgentAction::prompt("theirs"), theirs),
        ))
        .unwrap();

    assert!(is_replace(&events));
    let texts = user_texts(fold.messages());
    let tail = &texts[texts.len() - 2..];
    assert_eq!(
        tail,
        [("theirs".to_owned(), false), ("mine".to_owned(), true)],
        "the confirmed prompt sits before the still-pending one"
    );
    assert_eq!(fold.pending().collect::<Vec<_>>(), vec![mine]);
    // Turn ids are assigned in fold order, so the speculated prompt moved up.
    let mine_message = fold
        .messages()
        .iter()
        .find(|message| message.request_id == Some(mine))
        .unwrap();
    let theirs_message = fold
        .messages()
        .iter()
        .find(|message| message.request_id == Some(theirs))
        .unwrap();
    assert!(mine_message.id > theirs_message.id);
}

#[test]
fn a_retraction_removes_the_speculation_and_restores_the_committed_view() {
    let mut fold = settled();
    let committed: Vec<FoldedMessage> = fold.messages().to_vec();
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    let events = fold.push(FoldInput::Retracted(id)).unwrap();

    assert!(is_replace(&events));
    assert_eq!(fold.messages(), committed.as_slice());
    assert_eq!(fold.metadata().turn, TurnState::Idle);
    assert!(fold.fork.is_none());

    // Retracting something never speculated changes nothing.
    assert!(
        fold.push(FoldInput::Retracted(AgentActionId::mint()))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_snapshot_settles_what_it_already_contains() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(speculation(action.clone(), id)).unwrap();

    let mut log = parse_log(TURN);
    log.push(logged(&action, id));
    let events = fold.push(FoldInput::Snapshot(rows(log))).unwrap();

    assert!(is_replace(&events));
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.fork.is_none());
    let (text, pending) = user_texts(fold.messages()).pop().unwrap();
    assert_eq!(text, "hi");
    assert!(!pending);
}

#[test]
fn a_speculated_stop_reads_as_stopping_and_promotes_by_content() {
    let mut fold = mid_turn();
    let id = AgentActionId::mint();

    let events = fold.push(speculation(AgentAction::Stop, id)).unwrap();

    let control = events
        .iter()
        .filter_map(FoldEvent::message)
        .find(|message| {
            matches!(
                message.parts.first(),
                Some(MessagePart::Control {
                    control: Control::Stop,
                    ..
                })
            )
        })
        .expect("the stop renders as a control line");
    assert!(control.pending);
    assert!(matches!(
        control.parts.first(),
        Some(MessagePart::Control {
            outcome: ControlOutcome::Accepted,
            ..
        })
    ));
    // The turn is not closed: only the runtime's own stop event does that.
    assert_eq!(fold.metadata().turn, TurnState::Stopping);
    assert!(fold.messages().last().unwrap().stop.is_none() || fold.messages().len() > 1);

    // A cancel is a notification with no request id, so the confirmed row
    // matches on content and promotes the same way.
    let events = fold
        .push(FoldInput::Confirmed(
            cursor(99),
            logged(&AgentAction::Stop, AgentActionId::mint()),
        ))
        .unwrap();
    assert!(!is_replace(&events));
    assert_eq!(fold.pending().count(), 0);
    let control = fold
        .messages()
        .iter()
        .find(|message| {
            matches!(
                message.parts.first(),
                Some(MessagePart::Control {
                    control: Control::Stop,
                    ..
                })
            )
        })
        .unwrap();
    assert!(!control.pending);
    assert_eq!(fold.metadata().turn, TurnState::Stopping);
}

#[test]
fn a_speculated_frame_names_the_session_the_log_showed() {
    let mut fold = settled();
    assert_eq!(fold.committed.machine.acp_session_id(), Some(ACP_SESSION));
    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();
    let frame = &fold.suffix[0].frame;
    let Message::ToRuntime(ToRuntimeMessage::Acp(acp)) = &frame.content else {
        panic!("a runtime-bound frame");
    };
    let RawJsonRpcMessage::Request(request) = &acp.0 else {
        panic!("a request");
    };
    let params = serde_json::to_value(request.params.as_ref()).unwrap();
    assert_eq!(params["sessionId"], ACP_SESSION);
    assert_eq!(request.id, id.to_request_id());
}

#[test]
fn a_session_with_no_runtime_yet_still_speculates() {
    let mut fold = SpeculativeFold::new(test_session());
    fold.push(FoldInput::Snapshot(rows(parse_log(
        r#"{"direction":"to_server","content":{"type":"event","event":"acp_ready"}}"#,
    ))))
    .unwrap();
    assert_eq!(fold.committed.machine.acp_session_id(), None);

    let id = AgentActionId::mint();
    fold.push(speculation(AgentAction::prompt("hi"), id))
        .unwrap();

    assert_eq!(user_texts(fold.messages()), vec![("hi".to_owned(), true)]);
    assert_eq!(fold.metadata().turn, TurnState::Starting);
}

/// The frontend's job, written out: a reader holding only what the events
/// told it must end up with exactly what `messages()` says.
#[test]
fn events_alone_reconstruct_the_view() {
    #[derive(Default)]
    struct Reader {
        messages: Vec<FoldedMessage>,
    }
    impl Reader {
        fn apply(&mut self, events: Vec<FoldEvent<'_>>) {
            for event in events {
                match event {
                    FoldEvent::NewMessage(message) | FoldEvent::MessageUpdate(message) => {
                        let message = message.into_owned();
                        match self
                            .messages
                            .iter_mut()
                            .find(|held| held.id() == message.id())
                        {
                            Some(held) => *held = message,
                            None => self.messages.push(message),
                        }
                    }
                    FoldEvent::MessagesReplaced(messages) => {
                        self.messages = messages.into_owned();
                    }
                    FoldEvent::MetadataUpdated(_) => {}
                }
            }
        }
    }

    let mut fold = SpeculativeFold::new(test_session());
    let mut reader = Reader::default();
    let open: String = TURN.lines().take(4).collect::<Vec<_>>().join("\n");
    reader.apply(
        fold.push(FoldInput::Snapshot(rows(parse_log(&open))))
            .unwrap(),
    );

    let stop = AgentActionId::mint();
    reader.apply(fold.push(speculation(AgentAction::Stop, stop)).unwrap());
    let next = AgentActionId::mint();
    reader.apply(
        fold.push(speculation(AgentAction::prompt("next"), next))
            .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());

    // The rest of the fixture confirms the running turn's answer and end,
    // each one a foreign row that rebases the suffix.
    for (index, row) in parse_log(TURN).into_iter().enumerate().skip(4) {
        reader.apply(fold.push(FoldInput::Confirmed(cursor(index), row)).unwrap());
        assert_eq!(reader.messages, fold.messages());
    }
    reader.apply(
        fold.push(FoldInput::Confirmed(
            cursor(50),
            logged(&AgentAction::Stop, AgentActionId::mint()),
        ))
        .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());
    reader.apply(
        fold.push(FoldInput::Confirmed(
            cursor(51),
            logged(&AgentAction::prompt("next"), next),
        ))
        .unwrap(),
    );
    assert_eq!(reader.messages, fold.messages());
    assert_eq!(fold.pending().count(), 0);
    assert!(fold.messages().iter().all(|message| !message.pending));
}

#[test]
fn speculating_an_action_the_log_already_confirmed_changes_nothing() {
    let mut fold = settled();
    let id = AgentActionId::mint();
    let action = AgentAction::prompt("hi");
    fold.push(FoldInput::Confirmed(cursor(99), logged(&action, id)))
        .unwrap();
    let confirmed: Vec<FoldedMessage> = fold.messages().to_vec();

    let events = fold.push(speculation(action, id)).unwrap();

    assert!(events.is_empty());
    assert_eq!(fold.pending().count(), 0);
    assert_eq!(fold.messages(), confirmed.as_slice());
}
