import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import { votes, votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { generateAuditHash, calculateResults } from "@modules/voting/src/engine";
import { sendVoteConfirmation } from "@modules/voting/src/email/vote-confirmation";
import { isElectronicVotingBlocked } from "@modules/voting/src/rules";
import { dispatchHook } from "@/lib/modules/dispatch";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
} from "@/lib/voting-method";
import type {
  UserRole,
  VoteChoice,
  VotingMethod,
  VoteWithOwnership,
  QuorumType,
  Country,
} from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");

  if (!votingId) {
    return NextResponse.json({ error: "votingId je povinný" }, { status: 400 });
  }

  if (!hasPermission(session.user.role as UserRole, "viewVotingResults")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  // Phase 2b: voting method + country read from entities.data via
  // getCommunityRoot. Phase 3: votingMethod is canonicalized (legacy
  // values like "per_share" map to "weighted_by_share") so downstream
  // dispatch only sees the 5 canonical forms.
  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const country = (root?.country ?? "sk") as Country;

  // Voting scope (entityId points at root / entrance / flat).
  const [voting] = await db
    .select({
      quorumType: votings.quorumType,
      entityId: votings.entityId,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  const quorumType = (voting?.quorumType ?? "simple_all") as QuorumType;

  // Phase 2b: vote rows joined with the unit entity. Share / area / flat
  // number now come from entities.data jsonb. Numeric casts via ::int
  // preserve the integer semantics of the legacy columns — voting math
  // remains byte-identical to the housing_unit_data join (regulated by
  // §14 zák. 182/1993 Z.z.).
  type VoteRow = {
    id: string;
    choice: "za" | "proti" | "zdrzal_sa";
    voteType: "electronic" | "paper";
    createdAt: Date;
    ownerId: string;
    flatId: string;
    disputed: boolean;
    auditHash: string;
    paperPhotoUrl: string | null;
    ownerName: string | null;
    flatNumber: string;
    shareNumerator: number;
    shareDenominator: number;
    area: number | null;
    ownerUnitShareNumerator: number | null;
    ownerUnitShareDenominator: number | null;
    membershipWeight: number | null;
  };
  const voteRows: VoteRow[] = await db
    .select({
      id: votes.id,
      choice: votes.choice,
      voteType: votes.voteType,
      createdAt: votes.createdAt,
      ownerId: votes.ownerId,
      flatId: votes.entityId,
      disputed: votes.disputed,
      auditHash: votes.auditHash,
      paperPhotoUrl: votes.paperPhotoUrl,
      ownerName: users.name,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      // Phase 3b: surfaced for custom_weight; unused by unit-scoped.
      membershipWeight: memberships.weight,
    })
    .from(votes)
    .leftJoin(users, eq(votes.ownerId, users.id))
    .innerJoin(entities, eq(entities.id, votes.entityId))
    .leftJoin(
      memberships,
      and(
        eq(memberships.entityId, votes.entityId),
        eq(memberships.userId, votes.ownerId),
        eq(memberships.status, "active")
      )
    )
    .where(eq(votes.votingId, votingId));

  const votesWithOwnership: VoteWithOwnership[] = voteRows.map((v) => ({
    unitEntityId: v.flatId,
    userId: v.ownerId,
    userName: v.ownerName,
    choice: v.choice as VoteChoice,
    unitShareNumerator: v.shareNumerator,
    unitShareDenominator: v.shareDenominator,
    area: v.area,
    // If the membership row is gone (legacy paper vote on an archived
    // ownership, etc.), fall back to whole-unit share so the vote still
    // counts and the engine treats it as a single-owner case.
    ownerUnitShareNumerator: v.ownerUnitShareNumerator ?? 1,
    ownerUnitShareDenominator: v.ownerUnitShareDenominator ?? 1,
    membershipWeight: v.membershipWeight ?? 1,
  }));

  // Total possible weight: sum entities.data share/area over every unit
  // in the voting's subtree (or all when root-scope). The path overlap
  // is computed via the materialized path on entities. Phase 2b reads
  // share/area from entities.data jsonb instead of housing_unit_data.
  const flatsForScope = voting?.entityId
    ? await db
        .select({
          shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
          shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
          area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
        })
        .from(entities)
        .where(
          and(
            eq(entities.kind, "unit"),
            isNull(entities.archivedAt),
            sql`${entities.path} LIKE (
              SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId}
            )`
          )
        )
    : await db
        .select({
          shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
          shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
          area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
        })
        .from(entities)
        .where(
          and(eq(entities.kind, "unit"), isNull(entities.archivedAt))
        );

  // Phase 3 / 3b: dispatch total possible weight by scope.
  //   Unit-scoped: sum over the unit entities in the voting's subtree.
  //   Member-scoped: count active memberships in the voting's subtree
  //                   (one_per_member) or SUM(memberships.weight) for
  //                   custom_weight. Memberships outside the scope (e.g.
  //                   members of other communities on the instance) are
  //                   excluded by the path filter.
  let totalPossibleWeight = 0;
  if (isUnitScoped(votingMethod)) {
    for (const f of flatsForScope) {
      totalPossibleWeight += computeUnitWeight(
        {
          shareNumerator: f.shareNumerator,
          shareDenominator: f.shareDenominator,
          area: f.area,
        },
        votingMethod
      );
    }
  } else {
    const scopeMembers = voting?.entityId
      ? await db
          .select({ weight: memberships.weight })
          .from(memberships)
          .innerJoin(entities, eq(entities.id, memberships.entityId))
          .where(
            and(
              eq(memberships.status, "active"),
              isNull(entities.archivedAt),
              sql`${entities.path} LIKE (
                SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId}
              )`
            )
          )
      : await db
          .select({ weight: memberships.weight })
          .from(memberships)
          .innerJoin(entities, eq(entities.id, memberships.entityId))
          .where(
            and(
              eq(memberships.status, "active"),
              isNull(entities.archivedAt)
            )
          );
    for (const m of scopeMembers) {
      totalPossibleWeight += computeMemberWeight(
        { membershipWeight: m.weight },
        votingMethod
      );
    }
  }

  const results = calculateResults(
    votesWithOwnership,
    votingMethod,
    quorumType,
    totalPossibleWeight,
    { country }
  );

  const userVotedFlats = voteRows
    .filter((v) => v.ownerId === session.user.id)
    .map((v) => ({ flatId: v.flatId, choice: v.choice }));

  // Current user's flats via memberships at unit entities. Phase 2b
  // reads flat_number from entities.data jsonb.
  type UserFlat = { flatId: string; flatNumber: string };
  const currentUserFlats: UserFlat[] = await db
    .select({
      flatId: entities.id,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json({
    votes: voteRows,
    results,
    userVotedFlats,
    userFlats: currentUserFlats,
    totalVotes: voteRows.length,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { votingId, choice, flatId, ownerId, voteType, paperPhotoUrl } = body;

  if (!votingId || !choice || !flatId) {
    return NextResponse.json(
      { error: "votingId, choice a flatId sú povinné" },
      { status: 400 }
    );
  }

  const isPaperVote = voteType === "paper";
  const voterId = isPaperVote ? ownerId : session.user.id;

  if (isPaperVote) {
    if (!paperPhotoUrl) {
      return NextResponse.json(
        { error: "PAPER_PHOTO_REQUIRED" },
        { status: 400 }
      );
    }
    if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
      return NextResponse.json(
        { error: "Nemáte oprávnenie zapisovať listinné hlasy" },
        { status: 403 }
      );
    }
  } else {
    if (!hasPermission(session.user.role as UserRole, "vote")) {
      return NextResponse.json({ error: "Nemáte oprávnenie hlasovať" }, { status: 403 });
    }
  }

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  if (!voting || voting.status !== "active") {
    return NextResponse.json(
      { error: "Hlasovanie nie je aktívne" },
      { status: 400 }
    );
  }

  // Country + canonical voting method for downstream dispatch.
  const root = await getCommunityRoot();
  const voteCountry = (root?.country ?? "sk") as Country;
  const voteMethod = normalizeVotingMethod(root?.votingMethod);
  const memberScoped = !isUnitScoped(voteMethod);

  if (!isPaperVote && isElectronicVotingBlocked(voteCountry, voting.votingType, voting.initiatedBy)) {
    return NextResponse.json(
      {
        error:
          voting.votingType === "meeting"
            ? "Elektronické hlasovanie nie je povolené pre hlasovanie na schôdzi"
            : "Elektronické hlasovanie nie je povolené pre hlasovanie iniciované štvrtinou vlastníkov",
      },
      { status: 400 }
    );
  }

  // Validate ownership via memberships (housing_unit entity id == flat id
  // because the 0023 backfill reused flat ids).
  const [ownerFlat] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, voterId),
        eq(memberships.entityId, flatId),
        eq(memberships.status, "active")
      )
    )
    .limit(1);

  if (!ownerFlat) {
    return NextResponse.json(
      { error: "Vlastník nevlastní tento byt" },
      { status: 400 }
    );
  }

  // Validate flat is within the voting's subtree (path overlap on entities).
  if (voting.entityId) {
    const flatRow = await db
      .select({ flatPath: entities.path })
      .from(entities)
      .where(eq(entities.id, flatId))
      .limit(1);
    const scopeRow = await db
      .select({ scopePath: entities.path })
      .from(entities)
      .where(eq(entities.id, voting.entityId))
      .limit(1);
    if (
      flatRow[0] &&
      scopeRow[0] &&
      !flatRow[0].flatPath.startsWith(scopeRow[0].scopePath)
    ) {
      return NextResponse.json(
        { error: "Tento byt nie je v hlasovanom rozsahu" },
        { status: 403 }
      );
    }
  }

  // Helper: re-fetch flat number for confirmation email. Phase 2b
  // reads from entities.data jsonb.
  async function loadFlatNumber(eid: string): Promise<string | null> {
    const [row] = await db
      .select({
        flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      })
      .from(entities)
      .where(eq(entities.id, eid))
      .limit(1);
    return row?.flatNumber ?? null;
  }

  const _aliasedTableUnused = aliasedTable; // keep import warning quiet
  void _aliasedTableUnused;

  // Existing-vote check. Phase 3b: member-scoped voting allows
  // multiple owners of the same unit to vote independently, so the
  // dedup key is (votingId, ownerId) rather than (votingId, entityId).
  const existingVote = memberScoped
    ? await db
        .select()
        .from(votes)
        .where(and(eq(votes.votingId, votingId), eq(votes.ownerId, voterId)))
        .limit(1)
    : await db
        .select()
        .from(votes)
        .where(and(eq(votes.votingId, votingId), eq(votes.entityId, flatId)))
        .limit(1);

  if (existingVote.length > 0) {
    const existing = existingVote[0];

    if (!isPaperVote && !memberScoped && existing.ownerId !== voterId) {
      return NextResponse.json(
        { error: "Za tento byt už hlasoval iný vlastník" },
        { status: 400 }
      );
    }

    if (existing.choice === choice) {
      return NextResponse.json(
        { ...existing, auditHash: existing.auditHash },
        { status: 200 }
      );
    }

    const now = new Date();
    const newAuditHash = generateAuditHash(votingId, voterId, flatId, choice, now);

    const [updated] = await db
      .update(votes)
      .set({
        choice,
        auditHash: newAuditHash,
        ...(isPaperVote
          ? { recordedById: session.user.id, paperPhotoUrl: paperPhotoUrl || null }
          : {}),
      })
      .where(eq(votes.id, existing.id))
      .returning();

    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);
      const flatNumber = await loadFlatNumber(flatId);
      if (voter?.email && flatNumber) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber,
          choice,
          timestamp: now,
          auditHash: newAuditHash,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ...updated, auditHash: newAuditHash }, { status: 200 });
  }

  const now = new Date();
  const auditHash = generateAuditHash(votingId, voterId, flatId, choice, now);

  const requireEmail = process.env.REQUIRE_VOTE_EMAIL === "true";

  if (requireEmail && !isPaperVote) {
    try {
      const result = await db.transaction(async (tx) => {
        const [vote] = await tx
          .insert(votes)
          .values({
            votingId,
            ownerId: voterId,
            entityId: flatId,
            choice,
            voteType: "electronic",
            auditHash,
          })
          .returning();

        const [voter] = await tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, voterId))
          .limit(1);
        const [hud] = await tx
          .select({
            flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
          })
          .from(entities)
          .where(eq(entities.id, flatId))
          .limit(1);

        if (!voter.email) {
          // Shell user with no email — skip the confirmation email.
          // (sendVoteConfirmation has nowhere to send.)
          return vote;
        }
        const emailSent = await sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber: hud?.flatNumber ?? "",
          choice,
          timestamp: now,
          auditHash,
        });
        if (!emailSent) throw new Error("Email confirmation failed");
        return vote;
      });

      dispatchHook("onVoteCreate", {
        id: result.id,
        votingId: result.votingId,
        memberId: result.ownerId,
        choice: result.choice,
        createdAt: result.createdAt,
      }).catch((err) => console.error("[modules] onVoteCreate failed:", err));

      return NextResponse.json(result, { status: 201 });
    } catch {
      return NextResponse.json(
        { error: "Nepodarilo sa odoslať potvrdzujúci email. Hlas nebol zaznamenaný." },
        { status: 500 }
      );
    }
  } else {
    const [vote] = await db
      .insert(votes)
      .values({
        votingId,
        ownerId: voterId,
        entityId: flatId,
        choice,
        voteType: isPaperVote ? "paper" : "electronic",
        recordedById: isPaperVote ? session.user.id : null,
        paperPhotoUrl: isPaperVote ? (paperPhotoUrl || null) : null,
        auditHash,
      })
      .returning();

    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);
      const flatNumber = await loadFlatNumber(flatId);
      if (voter?.email && flatNumber) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber,
          choice,
          timestamp: now,
          auditHash,
        }).catch(() => {});
      }
    }

    dispatchHook("onVoteCreate", {
      id: vote.id,
      votingId: vote.votingId,
      memberId: vote.ownerId,
      choice: vote.choice,
      createdAt: vote.createdAt,
    }).catch((err) => console.error("[modules] onVoteCreate failed:", err));

    return NextResponse.json({ ...vote, auditHash }, { status: 201 });
  }
}
