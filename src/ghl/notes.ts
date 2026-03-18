import { ghlClient } from "./client";
import { logger } from "../utils/logger";

/**
 * Add a note to a GHL contact record.
 */
export async function addContactNote(contactId: string, body: string): Promise<boolean> {
  try {
    await ghlClient.post(`/contacts/${contactId}/notes`, { body });
    logger.info(`Note added to contact ${contactId}`);
    return true;
  } catch (err) {
    logger.error(`Failed to add note to contact ${contactId}`, err);
    return false;
  }
}
