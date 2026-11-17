import { MCP_SCOPES, type Scope } from "../principal";

// Scope parsing (BYT-20261117-001 §2). Every scope is advertised in
// `scopes_supported` and granted by default: Claude does not re-authorize on
// a 403 insufficient_scope, so step-up never happened and finance/write tools
// stayed unusable. The consent screen lists each scope, and the user's role in
// the community still limits what any tool may do.

export const ADVERTISED_SCOPES: readonly Scope[] = MCP_SCOPES;
export const DEFAULT_SCOPES: readonly Scope[] = MCP_SCOPES;

export function isScope(s: string): s is Scope {
  return (MCP_SCOPES as readonly string[]).includes(s);
}

/**
 * Space-delimited scope string → deduped Scope[] in canonical order.
 * Returns null when any scope is unknown (→ `invalid_scope`). Empty/absent
 * → the default scope set.
 */
export function parseScopeParam(raw: string | null | undefined): Scope[] | null {
  const parts = (raw ?? "").split(" ").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [...DEFAULT_SCOPES];
  if (!parts.every(isScope)) return null;
  const set = new Set(parts);
  return MCP_SCOPES.filter((s) => set.has(s));
}

/** Stored jsonb scopes → known Scope[] (drops anything unknown). */
export function normalizeStoredScopes(raw: unknown): Scope[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.filter((s): s is string => typeof s === "string"));
  return MCP_SCOPES.filter((s) => set.has(s));
}

export function formatScopes(scopes: readonly string[]): string {
  return scopes.join(" ");
}
