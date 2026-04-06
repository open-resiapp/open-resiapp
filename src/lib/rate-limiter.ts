import { NextRequest, NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(tier: string): Map<string, RateLimitEntry> {
  let store = stores.get(tier);
  if (!store) {
    store = new Map();
    stores.set(tier, store);
  }
  return store;
}

export const RATE_LIMITS = {
  pair: { maxRequests: 5, windowMs: 60 * 60 * 1000 } as RateLimitConfig, // 5/hr
  health: { maxRequests: 30, windowMs: 60 * 1000 } as RateLimitConfig, // 30/min
  api: { maxRequests: 100, windowMs: 60 * 1000 } as RateLimitConfig, // 100/min
};

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig,
  tier: string = "default"
): NextResponse | null {
  const ip = getClientIp(request);
  if (ip === "unknown") return null;

  // Check IP block first
  if (isIpBlocked(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": "900" },
      }
    );
  }

  const store = getStore(tier);
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > config.maxRequests) {
    trackRateLimitHit(ip);
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  return null;
}

// ── IP Blocking ─────────────────────────────────────────

interface BlockEntry {
  blockedUntil: number;
}

interface HitTracker {
  hits: number[];
}

const blockedIps = new Map<string, BlockEntry>();
const rateLimitHits = new Map<string, HitTracker>();

const BLOCK_THRESHOLD = 3; // 3 rate limit hits
const BLOCK_WINDOW_MS = 5 * 60 * 1000; // within 5 minutes
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15-minute block

export function isIpBlocked(ip: string): boolean {
  const entry = blockedIps.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.blockedUntil) {
    blockedIps.delete(ip);
    return false;
  }
  return true;
}

function trackRateLimitHit(ip: string) {
  const now = Date.now();
  const tracker = rateLimitHits.get(ip) || { hits: [] };

  // Keep only hits within the window
  tracker.hits = tracker.hits.filter((t) => now - t < BLOCK_WINDOW_MS);
  tracker.hits.push(now);
  rateLimitHits.set(ip, tracker);

  if (tracker.hits.length >= BLOCK_THRESHOLD) {
    blockedIps.set(ip, { blockedUntil: now + BLOCK_DURATION_MS });
    rateLimitHits.delete(ip);
  }
}

// ── Periodic Cleanup ────────────────────────────────────

function cleanup() {
  const now = Date.now();

  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
      }
    }
  }

  for (const [ip, entry] of blockedIps) {
    if (now > entry.blockedUntil) {
      blockedIps.delete(ip);
    }
  }

  for (const [ip, tracker] of rateLimitHits) {
    tracker.hits = tracker.hits.filter((t) => now - t < BLOCK_WINDOW_MS);
    if (tracker.hits.length === 0) {
      rateLimitHits.delete(ip);
    }
  }
}

// Clean up every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanup, 5 * 60 * 1000).unref?.();
}
