import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import {
  building,
  entrances,
  flats,
  users,
  userFlats,
  votings,
  votes,
  posts,
} from "./schema";
import { generateAuditHash } from "../lib/voting";

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  console.log("Seeding database...");

  // Clear existing data (in reverse FK order)
  await db.delete(votes);
  await db.delete(posts);
  await db.delete(votings);
  await db.delete(userFlats);
  await db.delete(users);
  await db.delete(flats);
  await db.delete(entrances);
  await db.delete(building);

  // Building
  const [bld] = await db
    .insert(building)
    .values({
      name: "Bytové spoločenstvo Hlavná 12",
      address: "Hlavná 12, 040 01 Košice",
      ico: "12345678",
    })
    .returning();
  console.log("Created building:", bld.name);

  // Entrances
  const [entranceA] = await db
    .insert(entrances)
    .values({
      buildingId: bld.id,
      name: "Vchod A",
      streetNumber: "12",
    })
    .returning();

  const [entranceB] = await db
    .insert(entrances)
    .values({
      buildingId: bld.id,
      name: "Vchod B",
      streetNumber: "14",
    })
    .returning();
  console.log("Created 2 entrances");

  // Flats - 4 per entrance
  const flatDataA = [
    { flatNumber: "1", floor: 1, shareNumerator: 65, shareDenominator: 10000, area: 52 },
    { flatNumber: "2", floor: 1, shareNumerator: 75, shareDenominator: 10000, area: 68 },
    { flatNumber: "3", floor: 2, shareNumerator: 65, shareDenominator: 10000, area: 52 },
    { flatNumber: "4", floor: 2, shareNumerator: 80, shareDenominator: 10000, area: 74 },
  ];

  const flatDataB = [
    { flatNumber: "5", floor: 1, shareNumerator: 70, shareDenominator: 10000, area: 58 },
    { flatNumber: "6", floor: 1, shareNumerator: 75, shareDenominator: 10000, area: 68 },
    { flatNumber: "7", floor: 2, shareNumerator: 70, shareDenominator: 10000, area: 58 },
    { flatNumber: "8", floor: 2, shareNumerator: 85, shareDenominator: 10000, area: 82 },
  ];

  const createdFlatsA = await db
    .insert(flats)
    .values(flatDataA.map((f) => ({ ...f, entranceId: entranceA.id })))
    .returning();

  const createdFlatsB = await db
    .insert(flats)
    .values(flatDataB.map((f) => ({ ...f, entranceId: entranceB.id })))
    .returning();

  const allFlats = [...createdFlatsA, ...createdFlatsB];
  console.log("Created 8 flats");

  // Hash password
  const hash = await bcrypt.hash("Admin123!", 12);

  // Admin user (no flat)
  const [admin] = await db
    .insert(users)
    .values({
      name: "Admin Správca",
      email: "admin@test.sk",
      passwordHash: hash,
      role: "admin",
      phone: "+421900000000",
    })
    .returning();
  console.log("Created admin:", admin.email);

  // 4 owners — Ján Novák gets flat 1 + flat 7 (multi-flat test case)
  const ownerData = [
    { name: "Ján Novák", email: "jan@test.sk", flatIdxs: [0, 6] },
    { name: "Mária Kováčová", email: "maria@test.sk", flatIdxs: [1] },
    { name: "Peter Horváth", email: "peter@test.sk", flatIdxs: [2] },
    { name: "Anna Szabová", email: "anna@test.sk", flatIdxs: [4] },
  ];

  const ownerIds: string[] = [];
  for (const o of ownerData) {
    const [owner] = await db
      .insert(users)
      .values({
        name: o.name,
        email: o.email,
        passwordHash: hash,
        role: "owner",
        flatId: allFlats[o.flatIdxs[0]].id, // Phase 1 compat
      })
      .returning();
    ownerIds.push(owner.id);

    // Insert junction rows for all flats
    await db.insert(userFlats).values(
      o.flatIdxs.map((idx) => ({
        userId: owner.id,
        flatId: allFlats[idx].id,
      }))
    );
  }
  console.log("Created 4 owners (Ján Novák has flats 1 and 7)");

  // 2 tenants
  const tenantData = [
    { name: "Tomáš Malý", email: "tomas@test.sk", flatIdx: 3 },
    { name: "Eva Veľká", email: "eva@test.sk", flatIdx: 5 },
  ];

  for (const t of tenantData) {
    const [tenant] = await db
      .insert(users)
      .values({
        name: t.name,
        email: t.email,
        passwordHash: hash,
        role: "tenant",
        flatId: allFlats[t.flatIdx].id,
      })
      .returning();

    await db.insert(userFlats).values({
      userId: tenant.id,
      flatId: allFlats[t.flatIdx].id,
    });
  }
  console.log("Created 2 tenants");

  // Active voting
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeVoting] = await db
    .insert(votings)
    .values({
      title: "Oprava strechy bytového domu",
      description:
        "Hlasovanie o schválení opravy strechy v celkovej hodnote 15 000 EUR. Oprava zahŕňa výmenu strešnej krytiny a opravu odkvapov.",
      status: "active",
      startsAt: weekAgo,
      endsAt: weekLater,
      createdById: admin.id,
    })
    .returning();
  console.log("Created active voting:", activeVoting.title);

  // Cast some votes on active voting
  const voteData = [
    { ownerId: ownerIds[0], choice: "za" as const },
    { ownerId: ownerIds[1], choice: "za" as const },
    { ownerId: ownerIds[2], choice: "proti" as const },
  ];

  for (const v of voteData) {
    const ts = new Date();
    await db.insert(votes).values({
      votingId: activeVoting.id,
      ownerId: v.ownerId,
      choice: v.choice,
      voteType: "electronic",
      auditHash: generateAuditHash(
        activeVoting.id,
        v.ownerId,
        v.choice,
        ts
      ),
    });
  }
  console.log("Cast 3 votes on active voting");

  // Closed voting
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [closedVoting] = await db
    .insert(votings)
    .values({
      title: "Výmena výťahu vo vchode A",
      description:
        "Hlasovanie o výmene výťahu vo vchode A. Predpokladaná cena 45 000 EUR.",
      status: "closed",
      startsAt: monthAgo,
      endsAt: twoWeeksAgo,
      createdById: admin.id,
    })
    .returning();

  for (const ownerId of ownerIds) {
    const choice = Math.random() > 0.3 ? "za" : "proti";
    const ts = new Date(monthAgo.getTime() + Math.random() * 14 * 24 * 60 * 60 * 1000);
    await db.insert(votes).values({
      votingId: closedVoting.id,
      ownerId,
      choice: choice as "za" | "proti",
      voteType: "electronic",
      auditHash: generateAuditHash(closedVoting.id, ownerId, choice, ts),
    });
  }
  console.log("Created closed voting with 4 votes");

  // Posts
  const postData = [
    {
      title: "Plánované vypnutie vody",
      content:
        "Dňa 15.3.2026 bude v čase od 8:00 do 14:00 vypnutá teplá voda z dôvodu opravy rozvodov. Prosíme o trpezlivosť.",
      category: "urgent" as const,
      isPinned: true,
    },
    {
      title: "Upratovanie spoločných priestorov",
      content:
        "Prosíme všetkých obyvateľov o udržiavanie poriadku v spoločných priestoroch. Ďakujeme za spoluprácu.",
      category: "info" as const,
      isPinned: false,
    },
    {
      title: "Jarná brigáda",
      content:
        "Pozývame vás na jarnú brigádu, ktorá sa uskutoční v sobotu 22.3.2026 od 9:00. Stretneme sa pred vchodom A. Prineste si rukavice.",
      category: "event" as const,
      isPinned: false,
    },
    {
      title: "Výmena žiaroviek na chodbe",
      content:
        "Na 3. poschodí vchodu B boli vymenené žiarovky za LED. V prípade problémov kontaktujte správcu.",
      category: "maintenance" as const,
      isPinned: false,
    },
    {
      title: "Nový domový poriadok",
      content:
        "Od 1.4.2026 platí nový domový poriadok. Dokument je k dispozícii v sekcii dokumentov. Hlavné zmeny sa týkajú nočného kľudu (22:00-6:00) a parkovania.",
      category: "info" as const,
      isPinned: true,
    },
  ];

  for (const p of postData) {
    await db.insert(posts).values({
      ...p,
      authorId: admin.id,
    });
  }
  console.log("Created 5 posts");

  console.log("\nSeed complete!");
  console.log("Login: admin@test.sk / Admin123!");
  console.log("Owners: jan@test.sk, maria@test.sk, peter@test.sk, anna@test.sk (all password: Admin123!)");
  console.log("Note: jan@test.sk owns flat 1 AND flat 7 (multi-flat test)");

  await pool.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
