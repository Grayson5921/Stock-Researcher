// Shared ioredis connection factory for BullMQ + rate limiting.
// BullMQ requires maxRetriesPerRequest: null on its connection.
import IORedis, { Redis } from "ioredis";
import { env } from "./env";

const g = globalThis as unknown as { __srRedis?: Redis };

export function getRedis(): Redis {
  if (g.__srRedis) return g.__srRedis;
  const client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  g.__srRedis = client;
  return client;
}
