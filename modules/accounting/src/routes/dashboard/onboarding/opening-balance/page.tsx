"use client";

// Opening-balance wizard (BYT-20260512-002 Phase 1).
// Domain invariant 6: banka + pokladnica = Σ FPÚO + Σ zálohy + Σ preplatky
// − Σ nedoplatky + výsledok minulých rokov. The rozdiel is shown live on
// every keystroke; posting requires the treasurer to explicitly confirm
// the korekcia when the rozdiel is non-zero. Amounts are entered in EUR
// and converted to integer cents on parse — no float math on money.
//
// Per unit there are FOUR separate fields (fund balance, advances, the
// owner's own arrears, the owner's own credit) so savings and debts no
// longer net into one number. A posted opening balance can be CORRECTED:
// the server reverses the active entry and posts the corrected one
// (ledger discipline — never edit/delete), with a mandatory reason.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { PageHeader } from "@/components/ui";
import {
  parseCents as parseCentsBase,
  centsToInput,
  formatEur,
} from "@modules/accounting/src/lib/money";
import {
  parseOpeningBalanceCsv,
  buildOpeningBalanceTemplate,
  type OpeningImportResult,
  type OpeningRowErrorCode,
  type OpeningFileErrorCode,
} from "@modules/accounting/src/lib/opening-balance-import";
import type {
  VyuctovaniePdfImportResult,
  VyuctovaniePdfErrorCode,
} from "@modules/accounting/src/lib/vyuctovanie-pdf-import";

// Parser error codes → i18n keys (parser stays i18n-free; UI localizes).
const ROW_ERR_KEY: Record<OpeningRowErrorCode, string> = {
  unknown_unit: "import.errUnknownUnit",
  ambiguous_unit: "import.errAmbiguousUnit",
  duplicate_unit: "import.errDuplicateUnit",
  bad_fpuo: "import.errBadFpuo",
  bad_zalohy: "import.errBadZalohy",
  bad_nedoplatok: "import.errBadNedoplatok",
  bad_preplatok: "import.errBadPreplatok",
};
const FILE_ERR_KEY: Record<OpeningFileErrorCode, string> = {
  empty_file: "import.errEmptyFile",
  no_header: "import.errNoHeader",
  missing_flat_column: "import.errMissingFlatColumn",
  missing_amount_column: "import.errMissingAmountColumn",
};
// Vyúčtovanie-PDF parse + match error codes → i18n keys (AC 508).
const PDF_ERR_KEY: Record<VyuctovaniePdfErrorCode, string> = {
  not_app_vyuctovanie: "import.pdfErrNotApp",
  no_year: "import.pdfErrNoYear",
  no_vs: "import.pdfErrNoVs",
  no_result: "import.pdfErrNoResult",
  total_mismatch: "import.pdfErrMismatch",
};
// Server error codes (lib/opening-balance.ts + route) → i18n keys.
const SUBMIT_ERR_KEYS = new Set([
  "already_posted",
  "not_posted",
  "opening_period_locked",
  "invalid_amounts",
  "unknown_unit",
  "reason_required",
  "invalid_year",
]);
const PDF_MATCH_ERR_KEY: Record<string, string> = {
  unknown_vs: "import.pdfErrUnknownVs",
  ambiguous_vs: "import.pdfErrAmbiguousVs",
  duplicate_unit: "import.pdfErrDuplicate",
};

interface UnitRow {
  id: string;
  name: string;
  flatNumber: string | null;
}

interface PostedUnit {
  unitEntityId: string;
  fpuoCents: number;
  zalohyCents: number;
  nedoplatokCents: number;
  preplatokCents: number;
}

interface State {
  entityId: string;
  country: "sk" | "cz";
  year: number;
  alreadyPosted: boolean;
  posted: {
    journalEntryId: string;
    year: number;
    periodOpen: boolean;
    bankaCents: number;
    pokladnicaCents: number;
    unitBalances: PostedUnit[];
  } | null;
  units: UnitRow[];
}

type UnitField = "fpuo" | "zalohy" | "nedoplatok" | "preplatok";
type UnitValues = Record<UnitField, string>;
const EMPTY_UNIT: UnitValues = { fpuo: "", zalohy: "", nedoplatok: "", preplatok: "" };
const UNIT_FIELDS: UnitField[] = ["fpuo", "zalohy", "nedoplatok", "preplatok"];

// Fund / advance balances allow negatives (legacy: unpaid contributions);
// the owner's arrears / credit are magnitudes (>= 0). Empty = 0.
const parseCents = (raw: string) =>
  parseCentsBase(raw, { allowNegative: true, emptyAsZero: true });
const parseNonNeg = (raw: string) =>
  parseCentsBase(raw, { emptyAsZero: true });
const parseField = (field: UnitField, raw: string) =>
  field === "nedoplatok" || field === "preplatok"
    ? parseNonNeg(raw)
    : parseCents(raw);
const toInput = (cents: number) => (cents === 0 ? "" : centsToInput(cents));

export default function OpeningBalancePage() {
  const t = useTranslations("Accounting.openingBalance");
  const router = useRouter();

  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [banka, setBanka] = useState("");
  const [pokladnica, setPokladnica] = useState("");
  const [unitValues, setUnitValues] = useState<Record<string, UnitValues>>(
    {}
  );
  // Correction mode: the posted opening is reversed and reposted.
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmKorekcia, setConfirmKorekcia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<OpeningImportResult | null>(
    null
  );
  const [pdfReport, setPdfReport] =
    useState<VyuctovaniePdfImportResult | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/accounting/opening-balance")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data: State) => {
        setState(data);
        setLoading(false);
      })
      .catch(() => {
        setError("load");
        setLoading(false);
      });
  }, []);

  const bankaCents = parseCents(banka);
  const pokladnicaCents = parseCents(pokladnica);

  const unitCents = useMemo(() => {
    if (!state) return [];
    return state.units.map((u) => {
      const v = unitValues[u.id] ?? EMPTY_UNIT;
      return {
        unit: u,
        fpuoCents: parseField("fpuo", v.fpuo),
        zalohyCents: parseField("zalohy", v.zalohy),
        nedoplatokCents: parseField("nedoplatok", v.nedoplatok),
        preplatokCents: parseField("preplatok", v.preplatok),
      };
    });
  }, [state, unitValues]);

  const unitsValid = unitCents.every(
    (u) =>
      u.fpuoCents !== null &&
      u.zalohyCents !== null &&
      u.nedoplatokCents !== null &&
      u.preplatokCents !== null
  );
  const step1Valid =
    bankaCents !== null &&
    pokladnicaCents !== null &&
    bankaCents >= 0 &&
    pokladnicaCents >= 0;

  const totals = useMemo(() => {
    const sum = (k: "fpuoCents" | "zalohyCents" | "nedoplatokCents" | "preplatokCents") =>
      unitCents.reduce((s, u) => s + (u[k] ?? 0), 0);
    const fpuo = sum("fpuoCents");
    const zalohy = sum("zalohyCents");
    const nedoplatok = sum("nedoplatokCents");
    const preplatok = sum("preplatokCents");
    const assets = (bankaCents ?? 0) + (pokladnicaCents ?? 0);
    return {
      fpuo,
      zalohy,
      nedoplatok,
      preplatok,
      assets,
      // Owners' receivables add to what the SVB has; their credit is owed.
      rozdiel: assets + nedoplatok - fpuo - zalohy - preplatok,
    };
  }, [unitCents, bankaCents, pokladnicaCents]);

  // Prefill the wizard from the posted entry and switch to correction.
  function startCorrection() {
    if (!state?.posted) return;
    const p = state.posted;
    setBanka(toInput(p.bankaCents));
    setPokladnica(toInput(p.pokladnicaCents));
    const next: Record<string, UnitValues> = {};
    for (const u of p.unitBalances) {
      next[u.unitEntityId] = {
        fpuo: toInput(u.fpuoCents),
        zalohy: toInput(u.zalohyCents),
        nedoplatok: toInput(u.nedoplatokCents),
        preplatok: toInput(u.preplatokCents),
      };
    }
    setUnitValues(next);
    setConfirmKorekcia(false);
    setReason("");
    setError(null);
    setStep(1);
    setCorrecting(true);
  }

  function setUnitField(unitId: string, field: UnitField, value: string) {
    setUnitValues((prev) => ({
      ...prev,
      [unitId]: { ...(prev[unitId] ?? EMPTY_UNIT), [field]: value },
    }));
  }

  async function submit() {
    if (!state) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/opening-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: state.year,
          ...(correcting ? { correction: true, reason: reason.trim() } : {}),
          bankaCents,
          pokladnicaCents,
          unitBalances: unitCents.map((u) => ({
            unitEntityId: u.unit.id,
            fpuoCents: u.fpuoCents,
            zalohyCents: u.zalohyCents,
            nedoplatokCents: u.nedoplatokCents,
            preplatokCents: u.preplatokCents,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? String(res.status));
      }
      router.push("/accounting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "submit");
      setSubmitting(false);
    }
  }

  // Concierge import: download a per-unit template, or fill the table from
  // a filled-in spreadsheet — the parse runs entirely client-side.
  function downloadTemplate() {
    if (!state) return;
    const csv = buildOpeningBalanceTemplate(
      state.units.map((u) => ({ label: u.flatNumber ?? u.name }))
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `otvaracia-suvaha-${state.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected after an edit
    if (!file || !state) return;
    const text = await file.text();
    const result = parseOpeningBalanceCsv(
      text,
      state.units.map((u) => ({ id: u.id, label: u.flatNumber ?? u.name }))
    );
    setImportReport(result);
    if (result.fileError) return;
    // Merge every cleanly-matched row into the editable table.
    setUnitValues((prev) => {
      const next = { ...prev };
      for (const [unitId, v] of Object.entries(result.matched)) {
        next[unitId] = {
          fpuo: centsToInput(v.fpuoCents),
          zalohy: centsToInput(v.zalohyCents),
          nedoplatok: toInput(v.nedoplatokCents),
          preplatok: toInput(v.preplatokCents),
        };
      }
      return next;
    });
  }

  // Vyúčtovanie-PDF ingest (AC 508): the PDF → text extraction runs
  // server-side (pdf-parse), the parse + VS matching is the shared,
  // golden-tested pure code. Only the zálohy column is filled — the
  // statutory vyúčtovanie carries no fond-opráv balance.
  async function onPdfFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0 || !state) return;
    setPdfBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f);
      const res = await fetch("/api/accounting/opening-balance/pdf", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? String(res.status));
      }
      const result: VyuctovaniePdfImportResult = await res.json();
      setPdfReport(result);
      setUnitValues((prev) => {
        const next = { ...prev };
        for (const [unitId, v] of Object.entries(result.matched)) {
          const existing = next[unitId] ?? EMPTY_UNIT;
          // PDF fills ONLY zálohy; fond opráv stays as-is (CSV / manual).
          next[unitId] = { ...existing, zalohy: centsToInput(v.zalohyCents) };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "pdf");
    } finally {
      setPdfBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse h-40 bg-gray-100 dark:bg-gray-800 rounded-lg" />
    );
  }
  if (!state) {
    return (
      <p className="text-red-600 dark:text-red-400">{t("loadError")}</p>
    );
  }
  if (state.alreadyPosted && !correcting) {
    const p = state.posted;
    return (
      <div className="max-w-2xl">
        <PageHeader
          title={t("title")}
          backHref="/accounting/settings"
          backLabel={t("backToSettings")}
        />
        <p className="text-base text-ui-text mb-4">{t("alreadyPosted")}</p>
        {p && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 space-y-3 text-base">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              {t("correct.postedSummary", {
                year: p.year,
                assets: formatEur(p.bankaCents + p.pokladnicaCents),
                units: p.unitBalances.length,
              })}
            </p>
            {p.periodOpen ? (
              <>
                <p className="text-gray-700 dark:text-gray-300">
                  {t("correct.intro")}
                </p>
                <button
                  type="button"
                  onClick={startCorrection}
                  className="min-h-11 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base"
                >
                  {t("correct.button")}
                </button>
              </>
            ) : (
              <p className="text-amber-800 dark:text-amber-300">
                {t("correct.locked")}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  const inputClass =
    "w-full sm:w-36 min-h-11 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-right text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100";
  const fieldLabel: Record<UnitField, string> = {
    fpuo: t("fpuoBalance"),
    zalohy: t("zalohyBalance"),
    nedoplatok: t("nedoplatokBalance"),
    preplatok: t("preplatokBalance"),
  };
  const fieldInvalid = (unitId: string, field: UnitField) =>
    parseField(field, (unitValues[unitId] ?? EMPTY_UNIT)[field]) === null;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={correcting ? t("correct.title") : t("title")}
        description={t("subtitle", { year: state.year })}
        backHref="/accounting/settings"
        backLabel={t("backToSettings")}
      />

      {/* Step indicator */}
      {correcting && (
        <p className="mb-4 text-base text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          {t("correct.modeBanner")}
        </p>
      )}
      <ol className="flex flex-wrap gap-2 mb-6 text-base">
        {[1, 2, 3].map((s) => (
          <li
            key={s}
            className={`px-3 py-1 rounded-full ${
              step === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
            }`}
          >
            {s}. {t(`step${s}` as "step1" | "step2" | "step3")}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <span className="text-base text-gray-900 dark:text-gray-100">{t("banka")}</span>
            <input
              value={banka}
              onChange={(e) => setBanka(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <span className="text-base text-gray-900 dark:text-gray-100">{t("pokladnica")}</span>
            <input
              value={pokladnica}
              onChange={(e) => setPokladnica(e.target.value)}
              placeholder={t("amountPlaceholder")}
              inputMode="decimal"
              className={inputClass}
            />
          </label>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!step1Valid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          {/* Concierge CSV import — fill the table from a spreadsheet. */}
          <div className="mb-5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
            <p className="text-base font-medium text-gray-900 dark:text-gray-100">
              {t("import.panelTitle")}
            </p>
            <p className="text-base text-gray-600 dark:text-gray-400 mt-1 mb-3">
              {t("import.panelHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadTemplate}
                className="min-h-11 px-3 py-1.5 text-base border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900"
              >
                ⬇ {t("import.downloadTemplate")}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-11 px-3 py-1.5 text-base bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                ⬆ {t("import.uploadCsv")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={onCsvFile}
                className="hidden"
              />
              {/* AC 508 — ingest last year's own vyúčtovanie PDFs. */}
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={pdfBusy}
                className="min-h-11 px-3 py-1.5 text-base border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900 disabled:opacity-50"
              >
                ⬆ {pdfBusy ? t("import.pdfUploading") : t("import.pdfUpload")}
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                multiple
                onChange={onPdfFiles}
                className="hidden"
              />
            </div>
            <p className="text-base text-gray-600 dark:text-gray-400 mt-2">
              {t("import.pdfHint")}
            </p>

            {pdfReport && (
              <div className="mt-3 text-base space-y-2">
                <p className="text-green-700 dark:text-green-400">
                  {t("import.pdfResultMatched", {
                    count: pdfReport.matchedCount,
                  })}
                </p>
                {pdfReport.matchedCount > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    {t("import.pdfFondNote")}
                  </p>
                )}
                {pdfReport.files.some(
                  (f) => f.parsed.error || f.matchError
                ) && (
                  <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-2 text-amber-900 dark:text-amber-200">
                    <ul className="list-disc pl-5 space-y-0.5">
                      {pdfReport.files
                        .filter((f) => f.parsed.error || f.matchError)
                        .slice(0, 12)
                        .map((f, i) => {
                          const key = f.parsed.error
                            ? PDF_ERR_KEY[f.parsed.error]
                            : PDF_MATCH_ERR_KEY[f.matchError ?? ""];
                          return (
                            <li key={i}>
                              {f.fileName}:{" "}
                              {key
                                ? t(key as Parameters<typeof t>[0])
                                : f.matchError}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {importReport && (
              <div className="mt-3 text-base space-y-2">
                {importReport.fileError ? (
                  <p className="text-red-700 dark:text-red-400">
                    {t(
                      FILE_ERR_KEY[
                        importReport.fileError
                      ] as Parameters<typeof t>[0]
                    )}
                  </p>
                ) : (
                  <>
                    <p className="text-green-700 dark:text-green-400">
                      {t("import.resultMatched", {
                        count: importReport.matchedCount,
                      })}
                    </p>
                    {importReport.errorCount > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-2 text-amber-900 dark:text-amber-200">
                        <p className="font-medium mb-1">
                          {t("import.resultErrors", {
                            count: importReport.errorCount,
                          })}
                        </p>
                        <ul className="list-disc pl-5 space-y-0.5">
                          {importReport.rows
                            .filter((r) => r.errors.length)
                            .slice(0, 12)
                            .map((r) => (
                              <li key={r.rowNumber}>
                                {t("import.rowLabel", {
                                  row: r.rowNumber,
                                  unit: r.rawLabel,
                                })}
                                :{" "}
                                {r.errors
                                  .map((c) =>
                                    t(ROW_ERR_KEY[c] as Parameters<typeof t>[0])
                                  )
                                  .join(", ")}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}
                    {importReport.unmatchedUnitLabels.length > 0 && (
                      <p className="text-amber-700 dark:text-amber-400">
                        {t("import.resultEmpty", {
                          count: importReport.unmatchedUnitLabels.length,
                          units: importReport.unmatchedUnitLabels
                            .slice(0, 10)
                            .join(", "),
                        })}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <p className="text-base text-gray-700 dark:text-gray-300 mb-3">
            {t("unitsHint")}
          </p>
          {/* Plain-words guide to the four fields. */}
          <dl className="mb-5 grid gap-2 text-base text-gray-700 dark:text-gray-300">
            {UNIT_FIELDS.map((f) => (
              <div key={f}>
                <dt className="font-semibold text-gray-900 dark:text-gray-100 inline">
                  {fieldLabel[f]}:
                </dt>{" "}
                <dd className="inline">{t(`fieldHelp.${f}` as Parameters<typeof t>[0])}</dd>
              </div>
            ))}
          </dl>

          {/* < md: one card per unit (390 px, no horizontal scroll). */}
          <ul className="md:hidden space-y-3">
            {state.units.map((u) => {
              const v = unitValues[u.id] ?? EMPTY_UNIT;
              return (
                <li
                  key={u.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3"
                >
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    {t("unit")} {u.flatNumber ?? u.name}
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {UNIT_FIELDS.map((f) => (
                      <label key={f} className="flex flex-col gap-1 text-base text-gray-700 dark:text-gray-300">
                        {fieldLabel[f]}
                        <input
                          value={v[f]}
                          onChange={(e) => setUnitField(u.id, f, e.target.value)}
                          placeholder={t("amountPlaceholder")}
                          inputMode="decimal"
                          aria-invalid={fieldInvalid(u.id, f)}
                          className={`${inputClass} ${fieldInvalid(u.id, f) ? "border-red-500" : ""}`}
                        />
                      </label>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="text-left text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3">{t("unit")}</th>
                  {UNIT_FIELDS.map((f) => (
                    <th key={f} className="py-2 pr-3 text-right">
                      {fieldLabel[f]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.units.map((u) => {
                  const v = unitValues[u.id] ?? EMPTY_UNIT;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="py-2 pr-3 text-gray-900 dark:text-gray-100">
                        {u.flatNumber ?? u.name}
                      </td>
                      {UNIT_FIELDS.map((f) => (
                        <td key={f} className="py-2 pr-3 text-right">
                          <input
                            value={v[f]}
                            onChange={(e) => setUnitField(u.id, f, e.target.value)}
                            placeholder={t("amountPlaceholder")}
                            inputMode="decimal"
                            aria-label={`${u.flatNumber ?? u.name} — ${fieldLabel[f]}`}
                            aria-invalid={fieldInvalid(u.id, f)}
                            className={`${inputClass} ${fieldInvalid(u.id, f) ? "border-red-500" : ""}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-gray-900 dark:text-gray-100">
                  <td className="py-2 pr-3">{t("unitsSum")}</td>
                  <td className="py-2 pr-3 text-right">{formatEur(totals.fpuo)}</td>
                  <td className="py-2 pr-3 text-right">{formatEur(totals.zalohy)}</td>
                  <td className="py-2 pr-3 text-right">{formatEur(totals.nedoplatok)}</td>
                  <td className="py-2 pr-3 text-right">{formatEur(totals.preplatok)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-base text-gray-600 dark:text-gray-400 mt-3">
            {t("negativeHint")}
          </p>
          <div className="flex flex-wrap gap-2 justify-between mt-4">
            <button
              onClick={() => setStep(1)}
              className="px-5 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              {t("back")}
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!unitsValid}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-6 space-y-3">
          <dl className="space-y-2 text-base text-gray-900 dark:text-gray-100">
            <div className="flex justify-between">
              <dt>{t("assetsTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.assets)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t("fpuoTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.fpuo)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("zalohyTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.zalohy)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("preplatokTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.preplatok)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t("nedoplatokTotal")}</dt>
              <dd className="font-medium">{formatEur(totals.nedoplatok)}</dd>
            </div>
            <div
              className={`flex justify-between border-t border-gray-200 dark:border-gray-700 pt-2 ${
                totals.rozdiel === 0
                  ? "text-green-700 dark:text-green-400"
                  : "text-amber-700 dark:text-amber-400"
              }`}
            >
              <dt className="font-semibold">{t("rozdiel")}</dt>
              <dd className="font-semibold">{formatEur(totals.rozdiel)}</dd>
            </div>
          </dl>

          {totals.rozdiel !== 0 && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 text-base text-amber-900 dark:text-amber-200">
              <p className="mb-3">{t("korekciaExplain")}</p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmKorekcia}
                  onChange={(e) => setConfirmKorekcia(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  {t("korekciaConfirm", {
                    amount: formatEur(Math.abs(totals.rozdiel)),
                  })}
                </span>
              </label>
            </div>
          )}

          {correcting && (
            <label className="flex flex-col gap-1 text-base text-gray-900 dark:text-gray-100">
              {t("correct.reasonLabel")}
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("correct.reasonPlaceholder")}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </label>
          )}

          {error && (
            <p className="text-red-600 dark:text-red-400 text-base">
              {t("submitError")}
              {SUBMIT_ERR_KEYS.has(error)
                ? `: ${t(`errors.${error}` as Parameters<typeof t>[0])}`
                : ""}
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-between pt-2">
            <button
              onClick={() => setStep(2)}
              className="px-5 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg"
            >
              {t("back")}
            </button>
            <button
              onClick={submit}
              disabled={
                submitting ||
                (totals.rozdiel !== 0 && !confirmKorekcia) ||
                (correcting && reason.trim() === "")
              }
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
            >
              {submitting
                ? t("submitting")
                : correcting
                  ? t("correct.submit")
                  : t("submit")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
