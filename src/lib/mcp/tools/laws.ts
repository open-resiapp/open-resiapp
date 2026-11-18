import "server-only";

import { z } from "zod";

import { LAW_JURISDICTIONS, type LawDocument, type LawJurisdiction, type LawMeta } from "@/lib/laws";
import {
  anchorCandidates,
  formatCitation,
  isOutOfScope,
  lawReference,
  parseCitation,
  provisionAnchor,
  resolveCitationLaw,
  type ParsedCitation,
} from "@/lib/laws-citation";
import { foldText } from "@/lib/laws-reader";
import {
  findBasis,
  locateAnchor,
  paragraphText,
  provisionText,
  type BasisHit,
  type LocatedAnchor,
} from "@/lib/laws-search";
import { getLaw, getSearchCorpus, listLaws } from "@/lib/laws.server";
import { LAW_TOPICS, inferTopics, topicScope, type LawTopic } from "@/lib/laws-topics";
import { appLink, resolveActionLocale } from "../actions/format";
import { APP_LOCALES, type AppLocale } from "../actions/types";
import { McpError, validationError } from "../errors";
import { defineTool, type ToolContext, type ToolDef } from "./types";

// Law library tools — read-only over the static laws library
// (data/laws/**, see laws.server.ts): no DB, no network. Available to every
// active member with the basic `read` scope (owners discuss the law with
// their AI too); not tied to any business module.
//
// Size budget: every result stays under ~8k chars including the duplicated
// summary text (hosts show the model `content`, apps read structuredContent).

const DISCLAIMER =
  "Informational consolidated text, not legal advice; the legally binding version is the official collection.";

const MAX_HITS = 5;
/** Per channel (summary + structuredContent both carry it) → ~7k total. */
const TEXT_CAP = 3_200;

/** Main housing act per jurisdiction — target of a bare "§ 14b" in a question. */
const PRIMARY_LAW: Record<LawJurisdiction, string> = { sk: "sk-182-1993", cz: "cz-89-2012" };

const localeArg = z
  .enum(APP_LOCALES)
  .optional()
  .describe("Language of the app reader links (sk | en | cs); defaults to the community's language.");

const jurisdictionArg = z
  .enum(LAW_JURISDICTIONS)
  .optional()
  .describe("sk = Slovak law, cz = Czech law; defaults to the community's country.");

function communityJurisdiction(ctx: ToolContext): LawJurisdiction {
  return ctx.root.country === "cz" ? "cz" : "sk";
}

function readerUrl(ctx: ToolContext, locale: AppLocale, lawId: string, anchor?: string): string {
  const path = anchor ? `/zakony/${lawId}/p/${encodeURIComponent(anchor)}` : `/zakony/${lawId}`;
  return appLink(ctx, locale, path);
}

function clipText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

// ---------------------------------------------------------------------------
// find_legal_basis
// ---------------------------------------------------------------------------

const TOPIC_DESCRIPTIONS =
  "voting = votes, majorities, quorums, written / electronic voting; meeting = owners' meeting, convening, minutes; " +
  "fund = repair fund, advance payments; budget_accounting = budget, accounting, annual report; " +
  "heating_billing = heating / services billing and its deadlines; renovation_building = renovation, loans, building works; " +
  "administrator = administrator / association bodies; gdpr = personal data; ownership_general = ownership, common parts, transfers.";

/** Provisions cited in the question ("§ 14b", "§ 1206 OZ") → exact matches. */
function citedProvisions(
  question: string,
  laws: readonly LawMeta[],
  jurisdiction: LawJurisdiction
): { exact: Array<{ lawId: string; anchor: string }>; jurisdiction: LawJurisdiction | null } {
  const parsed = parseCitation(question);
  if (!parsed.ok) return { exact: [], jurisdiction: null };
  const anchor = provisionAnchor(parsed.citation);
  if (!anchor) return { exact: [], jurisdiction: null };
  const law = parsed.citation.law
    ? resolveCitationLaw(parsed.citation, laws, jurisdiction)
    : null;
  if (law && law.ok) return { exact: [{ lawId: law.law.id, anchor }], jurisdiction: law.law.jurisdiction };
  return { exact: [{ lawId: PRIMARY_LAW[jurisdiction], anchor }], jurisdiction: null };
}

const findLegalBasis = defineTool({
  name: "find_legal_basis",
  title: "Find legal basis",
  description:
    "Use when the user asks what the law requires/allows for their housing community (votes and quorums, meetings, " +
    "repair fund, budget and accounting, heating billing, renovation, administrator, personal data), or BEFORE you " +
    "state any legal rule as fact. Do NOT call for ordinary data questions (debts, meters, votings, payments) or for " +
    "write actions — their previews already carry what you need.",
  scopes: ["read"],
  visible: () => true,
  input: z.object({
    question: z
      .string()
      .trim()
      .min(2)
      .max(500)
      .describe(
        "The question or keywords. Slovak / Czech wording (the law's language) matches best, e.g. " +
          "\"koľko hlasov treba na úver\", \"kdo svolává shromáždění\"; a cited § (\"§ 14b\") is matched exactly."
      ),
    topic: z.enum(LAW_TOPICS).optional().describe(`Narrows the search: ${TOPIC_DESCRIPTIONS}`),
    jurisdiction: jurisdictionArg,
    locale: localeArg,
  }),
  async run(args, ctx) {
    const locale = resolveActionLocale(args.locale, ctx.root);
    const laws = await listLaws();
    let jurisdiction = args.jurisdiction ?? communityJurisdiction(ctx);
    const cited = citedProvisions(args.question, laws, jurisdiction);
    // "§ 1206 89/2012" asked in an SK community: follow the cited law.
    if (!args.jurisdiction && cited.jurisdiction) jurisdiction = cited.jurisdiction;

    const topics: LawTopic[] = args.topic ? [args.topic] : inferTopics(foldText(args.question));
    const units = await getSearchCorpus(jurisdiction);
    const hits = findBasis(units, args.question, {
      scope: topicScope(topics, jurisdiction),
      scopeMode: args.topic ? "strict" : "boost",
      exact: cited.exact,
      limit: MAX_HITS,
    });

    const byId = new Map(laws.map((l) => [l.id, l]));
    const items = hits.flatMap((h: BasisHit) => {
      const law = byId.get(h.unit.lawId);
      if (!law) return [];
      return [
        {
          citation: formatCitation(law, { label: h.unit.label, paragraph: h.unit.n, items: h.itemLabels }),
          lawId: law.id,
          anchor: h.anchor,
          snippet: h.snippet,
          url: readerUrl(ctx, locale, law.id, h.anchor),
          effectiveFrom: law.effectiveFrom,
        },
      ];
    });
    const sources = [...new Set(items.map((i) => i.lawId))].map((id) => {
      const law = byId.get(id)!;
      return { lawId: id, number: law.number, title: law.title, officialSourceUrl: law.sourceUrl };
    });
    const hint = items.length
      ? null
      : "No matching provision in the library. Rephrase with Slovak / Czech legal terms, pass a topic, " +
        "or call get_provision if you know the citation. If there is still nothing, tell the user the library has no basis — do not guess.";

    const lines = items.map(
      (i, n) => `${n + 1}. ${i.citation} (effective from ${i.effectiveFrom})\n   ${i.snippet}\n   ${i.url}`
    );
    const summary = items.length
      ? `${items.length} provision(s) [${jurisdiction.toUpperCase()}${topics.length ? `, topics: ${topics.join(", ")}` : ""}]:\n` +
        `${lines.join("\n")}\nOfficial sources: ${sources.map((s) => `${s.number} ${s.officialSourceUrl}`).join("; ")}\n${DISCLAIMER}`
      : `${hint}\n${DISCLAIMER}`;

    return {
      summary,
      data: {
        jurisdiction,
        topics,
        topicSource: args.topic ? "argument" : topics.length ? "inferred" : "none",
        hits: items,
        ...(hint ? { hint } : {}),
        sources,
        disclaimer: DISCLAIMER,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// get_provision
// ---------------------------------------------------------------------------

/** Footnote anchors (fn-5a) live outside the provisions. */
function footnoteText(law: LawDocument, anchor: string): string | null {
  const fn = law.footnotes.find((f) => f.anchor === anchor);
  return fn ? `${fn.label} ${fn.text}` : null;
}

interface Target {
  law: LawMeta;
  /** Anchors to try, most specific first (only one for a structured call). */
  candidates: string[];
  parsed: ParsedCitation | null;
}

async function resolveTarget(
  args: { citation?: string; lawId?: string; anchor?: string; jurisdiction?: LawJurisdiction },
  ctx: ToolContext
): Promise<Target> {
  const laws = await listLaws();
  if (args.anchor) {
    let law: LawMeta | undefined;
    if (args.lawId) law = laws.find((l) => l.id === args.lawId);
    else if (args.citation) {
      const parsed = parseCitation(args.citation);
      const r = parsed.ok
        ? resolveCitationLaw(parsed.citation, laws, args.jurisdiction ?? communityJurisdiction(ctx))
        : null;
      if (r?.ok) law = r.law;
    } else {
      throw validationError("lawId", { reason: "lawId_required_with_anchor" });
    }
    if (!law) throw new McpError("not_found", { reason: "law_unknown" });
    return { law, candidates: [args.anchor], parsed: null };
  }

  if (!args.citation) throw validationError("citation", { reason: "citation_or_anchor_required" });
  const parsed = parseCitation(args.citation);
  if (!parsed.ok) throw validationError("citation", { reason: parsed.code });
  const r = resolveCitationLaw(
    parsed.citation,
    laws,
    args.jurisdiction ?? communityJurisdiction(ctx),
    args.lawId
  );
  if (!r.ok) {
    if (r.code === "citation.law_unknown") throw new McpError("not_found", { reason: "law_unknown" });
    throw validationError("citation", { reason: r.code });
  }
  return { law: r.law, candidates: anchorCandidates(parsed.citation), parsed: parsed.citation };
}

/** Why the most specific candidate was not found (the provision itself may exist). */
function missingReason(candidates: readonly string[], found: string | null, structured: boolean): string {
  if (!found) return structured ? "anchor_unknown" : "provision_unknown";
  // Candidates end with the provision anchor: finding only that means the
  // paragraph is missing; finding the paragraph means the item is.
  return found === candidates[candidates.length - 1] ? "paragraph_unknown" : "item_unknown";
}

const getProvision = defineTool({
  name: "get_provision",
  title: "Get provision",
  description:
    "Use to quote or verify the exact wording of a specific provision you already know (from find_legal_basis or " +
    "the user). Cite it with the returned url.",
  scopes: ["read"],
  visible: () => true,
  input: z.object({
    citation: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe(
        "Free-form citation, e.g. \"§ 14 ods. 4 182/1993\", \"§ 1206 odst. 1 89/2012 Sb.\", \"OZ § 151\", \"§ 14b ods. 2 písm. b) 182/1993\"."
      ),
    lawId: z
      .string()
      .max(40)
      .regex(/^[a-z]{2}-\d+-\d{4}$/)
      .optional()
      .describe("Law id from find_legal_basis / list_laws, e.g. sk-182-1993. Required with anchor."),
    anchor: z
      .string()
      .max(80)
      .regex(/^[a-z0-9-]+$/)
      .optional()
      .describe("Provision / paragraph / item anchor from find_legal_basis, e.g. p14b-2 or p14b-2-b."),
    jurisdiction: jurisdictionArg,
    locale: localeArg,
  }),
  async run(args, ctx) {
    const locale = resolveActionLocale(args.locale, ctx.root);
    const { law, candidates, parsed } = await resolveTarget(args, ctx);
    const doc = await getLaw(law.id);
    if (!doc) throw new McpError("not_found", { reason: "law_unknown" });

    const base = {
      lawId: law.id,
      number: law.number,
      title: law.title,
      effectiveFrom: law.effectiveFrom,
      effectiveTo: law.effectiveTo,
      officialSourceUrl: law.sourceUrl,
      ...(law.scope ? { scope: law.scope } : {}),
      disclaimer: DISCLAIMER,
    };

    // Footnote (structured calls only).
    const fn = candidates.length === 1 ? footnoteText(doc, candidates[0]) : null;
    if (fn) {
      const { text, truncated } = clipText(fn, TEXT_CAP);
      const url = readerUrl(ctx, locale, law.id, candidates[0]);
      return {
        summary: `Footnote ${candidates[0]} of ${law.number}:\n${text}\n${url}\nOfficial source: ${law.sourceUrl}\n${DISCLAIMER}`,
        data: {
          ...base,
          citation: `${law.number}, footnote ${candidates[0].replace(/^fn-/, "")}`,
          anchor: candidates[0],
          text,
          truncated,
          url,
          outOfScope: false,
        },
      };
    }

    let located: LocatedAnchor | null = null;
    let foundAnchor: string | null = null;
    for (const a of candidates) {
      located = locateAnchor(doc, a);
      if (located) {
        foundAnchor = a;
        break;
      }
    }

    if (!located || foundAnchor !== candidates[0]) {
      const section = parsed ? parsed.section : /^p(\d+[a-z]{0,2})(?:-|$)/.exec(candidates[0])?.[1];
      if (!located && section && isOutOfScope(law.scope, section)) {
        const url = readerUrl(ctx, locale, law.id);
        const citation = `§ ${section} ${lawReference(law)}`;
        return {
          summary:
            `${citation} is outside the stored part of this act (${law.scope}); its text is not in the library. ` +
            `Read it at the official source: ${law.sourceUrl}\n${DISCLAIMER}`,
          data: { ...base, citation, outOfScope: true, url },
        };
      }
      throw new McpError("not_found", { reason: missingReason(candidates, foundAnchor, !parsed) });
    }

    const { provision, paragraph, items } = located;
    const full = paragraph ? paragraphText(paragraph) : provisionText(provision);
    const { text, truncated } = clipText(full, TEXT_CAP);
    const citation = formatCitation(law, {
      label: provision.label,
      paragraph: paragraph?.n,
      items: items.map((i) => i.label),
    });
    const url = readerUrl(ctx, locale, law.id, foundAnchor);
    // A cut-off whole provision: list its paragraphs so the model can fetch one.
    const paragraphs =
      truncated && !paragraph
        ? provision.paragraphs.map((p) => ({ anchor: p.anchor, n: p.n ?? null }))
        : undefined;
    const item = items.length ? items[items.length - 1] : null;

    return {
      summary:
        `${citation}${provision.heading ? ` — ${provision.heading}` : ""} (effective from ${law.effectiveFrom}` +
        `${law.effectiveTo ? ` to ${law.effectiveTo}` : ""}):\n${text}\n` +
        (truncated ? `[truncated — full text: ${url}]\n` : "") +
        `${url}\nOfficial source: ${law.sourceUrl}\n${DISCLAIMER}`,
      data: {
        ...base,
        citation,
        anchor: foundAnchor,
        ...(provision.heading ? { heading: provision.heading } : {}),
        text,
        ...(item ? { itemText: `${item.label} ${item.text}`.trim() } : {}),
        truncated,
        ...(paragraphs ? { paragraphs } : {}),
        url,
        outOfScope: false,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// list_laws
// ---------------------------------------------------------------------------

const listLawsTool = defineTool({
  name: "list_laws",
  title: "List laws",
  description: "Use only when the user asks which laws are available.",
  scopes: ["read"],
  visible: () => true,
  input: z.object({
    jurisdiction: z
      .enum([...LAW_JURISDICTIONS, "all"])
      .optional()
      .describe("sk | cz | all; defaults to the community's country."),
    locale: localeArg,
  }),
  async run(args, ctx) {
    const locale = resolveActionLocale(args.locale, ctx.root);
    const juris = args.jurisdiction ?? communityJurisdiction(ctx);
    const laws = await listLaws(juris === "all" ? undefined : juris);
    const items = laws.map((l) => ({
      id: l.id,
      number: l.number,
      title: l.title,
      effectiveFrom: l.effectiveFrom,
      effectiveTo: l.effectiveTo,
      scope: l.scope ?? null,
      readerUrl: readerUrl(ctx, locale, l.id),
      officialSourceUrl: l.sourceUrl,
    }));
    const lines = items.map(
      (l) =>
        `- ${l.number} ${clipText(l.title, 70).text}${l.scope ? ` [only ${l.scope}]` : ""} (${l.id}): ${l.readerUrl}`
    );
    return {
      summary: `${items.length} law(s):\n${lines.join("\n")}\n${DISCLAIMER}`,
      data: { laws: items, disclaimer: DISCLAIMER },
    };
  },
});

export const LAW_TOOLS: readonly ToolDef[] = [findLegalBasis, getProvision, listLawsTool];
