import Anthropic from "@anthropic-ai/sdk";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import type { GHLConversationDetail } from "../ghl/types";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface EngagementScore {
  score: number;                  // 0–100
  rationale: string;
  sellerFinancingImplied: boolean;
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
      const who = m.direction === "inbound" ? `Homeowner (${name})` : "Us (Buyer)";
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
 * Use Claude to score the engagement level of a single conversation
 * in the context of a real estate creative finance / seller financing deal.
 * Returns a score, rationale, and whether seller financing was implied.
 */
export async function scoreEngagement(
  conversation: GHLConversationDetail
): Promise<EngagementScore> {
  const transcript = buildTranscript(conversation);

  const systemPrompt = `You are a real estate acquisition analyst specializing in creative finance and seller financing deals. Your company approaches homeowners (many of whom are realtors or have real estate knowledge) about purchasing their property using seller financing — meaning the homeowner acts as the bank and receives monthly payments over time instead of one lump-sum cash payout at closing.

Your job is to assess two things:
1. Whether the homeowner has IMPLIED openness to seller financing or flexible terms (this is a hard requirement)
2. How engaged and warm they are as a lead

SELLER FINANCING SIGNALS — look for any of these (explicit or implied):
- Mentions of flexibility on terms, closing timeline, or payment structure
- Concern about a large tax hit from a lump-sum sale (capital gains)
- Interest in monthly income or passive cash flow from the property
- No urgency to receive all cash at once
- Openness to "creative" or "non-traditional" arrangements
- Willingness to "work something out" or "be flexible"
- Questions about how the deal would be structured
- They own the property free-and-clear or have low remaining mortgage balance (often more open to seller financing)
- Mentions of estate/inheritance situations where heirs don't need immediate cash

ENGAGEMENT SIGNALS:
- Recency and frequency of replies
- Questions about next steps, timelines, or specifics
- Positive tone, warmth, expressed interest
- Urgency indicators (life event, relocation, retirement)
- Absence of hard objections or outright refusals

Output ONLY a valid JSON object in this exact format (no markdown, no explanation outside the JSON):
{
  "score": <integer 0-100>,
  "rationale": "<2-3 sentence summary focusing on why they scored this way and what seller financing signals were present>",
  "sellerFinancingImplied": <true or false>
}

Set sellerFinancingImplied to true ONLY if the conversation contains at least one clear signal of openness to seller financing or flexible terms. If the conversation contains no such signals, set it to false regardless of score.`;

  const userMessage = `Please score the following homeowner conversation:\n\n${transcript}`;

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for engagement scoring");
  }

  try {
    const parsed = JSON.parse(textBlock.text) as {
      score: number;
      rationale: string;
      sellerFinancingImplied: boolean;
    };
    logger.debug(
      `Scored contact ${conversation.contactId}: ${parsed.score}/100, sellerFinancing=${parsed.sellerFinancingImplied} — ${parsed.rationale}`
    );
    return {
      score: parsed.score,
      rationale: parsed.rationale,
      sellerFinancingImplied: parsed.sellerFinancingImplied,
    };
  } catch {
    logger.warn(`Failed to parse Claude score response, defaulting to 0. Raw: ${textBlock.text}`);
    return { score: 0, rationale: "Score parsing failed.", sellerFinancingImplied: false };
  }
}
