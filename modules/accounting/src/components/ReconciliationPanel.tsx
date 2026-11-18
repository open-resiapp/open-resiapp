"use client";

// "Z banky" tab of Platby od vlastníkov (BYT-20261117-002; flow from
// BYT-20260512-002 Phase 2). Two parts: bring the bank payments in (CAMT.053
// statement upload, the Fio connection or Enable Banking), then assign each payment the
// engine could not match on its own to a flat. Every line shows the engine's
// best suggestion with a confidence badge; fuzzy name hits are suggestion-
// only by design (domain edge case 9 — VS is the primary key).
// Treasurer/admin only (the reconciliation API is writer-guarded).

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Select,
} from "@/components/ui";
import { formatEur } from "@modules/accounting/src/lib/money";
import EnableBankingConnection from "./EnableBankingConnection";

interface Suggestion {
  unitEntityId: string | null;
  unitLabel: string | null;
  confidence: number;
  rule: string;
  autoApply: boolean;
}

interface Line {
  paymentId: string;
  receivedAt: string;
  amountCents: number;
  vs: string | null;
  counterpartyIban: string | null;
  counterpartyName: string | null;
  narrative: string | null;
  suggestion: Suggestion;
}

interface UnitOption {
  id: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
}

interface ImportSummary {
  credits: number;
  imported: number;
  skippedDuplicates: number;
  autoMatched: number;
  needsReview: number;
  debitsSkipped: number;
}

interface FioState {
  connected: boolean;
  tokenPreview: string | null;
  lastSyncAt: string | null;
}

export default function ReconciliationPanel({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("Accounting.reconciliation");
  const format = useFormatter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[] | null>(null);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dismissTarget, setDismissTarget] = useState<Line | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [fio, setFio] = useState<FioState | null>(null);
  const [fioToken, setFioToken] = useState("");
  const [fioSaving, setFioSaving] = useState(false);
  const [fioSyncing, setFioSyncing] = useState(false);

  const load = useCallback(() => {
    fetch("/api/accounting/reconciliation")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: { lines: Line[]; units: UnitOption[] }) => {
        setLines(data.lines);
        setUnits(data.units);
      })
      .catch(() => setError("load"));
  }, []);

  useEffect(load, [load]);

  const loadFio = useCallback(() => {
    fetch("/api/accounting/fio")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: FioState | null) => {
        if (data) setFio(data);
      })
      .catch(() => {});
  }, []);

  useEffect(loadFio, [loadFio]);

  const refreshAll = () => {
    load();
    onChanged?.();
  };

  async function saveFioToken() {
    if (!fioToken.trim()) return;
    setFioSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/fio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: fioToken.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setFioToken("");
      loadFio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "fio");
    } finally {
      setFioSaving(false);
    }
  }

  async function syncFioNow() {
    setFioSyncing(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/accounting/fio/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSummary(body);
      loadFio();
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "fio");
    } finally {
      setFioSyncing(false);
    }
  }

  async function importFile(file: File) {
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const xml = await file.text();
      const res = await fetch("/api/accounting/bank-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setSummary(body);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "import");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function assign(line: Line) {
    const unitEntityId = overrides[line.paymentId] ?? line.suggestion.unitEntityId;
    if (!unitEntityId) return;
    setConfirming(line.paymentId);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/reconciliation/${line.paymentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitEntityId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "confirm");
    } finally {
      setConfirming(null);
    }
  }

  async function dismiss() {
    if (!dismissTarget) return;
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/reconciliation/${dismissTarget.paymentId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? String(res.status));
      setDismissTarget(null);
      refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "dismiss");
    } finally {
      setDismissing(false);
    }
  }

  if (error === "load") {
    return <p className="text-base text-ui-danger">{t("loadError")}</p>;
  }
  if (!lines) return <LoadingBlock />;

  const unitLabel = (u: UnitOption) =>
    `${u.flatNumber ?? u.name}${u.vs ? ` (${t("vsLabel", { vs: u.vs })})` : ""}`;

  return (
    <div className="space-y-6">
      {/* 1. Bring payments in */}
      <Card as="section" aria-labelledby="bank-import-title">
        <h2 id="bank-import-title" className="text-lg font-semibold text-ui-text">
          {t("uploadTitle")}
        </h2>
        <p className="mt-1 text-base text-ui-text-muted">{t("uploadHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
            }}
          />
          <Button
            variant="secondary"
            loading={importing}
            onClick={() => fileInput.current?.click()}
          >
            {importing ? t("importing") : t("uploadButton")}
          </Button>
          {fio?.connected && (
            <Button variant="secondary" loading={fioSyncing} onClick={syncFioNow}>
              {fioSyncing ? t("fioSyncing") : t("fioSync")}
            </Button>
          )}
        </div>
        {fio?.connected && (
          <p className="mt-2 text-base text-ui-text-muted">
            {t("fioConnected", { preview: fio.tokenPreview ?? "" })}
            {fio.lastSyncAt &&
              ` · ${t("fioLastSync", {
                date: format.dateTime(new Date(fio.lastSyncAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}`}
          </p>
        )}

        {summary && (
          <div role="status" className="mt-3 rounded-lg bg-ui-surface-muted p-4 text-base text-ui-text">
            <p>
              {t("summary", {
                imported: summary.imported,
                autoMatched: summary.autoMatched,
                needsReview: summary.needsReview,
              })}
            </p>
            {(summary.skippedDuplicates > 0 || summary.debitsSkipped > 0) && (
              <p className="mt-1">
                {t("summarySkipped", {
                  duplicates: summary.skippedDuplicates,
                  debits: summary.debitsSkipped,
                })}
              </p>
            )}
          </div>
        )}
        {error && error !== "load" && (
          <p role="alert" className="mt-3 text-base font-medium text-ui-danger">
            {t("submitError")} ({error})
          </p>
        )}

        {/* Fio live connection — set up once, then one click per sync. */}
        {fio && !fio.connected && (
          <details className="mt-4 border-t border-ui-border pt-3">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-base font-medium text-ui-primary hover:underline">
              {t("fioTitle")}
            </summary>
            <div className="mt-2 space-y-3">
              <p className="text-base text-ui-text-muted">{t("fioHint")}</p>
              <Field label={t("fioTokenPlaceholder")}>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={fioToken}
                  onChange={(e) => setFioToken(e.target.value)}
                  className="font-mono"
                />
              </Field>
              <Button
                variant="secondary"
                loading={fioSaving}
                disabled={!fioToken.trim()}
                onClick={saveFioToken}
              >
                {fioSaving ? t("fioSaving") : t("fioConnect")}
              </Button>
            </div>
          </details>
        )}

        {/* Any SK/CZ bank via PSD2 (Enable Banking) — BYT-20261118-001. */}
        <EnableBankingConnection
          variant="compact"
          onBusy={() => setSummary(null)}
          onSynced={(next) => {
            setSummary(next);
            refreshAll();
          }}
        />
      </Card>

      {/* 2. Assign the rest to flats */}
      <section aria-labelledby="unmatched-title">
        <h2 id="unmatched-title" className="mb-1 text-lg font-semibold text-ui-text">
          {t("unmatchedTitle", { count: lines.length })}
        </h2>
        <p className="mb-3 text-base text-ui-text-muted">{t("unmatchedHint")}</p>
        {lines.length === 0 ? (
          <Card>
            <EmptyState icon="check" title={t("allMatched")} />
          </Card>
        ) : (
          <ul className="space-y-3">
            {lines.map((line) => {
              const selected = overrides[line.paymentId] ?? line.suggestion.unitEntityId ?? "";
              return (
                <li key={line.paymentId}>
                  <Card padding="sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-ui-text">
                          {formatEur(line.amountCents)}
                          <span className="ml-3 font-normal text-ui-text-muted">
                            {format.dateTime(new Date(line.receivedAt), { dateStyle: "medium" })}
                          </span>
                        </p>
                        <p className="break-words text-base text-ui-text-muted">
                          {line.counterpartyName ?? "—"}
                          {line.vs && <span className="ml-2">{t("vsLabel", { vs: line.vs })}</span>}
                        </p>
                        {line.narrative && (
                          <p className="break-words text-base text-ui-text-muted">{line.narrative}</p>
                        )}
                        {line.suggestion.unitEntityId && (
                          <Badge
                            className="mt-1"
                            tone={line.suggestion.confidence >= 80 ? "success" : "warning"}
                          >
                            {t("confidence", { value: line.suggestion.confidence })}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Field label={t("pickUnitLabel")} className="sm:min-w-56">
                          <Select
                            value={selected}
                            onChange={(e) =>
                              setOverrides((prev) => ({ ...prev, [line.paymentId]: e.target.value }))
                            }
                          >
                            <option value="">{t("pickUnit")}</option>
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {unitLabel(u)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Button
                          onClick={() => assign(line)}
                          loading={confirming === line.paymentId}
                          disabled={!selected}
                        >
                          {confirming === line.paymentId ? t("confirming") : t("confirm")}
                        </Button>
                        <Button variant="ghost" onClick={() => setDismissTarget(line)}>
                          {t("dismiss")}
                        </Button>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={dismissTarget !== null}
        title={t("dismissTitle")}
        description={t("dismissConfirm")}
        confirmLabel={t("dismiss")}
        loading={dismissing}
        onConfirm={dismiss}
        onCancel={() => setDismissTarget(null)}
      />
    </div>
  );
}
