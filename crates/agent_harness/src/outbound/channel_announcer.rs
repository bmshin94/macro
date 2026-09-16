//! Announce sessions by posting into the mention's thread as the bot.
//!
//! Implements [`SessionAnnouncer`] over the channels domain's own
//! [`ChannelService`] port, so the post gets the full side-effect fan-out -
//! persistence, realtime, notifications, broker - exactly as if it came
//! through the channel API. The composition root decides which
//! `ChannelService` implementation (and side-effect stack) this wraps.
//!
//! The announcement places a structured reply target above the session's
//! magic chip. That content is composed by the lexical service — the one
//! place that builds message markdown from real Lexical nodes — so this
//! adapter never assembles a node tree itself. A declined mention is the
//! exception that proves the rule: one sentence and one inline chip tag, the
//! same `<m-connect-app>` string the egress proxy hands agents to echo, so it
//! is written here as text.

#[cfg(test)]
mod test;

use std::sync::Arc;

use agent_egress::domain::model::CONNECT_APP_TAG;
use channel_sender::ChannelSender;
use channels::domain::models::{PostMessageNotificationPolicy, PostMessageRequest};
use channels::domain::ports::ChannelService;
use lexical_client::LexicalClient;
use lexical_client::parse_markdown::{AgentAnnouncementChip, AgentAnnouncementReplyTarget};

use crate::domain::error::{HarnessError, Result};
use crate::domain::model::{
    AnnouncedMessage, DeclinedMention, SessionAnnouncement, SessionBlocker,
};
use crate::domain::ports::SessionAnnouncer;
use macro_uuid::Uuid;

/// The message a declined mention becomes: what to connect, and the chip
/// that opens the settings page to do it.
///
/// The chip targets the Harness settings page rather than Connections, and
/// names the harness by slug — the frontend reads the reader's own Cursor
/// key status off that, so once they have connected, the same message reads
/// as connected instead of nagging them again.
fn decline_markdown(blocker: SessionBlocker) -> String {
    match blocker {
        SessionBlocker::CursorNotConnected => {
            let chip = serde_json::json!({
                "appSlug": "cursor",
                "name": "Cursor",
                "target": "harness",
            });
            format!(
                "`@cursor` runs on your own Cursor account, and yours is not connected yet. \
                 Add your Cursor API key, then mention me again. \
                 <{tag}>{chip}</{tag}>",
                tag = CONNECT_APP_TAG,
            )
        }
    }
}

fn announcement_chip(announcement: &SessionAnnouncement) -> AgentAnnouncementChip {
    AgentAnnouncementChip {
        agent_session_id: announcement.session_id.to_string(),
        channel_id: None,
        prompted_message: announcement.prompted_message_id,
        status: "booting".to_owned(),
    }
}

fn announcement_reply_target(announcement: &SessionAnnouncement) -> AgentAnnouncementReplyTarget {
    AgentAnnouncementReplyTarget {
        channel_id: announcement.origin_channel_id.to_string(),
        target_message_id: announcement.origin_message_id.to_string(),
        target_thread_id: announcement.origin_thread_id.to_string(),
        display_text: announcement.prompted_content.clone(),
        sender_id: announcement.triggered_by.as_ref().to_owned(),
    }
}

/// Posts session announcements as their session's bot through a
/// [`ChannelService`].
pub struct ChannelAnnouncer<Channels> {
    channels: Arc<Channels>,
    lexical: LexicalClient,
}

impl<Channels> ChannelAnnouncer<Channels> {
    /// Post through `channels`, with content composed by `lexical`. The
    /// sender is per-announcement: whichever bot the session runs for.
    pub fn new(channels: Arc<Channels>, lexical: LexicalClient) -> Self {
        Self { channels, lexical }
    }
}

impl<Channels> SessionAnnouncer for ChannelAnnouncer<Channels>
where
    Channels: ChannelService + Send + Sync + 'static,
{
    async fn announce(&self, announcement: SessionAnnouncement) -> Result<AnnouncedMessage> {
        let reply_target = announcement_reply_target(&announcement);
        let chip = announcement_chip(&announcement);
        let content = self
            .lexical
            .compose_agent_announcement(&reply_target, &chip)
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        let posted = self
            .channels
            .post_message(
                ChannelSender::new_from_bot(announcement.bot_id),
                announcement.origin_channel_id,
                PostMessageRequest {
                    content,
                    mentions: Vec::new(),
                    thread_id: Some(announcement.origin_thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    // The chip is a pointer, not news: the thread hears
                    // about the session when it finishes or asks, through
                    // the lifecycle notifications, not when it boots.
                    notification_policy: PostMessageNotificationPolicy::Silent,
                    // Attributed to whoever mentioned the bot, so the reply
                    // reads as their agent answering.
                    triggered_by: Some(announcement.triggered_by.as_ref().to_owned()),
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;

        // Message ids are uuids everywhere in the channels domain; anything
        // else here is a bug in the poster, not a shape to tolerate.
        let message_id = Uuid::parse_str(&posted.id).map_err(|error| {
            HarnessError::Announce(
                rootcause::report!(error)
                    .context(format!(
                        "announcement posted a non-uuid message id {}",
                        posted.id
                    ))
                    .into(),
            )
        })?;
        Ok(AnnouncedMessage { message_id })
    }

    async fn decline(&self, declined: DeclinedMention) -> Result<()> {
        self.channels
            .post_message(
                ChannelSender::new_from_bot(declined.bot_id),
                declined.origin.channel_id,
                PostMessageRequest {
                    content: decline_markdown(declined.blocker),
                    mentions: Vec::new(),
                    thread_id: Some(declined.origin.thread_id),
                    attachments: Vec::new(),
                    nonce: None,
                    // Unlike a session chip, this is the whole answer: the
                    // person who asked should hear it even if they have
                    // already looked away from the thread.
                    notification_policy: PostMessageNotificationPolicy::Default,
                    triggered_by: Some(declined.triggered_by.as_ref().to_owned()),
                },
            )
            .await
            .map_err(|error| HarnessError::Announce(rootcause::report!(error).into()))?;
        Ok(())
    }
}
