#!/usr/bin/env node
/**
 * Operator CLI for entity tree mutations.
 * Mirrors `/api/admin/entities/*` and `/api/admin/memberships/*` 1:1
 * so operator runbooks behave identically regardless of entry point.
 *
 * RES-20260501-002 §"Operator-only mutation surface".
 *
 * Usage:
 *   pnpm tsx scripts/entity-admin/cli.ts <command> [...args] [--dry-run | --apply]
 *
 * Commands:
 *   create <kind> <name> [--parent <id>]
 *   set-parent <id> [--parent <id>]
 *   set-kind <id> <kind>
 *   archive <id>
 *   unarchive <id>
 *   hard-delete <id>
 *   list [--kind <kind>] [--include-archived]
 *   membership-grant <userId> <entityId> [--role owner] [--weight 1]
 *   membership-revoke <membershipId>
 *
 * Defaults to --dry-run; pass --apply to persist.
 */
import "dotenv/config";

type Mode = "dry-run" | "apply";

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  mode: Mode;
}

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let mode: Mode = "dry-run";

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--apply") {
      mode = "apply";
      continue;
    }
    if (tok === "--dry-run") {
      mode = "dry-run";
      continue;
    }
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(tok);
  }

  return { command: command ?? "", positional, flags, mode };
}

async function callApi(
  method: string,
  pathname: string,
  body?: unknown
): Promise<unknown> {
  const baseUrl = process.env.OPEN_HOUSING_BASE_URL ?? "http://localhost:3000";
  const apiKey = process.env.OPEN_HOUSING_FULL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPEN_HOUSING_FULL_API_KEY env var is required (full-permission API key)."
    );
  }
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function describe(args: Args): { method: string; pathname: string; body?: unknown } | null {
  switch (args.command) {
    case "create": {
      const [kind, name] = args.positional;
      const parentId = (args.flags.parent as string) ?? null;
      if (!kind || !name) {
        throw new Error("usage: create <kind> <name> [--parent <id>]");
      }
      return {
        method: "POST",
        pathname: "/api/admin/entities",
        body: { kind, name, parentId },
      };
    }
    case "set-parent": {
      const [id] = args.positional;
      const parentId = (args.flags.parent as string) ?? null;
      if (!id) throw new Error("usage: set-parent <id> [--parent <id>]");
      return {
        method: "POST",
        pathname: `/api/admin/entities/${id}/set-parent`,
        body: { parentId },
      };
    }
    case "set-kind": {
      const [id, kind] = args.positional;
      if (!id || !kind) throw new Error("usage: set-kind <id> <kind>");
      return {
        method: "POST",
        pathname: `/api/admin/entities/${id}/set-kind`,
        body: { kind },
      };
    }
    case "archive": {
      const [id] = args.positional;
      if (!id) throw new Error("usage: archive <id>");
      return { method: "POST", pathname: `/api/admin/entities/${id}/archive` };
    }
    case "unarchive": {
      const [id] = args.positional;
      if (!id) throw new Error("usage: unarchive <id>");
      return { method: "POST", pathname: `/api/admin/entities/${id}/unarchive` };
    }
    case "hard-delete": {
      const [id] = args.positional;
      if (!id) throw new Error("usage: hard-delete <id>");
      return { method: "DELETE", pathname: `/api/admin/entities/${id}` };
    }
    case "list": {
      const params = new URLSearchParams();
      if (args.flags["include-archived"]) params.set("includeArchived", "true");
      if (typeof args.flags.kind === "string") params.set("kind", args.flags.kind);
      const qs = params.toString();
      return {
        method: "GET",
        pathname: `/api/admin/entities${qs ? `?${qs}` : ""}`,
      };
    }
    case "membership-grant": {
      const [userId, entityId] = args.positional;
      if (!userId || !entityId) {
        throw new Error("usage: membership-grant <userId> <entityId> [--role owner]");
      }
      return {
        method: "POST",
        pathname: "/api/admin/memberships",
        body: {
          userId,
          entityId,
          role: (args.flags.role as string) ?? "owner",
          ...(typeof args.flags.weight === "string"
            ? { weight: Number(args.flags.weight) }
            : {}),
        },
      };
    }
    case "membership-revoke": {
      const [membershipId] = args.positional;
      if (!membershipId) throw new Error("usage: membership-revoke <membershipId>");
      return {
        method: "DELETE",
        pathname: `/api/admin/memberships/${membershipId}`,
      };
    }
    case "module-disable": {
      const [name] = args.positional;
      if (!name) throw new Error("usage: module-disable <module-name>");
      return {
        method: "POST",
        pathname: `/api/admin/modules/${name}/disable`,
      };
    }
    case "module-enable": {
      const [name] = args.positional;
      if (!name) throw new Error("usage: module-enable <module-name>");
      return {
        method: "POST",
        pathname: `/api/admin/modules/${name}/enable`,
      };
    }
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "help" || args.command === "--help") {
    console.log(`entity-admin CLI

Commands:
  create <kind> <name> [--parent <id>]
  set-parent <id> [--parent <id>]
  set-kind <id> <kind>
  archive <id>
  unarchive <id>
  hard-delete <id>
  list [--kind <kind>] [--include-archived]
  membership-grant <userId> <entityId> [--role owner] [--weight 1]
  membership-revoke <membershipId>

Mode: --dry-run (default) | --apply

Env:
  OPEN_HOUSING_BASE_URL (default: http://localhost:3000)
  OPEN_HOUSING_FULL_API_KEY (required, "full" permission)`);
    return;
  }

  const desc = describe(args);
  if (!desc) {
    console.error(`Unknown command: ${args.command}. Run with "help".`);
    process.exit(1);
  }

  if (args.mode === "dry-run") {
    console.log(`[dry-run] ${desc.method} ${desc.pathname}`);
    if (desc.body) console.log(`  body: ${JSON.stringify(desc.body, null, 2)}`);
    console.log("(pass --apply to persist)");
    return;
  }

  const result = await callApi(desc.method, desc.pathname, desc.body);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
