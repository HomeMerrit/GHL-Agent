import { ghlClient } from "./client";
import { config } from "../utils/config";
import { logger } from "../utils/logger";

/**
 * Move a contact's opportunity to the target pipeline stage.
 * First finds existing opportunities for the contact, then updates the stage.
 * If no opportunity exists, creates one in the target stage.
 */
export async function moveToTargetStage(contactId: string): Promise<boolean> {
  try {
    // Look up existing opportunities for this contact
    const searchRes = await ghlClient.get<{
      opportunities: Array<{ id: string; pipelineStageId: string }>;
    }>("/opportunities/search", {
      params: {
        location_id: config.ghl.locationId,
        contact_id: contactId,
        limit: 1,
      },
    });

    const existing = searchRes.data.opportunities?.[0];

    if (existing) {
      // Update the existing opportunity to the target stage
      await ghlClient.put(`/opportunities/${existing.id}`, {
        pipelineStageId: config.ghl.pipelineStageId,
      });
      logger.info(
        `Moved contact ${contactId} opportunity ${existing.id} to stage ${config.ghl.pipelineStageId}`
      );
    } else {
      // Create a new opportunity in the target stage
      await ghlClient.post(`/opportunities/`, {
        pipelineId: config.ghl.pipelineId,
        pipelineStageId: config.ghl.pipelineStageId,
        locationId: config.ghl.locationId,
        contactId,
        name: "AI-Identified Engagement",
        status: "open",
      });
      logger.info(
        `Created new opportunity for contact ${contactId} in stage ${config.ghl.pipelineStageId}`
      );
    }

    return true;
  } catch (err) {
    logger.error(`Failed to move contact ${contactId} to pipeline stage`, err);
    return false;
  }
}
