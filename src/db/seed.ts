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
  mandates,
  posts,
  communityPosts,
  communityResponses,
  eventRsvps,
  directoryEntries,
} from "./schema";
import { generateAuditHash } from "../lib/voting";

async function seed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool);

  console.log("Seeding database...");

  // Clear existing data (in reverse FK order)
  await db.delete(eventRsvps);
  await db.delete(communityResponses);
  await db.delete(communityPosts);
  await db.delete(directoryEntries);
  await db.delete(votes);
  await db.delete(mandates);
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
      legalNotice: "Hlasovanie sa riadi ustanoveniami §14a zákona č. 182/1993 Z.z. o vlastníctve bytov a nebytových priestorov v znení neskorších predpisov.",
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

  const tenantIds: string[] = [];
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
    tenantIds.push(tenant.id);

    await db.insert(userFlats).values({
      userId: tenant.id,
      flatId: allFlats[t.flatIdx].id,
    });
  }
  console.log("Created 2 tenants");

  // Active voting — written type, board initiated, simple_all quorum
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
      votingType: "written",
      initiatedBy: "board",
      quorumType: "simple_all",
      startsAt: weekAgo,
      endsAt: weekLater,
      createdById: admin.id,
    })
    .returning();
  console.log("Created active voting:", activeVoting.title);

  // Cast some votes on active voting — per flat now
  // ownerIds[0] = Ján Novák (flats 0, 6) — vote for flat 0
  // ownerIds[1] = Mária Kováčová (flat 1)
  // ownerIds[2] = Peter Horváth (flat 2)
  const voteData = [
    { ownerId: ownerIds[0], flatIdx: 0, choice: "za" as const },
    { ownerId: ownerIds[1], flatIdx: 1, choice: "za" as const },
    { ownerId: ownerIds[2], flatIdx: 2, choice: "proti" as const },
  ];

  for (const v of voteData) {
    const ts = new Date();
    await db.insert(votes).values({
      votingId: activeVoting.id,
      ownerId: v.ownerId,
      flatId: allFlats[v.flatIdx].id,
      choice: v.choice,
      voteType: "electronic",
      auditHash: generateAuditHash(
        activeVoting.id,
        v.ownerId,
        allFlats[v.flatIdx].id,
        v.choice,
        ts
      ),
    });
  }
  console.log("Cast 3 votes on active voting (per flat)");

  // Closed voting — two_thirds_all quorum
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [closedVoting] = await db
    .insert(votings)
    .values({
      title: "Výmena výťahu vo vchode A",
      description:
        "Hlasovanie o výmene výťahu vo vchode A. Predpokladaná cena 45 000 EUR.",
      status: "closed",
      votingType: "written",
      initiatedBy: "board",
      quorumType: "two_thirds_all",
      startsAt: monthAgo,
      endsAt: twoWeeksAgo,
      createdById: admin.id,
    })
    .returning();

  // Each owner votes for their first flat
  const closedVoteFlats = [0, 1, 2, 4]; // flatIdx for each owner
  for (let i = 0; i < ownerIds.length; i++) {
    const choice = Math.random() > 0.3 ? "za" : "proti";
    const ts = new Date(monthAgo.getTime() + Math.random() * 14 * 24 * 60 * 60 * 1000);
    await db.insert(votes).values({
      votingId: closedVoting.id,
      ownerId: ownerIds[i],
      flatId: allFlats[closedVoteFlats[i]].id,
      choice: choice as "za" | "proti",
      voteType: "electronic",
      auditHash: generateAuditHash(
        closedVoting.id,
        ownerIds[i],
        allFlats[closedVoteFlats[i]].id,
        choice,
        ts
      ),
    });
  }
  console.log("Created closed voting with 4 votes");

  // Draft voting — meeting type (for testing)
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  await db
    .insert(votings)
    .values({
      title: "Schôdza vlastníkov — plán údržby 2026",
      description:
        "Hlasovanie na schôdzi o pláne údržby na rok 2026. Elektronické hlasovanie nie je povolené.",
      status: "draft",
      votingType: "meeting",
      initiatedBy: "board",
      quorumType: "simple_present",
      startsAt: nextWeek,
      endsAt: twoWeeksLater,
      createdById: admin.id,
    })
    .returning();
  console.log("Created draft meeting voting");

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

  // Community posts
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const communityPostData = [
    {
      type: "sale" as const,
      title: "Detská postieľka IKEA",
      content: "Zachovalá, 3 roky stará. Matrac v cene. Cena dohodou.",
      authorId: ownerIds[0],
      entranceId: entranceA.id,
    },
    {
      type: "free" as const,
      title: "Knihy — vezmite zadarmo",
      content: "Rôzne žánre, detektívky, historické romány. Cca 30 kusov.",
      authorId: ownerIds[1],
      entranceId: null,
    },
    {
      type: "borrow" as const,
      title: "Hľadám parkovacie miesto",
      content: "Dlhodobý prenájom parkovacieho miesta. Byt 5, vchod B.",
      authorId: ownerIds[3],
      entranceId: entranceB.id,
    },
    {
      type: "help_request" as const,
      title: "Zalievanie kvetov počas dovolenky",
      content: "Prosím o zalievanie kvetov 15.-22. júla. Kľúč nechám u suseda.",
      authorId: ownerIds[1],
      entranceId: entranceA.id,
    },
    {
      type: "help_offer" as const,
      title: "Ponúkam IT pomoc starším susedom",
      content: "Nastavenie telefónu, emailu, wifi. Rád pomôžem po práci.",
      authorId: tenantIds[0],
      entranceId: null,
    },
    {
      type: "event" as const,
      title: "Spoločná grilovačka",
      content: "Prineste si jedlo a pitie. Gril a uhlie zabezpečené.",
      authorId: ownerIds[1],
      entranceId: entranceB.id,
      eventDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      eventLocation: "Dvorček za Vchodom B",
    },
    {
      type: "event" as const,
      title: "Brigáda – upratanie dvora",
      content: "Jarné upratovanie, hrabanie lístia, drobné opravy. Občerstvenie zabezpečené.",
      authorId: admin.id,
      entranceId: null,
      eventDate: new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000),
      eventLocation: "Pred vchodom A",
    },
  ];

  const createdCommunityPosts = [];
  for (const p of communityPostData) {
    const [post] = await db
      .insert(communityPosts)
      .values({
        ...p,
        expiresAt: new Date(now.getTime() + thirtyDays),
      })
      .returning();
    createdCommunityPosts.push(post);
  }
  console.log("Created 7 community posts (3 marketplace, 2 help, 2 events)");

  // A couple of RSVPs on the grilovačka
  const grilovacka = createdCommunityPosts.find((p) => p.title === "Spoločná grilovačka");
  if (grilovacka) {
    await db.insert(eventRsvps).values([
      { postId: grilovacka.id, userId: ownerIds[0], status: "yes" },
      { postId: grilovacka.id, userId: ownerIds[2], status: "yes" },
      { postId: grilovacka.id, userId: tenantIds[0], status: "maybe" },
    ]);
    console.log("Added 3 RSVPs on grilovačka");
  }

  // One response on the marketplace post
  const postiel = createdCommunityPosts.find((p) => p.title === "Detská postieľka IKEA");
  if (postiel) {
    await db.insert(communityResponses).values({
      postId: postiel.id,
      authorId: ownerIds[2],
      content: "Dobrý deň, mám záujem. Je ešte dostupná?",
    });
    console.log("Added 1 response on marketplace post");
  }

  // Directory entries (opt-in) — Ján shares phone + skills, Tomáš shares email + note
  await db.insert(directoryEntries).values([
    {
      userId: ownerIds[0],
      sharePhone: true,
      shareEmail: false,
      note: "Rád pomôžem so záhradou",
      skills: "elektrikár, záhrada",
    },
    {
      userId: tenantIds[0],
      sharePhone: false,
      shareEmail: true,
      note: "IT a technika pre starších",
      skills: "IT, telefóny, wifi",
    },
    {
      userId: ownerIds[1],
      sharePhone: true,
      shareEmail: true,
      note: null,
      skills: "pečenie, krajčírka",
    },
  ]);
  console.log("Created 3 directory entries");

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
