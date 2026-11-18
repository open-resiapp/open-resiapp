"use client";

import { useTranslations } from "next-intl";

import { Button, Icon } from "@/components/ui";

// BYT-20261118-001 §2 — planned attendance for an owners' meeting: three
// explicit buttons (Prídem · Neprídem · Ešte neviem), never a cycling
// toggle (CLAUDE.md UI rule), plus "Zrušiť odpoveď". Presentational only:
// the caller does the request. Shared by the feed card, Domov, the voting
// detail, the board overview row and the e-mail answer page.

export type MeetingRsvpValue = "yes" | "no" | "maybe";

const ORDER: MeetingRsvpValue[] = ["yes", "no", "maybe"];
const ICON = { yes: "check", no: "x", maybe: "help" } as const;

export default function MeetingRsvpButtons({
  value,
  onSelect,
  onWithdraw,
  readOnly = false,
  busy = false,
  legend,
}: {
  value: MeetingRsvpValue | null;
  onSelect: (s: MeetingRsvpValue) => void;
  onWithdraw?: () => void;
  /** After the meeting started: show the answer, no buttons. */
  readOnly?: boolean;
  busy?: boolean;
  /** Visible group label; defaults to the meeting question. */
  legend?: string;
}) {
  const t = useTranslations("MeetingAttendance.rsvp");

  if (readOnly) {
    return (
      <p className="text-base text-ui-text">
        {value ? t("yourAnswer", { answer: t(value) }) : t("noAnswerClosed")}
      </p>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-base font-medium text-ui-text">{legend ?? t("question")}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ORDER.map((s) => {
          const active = value === s;
          return (
            <Button
              key={s}
              variant="secondary"
              fullWidth
              aria-pressed={active}
              disabled={busy}
              onClick={() => onSelect(s)}
              className={active ? "border-ui-primary bg-ui-surface-muted ring-2 ring-ui-primary" : undefined}
            >
              <Icon name={active ? "check" : ICON[s]} size={20} />
              {t(s)}
            </Button>
          );
        })}
      </div>
      {value && onWithdraw ? (
        <button
          type="button"
          onClick={onWithdraw}
          disabled={busy}
          className="min-h-11 text-base font-medium text-ui-text underline underline-offset-2"
        >
          {t("withdraw")}
        </button>
      ) : null}
    </fieldset>
  );
}
