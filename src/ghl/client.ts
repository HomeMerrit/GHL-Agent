import axios, { AxiosInstance, AxiosError } from "axios";
import { config } from "../utils/config";
import { logger } from "../utils/logger";

/**
 * Thin wrapper around the GHL REST API.
 * All methods are added in the feature-specific modules (conversations, contacts, etc.)
 * This module only provides the shared axios instance and retry logic.
 */

function createGHLClient(): AxiosInstance {
  const client = axios.create({
    baseURL: config.ghl.baseUrl,
    headers: {
      Authorization: `Bearer ${config.ghl.apiKey}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    timeout: 30_000,
  });

  // Request logger
  client.interceptors.request.use((req) => {
    logger.debug(`GHL → ${req.method?.toUpperCase()} ${req.url}`);
    return req;
  });

  // Response logger + basic error shaping
  client.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      const status = err.response?.status;
      const detail = JSON.stringify(err.response?.data ?? err.message);
      logger.error(`GHL API error ${status}: ${detail}`);
      return Promise.reject(err);
    }
  );

  return client;
}

export const ghlClient = createGHLClient();
