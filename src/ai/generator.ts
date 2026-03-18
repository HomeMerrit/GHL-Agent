import Anthropic from "@anthropic-ai/sdk";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import type { ScoredContact } from "../ghl/types";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Generate a personalized follow-up SMS message for a highly engaged contact.
 * The message is concise, warm, and references specific details from their
 * conversation history.
 */
export async function generateFollowUpMessage(
  scored: ScoredContact
): Promise<string> {
  const { contact, conversation } = scored;
  const name =
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "there";

  const recentMessages = conversation.messages
    .slice()
    .reverse()
    .slice(-10) // last 10 messages for context
    .map((m) => {
      const who = m.direction === "inbound" ? `Contact` : "Us";
      return `${who}: ${m.body?.trim() ?? "(no text)"}`;
    })
    .join("\n");

  const systemPrompt = `You are a friendly, professional sales representative crafting a personalized follow-up SMS message.

Guidelines:
- Address the contact by their first name
- Reference something specific from the conversation (a question they asked, a product they mentioned, a timeline they gave)
- Keep the message under 160 characters when possible (SMS limit), never exceed 300 characters
- Sound human and warm — not robotic or generic
- Include a clear, low-pressure call to action
- Do NOT use emojis
- Output ONLY the final message text, nothing else`;

  const userMessage = `Write a follow-up SMS for:
Name: ${name}
Engagement score: ${scored.engagementScore}/100
Reason they're a top lead: ${scored.scoreRationale}

Recent conversation:
${recentMessages}`;

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 256,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Claude returned no text for message generation (contact: ${contact.id})`);
  }

  const message = textBlock.text.trim();
  logger.debug(`Generated follow-up for ${name}: "${message}"`);
  return message;
}
