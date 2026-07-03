import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "./schema";
import * as votingSchema from "@modules/voting/src/db/schema";
import * as accountingSchema from "@modules/accounting/src/db/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Merged schema for Drizzle's relational queries. Module tables/relations
// must be present here so `db.query.votings.findMany({ with: { ... } })`
// resolves correctly. New modules with their own schemas extend this map.
const schema = {
  ...coreSchema,
  ...votingSchema,
  ...accountingSchema,
};

export const db = drizzle(pool, { schema });
