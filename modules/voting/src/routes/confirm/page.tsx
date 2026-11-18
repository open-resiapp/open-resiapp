// BYT-20261117-002 Phase 6: withdraw e-mail link page (server component).
// States which ballot is withdrawn and offers one button; rendering this
// page (GET — also what mail scanners do) never withdraws anything.
// Vote confirmation links moved to /<locale>/voting/confirm/<token>
// (BYT-20261118-009); a legacy vote link renders the "expired" state.
import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Icon } from "@/components/ui";
import { describeEmailConfirmation } from "@modules/voting/src/routes/api/ballots/confirm.server";
import ConfirmEmailVote from "./ConfirmEmailVote";

export default async function VoteConfirmPage({
  token,
  viewerId,
}: {
  token: string | null;
  viewerId: string;
}) {
  const t = await getTranslations("VoteConfirmPage");
  const format = await getFormatter();
  const view = await describeEmailConfirmation(token, viewerId);

  if (view.status !== "ready") {
    return (
      <Card as="section">
        <div className="mb-3 flex items-center gap-2 text-ui-text">
          <Icon name="alert" size={28} />
          <h1 className="text-xl font-bold">{t(`state.${view.status}.title`)}</h1>
        </div>
        <p className="mb-4 text-base text-ui-text">{t(`state.${view.status}.body`)}</p>
        <ButtonLink href="/voting" variant="secondary" size="lg" fullWidth>
          {t("goToVoting")}
        </ButtonLink>
      </Card>
    );
  }

  const dateOpts = {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  } as const;

  return (
    <Card as="section">
      <h1 className="mb-1 text-xl font-bold text-ui-text">{t("withdraw.title")}</h1>
      <p className="mb-4 break-words text-base text-ui-text-muted">{view.votingTitle}</p>
      <p className="mb-4 text-lg font-semibold text-ui-text">
        {t("withdraw.summary", { unit: view.flatNumber })}
      </p>
      <p className="mb-1 text-base text-ui-text">{t("voter", { name: view.voterName })}</p>
      <p className="mb-4 text-base text-ui-text-muted">
        {t("deadline", { deadline: format.dateTime(new Date(view.endsAt), dateOpts) })}
      </p>
      <p className="mb-4 text-base text-ui-text">{t("withdraw.explain")}</p>
      <ConfirmEmailVote token={token ?? ""} votingId={view.votingId} action="withdraw" />
    </Card>
  );
}
