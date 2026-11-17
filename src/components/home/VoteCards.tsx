import { getFormatter, getTranslations } from "next-intl/server";

import { ButtonLink, Card, Icon } from "@/components/ui";
import type { OwnerOpenVoting } from "@/lib/home.server";

import { formatDayMonth } from "./format";

// Running votes the owner can take part in. One primary "Hlasovať" (only
// on the first vote still waiting — one primary button per screen); once
// voted: "Hlasovali ste" with a check and a secondary "Zobraziť".

export async function VoteCards({
  votings,
  primaryVotingId,
}: {
  votings: OwnerOpenVoting[];
  /** The one vote that gets the screen's primary button, if any. */
  primaryVotingId: string | null;
}) {
  const t = await getTranslations("Home.vote");
  const format = await getFormatter();

  return (
    <ul className="space-y-3">
      {votings.map((v) => (
        <Card as="li" key={v.id} padding="lg" className="space-y-3">
          <p className="flex items-center gap-2 text-base font-medium text-ui-text-muted">
            <Icon name="vote" size={20} />
            {t("label")}
          </p>
          <h3 className="text-xl font-semibold text-ui-text break-words">{v.title}</h3>
          <p className="flex items-center gap-2 text-base text-ui-text">
            <Icon name="clock" size={20} />
            {t("deadline", { date: formatDayMonth(format, v.endsAt) })}
          </p>
          {v.voted ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-base font-semibold text-ui-success">
                <Icon name="check" size={22} />
                {t("voted")}
              </p>
              <ButtonLink href={`/voting/${v.id}`} variant="secondary">
                {t("view")}
              </ButtonLink>
            </div>
          ) : (
            <ButtonLink
              href={`/voting/${v.id}`}
              variant={v.id === primaryVotingId ? "primary" : "secondary"}
              size="lg"
              fullWidth
            >
              {t("cta")}
            </ButtonLink>
          )}
        </Card>
      ))}
    </ul>
  );
}
