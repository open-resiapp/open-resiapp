"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button, LoadingBlock, Modal } from "@/components/ui";
import { formatShortCode } from "@/lib/invitations-codes";

// Bulk "Listy pre vlastníkov bez účtu": one PDF, one A4 page per owner (QR +
// short code + plain instructions), valid 60 days. Also where the board marks
// "len papierová komunikácia" so it sees who needs paper.

interface OwnerRow {
  id: string;
  name: string;
  email: string | null;
  paperOnly: boolean;
  flats: string[];
}

interface LettersResponse {
  communityName: string;
  letters: {
    shellId: string;
    name: string;
    flats: string[];
    claimUrl: string;
    shortCode: string;
    expiresAt: string;
  }[];
}

export default function ClaimLettersDialog({
  open,
  onClose,
  locale,
}: {
  open: boolean;
  onClose: () => void;
  locale: string;
}) {
  const t = useTranslations("ClaimLetters");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const [owners, setOwners] = useState<OwnerRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOwners(null);
    setError(null);
    setDone(null);
    fetch("/api/admin/shell-users/claim-letters")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { owners: OwnerRow[] }) => {
        if (cancelled) return;
        setOwners(j.owners);
        setSelected(new Set(j.owners.map((o) => o.id)));
      })
      .catch(() => !cancelled && setError(t("loadFailed")));
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const withoutEmailCount = useMemo(
    () => (owners ?? []).filter((o) => !o.email).length,
    [owners]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setPaper(o: OwnerRow, paperOnly: boolean) {
    const res = await fetch("/api/admin/shell-users/paper", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: o.id, paperOnly }),
    });
    if (!res.ok) {
      setError(t("paperFailed"));
      return;
    }
    setOwners((prev) => prev?.map((x) => (x.id === o.id ? { ...x, paperOnly } : x)) ?? prev);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/shell-users/claim-letters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shellIds: [...selected], locale }),
      });
      if (!res.ok) throw new Error("request");
      const data = (await res.json()) as LettersResponse;
      if (data.letters.length === 0) {
        setError(t("nothingToPrint"));
        return;
      }
      const [{ pdf }, QRCode, { default: ClaimLettersPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("qrcode"),
        import("./ClaimLettersPDF"),
      ]);
      const origin = window.location.origin;
      const pages = await Promise.all(
        data.letters.map(async (l) => ({
          toLine: t("pdf.to", {
            name: l.name,
            flats: l.flats.length ? l.flats.join(", ") : "—",
          }),
          qrDataUrl: await QRCode.toDataURL(l.claimUrl, { width: 640, margin: 2 }),
          shortCodeDisplay: formatShortCode(l.shortCode),
          validLine: t("pdf.valid", {
            date: format.dateTime(new Date(l.expiresAt), { dateStyle: "long" }),
          }),
          stepsLines: [
            t("pdf.step1"),
            t("pdf.step2", { url: `${origin}/${locale}/claim` }),
            t("pdf.step3"),
          ],
        }))
      );
      const blob = await pdf(
        <ClaimLettersPDF
          communityName={data.communityName}
          labels={{
            title: t("pdf.title"),
            codeLabel: t("pdf.codeLabel"),
            help: t("pdf.help"),
          }}
          pages={pages}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "listy-pre-vlastnikov.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(data.letters.length);
    } catch (err) {
      console.error("Claim letters PDF failed:", err);
      setError(t("generateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tCommon("close")}
          </Button>
          <Button loading={busy} disabled={busy || selected.size === 0} onClick={generate}>
            {t("generate", { count: selected.size })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-base text-ui-text">{t("intro")}</p>
        <p className="text-base text-ui-text-muted">{t("note")}</p>

        {error && (
          <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-base text-ui-danger">
            {error}
          </p>
        )}
        {done !== null && (
          <p role="status" className="rounded-lg border border-ui-success/30 bg-ui-success/10 px-4 py-3 text-base text-ui-success">
            {t("done", { count: done })}
          </p>
        )}

        {!owners && !error ? (
          <LoadingBlock />
        ) : owners && owners.length === 0 ? (
          <p className="text-base text-ui-text">{t("empty")}</p>
        ) : owners ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => setSelected(new Set(owners.map((o) => o.id)))}
              >
                {t("selectAll", { count: owners.length })}
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  setSelected(new Set(owners.filter((o) => !o.email).map((o) => o.id)))
                }
              >
                {t("selectNoEmail", { count: withoutEmailCount })}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                {t("selectNone")}
              </Button>
            </div>
            <ul className="divide-y divide-ui-border rounded-lg border border-ui-border">
              {owners.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 px-4 py-3">
                  <label className="flex min-h-11 items-start gap-3 text-base text-ui-text">
                    <input
                      type="checkbox"
                      className="mt-1 h-5 w-5"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                    />
                    <span>
                      <span className="font-medium">{o.name}</span>
                      {o.flats.length > 0 && (
                        <span className="text-ui-text-muted">
                          {" "}
                          · {t("flats", { flats: o.flats.join(", ") })}
                        </span>
                      )}
                      <span className="block text-ui-text-muted">
                        {o.email ?? t("noEmail")}
                      </span>
                    </span>
                  </label>
                  <label className="ml-8 flex min-h-11 items-center gap-3 text-base text-ui-text">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={o.paperOnly}
                      onChange={(e) => void setPaper(o, e.target.checked)}
                    />
                    <span>{t("paperOnly")}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
