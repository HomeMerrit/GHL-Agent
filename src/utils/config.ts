import * as dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
        `Copy .env.example to .env and fill in your credentials.`
    );
  }
  return value;
}

export const config = {
  ghl: {
    apiKey: requireEnv("GHL_API_KEY"),
    locationId: requireEnv("GHL_LOCATION_ID"),
    pipelineId: requireEnv("GHL_PIPELINE_ID"),
    pipelineStageId: requireEnv("GHL_PIPELINE_STAGE_ID"),
    baseUrl: "https://services.leadconnectorhq.com",
  },
  anthropic: {
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    model: "claude-opus-4-6" as const,
  },
  agent: {
    topPercent: Number(process.env.TOP_PERCENT ?? "10"),
    maxMessagesPerConversation: Number(
      process.env.MAX_MESSAGES_PER_CONVERSATION ?? "20"
    ),
    concurrencyLimit: Number(process.env.CONCURRENCY_LIMIT ?? "5"),
    dryRun: process.env.DRY_RUN === "true",
    smsDripDelayMs: Number(process.env.SMS_DRIP_DELAY_MS ?? "30000"),
    stallDaysMin: Number(process.env.STALL_DAYS_MIN ?? "3"),
    minEngagementScore: Number(process.env.MIN_ENGAGEMENT_SCORE ?? "60"),
  },
};
