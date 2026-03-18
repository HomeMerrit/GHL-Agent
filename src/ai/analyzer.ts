import Anthropic from "@anthropic-ai/sdk";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import type { GHLConversationDetail } from "../ghl/types";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

interface EngagementScore {
  score: number;         // 0–100
  rationale: string;
}

/**
 * Serialize a conversation's messages into a readable transcript string
 * to pass as context to Claude.
 */
function buildTranscript(conversation: GHLConversationDetail): string {
  const { contact, messages } = conversation;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";

  const messageLines = messages
    .slice()
    .reverse() // chronological order (oldest first)
    .map((m) => {
      const who = m.direction === "inbound" ? `Contact (${name})` : "Business";
      const when = new Date(m.dateAdded).toLocaleString();
      return `[${when}] ${who}: ${m.body?.trim() ?? "(no text)"}`;
    })
    .join("\n");

  return `Contact: ${name} | Email: ${contact.email ?? "N/A"} | Phone: ${contact.phone ?? "N/A"}
Tags: ${contact.tags?.join(", ") || "none"}
Source: ${contact.source ?? "unknown"}

--- Conversation Transcript ---
${messageLines || "(no messages)"}`;
}

/**
 * Use Claude to score the engagement level of a single conversation.
 * Returns a score from 0–100 and a brief rationale.
 */
export async function scoreEngagement(
  conversation: GHLConversationDetail
): Promise<EngagementScore> {
  const transcript = buildTranscript(conversation);

  const systemPrompt = `You are a sales intelligence analyst. Your job is to assess how ready a contact is to do business based on their conversation history with a company.

Evaluate the conversation on the following signals:
- Recency and frequency of the contact's replies
- Expressed interest, questions about pricing, demos, or next steps
- Positive sentiment and emotional warmth
- Urgency indicators (timelines, specific needs, budget mentions)
- Any objections or hesitations

Output ONLY a valid JSON object in this exact format (no markdown, no explanation outside the JSON):
{
  "score": <integer 0-100>,
  "rationale": "<1-2 sentence summary of why this score was given>"
}`;

  const userMessage = `Please score the following conversation:\n\n${transcript}`;

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  // Extract the text block from the response
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for engagement scoring");
  }

  try {
    const parsed = JSON.parse(textBlock.text) as { score: number; rationale: string };
    logger.debug(
      `Scored contact ${conversation.contactId}: ${parsed.score}/100 — ${parsed.rationale}`
    );
    return { score: parsed.score, rationale: parsed.rationale };
  } catch {
    logger.warn(`Failed to parse Claude score response, defaulting to 0. Raw: ${textBlock.text}`);
    return { score: 0, rationale: "Score parsing failed." };
  }
}
