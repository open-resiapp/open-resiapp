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
  // BYT-20261117-001 §7: MCP calls per access token.
  mcpToken: { maxRequests: 60, windowMs: 60 * 1000 } as RateLimitConfig, // 60/min
  // OAuth endpoints (authorize / token / register / revoke) per IP.
  // Browser-facing /oauth/authorize, per user IP (feeds the IP block list).
  oauth: { maxRequests: 30, windowMs: 60 * 1000 } as RateLimitConfig, // 30/min
  // Server-to-server MCP / OAuth traffic arrives from a few AI-host egress IPs
  // shared by every user, so the per-IP limit is generous and never blocks
  // the IP (blockOnRepeat: false). The per-token limit is the real control.
  mcpIp: { maxRequests: 1200, windowMs: 60 * 1000 } as RateLimitConfig, // 1200/min
  oauthHost: { maxRequests: 300, windowMs: 60 * 1000 } as RateLimitConfig, // 300/min
  // DCR creates a DB row per call; CIMD (no registration) is the primary
  // path, so DCR stays tight even for shared AI-host egress IPs.
  oauthRegister: { maxRequests: 30, windowMs: 15 * 60 * 1000 } as RateLimitConfig, // 30/15 min
  // BYT-20261117-001 §6: ballot email-link confirm page + decision, per user.
  ballotConfirm: { maxRequests: 20, windowMs: 60 * 60 * 1000 } as RateLimitConfig, // 20/hr
};

/**
 * Reverse proxies in front of the app that append to X-Forwarded-For
 * (Caddy, a load balancer …). The client IP is the entry the outermost
 * trusted proxy appended: counted from the RIGHT, so a client cannot spoof
 * it by sending its own X-Forwarded-For. Default 1 (Caddy → app). 0 = do
 * not trust the header at all (every request shares the "unknown" bucket).
 * Read at call time.
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Shared bucket for requests whose client IP cannot be determined. */
export const UNKNOWN_IP = "unknown";

export function getClientIp(request: NextRequest): string {
  const hops = trustedProxyHops();
  if (hops === 0) return UNKNOWN_IP;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      // Fewer entries than trusted hops → fewer proxies than configured;
      // the left-most entry is the best we have.
      const ip = parts[Math.max(0, parts.length - hops)];
      if (ip) return ip;
    }
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return UNKNOWN_IP;
}

export interface RateLimitOptions {
  /**
   * Default true: repeated limit hits put the IP on the 15-minute block list,
   * and a blocked IP is refused. Set false for endpoints whose callers share
   * egress IPs (MCP / OAuth server-to-server traffic from AI hosts) — the
   * request is still counted and limited, but the IP is never blocked and
   * the block list is not consulted.
   */
  blockOnRepeat?: boolean;
}

export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig,
  tier: string = "default",
  options: RateLimitOptions = {}
): NextResponse | null {
  // An undeterminable IP is ONE shared bucket (limited, never unlimited),
  // but never put on the block list — that would lock out every such client.
  const ip = getClientIp(request);
  const blockOnRepeat = (options.blockOnRepeat ?? true) && ip !== UNKNOWN_IP;

  // Check IP block first
  if (blockOnRepeat && isIpBlocked(ip)) {
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
    if (blockOnRepeat) trackRateLimitHit(ip);
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

/**
 * Fixed-window limit on an arbitrary key (e.g. a token fingerprint) instead
 * of the client IP. Returns the Retry-After seconds when limited, else null.
 * In-process like the IP limiter — each replica counts separately.
 */
export function checkRateLimitKey(
  key: string,
  config: RateLimitConfig,
  tier: string
): number | null {
  const store = getStore(tier);
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }
  entry.count++;
  if (entry.count > config.maxRequests) {
    return Math.ceil((entry.resetAt - now) / 1000);
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
