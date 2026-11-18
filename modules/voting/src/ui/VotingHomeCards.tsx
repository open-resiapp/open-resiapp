// BYT-20261118-002 — voting blocks for the board's Domov (server component).
//  1. "Zverejniť výsledok do {date}" — one row per closed voting whose result
//     is not yet published (§14a ods. 9), computed at render.
//  2. "Čo dnes prejde elektronicky" — e-vote readiness per majority type.
// Rendered from server data of the Domov request: no client fetch, no polling.
// Owners never get it — the caller mounts it only in BoardHome.
import { getFormatter, getTranslations } from "next-intl/server";

import { Card } from "@/components/ui";
import { HomeSection } from "@/components/home/HomeSection";
import { LinkRow } from "@/components/home/LinkRow";
import type { CommunityRootRow } from "@/lib/legacy-compat";
import { getEVoteReadiness, listPublicationReminders } from "../readiness.server";
import type { VotingViewer } from "../votings";
import type { ReadinessRow } from "../workflow/readiness";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error("[voting] home card failed:", err);
    return fallback;
  }
}

export async function VotingHomeCards({
  root,
  viewer,
}: {
  root: CommunityRootRow | null;
  /** Reminders list only votings this viewer may see (shared visibility rule). */
  viewer: VotingViewer;
}) {
  if (!root) return null;
  const t = await getTranslations("VotingWorkflow");
  const tWizard = await getTranslations("VotingWizard");
  const format = await getFormatter();

  const [reminders, readiness] = await Promise.all([
    safe(listPublicationReminders(viewer), []),
    safe(getEVoteReadiness(root), [] as ReadinessRow[]),
  ]);

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  return (
    <>
      {reminders.length > 0 && (
        <ul className="space-y-2" aria-label={t("publishRemindersLabel")}>
          {reminders.map((r) => (
            <li key={r.id}>
              <LinkRow
                href={`/voting/${r.id}`}
                icon="vote"
                tone={r.overdue ? "danger" : "warning"}
                label={
                  <>
                    <span className="block break-words">{r.title}</span>
                    <span className="block font-normal text-ui-text-muted">
                      {t(r.overdue ? "publishOverdue" : "publishBy", {
                        date: format.dateTime(new Date(r.deadline), {
                          day: "numeric",
                          month: "long",
                        }),
                      })}
                    </span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}

      {readiness.length > 0 && (
        <HomeSection title={t("readiness.heading")}>
          <Card as="div" className="space-y-3">
            <p className="text-base text-ui-text-muted">{t("readiness.intro")}</p>
            <ul className="divide-y divide-ui-border">
              {readiness.map((r) => (
                <li key={r.quorumType} className="py-3 text-base">
                  <p className="font-medium text-ui-text">
                    {tWizard(`quorum.${r.quorumType}.label`)}
                  </p>
                  <p
                    className={
                      r.code === "REACHABLE" ? "text-ui-success" : "text-ui-text-muted"
                    }
                  >
                    {t(`readiness.codes.${r.code}`, {
                      readyOwners: r.readyOwners,
                      totalOwners: r.totalOwners,
                      pct: pct(r.readyWeight, r.totalWeight),
                    })}
                  </p>
                </li>
              ))}
            </ul>
            <LinkRow href="/owners" icon="users" label={t("readiness.whoMissing")} />
          </Card>
        </HomeSection>
      )}
    </>
  );
}
