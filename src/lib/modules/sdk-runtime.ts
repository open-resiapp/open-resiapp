import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { Pool } from "pg";

import {
  PermissionDeniedError,
  type ComponentLoader,
  type Community as SdkCommunity,
  type Member as SdkMember,
  type ModuleContext,
  type ModuleSDK,
  type Permission,
  type ReadQuery,
  type SlotName,
} from "./sdk";
import { tablePrefixFor, migrationsTableFor } from "./sdk";
import { registerModule, type LoadedModule } from "./registry";

// Read-only whitelist of core tables exposed via sdk.db.read. Each entry
// declares the table + columns a module is allowed to read. After
// RES-20260501-002, the canonical surface is entities + housing_*_data;
// the legacy `building` / `entrances` / `flats` aliases are kept for
// modules built against the older spec until they migrate.
const CORE_READ_WHITELIST: Record<string, ReadonlySet<string>> = {
  entities: new Set(["id", "parent_id", "kind", "name", "path", "depth", "root_id", "archived_at"]),
  housing_root_data: new Set(["entity_id", "address", "ico", "voting_method", "country", "governance_model"]),
  housing_unit_data: new Set(["entity_id", "flat_number", "floor", "share_numerator", "share_denominator", "area"]),
  memberships: new Set(["id", "user_id", "entity_id", "role", "weight", "status"]),
  users: new Set(["id", "email", "name", "platform_role", "is_active"]),
};

// Shape every module gets as `community` — matches SDK's Community DTO.
export interface CommunityRow {
  id: string;
  name: string;
  country: "sk" | "cz";
}

// Per-module SDK constructed at hook-call time. Closes over the LoadedModule
// (for grants) and the active community.
export function buildContextFor(
  mod: LoadedModule,
  communityRow: CommunityRow
): ModuleContext {
  const community: SdkCommunity = {
    id: communityRow.id,
    name: communityRow.name,
    country: communityRow.country,
  };
  return {
    sdk: makeSDK(mod, community),
    module: { name: mod.manifest.name, version: mod.manifest.version },
    community,
  };
}

function getPool(): Pool {
  const g = globalThis as unknown as { __openHousingPool?: Pool };
  if (!g.__openHousingPool) {
    g.__openHousingPool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return g.__openHousingPool;
}

function require_(mod: LoadedModule, perm: Permission, detail?: string): void {
  if (!mod.grantedPermissions.has(perm)) {
    throw new PermissionDeniedError(mod.manifest.name, perm, detail);
  }
}

function makeSDK(mod: LoadedModule, community: SdkCommunity): ModuleSDK {
  const prefix = tablePrefixFor(mod.manifest.name);
  const migrationsTable = migrationsTableFor(mod.manifest.name);

  return {
    db: {
      async read<T>(query: ReadQuery): Promise<T[]> {
        require_(mod, "db:read");
        const allowedCore = CORE_READ_WHITELIST[query.table];
        const isModuleTable = query.table.startsWith(prefix);
        if (!isModuleTable && !allowedCore) {
          throw new PermissionDeniedError(
            mod.manifest.name,
            "db:read",
            `table "${query.table}" is not exposed`
          );
        }
        const cols = query.columns ?? null;
        if (allowedCore && cols) {
          for (const c of cols) {
            if (!allowedCore.has(c)) {
              throw new PermissionDeniedError(
                mod.manifest.name,
                "db:read",
                `column "${c}" not exposed on "${query.table}"`
              );
            }
          }
        }
        const select = cols ? cols.map(quoteIdent).join(",") : "*";
        const where = query.where ?? {};
        const whereKeys = Object.keys(where);
        const params: unknown[] = [];
        const whereClause = whereKeys.length
          ? "WHERE " +
            whereKeys
              .map((k, i) => {
                params.push(where[k]);
                return `${quoteIdent(k)} = $${i + 1}`;
              })
              .join(" AND ")
          : "";
        const limit = query.limit ? `LIMIT ${Math.max(0, Math.floor(query.limit))}` : "";
        const sql = `SELECT ${select} FROM ${quoteIdent(query.table)} ${whereClause} ${limit}`.trim();
        const res = await getPool().query(sql, params);
        return res.rows as T[];
      },

      async write(table, row) {
        require_(mod, "db:write");
        if (!table.startsWith(prefix)) {
          throw new PermissionDeniedError(
            mod.manifest.name,
            "db:write",
            `module may only write to tables prefixed "${prefix}"`
          );
        }
        const keys = Object.keys(row);
        if (keys.length === 0) return;
        const cols = keys.map(quoteIdent).join(",");
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(",");
        const values = keys.map((k) => row[k]);
        const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`;
        await getPool().query(sql, values);
      },

      async runMigrations() {
        require_(mod, "db:write");
        await runModuleMigrations(mod.installPath, mod.manifest.name, migrationsTable);
      },
    },

    events: {
      emit(name, payload) {
        emitEvent(name, payload);
      },
      on(name, handler) {
        onEvent(name, handler as (p: unknown) => void);
      },
    },

    ui: {
      registerSlot(slot: SlotName, component: ComponentLoader) {
        require_(mod, "ui:inject");
        registerModule({
          ...mod,
          definition: {
            ...mod.definition,
            ui: { ...mod.definition.ui, [slot]: component },
          },
        });
      },
    },

    http: {
      async fetch(url, init) {
        require_(mod, "api:external");
        const start = Date.now();
        try {
          const res = await fetch(url, init);
          console.info(
            `[modules] ${mod.manifest.name} http ${init?.method ?? "GET"} ${url} -> ${res.status} (${Date.now() - start}ms)`
          );
          return res;
        } catch (err) {
          console.warn(
            `[modules] ${mod.manifest.name} http ${url} failed:`,
            err
          );
          throw err;
        }
      },
    },

    hardware: {
      async requestDevice(spec) {
        require_(mod, "hardware:access");
        // V1 stub — surfaces consent in admin UI later. Modules requesting
        // hardware should ship a Phase 2 implementation themselves.
        throw new Error(
          `hardware:access requested for kind="${spec.kind}" but no host driver registered`
        );
      },
    },

    community: {
      async current() {
        return community;
      },
      async member(userId): Promise<SdkMember | null> {
        // Phase 9.1d: role no longer lives on users; resolve the
        // strongest membership role within the active community.
        const res = await getPool().query(
          `SELECT u.id, u.email, u.name,
                  COALESCE(
                    (SELECT m.role FROM memberships m
                     JOIN entities e ON e.id = m.entity_id
                     WHERE m.user_id = u.id
                       AND m.status = 'active'
                       AND e.root_id = $2
                     ORDER BY
                       CASE m.role
                         WHEN 'admin' THEN 4
                         WHEN 'owner' THEN 3
                         WHEN 'vote_counter' THEN 2
                         WHEN 'caretaker' THEN 1
                         ELSE 0
                       END DESC
                     LIMIT 1),
                    'owner'
                  ) AS role
           FROM users u WHERE u.id = $1 LIMIT 1`,
          [userId, community.id]
        );
        if (res.rowCount === 0) return null;
        const r = res.rows[0];
        return { id: r.id, email: r.email, role: r.role, fullName: r.name };
      },
    },

    log: {
      info: (m, meta) =>
        console.info(`[mod:${mod.manifest.name}] ${m}`, meta ?? ""),
      warn: (m, meta) =>
        console.warn(`[mod:${mod.manifest.name}] ${m}`, meta ?? ""),
      error: (m, err) =>
        console.error(`[mod:${mod.manifest.name}] ${m}`, err ?? ""),
    },
  };
}

function quoteIdent(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`invalid SQL identifier: ${id}`);
  }
  return `"${id}"`;
}

// ── Per-module migrations ─────────────────────────────────

async function runModuleMigrations(
  installPath: string,
  moduleName: string,
  migrationsTable: string
): Promise<void> {
  const dir = path.join(installPath, "migrations");
  let files: string[];
  try {
    files = (await fs.readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }

  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${migrationsTable}" (
      filename text PRIMARY KEY,
      applied_at timestamptz DEFAULT now() NOT NULL
    )`
  );

  for (const file of files) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM "${migrationsTable}" WHERE filename = $1`,
      [file]
    );
    if (rowCount && rowCount > 0) continue;

    const sql = await fs.readFile(path.join(dir, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO "${migrationsTable}" (filename) VALUES ($1)`,
        [file]
      );
      await client.query("COMMIT");
      console.info(`[modules] ${moduleName} applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function dropModuleTables(
  moduleName: string,
  installPath: string
): Promise<void> {
  const prefix = tablePrefixFor(moduleName);
  const migrationsTable = migrationsTableFor(moduleName);
  const pool = getPool();

  // Best-effort: read manifest's migrations folder to find table names declared
  // — but simpler is to scan information_schema for prefixed tables.
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE $1`,
    [`${prefix}%`]
  );
  for (const row of rows) {
    await pool.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
  }
  await pool.query(`DROP TABLE IF EXISTS "${migrationsTable}"`);
  // installPath retained for symmetry / future hooks
  void installPath;
}

// ── In-process event bus ─────────────────────────────────

type Bus = Map<string, Set<(p: unknown) => void>>;
function getBus(): Bus {
  const g = globalThis as unknown as { __openHousingEventBus?: Bus };
  if (!g.__openHousingEventBus) g.__openHousingEventBus = new Map();
  return g.__openHousingEventBus;
}
function emitEvent(name: string, payload: unknown): void {
  const bus = getBus();
  const listeners = bus.get(name);
  if (!listeners) return;
  for (const l of listeners) {
    try {
      l(payload);
    } catch (err) {
      console.error(`[modules] event listener for "${name}" threw:`, err);
    }
  }
}
function onEvent(name: string, handler: (p: unknown) => void): void {
  const bus = getBus();
  if (!bus.has(name)) bus.set(name, new Set());
  bus.get(name)!.add(handler);
}
