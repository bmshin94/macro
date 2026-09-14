//! SendEmail tool for composing and sending an email in one step.

use crate::domain::{
    models::{ContactInfo, CreateDraftInput},
    ports::{EmailService, GmailTokenProvider},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::EmailToolContext;

/// A recipient for an email.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailRecipient {
    /// The recipient's email address.
    pub email: String,
    /// The recipient's display name (optional).
    #[serde(default)]
    pub name: Option<String>,
}

impl From<EmailRecipient> for ContactInfo {
    fn from(r: EmailRecipient) -> Self {
        ContactInfo {
            email: r.email,
            name: r.name,
            photo_url: None,
        }
    }
}

/// Compose and send an email. Creates a draft and immediately queues it for delivery.
#[derive(Debug, Deserialize, JsonSchema, Clone)]
#[schemars(
    title = "SendEmail",
    description = "Draft, compose, and send an email. ALWAYS use this tool whenever the user asks you to draft, write, compose, or send an email (or reply to one) — never write the email as plain text in the chat. This tool opens the email draft in the composer for the user to review, edit, and confirm before it is sent, so it is the correct tool even when the user only wants a draft. To reply to an existing message, provide the replying_to_id. Write the body in Markdown — use **bold**, *italics*, lists, links, and other standard Markdown formatting. The draft composer renders the Markdown for the user to review and edit; the composer produces HTML that is sent as the actual email body."
)]
#[serde(rename_all = "camelCase")]
pub struct SendEmail {
    /// The subject line of the email.
    pub subject: String,
    /// The body of the email, written as Markdown. A host with a composer
    /// (chat) replaces this with the base64url-encoded HTML the composer
    /// exported before the tool runs; a host without one (an agent session)
    /// leaves the Markdown, and this tool renders it the same way.
    pub body: String,
    /// The primary recipients (To field).
    pub to: Vec<EmailRecipient>,
    /// Carbon copy recipients (optional).
    #[serde(default)]
    pub cc: Vec<EmailRecipient>,
    /// Blind carbon copy recipients (optional).
    #[serde(default)]
    pub bcc: Vec<EmailRecipient>,
    /// The ID of a message to reply to (optional). When set, the email is
    /// sent as a reply within the same thread.
    #[serde(default)]
    pub replying_to_id: Option<Uuid>,
    /// Per-message signature override, set by the composer's signature preview —
    /// not normally by you. Omit to use the inbox's default policy (always on a
    /// new email; on replies/forwards only when the user enabled it). `false`
    /// excludes the signature for this one email.
    #[serde(default)]
    pub include_signature: Option<bool>,
    /// The ID of the inbox (email link) to send from. When replying to a
    /// message, the backend automatically selects the inbox that received the
    /// original email. For new messages or to override the default, the user
    /// can specify this field. If omitted, the most recently connected inbox
    /// is used.
    #[serde(default)]
    pub from_link_id: Option<Uuid>,
}

/// Response from the SendEmail tool.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SendEmailResponse {
    Sent {
        /// The database ID of the sent message.
        message_id: Uuid,
        /// The thread ID the message belongs to.
        thread_id: Uuid,
        /// The ID of the inbox (email link) the message was sent from.
        link_id: Uuid,
    },
    ConvertedToDraft {
        draft_id: Uuid,
    },
    UserEdited,
}

impl ToolAnnotated for SendEmail {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Send email").with_open_world();
}

#[async_trait]
impl<T, G, E> AsyncTool<EmailToolContext<T, G, E>> for SendEmail
where
    T: EmailService,
    G: GmailTokenProvider,
    E: EntityAccessService,
{
    type Output = SendEmailResponse;

    #[tracing::instrument(skip_all, fields(
        user_id=?request_context.user_id,
        subject=%self.subject,
        to_count=%self.to.len(),
    ), err)]
    async fn call(
        &self,
        service_context: ServiceContext<EmailToolContext<T, G, E>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        println!("CALL SEND EMAIL {:?}", request_context);

        let acting_user = MacroUserIdStr((*request_context.user_id).clone());

        // Fetch all accessible inboxes for this user
        let accessible_inboxes = service_context
            .service
            .get_inboxes_for_macro_id(acting_user.clone())
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to fetch accessible inboxes: {e}"),
                internal_error: e.into(),
            })?;

        if accessible_inboxes.is_empty() {
            return Err(ToolCallError {
                description: "No email account linked for this user.".to_string(),
                internal_error: anyhow::anyhow!("No email link found for user"),
            });
        }

        // Smart inbox selection logic:
        // 1. If from_link_id is explicitly provided, use that inbox
        // 2. If replying to a message and from_link_id is not set, use the inbox that received the original message
        // 3. Otherwise, use the first (most recently connected) inbox
        let link = if let Some(from_link_id) = self.from_link_id {
            // Explicitly specified inbox
            accessible_inboxes
                .iter()
                .find(|l| l.id == from_link_id)
                .ok_or_else(|| ToolCallError {
                    description: format!(
                        "The specified inbox (link_id: {}) is not accessible to this user.",
                        from_link_id
                    ),
                    internal_error: anyhow::anyhow!("Invalid from_link_id"),
                })?
                .clone()
        } else if let Some(replying_to_id) = self.replying_to_id {
            // When replying, determine the inbox that received the original message
            match service_context
                .service
                .get_owned_link_for_message(acting_user.clone(), replying_to_id)
                .await
            {
                Ok(Some(reply_link)) => reply_link,
                Ok(None) => {
                    // If we can't find the message, fall back to the default inbox
                    tracing::warn!(
                        replying_to_id = %replying_to_id,
                        "Could not find inbox for reply target; using default inbox"
                    );
                    accessible_inboxes[0].clone()
                }
                Err(e) => {
                    tracing::error!(
                        error = ?e,
                        replying_to_id = %replying_to_id,
                        "Failed to fetch inbox for reply target; using default inbox"
                    );
                    accessible_inboxes[0].clone()
                }
            }
        } else {
            // Default: use the first (most recently connected) inbox
            accessible_inboxes[0].clone()
        };

        let body = service_context.render_body(&self.body).await?;

        let input = CreateDraftInput {
            db_id: None,
            provider_id: None,
            replying_to_id: self.replying_to_id,
            provider_thread_id: None,
            thread_db_id: None,
            subject: self.subject.clone(),
            to: self.to.iter().cloned().map(ContactInfo::from).collect(),
            cc: self.cc.iter().cloned().map(ContactInfo::from).collect(),
            bcc: self.bcc.iter().cloned().map(ContactInfo::from).collect(),
            body_text: body.text,
            body_html: Some(body.html),
            body_macro: None,
            headers_json: None,
            send_time: None,
            // Composer override when present; otherwise None lets the backend
            // apply the default signature policy.
            include_signature: self.include_signature,
            actor: Some(acting_user),
        };

        let sent = service_context
            .service
            .send_message(&link, &accessible_inboxes, input)
            .await
            .map_err(|e| ToolCallError {
                description: format!("Failed to send email: {e}"),
                internal_error: e.into(),
            })?;

        Ok(SendEmailResponse::Sent {
            message_id: sent.db_id,
            thread_id: sent.thread_db_id,
            link_id: link.id,
        })
    }
}
