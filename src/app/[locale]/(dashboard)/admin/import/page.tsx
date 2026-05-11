"use client";

import { useMemo, useState, useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { columnsForStructure } from "@/lib/import/columns";
import type {
  ImportError,
  ImportPreview,
  ImportRow,
  StructureVariant,
} from "@/lib/import/types";

import {
  commitImportAction,
  generateTemplateAction,
  parsePasteAction,
  parseUploadedFileAction,
  previewImportAction,
} from "./actions";

type RowDict = Record<string, string | number | undefined>;

const STRUCTURES: { key: StructureVariant; labelKey: string }[] = [
  { key: "community_unit", labelKey: "structureCommunityUnit" },
  { key: "community_entrance_unit", labelKey: "structureCommunityEntranceUnit" },
  {
    key: "community_block_entrance_unit",
    labelKey: "structureCommunityBlockEntranceUnit",
  },
];

function downloadBlob(filename: string, base64: string, mimeType: string) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

export default function ImportWizardPage() {
  const t = useTranslations("Import");
  const router = useRouter();

  const [structure, setStructure] = useState<StructureVariant>(
    "community_entrance_unit"
  );
  const [rows, setRows] = useState<RowDict[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [committing, startCommit] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [generalError, setGeneralError] = useState<string | null>(null);

  const columns = useMemo(() => columnsForStructure(structure), [structure]);

  function onDownloadTemplate(format: "xlsx" | "csv") {
    setGeneralError(null);
    generateTemplateAction(structure, format)
      .then((blob) => downloadBlob(blob.filename, blob.base64, blob.mimeType))
      .catch((err: Error) => setGeneralError(err.message));
  }

  function onFileUpload(file: File) {
    setGeneralError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const base64 = btoa(String.fromCharCode(...data));
      parseUploadedFileAction(base64, structure)
        .then((res) => {
          setRows(res.rows.map((r) => ({ ...r })) as RowDict[]);
          setPreview(res);
        })
        .catch((err: Error) => setGeneralError(err.message));
    };
    reader.readAsArrayBuffer(file);
  }

  function onPasteSubmit() {
    setGeneralError(null);
    parsePasteAction(pasteText)
      .then((res) => {
        if (res.recognised === 0) {
          setGeneralError(t("pasteUnrecognised"));
          return;
        }
        // Merge community-level fields from any existing row so the admin
        // doesn't have to retype them on every pasted row.
        const headFromExisting = rows[0] ?? {};
        const merged = res.rows.map((d) => ({
          ...headFromExisting,
          ...d,
        })) as RowDict[];
        setRows((prev) => [...prev, ...merged]);
        setPasteOpen(false);
        setPasteText("");
      })
      .catch((err: Error) => setGeneralError(err.message));
  }

  function onCellChange(idx: number, key: string, value: string) {
    setRows((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
  }

  function onAddRow() {
    setRows((prev) => {
      const last = prev[prev.length - 1] ?? {};
      const blank: RowDict = {};
      for (const c of columns) blank[c.key] = "";
      // Inherit community-level fields from the last row.
      for (const k of [
        "community_name",
        "community_address",
        "community_ico",
        "country",
        "voting_method",
        "supisne_cislo",
      ]) {
        if (last[k] !== undefined) blank[k] = last[k];
      }
      return [...prev, blank];
    });
  }

  function onRemoveRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function onPreview() {
    setGeneralError(null);
    startPreview(() => {
      previewImportAction(rows, structure)
        .then(setPreview)
        .catch((err: Error) => setGeneralError(err.message));
    });
  }

  function onCommit() {
    setGeneralError(null);
    if (!preview?.ok) {
      setGeneralError(t("fixErrorsFirst"));
      return;
    }
    startCommit(() => {
      commitImportAction(preview.rows as ImportRow[], structure)
        .then((res) => {
          if (res.ok && res.communityEntityId) {
            router.push("/");
          } else if (res.errors) {
            setPreview({
              ok: false,
              rows: preview.rows,
              errors: res.errors,
              summary: preview.summary,
            });
          }
        })
        .catch((err: Error) => setGeneralError(err.message));
    });
  }

  const errorsByCell = useMemo(() => {
    const map = new Map<string, ImportError[]>();
    for (const e of preview?.errors ?? []) {
      const key = `${e.row}|${e.column ?? ""}`;
      const slot = map.get(key) ?? [];
      slot.push(e);
      map.set(key, slot);
    }
    return map;
  }, [preview]);

  const generalErrors = preview?.errors.filter((e) => e.row === 0) ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("subtitle")}
        </p>
      </div>

      {/* Step 1: Structure */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          {t("step1Title")}
        </h2>
        <div className="space-y-2">
          {STRUCTURES.map((s) => (
            <label
              key={s.key}
              className="flex items-start gap-3 p-3 rounded border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              <input
                type="radio"
                name="structure"
                checked={structure === s.key}
                onChange={() => setStructure(s.key)}
                className="mt-1"
              />
              <div>
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {t(s.labelKey)}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t(`${s.labelKey}Desc`)}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Step 2: On-ramp */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          {t("step2Title")}
        </h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onDownloadTemplate("xlsx")}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
          >
            {t("downloadXlsx")}
          </button>
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
          >
            {t("pasteFromLv")}
          </button>
          <label className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium cursor-pointer dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100">
            {t("uploadFile")}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileUpload(f);
              }}
            />
          </label>
          <details className="ml-auto">
            <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400 py-2">
              {t("advanced")}
            </summary>
            <button
              type="button"
              onClick={() => onDownloadTemplate("csv")}
              className="mt-2 px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100"
            >
              {t("downloadCsv")}
            </button>
          </details>
        </div>
      </section>

      {/* Step 3: Grid */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("step3Title")}{" "}
            <span className="text-sm font-normal text-gray-500">
              ({rows.length} {t("rowsLabel")})
            </span>
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddRow}
              className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100"
            >
              {t("addRow")}
            </button>
            <button
              type="button"
              onClick={onPreview}
              disabled={rows.length === 0 || previewing}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm disabled:opacity-50"
            >
              {previewing ? t("validating") : t("validate")}
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            {t("gridEmpty")}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left text-gray-700 dark:text-gray-300 font-semibold">
                    #
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`px-2 py-1 text-left font-semibold ${c.required ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}
                      title={c.comment}
                    >
                      {c.label}
                      {c.required ? " *" : ""}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  return (
                    <tr key={idx} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="px-2 py-1 text-gray-500">{idx + 1}</td>
                      {columns.map((c) => {
                        const cellErrors =
                          errorsByCell.get(`${idx + 1}|${c.key}`) ?? [];
                        const hasError = cellErrors.length > 0;
                        const value = r[c.key] ?? "";
                        const stringValue =
                          typeof value === "number" ? String(value) : value;
                        if (c.excelFormat === "enum") {
                          return (
                            <td key={c.key} className="px-1 py-1">
                              <select
                                value={String(stringValue)}
                                onChange={(e) =>
                                  onCellChange(idx, c.key, e.target.value)
                                }
                                className={`w-full px-1 py-0.5 border rounded text-sm bg-white dark:bg-gray-900 ${hasError ? "border-red-500" : "border-gray-300 dark:border-gray-700"}`}
                                title={cellErrors.map((e) => e.message).join("\n")}
                              >
                                <option value="" />
                                {c.enumOptions?.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} className="px-1 py-1">
                            <input
                              type="text"
                              value={String(stringValue)}
                              onChange={(e) =>
                                onCellChange(idx, c.key, e.target.value)
                              }
                              className={`w-full px-1 py-0.5 border rounded text-sm bg-white dark:bg-gray-900 ${hasError ? "border-red-500" : "border-gray-300 dark:border-gray-700"}`}
                              title={cellErrors.map((e) => e.message).join("\n")}
                            />
                          </td>
                        );
                      })}
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => onRemoveRow(idx)}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 text-xs"
                          aria-label={t("removeRow")}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Preview summary + commit */}
      {preview?.summary && (
        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
            {t("step4Title")}
          </h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label={t("summaryCommunity")} value={preview.summary.communityName} />
            <Stat label={t("summaryBlocks")} value={preview.summary.blocks} />
            <Stat label={t("summaryEntrances")} value={preview.summary.entrances} />
            <Stat label={t("summaryUnits")} value={preview.summary.units} />
            <Stat label={t("summaryOwners")} value={preview.summary.ownersNew} />
            <Stat
              label={t("summaryTotalShare")}
              value={`${preview.summary.totalUnitShare.num}/${preview.summary.totalUnitShare.den}`}
            />
          </dl>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={onCommit}
              disabled={!preview.ok || committing}
              className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50"
            >
              {committing ? t("committing") : t("commit")}
            </button>
            {!preview.ok && (
              <span className="text-sm text-red-600 dark:text-red-400">
                {preview.errors.length} {t("errorsCount")}
              </span>
            )}
          </div>
        </section>
      )}

      {(generalError || generalErrors.length > 0) && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200">
          {generalError && <div>{generalError}</div>}
          {generalErrors.map((e, i) => (
            <div key={i}>{e.message}</div>
          ))}
        </div>
      )}

      {pasteOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-3xl p-4 space-y-3">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("pasteModalTitle")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("pasteModalHelp")}
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={14}
              className="w-full font-mono text-xs border border-gray-300 dark:border-gray-700 rounded p-2 bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100"
              placeholder={t("pasteModalPlaceholder")}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false);
                  setPasteText("");
                }}
                className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm"
              >
                {t("pasteCancel")}
              </button>
              <button
                type="button"
                onClick={onPasteSubmit}
                disabled={pasteText.trim().length === 0}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm disabled:opacity-50"
              >
                {t("pasteRecognise")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </dd>
    </div>
  );
}
