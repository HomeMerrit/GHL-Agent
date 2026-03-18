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

  logger.info("Fetching conversations from GHL...");

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
    conversations.push(...batch);
    logger.info(`  Page ${page}: fetched ${batch.length} conversations (total so far: ${conversations.length})`);

    startAfter = res.data.meta?.startAfter;
    page++;
  } while (startAfter);

  logger.info(`Fetched ${conversations.length} conversations total.`);
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
