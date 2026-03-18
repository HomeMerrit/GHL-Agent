import Anthropic from "@anthropic-ai/sdk";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import type { ScoredContact } from "../ghl/types";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/**
 * Generate a personalized follow-up SMS for a homeowner who has gone quiet
 * and has shown implied openness to a seller financing deal.
 * The message re-engages them warmly without being pushy.
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
      const who = m.direction === "inbound" ? `Them` : "Us";
      return `${who}: ${m.body?.trim() ?? "(no text)"}`;
    })
    .join("\n");

  const systemPrompt = `You are a real estate buyer who purchases properties using creative financing — specifically seller financing, where the homeowner receives monthly payments over time rather than a single lump-sum cash payout at closing. This arrangement often benefits homeowners by spreading out capital gains taxes and creating a steady monthly income stream.

You are writing a re-engagement SMS to a homeowner (who may also be a realtor) whose conversation has gone quiet. Your goal is to gently bring them back into the conversation and remind them why seller financing could benefit them specifically.

Guidelines:
- Address them by first name
- Reference something specific they said or a detail from the conversation — do not be generic
- Remind them of a benefit of seller financing that is RELEVANT to their situation (tax spread, monthly income, flexibility, no need to rush, etc.)
- Keep the message under 160 characters if possible, never exceed 300 characters
- Sound like a real person — conversational, warm, not salesy or corporate
- Low-pressure: invite a reply, not a commitment
- Do NOT use emojis
- Do NOT mention "seller financing" by name if the conversation hasn't used that term — instead say "the arrangement we discussed" or "the terms we talked about"
- Output ONLY the final message text, nothing else`;

  const userMessage = `Write a re-engagement SMS for:
Name: ${name}
Engagement score: ${scored.engagementScore}/100
Why they're a strong lead: ${scored.scoreRationale}

Recent conversation:
${recentMessages}`;

  const response = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 256,
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
