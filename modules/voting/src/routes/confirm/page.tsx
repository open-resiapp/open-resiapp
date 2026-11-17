// BYT-20261117-002 Phase 6: e-mail confirmation link page (server component).
// States exactly what is being confirmed and offers one button. Rendering
// this page (GET — also what mail scanners do) never records a vote.
// The same page serves withdraw links (token purpose vote-withdraw-email):
// it then states which ballot is withdrawn, and only its button withdraws.
import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Icon } from "@/components/ui";
import { describeEmailConfirmation } from "@modules/voting/src/routes/api/ballots/confirm.server";
import ConfirmEmailVote from "./ConfirmEmailVote";

const CHOICE_KEY = { za: "for", proti: "against", zdrzal_sa: "abstain" } as const;

export default async function VoteConfirmPage({ token }: { token: string | null }) {
  const t = await getTranslations("VoteConfirmPage");
  const tVote = await getTranslations("VoteButton");
  const format = await getFormatter();
  const view = await describeEmailConfirmation(token);

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

  if (view.action === "withdraw") {
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

  const summary = view.items
    .map((i) =>
      t("summaryItem", { number: i.idx + 1, choice: tVote(CHOICE_KEY[i.choice]) })
    )
    .join(", ");

  return (
    <Card as="section">
      <h1 className="mb-1 text-xl font-bold text-ui-text">{t("title")}</h1>
      <p className="mb-4 break-words text-base text-ui-text-muted">{view.votingTitle}</p>

      <p className="mb-4 text-lg font-semibold text-ui-text">
        {t("summary", { unit: view.flatNumber, items: summary })}
      </p>

      <ul className="mb-4 divide-y divide-ui-border border-y border-ui-border">
        {view.items.map((i) => (
          <li key={i.idx} className="flex items-start justify-between gap-3 py-3">
            <span className="min-w-0 break-words text-base text-ui-text">
              {t("itemLine", { number: i.idx + 1, title: i.title })}
            </span>
            <span className="shrink-0 text-base font-bold text-ui-text">
              {tVote(CHOICE_KEY[i.choice])}
            </span>
          </li>
        ))}
      </ul>

      <p className="mb-1 text-base text-ui-text">{t("voter", { name: view.voterName })}</p>
      <p className="mb-4 text-base text-ui-text-muted">
        {t("deadline", {
          deadline: format.dateTime(new Date(view.endsAt), dateOpts),
        })}
      </p>
      <p className="mb-4 text-base text-ui-text">{t("explain")}</p>
      {view.activatesPasskey && (
        <p className="mb-4 text-base text-ui-text">{t("activatesPasskey")}</p>
      )}

      <ConfirmEmailVote token={token ?? ""} votingId={view.votingId} action="vote" />
    </Card>
  );
}
