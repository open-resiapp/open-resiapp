import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createEntity } from "@/lib/entity-tree";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { rootDataPatch } from "@/lib/db/entity-data";
import { getTemplate } from "@/lib/templates/loader";
import type { Template } from "@/lib/templates/types";
import { isVotingMethodAllowed } from "@/lib/voting-method";
import { legalRegimeFor, toLegalCountry } from "@/lib/legal-copy/regime";
import { validateNoticeLeadSetting } from "@modules/voting/src/workflow/notice";
import type { Country, UserRole } from "@/types";

// BYT-20261118-020 — error codes for statute-driven settings. Stable
// strings; VotingSettingsTab maps them to Settings.* i18n keys.
//   VOTING_METHOD_NOT_ALLOWED — method outside allowedVotingMethods(regime,
//     country): SK HOA §14 ods. 3 zák. 182/1993 counts per unit (no
//     one_per_member); cooperative §240 Obch. zák. / §755 ZOK = per member.
//   NOTICE_LEAD_SETTING_INVALID / NOTICE_LEAD_SETTING_BELOW_STATUTORY —
//     from validateNoticeLeadSetting (CZ cooperative floor §636 ods. 1 ZOK).
function validateStatutorySettings(input: {
  templateSlug: string | null;
  country: string | null | undefined;
  votingMethod: unknown;
  noticeLeadDays: number | null | undefined;
}): { error: string; minDays?: number } | null {
  const regime = legalRegimeFor(input.templateSlug);
  const country = toLegalCountry(input.country);
  if (input.votingMethod !== undefined && input.votingMethod !== null) {
    if (
      typeof input.votingMethod !== "string" ||
      !isVotingMethodAllowed(input.votingMethod, regime, country)
    ) {
      return { error: "VOTING_METHOD_NOT_ALLOWED" };
    }
  }
  const leadError = validateNoticeLeadSetting(country as Country, regime, input.noticeLeadDays);
  if (leadError) return { error: leadError.code, minDays: leadError.minDays };
  return null;
}

/** Template default for the stanovy notice lead time (null = none). */
function templateNoticeLeadDays(template: Template | null): number | null {
  return template?.notice?.default_lead_days ?? null;
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const root = await getCommunityRoot();
  return NextResponse.json(root ?? null);
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { name, address, ico, dic: rawDic, votingMethod, legalNotice, country, governanceModel } = body;

  // Community template (src/lib/templates/<slug>.json), chosen in the
  // onboarding template step. Unknown slug → 400; undefined = untouched.
  const rawTemplateSlug: unknown = body.templateSlug;
  let template: Template | null = null;
  if (rawTemplateSlug !== undefined) {
    template = typeof rawTemplateSlug === "string" ? await getTemplate(rawTemplateSlug) : null;
    if (!template) {
      return NextResponse.json({ error: "template_not_found" }, { status: 400 });
    }
  }

  // Optional, trimmed, max 20 chars; empty -> null. Undefined = leave untouched.
  const dic =
    rawDic === undefined
      ? undefined
      : typeof rawDic === "string" && rawDic.trim()
        ? rawDic.trim().slice(0, 20)
        : null;

  // Stanovy notice lead time: undefined = untouched; null / "" = clear
  // (statutory floor only); anything else must be an integer → validated
  // below (NaN / fractions fail validateNoticeLeadSetting as INVALID).
  const rawLead: unknown = body.noticeLeadDays;
  const noticeLeadDays: number | null | undefined =
    rawLead === undefined
      ? undefined
      : rawLead === null || rawLead === ""
        ? null
        : typeof rawLead === "number"
          ? rawLead
          : typeof rawLead === "string" && /^\d+$/.test(rawLead.trim())
            ? Number(rawLead.trim())
            : Number.NaN;

  // Phase 9.1d: building lives as root entity + housing_root_data.
  const existing = await getCommunityRoot();

  if (!existing) {
    // Bootstrap: create the root entity and its extension data.
    if (!name || !address) {
      return NextResponse.json(
        { error: "Názov a adresa sú povinné" },
        { status: 400 }
      );
    }
    // Template defaults (voting method, governance model, notice lead
    // time) apply unless the request sets them explicitly.
    const bootstrapSlug = template?.slug ?? "hoa";
    const bootstrapCountry = country || "sk";
    const bootstrapLead =
      noticeLeadDays !== undefined ? noticeLeadDays : templateNoticeLeadDays(template);
    const invalid = validateStatutorySettings({
      templateSlug: bootstrapSlug,
      country: bootstrapCountry,
      votingMethod: votingMethod || undefined,
      noticeLeadDays: bootstrapLead,
    });
    if (invalid) return NextResponse.json(invalid, { status: 400 });
    const root = await createEntity({
      parentId: null,
      kind: "community",
      name,
    });
    const bootstrapValues = {
      address,
      ico: ico || null,
      dic: dic ?? null,
      votingMethod: votingMethod || template?.default_voting_method || "per_share",
      country: bootstrapCountry,
      governanceModel:
        governanceModel || template?.default_governance_model || "chairman_council",
      legalNotice: legalNotice || null,
      noticeLeadDays: bootstrapLead,
    };
    const bootstrapPatch = {
      ...rootDataPatch(bootstrapValues),
      template_slug: bootstrapSlug,
    };
    // Phase 8a: dual-write removed — entities.data is the only target.
    await db
      .update(entities)
      .set({
        data: sql`${entities.data} || ${JSON.stringify(bootstrapPatch)}::jsonb`,
      })
      .where(eq(entities.id, root.id));
    const created = await getCommunityRoot();
    return NextResponse.json(created, { status: 201 });
  }

  if (template) {
    // The template decides the kind chain the import seeds (building /
    // entrance / unit vs garage_block / garage …): changing it once units
    // exist would leave the tree half one shape, half the other.
    const [child] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(
          eq(entities.rootId, existing.id),
          isNotNull(entities.parentId),
          isNull(entities.archivedAt)
        )
      )
      .limit(1);
    if (child && template.slug !== existing.templateSlug) {
      return NextResponse.json({ error: "template_locked" }, { status: 409 });
    }
  }

  // Validate against the state AFTER this request: a template switch
  // changes the regime, a country change the statutory floor.
  const switchingTemplate = !!template && template.slug !== existing.templateSlug;
  const effectiveSlug = switchingTemplate ? template!.slug : existing.templateSlug;
  const effectiveCountry = country ?? existing.country;
  const leadAfter =
    noticeLeadDays !== undefined
      ? noticeLeadDays
      : switchingTemplate
        ? templateNoticeLeadDays(template)
        : undefined; // untouched stored value is not re-validated here
  const invalid = validateStatutorySettings({
    templateSlug: effectiveSlug,
    country: effectiveCountry,
    votingMethod,
    noticeLeadDays: leadAfter,
  });
  if (invalid) return NextResponse.json(invalid, { status: 400 });

  if (name !== undefined) {
    await db
      .update(entities)
      .set({ name })
      .where(eq(entities.id, existing.id));
  }
  // Phase 8a: dual-write removed — entities.data is the only target.
  const dataPatch = rootDataPatch({
    address,
    ico,
    dic,
    votingMethod,
    country,
    governanceModel,
    legalNotice,
    noticeLeadDays,
  });
  if (switchingTemplate && template) {
    // Switching template (only possible before any unit exists) brings its
    // defaults along unless the request sets them explicitly.
    dataPatch.template_slug = template.slug;
    if (votingMethod === undefined) dataPatch.voting_method = template.default_voting_method;
    const tplGovernance = template.default_governance_model;
    if (governanceModel === undefined && tplGovernance) dataPatch.governance_model = tplGovernance;
    if (noticeLeadDays === undefined) dataPatch.notice_lead_days = templateNoticeLeadDays(template);
  }
  if (Object.keys(dataPatch).length > 0) {
    await db
      .update(entities)
      .set({
        data: sql`${entities.data} || ${JSON.stringify(dataPatch)}::jsonb`,
      })
      .where(eq(entities.id, existing.id));
  }

  const updated = await getCommunityRoot();
  return NextResponse.json(updated);
}
