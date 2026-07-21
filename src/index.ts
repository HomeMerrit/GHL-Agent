/**
 * GHL AI Engagement Agent
 *
 * Orchestrates the full pipeline:
 *  1. Fetch conversations from the last 30 days
 *  2. Filter for stalled conversations (contact went quiet)
 *  3. Score each contact with Claude (realtor / seller financing context)
 *  4. Drop contacts where seller financing was NOT implied
 *  5. Drop contacts below the minimum engagement score
 *  6. Select the top 10% of remaining contacts
 *  7. Generate a personalized re-engagement SMS for each
 *  8. Send SMS (drip — staggered), move pipeline, add note to record
 *     (all skipped in DRY_RUN mode)
 *  9. Write a CSV report of all processed contacts to ./results-<timestamp>.csv
 */

import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import { config } from "./utils/config";
import { logger } from "./utils/logger";
import { fetchRecentConversations, fetchConversationDetail } from "./ghl/conversations";
import { scoreEngagement } from "./ai/analyzer";
import { generateFollowUpMessage } from "./ai/generator";
import { sendMessage } from "./ghl/messaging";
import { moveToTargetStage } from "./ghl/pipeline";
import { addContactNote } from "./ghl/notes";
import type { GHLConversationDetail, ScoredContact, FollowUpResult } from "./ghl/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A conversation is "stalled" if:
 * - There is at least one inbound message (the contact replied at some point)
 * - The most recent inbound message is at least stallDaysMin days old
 */
function isStalled(conv: GHLConversationDetail): boolean {
  const inbound = conv.messages.filter((m) => m.direction === "inbound");
  if (inbound.length === 0) return false;

  const lastInboundDate = inbound
    .map((m) => new Date(m.dateAdded).getTime())
    .reduce((a, b) => Math.max(a, b), 0);

  const stallCutoff = Date.now() - config.agent.stallDaysMin * 24 * 60 * 60 * 1000;
  return lastInboundDate < stallCutoff;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function csvEscape(value: string | number | boolean | undefined | null): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeResultsCsv(results: FollowUpResult[], scored: ScoredContact[]): void {
  const scoreMap = new Map(scored.map((s) => [s.contact.id, s]));

  const headers = [
    "Name",
    "Phone",
    "Email",
    "Engagement Score",
    "SF Implied",
    "Rationale",
    "Generated Message",
    "Message Sent",
    "Pipeline Moved",
    "Note Saved",
    "Errors",
  ];

  const rows = results.map((r) => {
    const s = scoreMap.get(r.contact.id);
    const name = [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ");
    return [
      csvEscape(name),
      csvEscape(r.contact.phone),
      csvEscape(r.contact.email),
      csvEscape(s?.engagementScore ?? ""),
      csvEscape(s?.sellerFinancingImplied ?? ""),
      csvEscape(s?.scoreRationale ?? ""),
      csvEscape(r.message),
      csvEscape(r.messageSent),
      csvEscape(r.pipelineMoved),
      csvEscape(r.noteSaved),
      csvEscape(r.errors.join("; ")),
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");

  // Windows-safe timestamp (no colons)
  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const outPath = path.resolve(process.cwd(), `results-${ts}.csv`);
  fs.writeFileSync(outPath, csv, "utf8");
  logger.info(`CSV report written to: ${outPath}`);
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

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

function filterStalled(details: GHLConversationDetail[]): GHLConversationDetail[] {
  const stalled = details.filter(isStalled);
  const dropped = details.length - stalled.length;
  logger.info(
    `Stall filter: ${stalled.length} stalled conversations kept, ${dropped} dropped (active or no inbound messages).`
  );
  return stalled;
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
          const { score, rationale, sellerFinancingImplied } = await scoreEngagement(conv);
          return {
            contact: conv.contact,
            conversation: conv,
            engagementScore: score,
            scoreRationale: rationale,
            sellerFinancingImplied,
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

function applyHardFilters(scored: ScoredContact[]): ScoredContact[] {
  const beforeCount = scored.length;

  const noSellerFinancing = scored.filter((s) => !s.sellerFinancingImplied);
  if (noSellerFinancing.length > 0) {
    logger.info(`Seller financing filter: dropping ${noSellerFinancing.length} contacts with no implied openness.`);
    noSellerFinancing.forEach((s) => {
      const name = [s.contact.firstName, s.contact.lastName].filter(Boolean).join(" ");
      logger.debug(`  Dropped (no SF signal): ${name} — ${s.scoreRationale}`);
    });
  }

  const afterSF = scored.filter((s) => s.sellerFinancingImplied);

  const belowThreshold = afterSF.filter((s) => s.engagementScore < config.agent.minEngagementScore);
  if (belowThreshold.length > 0) {
    logger.info(
      `Score filter: dropping ${belowThreshold.length} contacts below minimum score of ${config.agent.minEngagementScore}.`
    );
  }

  const qualified = afterSF.filter((s) => s.engagementScore >= config.agent.minEngagementScore);
  logger.info(
    `Hard filters: ${beforeCount} in → ${qualified.length} qualified (seller financing implied + score ≥ ${config.agent.minEngagementScore}).`
  );
  return qualified;
}

function selectTopContacts(scored: ScoredContact[], topPercent: number): ScoredContact[] {
  const sorted = [...scored].sort((a, b) => b.engagementScore - a.engagementScore);
  const cutoff = Math.max(1, Math.ceil((topPercent / 100) * sorted.length));
  const top = sorted.slice(0, cutoff);

  logger.info(
    `Top ${topPercent}% = ${top.length} contacts selected (lowest score in group: ${top[top.length - 1]?.engagementScore ?? 0})`
  );
  top.forEach((s, i) => {
    const name = [s.contact.firstName, s.contact.lastName].filter(Boolean).join(" ");
    logger.info(`  #${i + 1} ${name} — score ${s.engagementScore}: ${s.scoreRationale}`);
  });

  return top;
}

async function processTopContacts(top: ScoredContact[]): Promise<FollowUpResult[]> {
  const isDryRun = config.agent.dryRun;
  const dripDelayMs = config.agent.smsDripDelayMs;

  if (isDryRun) {
    logger.info("=== DRY RUN MODE — no messages will be sent, no records will be changed ===");
  }

  logger.info(
    `Processing ${top.length} contacts${isDryRun ? " (DRY RUN)" : ` with ${dripDelayMs / 1000}s drip delay`}...`
  );

  const results: FollowUpResult[] = [];

  // Sequential loop — drip delay between sends
  for (let i = 0; i < top.length; i++) {
    const scored = top[i];
    const result: FollowUpResult = {
      contact: scored.contact,
      message: "",
      messageSent: false,
      pipelineMoved: false,
      noteSaved: false,
      errors: [],
    };

    const name = [scored.contact.firstName, scored.contact.lastName].filter(Boolean).join(" ") || scored.contact.id;

    // Generate message (always — even in dry run, so we can log what would be sent)
    try {
      result.message = await generateFollowUpMessage(scored);
    } catch (err) {
      result.errors.push(`Message generation failed: ${String(err)}`);
      logger.error(`Failed to generate message for ${name}`, err);
      results.push(result);
      continue;
    }

    const noteBody =
      `[AI Agent — ${new Date().toLocaleDateString()}] Engagement score: ${scored.engagementScore}/100. ` +
      `Seller financing implied: yes. ` +
      `Rationale: ${scored.scoreRationale} ` +
      `Moved to Priority Lead pipeline stage.`;

    if (isDryRun) {
      logger.info(`[DRY RUN] Contact #${i + 1}: ${name}`);
      logger.info(`  Would send SMS: "${result.message}"`);
      logger.info(`  Would move to pipeline stage: ${config.ghl.pipelineStageId}`);
      logger.info(`  Would add note: "${noteBody}"`);
      // Mark as if successful so summary is accurate for review
      result.messageSent = true;
      result.pipelineMoved = true;
      result.noteSaved = true;
    } else {
      // Send SMS
      result.messageSent = await sendMessage(scored.contact.id, scored.conversation.id, result.message);
      if (!result.messageSent) result.errors.push("Message send failed");

      // Move pipeline
      result.pipelineMoved = await moveToTargetStage(scored.contact.id);
      if (!result.pipelineMoved) result.errors.push("Pipeline move failed");

      // Add note to contact record
      result.noteSaved = await addContactNote(scored.contact.id, noteBody);
      if (!result.noteSaved) result.errors.push("Note save failed");

      // Drip delay before next send (skip after last contact)
      if (i < top.length - 1) {
        logger.info(`Drip delay: waiting ${dripDelayMs / 1000}s before next send...`);
        await sleep(dripDelayMs);
      }
    }

    results.push(result);
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("=== GHL AI Engagement Agent starting ===");
  logger.info(
    `Config: location=${config.ghl.locationId}, top=${config.agent.topPercent}%, ` +
    `concurrency=${config.agent.concurrencyLimit}, minScore=${config.agent.minEngagementScore}, ` +
    `stallDaysMin=${config.agent.stallDaysMin}, dryRun=${config.agent.dryRun}`
  );

  const limit = pLimit(config.agent.concurrencyLimit);

  // 1. Fetch & hydrate (last 30 days)
  const details = await hydrateConversations(limit);
  if (details.length === 0) {
    logger.warn("No conversations found in the last 30 days. Exiting.");
    return;
  }

  // 2. Filter for stalled conversations
  const stalled = filterStalled(details);
  if (stalled.length === 0) {
    logger.warn("No stalled conversations found. Exiting.");
    return;
  }

  // 3. Score with Claude
  const scored = await scoreAllContacts(stalled, limit);

  // 4. Hard filters: seller financing implied + min score
  const qualified = applyHardFilters(scored);
  if (qualified.length === 0) {
    logger.warn("No contacts passed hard filters. Exiting.");
    return;
  }

  // 5. Select top %
  const top = selectTopContacts(qualified, config.agent.topPercent);

  // 6. Generate messages, send (drip), move pipeline, add notes
  const results = await processTopContacts(top);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const succeeded = results.filter((r) => r.messageSent && r.pipelineMoved && r.noteSaved);
  const partial = results.filter((r) => r.errors.length > 0 && (r.messageSent || r.pipelineMoved));
  const failed = results.filter((r) => !r.messageSent && !r.pipelineMoved);

  logger.info("=== Run complete ===");
  if (config.agent.dryRun) logger.info("  (DRY RUN — no actual changes made)");
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

  // 7. Write CSV report
  writeResultsCsv(results, top);
}

main().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
