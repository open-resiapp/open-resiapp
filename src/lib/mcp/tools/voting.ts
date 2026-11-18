import "server-only";

import { z } from "zod";

import { hasPermission } from "@/lib/permissions";
import { getVotingImpacts } from "@modules/accounting/src/lib/voting-pipeline";
import { isAccountingReader } from "@modules/accounting/src/lib/authz";
import { getVotingParticipation } from "@modules/voting/src/participation";
import { getVotingResults } from "@modules/voting/src/results";
import { resultBasis } from "@modules/voting/src/workflow/result-basis";
import {
  getVisibleVotingDetail,
  listVisibleVotings,
} from "@modules/voting/src/votings";
import { isBoard } from "../authz";
import { McpError } from "../errors";
import { iso, link, paginate, paginationShape, untrusted, uuidSchema } from "./helpers";
import { defineTool, type ToolContext, type ToolDef } from "./types";

// Voting read tools (BYT-20261117-001 §4 #6–#9). Drafts are visible to the
// board only (B = admin / active chairman); results are per-item tallies
// with NO voter names or ballot hashes.

const STATUSES = ["draft", "active", "closed"] as const;

function canSeeDrafts(ctx: ToolContext): boolean {
  return isBoard(ctx.principal);
}

/** Voting detail with the visibility rule + board-only drafts; else not_found. */
async function loadVoting(ctx: ToolContext, votingId: string) {
  const voting = await getVisibleVotingDetail(ctx.principal, votingId);
  if (!voting) throw new McpError("not_found");
  if (voting.status === "draft" && !canSeeDrafts(ctx)) throw new McpError("not_found");
  return voting;
}

const listVotings = defineTool({
  name: "list_votings",
  title: "List votings",
  description:
    "Lists votings (hlasovania) visible to the user, newest first, optionally filtered by status; paginated.\n" +
    "Drafts are listed only for the chairman or an admin.",
  scopes: ["read"],
  module: "voting",
  visible: () => true,
  input: z.object({
    status: z.enum(STATUSES).optional().describe("draft | active | closed"),
    ...paginationShape,
  }),
  async run(args, ctx) {
    const drafts = canSeeDrafts(ctx);
    if (args.status === "draft" && !drafts) throw new McpError("forbidden");
    const all = (await listVisibleVotings(ctx.principal)).filter(
      (v) => (drafts || v.status !== "draft") && (!args.status || v.status === args.status)
    );
    const page = paginate(all, args);
    return {
      summary: `${page.total} voting(s)${args.status ? ` with status ${args.status}` : ""}; showing ${page.items.length}.`,
      data: {
        total: page.total,
        nextCursor: page.nextCursor,
        votings: page.items.map((v) => ({
          id: v.id,
          title: untrusted(v.title, "voting.title"),
          status: v.status,
          votingType: v.votingType,
          initiatedBy: v.initiatedBy,
          startsAt: iso(v.startsAt),
          endsAt: iso(v.endsAt),
          scope: v.entranceName,
          createdBy: v.createdBy?.name ?? null,
          url: link(ctx, `/voting/${v.id}`),
        })),
      },
    };
  },
});

const getVoting = defineTool({
  name: "get_voting",
  title: "Get voting",
  description:
    "Returns one voting with its ordered items, each item's quorum rule and financial effect.\n" +
    "For the treasurer, chairman or admin it also lists the accounting impacts of each item (fee-schedule drafts, expense authorisations).",
  scopes: ["read"],
  module: "voting",
  visible: () => true,
  input: z.object({ id: uuidSchema.describe("Voting id from list_votings.") }),
  async run(args, ctx) {
    const v = await loadVoting(ctx, args.id);
    const withImpacts =
      ctx.enabledModules.has("accounting") &&
      isAccountingReader(ctx.principal.role, ctx.principal.boardRoles);
    const impacts = withImpacts
      ? await getVotingImpacts(
          ctx.root.id,
          v.items.map((i) => i.id)
        )
      : null;
    const impactByItem = new Map((impacts ?? []).map((i) => [i.votingItemId, i]));
    return {
      summary: `"${v.title}" — ${v.status}, ${v.votingType}, ${v.items.length} item(s), ${iso(v.startsAt)?.slice(0, 10)} → ${iso(v.endsAt)?.slice(0, 10)}.`,
      data: {
        id: v.id,
        title: untrusted(v.title, "voting.title"),
        description: untrusted(v.description, "voting.description"),
        status: v.status,
        votingType: v.votingType,
        initiatedBy: v.initiatedBy,
        startsAt: iso(v.startsAt),
        endsAt: iso(v.endsAt),
        scope: v.entranceName,
        createdBy: v.createdBy?.name ?? null,
        items: v.items.map((i) => ({
          id: i.id,
          idx: i.idx,
          title: untrusted(i.title, "voting.item.title"),
          description: untrusted(i.description, "voting.item.description"),
          quorumType: i.quorumType,
          financialEffect: i.financialEffectKind
            ? { kind: i.financialEffectKind, params: i.financialEffectParams }
            : null,
          impacts: withImpacts ? impactByItem.get(i.id) ?? null : undefined,
        })),
        url: link(ctx, `/voting/${v.id}`),
      },
    };
  },
});

const getVotingResultsTool = defineTool({
  name: "get_voting_results",
  title: "Get voting results",
  description:
    "Returns per-item tallies of a voting (for / against / abstain weights and percentages, quorum, passed).\n" +
    "zaPercent / protiPercent are shares of the CAST weight only. `passed` is decided on `decisionBasis`: for *_all quorums the za " +
    "weight is compared with ALL owners' weight (e.g. SK §14b zák. 182/1993 Z.z.), for simple_present with the weight present. When reporting " +
    "an outcome quote decisionBasis.zaOfBasisPercent against decisionBasis.thresholdPercent, never zaPercent alone. " +
    "Never includes voter names, per-unit breakdowns or ballot hashes.",
  scopes: ["read"],
  module: "voting",
  visible: (ctx) => hasPermission(ctx.principal.role, "viewVotingResults"),
  input: z.object({ id: uuidSchema.describe("Voting id.") }),
  async run(args, ctx) {
    if (!hasPermission(ctx.principal.role, "viewVotingResults")) {
      throw new McpError("forbidden");
    }
    const v = await loadVoting(ctx, args.id);
    const bundle = await getVotingResults(v.id);
    if (!bundle) throw new McpError("not_found");
    const titleById = new Map(bundle.items.map((i) => [i.id, i]));
    // Whitelist the aggregate fields — unitBreakdowns / memberBreakdowns
    // (voter names) are deliberately NOT copied.
    const items = bundle.results.map((r) => {
      const item = titleById.get(r.itemId);
      return {
        itemId: r.itemId,
        idx: item?.idx ?? null,
        title: untrusted(item?.title ?? null, "voting.item.title"),
        quorumType: r.quorumType,
        za: r.za,
        proti: r.proti,
        zdrzalSa: r.zdrzalSa,
        total: r.total,
        zaPercent: r.zaPercent,
        protiPercent: r.protiPercent,
        zdrzalSaPercent: r.zdrzalSaPercent,
        // What the verdict was decided on (re-statement only — the engine's
        // `passed` stays the authority): basis "all" / "present" / "cast".
        decisionBasis: (() => {
          const b = resultBasis(r);
          const pct = (n: number) => Number(n.toFixed(2));
          return {
            basis: b.kind,
            threshold: b.threshold,
            basisWeight: b.basisWeight,
            thresholdWeight: b.thresholdWeight,
            thresholdPercent: pct(b.thresholdPct),
            totalPossibleWeight: b.totalPossibleWeight,
            zaOfBasisPercent: pct(b.zaOfBasisPct),
            protiOfBasisPercent: pct(b.protiOfBasisPct),
            zdrzalSaOfBasisPercent: pct(b.zdrzalSaOfBasisPct),
            zaOfAllPercent: pct(b.totalPossibleWeight > 0 ? (r.za / b.totalPossibleWeight) * 100 : 0),
            ...(r.presence ? { presentWeight: r.presence.weight } : {}),
          };
        })(),
        quorumReached: r.quorumReached,
        passed: r.passed,
      };
    });
    const passed = items.filter((i) => i.passed).length;
    return {
      summary: `"${v.title}" (${v.status}): ${passed}/${items.length} item(s) passing.`,
      data: {
        votingId: v.id,
        status: v.status,
        totalPossibleWeight: bundle.totalPossibleWeight,
        items,
        url: link(ctx, `/voting/${v.id}`),
      },
    };
  },
});

const getVotingParticipationTool = defineTool({
  name: "get_voting_participation",
  title: "Get voting participation",
  description:
    "Lists the units and owners who have not voted yet in a voting, with their voting weight, plus overall turnout.\n" +
    "Board only (chairman or admin). Paginated.",
  scopes: ["read"],
  module: "voting",
  visible: (ctx) => isBoard(ctx.principal),
  input: z.object({ id: uuidSchema.describe("Voting id."), ...paginationShape }),
  async run(args, ctx) {
    if (!isBoard(ctx.principal)) throw new McpError("forbidden");
    const v = await loadVoting(ctx, args.id);
    const p = await getVotingParticipation(v.id);
    if (!p) throw new McpError("not_found");
    const page = paginate(p.notVoted, args);
    const turnoutPct = p.eligibleWeight > 0 ? (p.votedWeight / p.eligibleWeight) * 100 : 0;
    return {
      summary: `"${v.title}": ${p.votedCount}/${p.eligibleCount} voted (${turnoutPct.toFixed(1)} % of weight); ${p.notVoted.length} not yet.`,
      data: {
        votingId: v.id,
        votingMethod: p.votingMethod,
        eligibleCount: p.eligibleCount,
        votedCount: p.votedCount,
        eligibleWeight: p.eligibleWeight,
        votedWeight: p.votedWeight,
        turnoutPercent: Number(turnoutPct.toFixed(2)),
        total: page.total,
        nextCursor: page.nextCursor,
        notVoted: page.items.map((r) => ({
          unitId: r.unitId,
          unitLabel: r.unitLabel,
          ownerName: r.ownerName,
          weight: r.weight,
          ownerShare: `${r.ownerUnitShareNumerator}/${r.ownerUnitShareDenominator}`,
        })),
      },
    };
  },
});

export const VOTING_TOOLS: ToolDef[] = [
  listVotings,
  getVoting,
  getVotingResultsTool,
  getVotingParticipationTool,
];
