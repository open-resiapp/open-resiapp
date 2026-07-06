"use client";

// Per-expense attachments + visibility panel (BYT-20260512-002 Phase 3
// legal). Treasurer uploads the invoice scan and sets who may see it in
// the owners' right-to-inspect view: public (original), redacted_required
// (owners see only a redacted copy), or restricted (board only, needs a
// justification). Downloads proxy through the auth-gated route.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Visibility = "public" | "redacted_required" | "restricted";
interface Attachment {
  id: string;
  role: "original" | "redacted";
  fileName: string;
  sizeBytes: number;
}

export default function ExpenseAttachments({
  expenseId,
  visibility: initialVisibility,
}: {
  expenseId: string;
  visibility: Visibility;
}) {
  const t = useTranslations("Accounting.attachments");

  const [rows, setRows] = useState<Attachment[] | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/accounting/expenses/${expenseId}/attachments`)
      .then((r) => (r.ok ? r.json() : { attachments: [] }))
      .then((d: { attachments: Attachment[] }) => setRows(d.attachments))
      .catch(() => setError("load"));
  }, [expenseId]);

  useEffect(load, [load]);

  async function upload(file: File, role: "original" | "redacted") {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("role", role);
      const res = await fetch(`/api/accounting/expenses/${expenseId}/attachments`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload");
    } finally {
      setBusy(false);
    }
  }

  async function saveVisibility(next: Visibility) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/expenses/${expenseId}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: next,
          justification: next === "restricted" ? justification.trim() : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setVisibility(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "visibility");
    } finally {
      setBusy(false);
    }
  }

  async function voidAtt(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/accounting/attachments/${id}/void`, { method: "POST" });
      load();
    } finally {
      setBusy(false);
    }
  }

  const hasRedacted = (rows ?? []).some((r) => r.role === "redacted");

  return (
    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg p-4 space-y-3 text-sm">
      {/* GDPR guardrail */}
      <p className="text-xs text-amber-700 dark:text-amber-400">
        {t("gdprWarning")}
      </p>

      {/* Existing scans */}
      {rows === null ? (
        <p className="text-gray-500 dark:text-gray-400">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">{t("none")}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3">
              <a
                href={`/api/accounting/attachments/${a.id}/download`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                📎 {a.fileName}
                <span className="text-gray-400 ml-2">
                  ({t(`role_${a.role}`)}, {Math.round(a.sizeBytes / 1024)} kB)
                </span>
              </a>
              <button
                onClick={() => voidAtt(a.id)}
                disabled={busy}
                className="text-red-600 dark:text-red-400 hover:underline text-xs"
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Uploads */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-gray-700 dark:text-gray-300">
          {t("uploadOriginal")}{" "}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f, "original");
              e.target.value = "";
            }}
            className="text-xs"
          />
        </label>
        {visibility === "redacted_required" && (
          <label className="text-gray-700 dark:text-gray-300">
            {t("uploadRedacted")}{" "}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f, "redacted");
                e.target.value = "";
              }}
              className="text-xs"
            />
          </label>
        )}
      </div>

      {/* Visibility */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-700 dark:text-gray-300">{t("visibility")}:</span>
        <select
          value={visibility}
          onChange={(e) => {
            const next = e.target.value as Visibility;
            if (next === "restricted") setVisibility(next);
            else saveVisibility(next);
          }}
          disabled={busy}
          className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
        >
          <option value="public">{t("vis_public")}</option>
          <option value="redacted_required">{t("vis_redacted")}</option>
          <option value="restricted">{t("vis_restricted")}</option>
        </select>
        {visibility === "restricted" && (
          <>
            <input
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder={t("justificationPlaceholder")}
              className="flex-1 min-w-48 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-xs"
            />
            <button
              onClick={() => saveVisibility("restricted")}
              disabled={busy || !justification.trim()}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded text-xs"
            >
              {t("save")}
            </button>
          </>
        )}
      </div>
      {visibility === "redacted_required" && !hasRedacted && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("needsRedacted")}
        </p>
      )}

      {error && error !== "load" && (
        <p className="text-red-600 dark:text-red-400 text-xs">
          {t("error")} ({error})
        </p>
      )}
    </div>
  );
}
