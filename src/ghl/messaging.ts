import { ghlClient } from "./client";
import { logger } from "../utils/logger";

/**
 * Send an SMS/text message to a contact via GHL.
 */
export async function sendMessage(
  contactId: string,
  conversationId: string,
  message: string
): Promise<boolean> {
  try {
    await ghlClient.post(`/conversations/messages`, {
      type: "SMS",
      conversationId,
      contactId,
      message,
    });
    logger.info(`Message sent to contact ${contactId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send message to contact ${contactId}`, err);
    return false;
  }
}
