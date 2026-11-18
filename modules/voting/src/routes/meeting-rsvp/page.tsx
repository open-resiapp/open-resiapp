// BYT-20261118-001 §3 — e-mail answer page (server component). Shows only
// the recipient's own state; the single "Potvrdiť" tap (client child) is the
// only write. GET never writes.
import { getFormatter, getTranslations } from "next-intl/server";
import { ButtonLink, Card, Icon } from "@/components/ui";
import { describeMeetingRsvpToken } from "@modules/voting/src/meeting-token.server";
import MeetingRsvpConfirm from "./MeetingRsvpConfirm";

const ANSWERS = ["yes", "no", "maybe"] as const;

export default async function MeetingRsvpPage({
  token,
  suggested,
}: {
  token: string | null;
  suggested: string | null;
}) {
  const t = await getTranslations("MeetingAttendance.tokenPage");
  const format = await getFormatter();
  const view = await describeMeetingRsvpToken(token);

  if (view.status !== "ready") {
    return (
      <Card as="section">
        <div className="mb-3 flex items-center gap-2 text-ui-text">
          <Icon name="alert" size={28} />
          <h1 className="text-xl font-bold">{t(`state.${view.status}.title`)}</h1>
        </div>
        <p className="mb-4 text-base text-ui-text">{t(`state.${view.status}.body`)}</p>
        <ButtonLink href="/login" variant="secondary" size="lg" fullWidth>
          {t("login")}
        </ButtonLink>
      </Card>
    );
  }

  const pick = (ANSWERS as readonly string[]).includes(suggested ?? "")
    ? (suggested as (typeof ANSWERS)[number])
    : null;

  return (
    <Card as="section">
      <h1 className="mb-1 text-xl font-bold text-ui-text">{t("title")}</h1>
      <p className="mb-2 break-words text-lg font-semibold text-ui-text">{view.title}</p>
      <p className="text-base text-ui-text">
        {format.dateTime(new Date(view.startsAt), {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: view.timeZone,
        })}
      </p>
      {view.place ? <p className="mb-4 break-words text-base text-ui-text">{view.place}</p> : null}
      <MeetingRsvpConfirm token={token ?? ""} suggested={pick} current={view.myRsvp} />
    </Card>
  );
}
