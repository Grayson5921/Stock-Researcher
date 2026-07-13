// Simple Redis fixed-window rate limiter. Good enough for per-endpoint abuse
// protection; swap for a sliding window/leaky bucket if you need precision.
import { getRedis } from "./redis";

export interface RateResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const redis = getRedis();
  const redisKey = `rl:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSec);
  const ttl = await redis.ttl(redisKey);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetSec: ttl < 0 ? windowSec : ttl,
  };
}
