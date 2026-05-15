"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  communityColumns,
  rowColumns,
} from "@/lib/import/columns";
import type {
  ImportError,
  ImportPreview,
  ImportRow,
  StructureVariant,
} from "@/lib/import/types";

import {
  commitImportAction,
  exportCurrentDataAction,
  exportRowsAsXlsxAction,
  generateTemplateAction,
  parsePdfAction,
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

// BYT-20260515-001 Phase 6: minimal client-side template descriptor.
// Mirrors the subset of `Template` the wizard needs without importing
// server-only types.
interface WizardTemplate {
  slug: string;
  display_name_key: string;
  description_key: string;
  category: "residential" | "land" | "commercial" | "civic" | "custom";
  default_voting_method: string;
  legal_review_required: boolean;
}

interface TemplateDetail extends WizardTemplate {
  import_levels: string[];
  root_kind: string;
}

// Map a template's `import_levels` length to one of the three legacy
// StructureVariant shapes the seeder currently supports. Phase 6b
// generalizes the seeder so import_levels can use arbitrary kind
// slugs — for now we approximate, and surface a warning when the
// template's kinds don't match the HOA-style chain.
function structureFromTemplate(levels: string[]): StructureVariant {
  switch (levels.length) {
    case 2:
      return "community_unit";
    case 3:
      return "community_entrance_unit";
    case 4:
      return "community_block_entrance_unit";
    default:
      return "community_entrance_unit";
  }
}

const HOA_LEAF_KINDS = new Set(["unit"]);
const HOA_BRANCH_KINDS = new Set(["building", "entrance"]);

function templateUsesHoaKinds(levels: string[]): boolean {
  if (levels.length === 0) return false;
  if (levels[0] !== "community") return false;
  for (let i = 1; i < levels.length - 1; i++) {
    if (!HOA_BRANCH_KINDS.has(levels[i])) return false;
  }
  const leaf = levels[levels.length - 1];
  return HOA_LEAF_KINDS.has(leaf);
}

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
  // Phase 6: template the wizard is operating under. Defaults to "hoa"
  // for installs predating Phase 5; overridden once /api/building
  // returns the bootstrapped template slug.
  const [templateSlug, setTemplateSlug] = useState<string>("hoa");
  const [templates, setTemplates] = useState<WizardTemplate[]>([]);
  const [templateDetail, setTemplateDetail] = useState<TemplateDetail | null>(
    null
  );
  const [community, setCommunity] = useState<RowDict>({
    country: "sk",
    voting_method: "per_share",
  });
  // If a community is already configured in Settings, the wizard switches
  // into "append" mode: the Community panel is prefilled and locked, and
  // the seeder attaches new units/owners under the existing root instead
  // of trying to create a duplicate community.
  const [existingCommunityId, setExistingCommunityId] = useState<string | null>(
    null
  );

  useEffect(() => {
    fetch("/api/building")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.id) return;
        setExistingCommunityId(data.id);
        setCommunity((prev) => ({
          ...prev,
          community_name: prev.community_name ?? data.name ?? "",
          community_address: prev.community_address ?? data.address ?? "",
          community_ico: prev.community_ico ?? data.ico ?? "",
          country: prev.country ?? data.country ?? "sk",
          voting_method: prev.voting_method ?? data.votingMethod ?? "per_share",
        }));
        if (data.templateSlug) setTemplateSlug(data.templateSlug);
      })
      .catch(() => {});
  }, []);

  // Load the template summary list once.
  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { templates: WizardTemplate[] } | null) => {
        if (data?.templates) setTemplates(data.templates);
      })
      .catch(() => {});
  }, []);

  // When the selected template changes, fetch its full detail (so we
  // can read import_levels) and reconcile structure + voting method.
  useEffect(() => {
    if (!templateSlug) return;
    let cancelled = false;
    fetch(`/api/templates?slug=${encodeURIComponent(templateSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tpl: TemplateDetail | null) => {
        if (cancelled || !tpl) return;
        setTemplateDetail(tpl);
        setStructure(structureFromTemplate(tpl.import_levels));
        // Only seed defaults — don't clobber operator edits.
        setCommunity((prev) => ({
          ...prev,
          voting_method: prev.voting_method || tpl.default_voting_method,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [templateSlug]);
  const [rows, setRows] = useState<RowDict[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [committing, startCommit] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Per-row columns (community fields are captured separately above).
  const columns = useMemo(() => rowColumns(structure), [structure]);
  const communityCols = useMemo(() => communityColumns(structure), [structure]);

  // Persisted column widths per column key (px).
  const [columnWidths, setColumnWidths] = useLocalStorage<Record<string, number>>(
    "import-grid-column-widths-v1",
    {}
  );
  const widthFor = (key: string): number => columnWidths[key] ?? defaultWidth(key);

  // Column-resize drag state. We track the column being dragged and the
  // starting pageX / starting width to compute deltas without re-rendering
  // on every mousemove via state.
  const dragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(
    null
  );

  const onResizeStart = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        key,
        startX: e.pageX,
        startWidth: widthFor(key),
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    // widthFor is defined inline above; columnWidths is the actual dep.
    [columnWidths] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.max(60, drag.startWidth + (e.pageX - drag.startX));
      setColumnWidths((prev) => ({ ...prev, [drag.key]: next }));
    }
    function onUp() {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setColumnWidths]);

  function onDownloadTemplate(format: "xlsx" | "csv") {
    setGeneralError(null);
    generateTemplateAction(structure, format)
      .then((blob) => downloadBlob(blob.filename, blob.base64, blob.mimeType))
      .catch((err: Error) => setGeneralError(err.message));
  }

  function onExportCurrentData(format: "xlsx" | "csv") {
    setGeneralError(null);
    exportCurrentDataAction(format)
      .then((res) => {
        if (res.empty) {
          setGeneralError(t("exportEmpty"));
          return;
        }
        downloadBlob(res.filename, res.base64, res.mimeType);
      })
      .catch((err: Error) => setGeneralError(err.message));
  }

  function onFileUpload(file: File) {
    setGeneralError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const base64 = btoa(String.fromCharCode(...data));
      parseUploadedFileAction(base64, structure, community)
        .then((res) => {
          // Lift community fields from the first row into the Community panel
          // and strip them from every row. Files generated by older versions
          // of this wizard carry the duplicated columns — this keeps them
          // backwards-compatible.
          const first = res.rows[0] ?? {};
          const commKeys = communityCols.map((c) => c.key);
          const liftedCommunity: RowDict = { ...community };
          for (const k of commKeys) {
            const v = (first as unknown as Record<string, unknown>)[k];
            if (v !== undefined && v !== null && v !== "") {
              liftedCommunity[k] = v as string | number;
            }
          }
          setCommunity(liftedCommunity);
          const rowsOnly = res.rows.map((r) => {
            const stripped: RowDict = {};
            for (const c of columns) {
              const v = (r as unknown as Record<string, unknown>)[c.key];
              if (v !== undefined) stripped[c.key] = v as string | number;
            }
            return stripped;
          });
          setRows(rowsOnly);
          setPreview(res);
        })
        .catch((err: Error) => setGeneralError(err.message));
    };
    reader.readAsArrayBuffer(file);
  }

  function onPdfUpload(file: File) {
    setGeneralError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      let binary = "";
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
      const base64 = btoa(binary);
      parsePdfAction(base64)
        .then((res) => {
          if (res.scanned) {
            setGeneralError(t("pdfScannedHint"));
            return;
          }
          if (res.recognised === 0) {
            setGeneralError(t("pasteUnrecognised"));
            return;
          }
          // Lift community_address from first parsed row if Community panel is empty.
          if (!community.community_address) {
            const inferred = (res.rows[0] as unknown as Record<string, unknown>)
              ?.community_address;
            if (typeof inferred === "string" && inferred !== "") {
              setCommunity((c) => ({ ...c, community_address: inferred }));
            }
          }
          const rowOnly = res.rows.map((d) => {
            const stripped: RowDict = {};
            for (const c of columns) {
              const v = (d as unknown as Record<string, unknown>)[c.key];
              if (v !== undefined) stripped[c.key] = v as string | number;
            }
            return stripped;
          });
          setRows((prev) => [...prev, ...rowOnly]);
        })
        .catch((err: Error) => setGeneralError(err.message));
    };
    reader.readAsArrayBuffer(file);
  }

  function onClearGrid() {
    if (rows.length === 0) return;
    if (!window.confirm(t("clearGridConfirm"))) return;
    setRows([]);
    setPreview(null);
    setGeneralError(null);
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
      const blank: RowDict = {};
      for (const c of columns) blank[c.key] = "";
      return [...prev, blank];
    });
  }

  function onRemoveRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function onExportRows() {
    setGeneralError(null);
    // For export only, splat community onto rows so the resulting XLSX is
    // self-contained and can be re-imported as a single file.
    const exportRows = rows.map((r) => ({ ...community, ...r }));
    exportRowsAsXlsxAction(exportRows, structure)
      .then((blob) => downloadBlob(blob.filename, blob.base64, blob.mimeType))
      .catch((err: Error) => setGeneralError(err.message));
  }

  function onPreview() {
    setGeneralError(null);
    startPreview(() => {
      previewImportAction(
        rows,
        structure,
        community,
        existingCommunityId ?? undefined,
        templateSlug
      )
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
      commitImportAction(
        preview.rows as ImportRow[],
        structure,
        community,
        existingCommunityId ?? undefined,
        templateSlug
      )
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
  // Map of community-column errors (row=0) keyed by column for inline display
  // beside the offending Community panel input.
  const communityErrors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of preview?.errors ?? []) {
      if (e.row !== 0 || !e.column) continue;
      const isCommunityField = communityCols.some((c) => c.key === e.column);
      if (isCommunityField) m.set(e.column, e.message);
    }
    return m;
  }, [preview, communityCols]);

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

      {/* Step 1a: Template (Phase 6) */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          {t("templateTitle")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {t("templateSubtitle")}
        </p>
        <TemplatePicker
          templates={templates}
          value={templateSlug}
          onChange={setTemplateSlug}
        />
        {templateDetail && !templateUsesHoaKinds(templateDetail.import_levels) && (
          <div className="mt-3 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
            <strong>{t("templateNonHoaTitle")}</strong>{" "}
            {t("templateNonHoaBody", {
              levels: templateDetail.import_levels.join(" → "),
            })}
          </div>
        )}
      </section>
      {/* Phase 6b note: the amber banner above stays as a hint that
          share/area CSV columns can default to 1/1 for non-HOA leaves
          — the seeder itself now writes the correct kind chain. */}

      {/* Step 1b: Structure */}
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

      {/* Step 1b: Community-level fields (entered once, not per row) */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <h2 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          {t("communityTitle")}
        </h2>
        {existingCommunityId ? (
          <div className="mb-3 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            <strong>{t("appendModeTitle")}</strong> {t("appendModeBody")}
          </div>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {t("communitySubtitle")}
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {communityCols.map((c) => {
            const value = (community[c.key] ?? "") as string;
            const onChange = (v: string) =>
              setCommunity((prev) => ({ ...prev, [c.key]: v }));
            const err = communityErrors.get(c.key);
            const locked = !!existingCommunityId;
            const borderClass = err
              ? "border-red-500"
              : "border-gray-300 dark:border-gray-700";
            const lockedClass = locked
              ? "bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
              : "bg-white dark:bg-gray-900";
            if (c.excelFormat === "enum") {
              return (
                <label key={c.key} className="block text-sm">
                  <span className="text-gray-700 dark:text-gray-200 font-medium">
                    {c.label}
                    {c.required ? " *" : ""}
                  </span>
                  <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={locked}
                    className={`mt-1 w-full px-2 py-1.5 border rounded text-sm ${lockedClass} ${borderClass}`}
                  >
                    <option value="" />
                    {c.enumOptions?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  {err && (
                    <span className="block text-xs text-red-600 dark:text-red-400 mt-0.5">
                      {err}
                    </span>
                  )}
                </label>
              );
            }
            return (
              <label key={c.key} className="block text-sm">
                <span className="text-gray-700 dark:text-gray-200 font-medium">
                  {c.label}
                  {c.required ? " *" : ""}
                </span>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  placeholder={c.comment}
                  readOnly={locked}
                  className={`mt-1 w-full px-2 py-1.5 border rounded text-sm ${lockedClass} ${borderClass}`}
                />
                {err && (
                  <span className="block text-xs text-red-600 dark:text-red-400 mt-0.5">
                    {err}
                  </span>
                )}
              </label>
            );
          })}
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
          <label className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium cursor-pointer">
            {t("uploadPdf")}
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPdfUpload(f);
                // Reset so the same file can be re-selected if needed.
                e.target.value = "";
              }}
            />
          </label>
          <label className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-gray-900 font-medium cursor-pointer dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100">
            {t("uploadFile")}
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileUpload(f);
                e.target.value = "";
              }}
            />
          </label>
          <details className="ml-auto">
            <summary className="cursor-pointer text-sm text-gray-600 dark:text-gray-400 py-2">
              {t("advanced")}
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onDownloadTemplate("csv")}
                className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100"
              >
                {t("downloadCsv")}
              </button>
              <button
                type="button"
                onClick={() => onExportCurrentData("xlsx")}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
                title={t("exportCurrentDataHelp")}
              >
                {t("exportCurrentDataXlsx")}
              </button>
              <button
                type="button"
                onClick={() => onExportCurrentData("csv")}
                className="px-3 py-1.5 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-900 text-sm dark:bg-indigo-900 dark:hover:bg-indigo-800 dark:text-indigo-100"
                title={t("exportCurrentDataHelp")}
              >
                {t("exportCurrentDataCsv")}
              </button>
            </div>
          </details>
        </div>
      </section>

      {/* Step 3: Grid */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        {rows.length > 0 && (
          <div className="mb-3 rounded border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-sm text-blue-900 dark:text-blue-100">
            <strong>{t("notSavedYetTitle")}</strong>{" "}
            {t("notSavedYetBody")}
          </div>
        )}
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
              onClick={onClearGrid}
              disabled={rows.length === 0}
              className="px-3 py-1.5 rounded bg-red-50 hover:bg-red-100 text-red-700 text-sm disabled:opacity-50 dark:bg-red-950 dark:hover:bg-red-900 dark:text-red-300"
            >
              {t("clearGrid")}
            </button>
            <button
              type="button"
              onClick={onExportRows}
              disabled={rows.length === 0}
              className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-900 text-sm disabled:opacity-50 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-100"
              title={t("exportRowsHelp")}
            >
              {t("exportRows")}
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
            <table className="text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 40 }} />
                {columns.map((c) => (
                  <col key={c.key} style={{ width: widthFor(c.key) }} />
                ))}
                <col style={{ width: 40 }} />
              </colgroup>
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left text-gray-700 dark:text-gray-300 font-semibold">
                    #
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className={`relative px-2 py-1 text-left font-semibold ${c.required ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-gray-300"}`}
                      title={c.comment}
                    >
                      <span className="truncate block pr-2">
                        {c.label}
                        {c.required ? " *" : ""}
                      </span>
                      <span
                        onMouseDown={(e) => onResizeStart(c.key, e)}
                        onDoubleClick={() =>
                          setColumnWidths((prev) => {
                            const next = { ...prev };
                            delete next[c.key];
                            return next;
                          })
                        }
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60 dark:hover:bg-blue-500/60"
                        title={t("resizeHelp")}
                      />
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

    </div>
  );
}

function defaultWidth(key: string): number {
  if (key.includes("address") || key.includes("name")) return 220;
  if (key.includes("email")) return 200;
  if (key === "owner_phone") return 140;
  if (key === "community_ico" || key === "supisne_cislo") return 120;
  return 110;
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

function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: WizardTemplate[];
  value: string;
  onChange: (slug: string) => void;
}) {
  const tRoot = useTranslations();
  const tCat = useTranslations("Templates.Categories");

  const grouped = useMemo(() => {
    const out: Record<string, WizardTemplate[]> = {
      residential: [],
      land: [],
      commercial: [],
      civic: [],
      custom: [],
    };
    for (const tpl of templates) out[tpl.category]?.push(tpl);
    return out;
  }, [templates]);

  if (templates.length === 0) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 border rounded text-sm bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700"
      >
        <option value={value}>{value}</option>
      </select>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 border rounded text-sm bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700"
    >
      {(["residential", "land", "commercial", "civic", "custom"] as const).map(
        (cat) =>
          grouped[cat].length > 0 ? (
            <optgroup key={cat} label={tCat(cat)}>
              {grouped[cat].map((tpl) => (
                <option key={tpl.slug} value={tpl.slug}>
                  {tRoot(tpl.display_name_key)}
                  {tpl.legal_review_required ? " ⚖" : ""}
                </option>
              ))}
            </optgroup>
          ) : null
      )}
    </select>
  );
}
