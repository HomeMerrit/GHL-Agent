import { ghlClient } from "./client";
import { config } from "../utils/config";
import { logger } from "../utils/logger";
import type { GHLConversation, GHLConversationDetail, GHLMessage, GHLContact } from "./types";

/**
 * Fetch all recent conversations for the configured GHL location.
 * Uses cursor-based pagination to retrieve every page.
 */
export async function fetchRecentConversations(): Promise<GHLConversation[]> {
  const conversations: GHLConversation[] = [];
  let startAfter: string | undefined;
  let page = 1;
  let reachedCutoff = false;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  logger.info(`Fetching conversations from GHL (last 30 days, since ${cutoffDate.toISOString()})...`);

  do {
    const params: Record<string, string | number> = {
      locationId: config.ghl.locationId,
      limit: 100,
      sort: "desc",
      sortBy: "last_message_date",
    };
    if (startAfter) params.startAfter = startAfter;

    const res = await ghlClient.get<{
      conversations: GHLConversation[];
      meta?: { startAfter?: string; total?: number };
    }>("/conversations/search", { params });

    const batch = res.data.conversations ?? [];

    for (const conv of batch) {
      if (conv.lastMessageDate && new Date(conv.lastMessageDate) < cutoffDate) {
        reachedCutoff = true;
        break;
      }
      conversations.push(conv);
    }

    logger.info(`  Page ${page}: fetched ${batch.length} (kept so far: ${conversations.length})`);

    startAfter = reachedCutoff ? undefined : res.data.meta?.startAfter;
    page++;
  } while (startAfter && !reachedCutoff);

  logger.info(`Fetched ${conversations.length} conversations within the last 30 days.`);
  return conversations;
}

/**
 * Fetch the full message history for a single conversation,
 * along with the associated contact record.
 */
export async function fetchConversationDetail(
  conversation: GHLConversation
): Promise<GHLConversationDetail> {
  const [messagesRes, contactRes] = await Promise.all([
    ghlClient.get<{ messages: GHLMessage[] }>(
      `/conversations/${conversation.id}/messages`,
      {
        params: {
          limit: config.agent.maxMessagesPerConversation,
          sort: "desc",
        },
      }
    ),
    ghlClient.get<{ contact: GHLContact }>(
      `/contacts/${conversation.contactId}`
    ),
  ]);

  return {
    ...conversation,
    messages: messagesRes.data.messages ?? [],
    contact: contactRes.data.contact,
  };
}
