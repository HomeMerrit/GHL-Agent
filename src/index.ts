/**
 * GHL AI Engagement Agent
 *
 * Orchestrates the full pipeline:
 *  1. Fetch all recent GHL conversations
 *  2. Score each contact's engagement with Claude
 *  3. Identify the top 10% most engaged contacts
 *  4. Generate a personalized follow-up message for each
 *  5. Send the message via GHL and move them to the target pipeline stage
 */

import pLimit from "p-limit";
import { config } from "./utils/config";
import { logger } from "./utils/logger";
import { fetchRecentConversations, fetchConversationDetail } from "./ghl/conversations";
import { scoreEngagement } from "./ai/analyzer";
import { generateFollowUpMessage } from "./ai/generator";
import { sendMessage } from "./ghl/messaging";
import { moveToTargetStage } from "./ghl/pipeline";
import type { GHLConversationDetail, ScoredContact, FollowUpResult } from "./ghl/types";

// ─── Step helpers ────────────────────────────────────────────────────────────

async function hydrateConversations(
  limit: ReturnType<typeof pLimit>
): Promise<GHLConversationDetail[]> {
  const conversations = await fetchRecentConversations();

  logger.info(`Hydrating ${conversations.length} conversation details...`);
  const details = await Promise.all(
    conversations.map((c) =>
      limit(async () => {
        try {
          return await fetchConversationDetail(c);
        } catch (err) {
          logger.warn(`Skipping conversation ${c.id}: failed to hydrate`, err);
          return null;
        }
      })
    )
  );

  return details.filter((d): d is GHLConversationDetail => d !== null);
}

async function scoreAllContacts(
  details: GHLConversationDetail[],
  limit: ReturnType<typeof pLimit>
): Promise<ScoredContact[]> {
  logger.info(`Scoring ${details.length} contacts with Claude...`);

  const scored = await Promise.all(
    details.map((conv) =>
      limit(async () => {
        try {
          const { score, rationale } = await scoreEngagement(conv);
          return {
            contact: conv.contact,
            conversation: conv,
            engagementScore: score,
            scoreRationale: rationale,
          } satisfies ScoredContact;
        } catch (err) {
          logger.warn(`Skipping scoring for contact ${conv.contactId}`, err);
          return null;
        }
      })
    )
  );

  return scored.filter((s): s is ScoredContact => s !== null);
}

function selectTopContacts(scored: ScoredContact[], topPercent: number): ScoredContact[] {
  const sorted = [...scored].sort((a, b) => b.engagementScore - a.engagementScore);
  const cutoff = Math.max(1, Math.ceil((topPercent / 100) * sorted.length));
  const top = sorted.slice(0, cutoff);

  logger.info(
    `Top ${topPercent}% = ${top.length} contacts (score threshold: ${top[top.length - 1]?.engagementScore ?? 0})`
  );
  top.forEach((s, i) => {
    const name = [s.contact.firstName, s.contact.lastName].filter(Boolean).join(" ");
    logger.info(`  #${i + 1} ${name} — score ${s.engagementScore}: ${s.scoreRationale}`);
  });

  return top;
}

async function processTopContacts(
  top: ScoredContact[],
  limit: ReturnType<typeof pLimit>
): Promise<FollowUpResult[]> {
  logger.info(`Generating messages and following up with ${top.length} contacts...`);

  const results = await Promise.all(
    top.map((scored) =>
      limit(async (): Promise<FollowUpResult> => {
        const result: FollowUpResult = {
          contact: scored.contact,
          message: "",
          messageSent: false,
          pipelineMoved: false,
          errors: [],
        };

        try {
          result.message = await generateFollowUpMessage(scored);
        } catch (err) {
          result.errors.push(`Message generation failed: ${String(err)}`);
          logger.error(`Failed to generate message for ${scored.contact.id}`, err);
          return result;
        }

        const [sent, moved] = await Promise.all([
          sendMessage(scored.contact.id, scored.conversation.id, result.message),
          moveToTargetStage(scored.contact.id),
        ]);

        result.messageSent = sent;
        result.pipelineMoved = moved;

        if (!sent) result.errors.push("Message send failed");
        if (!moved) result.errors.push("Pipeline move failed");

        return result;
      })
    )
  );

  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("=== GHL AI Engagement Agent starting ===");
  logger.info(`Config: location=${config.ghl.locationId}, top=${config.agent.topPercent}%, concurrency=${config.agent.concurrencyLimit}`);

  const limit = pLimit(config.agent.concurrencyLimit);

  // 1. Fetch & hydrate conversations
  const details = await hydrateConversations(limit);
  if (details.length === 0) {
    logger.warn("No conversations found. Exiting.");
    return;
  }

  // 2. Score engagement
  const scored = await scoreAllContacts(details, limit);

  // 3. Select top contacts
  const top = selectTopContacts(scored, config.agent.topPercent);

  // 4 & 5. Generate messages, send, move pipeline
  const results = await processTopContacts(top, limit);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const succeeded = results.filter((r) => r.messageSent && r.pipelineMoved);
  const partial = results.filter((r) => (r.messageSent || r.pipelineMoved) && r.errors.length > 0);
  const failed = results.filter((r) => !r.messageSent && !r.pipelineMoved);

  logger.info("=== Run complete ===");
  logger.info(`  Total processed:  ${results.length}`);
  logger.info(`  Fully succeeded:  ${succeeded.length}`);
  logger.info(`  Partial success:  ${partial.length}`);
  logger.info(`  Failed:           ${failed.length}`);

  if (failed.length > 0) {
    logger.warn("Failed contacts:");
    failed.forEach((r) => {
      const name = [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ");
      logger.warn(`  ${name} (${r.contact.id}): ${r.errors.join(", ")}`);
    });
  }
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
