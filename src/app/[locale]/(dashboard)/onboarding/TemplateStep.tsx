"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button, Input } from "@/components/ui";
import type { TemplateSummary } from "@/lib/templates/types";

// Onboarding step "Typ komunity": the template decides the tree the import
// seeds (budova → vchod → byt, garážový blok → garáž, …) and the default
// voting method / governance. Without a community yet, it bootstraps one
// (name + address + template) through PATCH /api/building. Locked once units
// exist (the API refuses with template_locked).

const CATEGORY_ORDER = ["residential", "land", "commercial", "civic", "custom"] as const;

export function TemplateStep({
  templates,
  currentSlug,
  communityExists,
  locked,
}: {
  templates: TemplateSummary[];
  currentSlug: string | null;
  communityExists: boolean;
  locked: boolean;
}) {
  const t = useTranslations("Onboarding.template");
  const tRoot = useTranslations();
  const tCat = useTranslations("Templates.Categories");
  const router = useRouter();
  const [slug, setSlug] = useState(currentSlug ?? "hoa");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const label = (tpl: TemplateSummary) =>
    tRoot.has(tpl.display_name_key as never) ? tRoot(tpl.display_name_key as never) : tpl.slug;
  const description = (tpl: TemplateSummary) =>
    tRoot.has(tpl.description_key as never) ? tRoot(tpl.description_key as never) : "";

  const grouped = useMemo(() => {
    const out = new Map<string, TemplateSummary[]>();
    for (const tpl of templates) {
      const list = out.get(tpl.category) ?? [];
      list.push(tpl);
      out.set(tpl.category, list);
    }
    return out;
  }, [templates]);
  const selected = templates.find((x) => x.slug === slug);

  async function onSave() {
    setError(null);
    setSaved(false);
    if (!communityExists && (!name.trim() || !address.trim())) {
      setError(t("nameAddressRequired"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/building", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          communityExists
            ? { templateSlug: slug }
            : { templateSlug: slug, name: name.trim(), address: address.trim() }
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === "template_locked" ? t("lockedError") : t("saveFailed"));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <p className="text-base text-ui-text-muted">
        {t("lockedInfo", { template: selected ? label(selected) : slug })}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-base">
        <span className="font-medium text-ui-text">{t("pickLabel")}</span>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="mt-1 w-full rounded border border-ui-border bg-ui-surface px-2 py-2 text-base text-ui-text"
        >
          {CATEGORY_ORDER.map((cat) => {
            const list = grouped.get(cat);
            if (!list?.length) return null;
            return (
              <optgroup key={cat} label={tCat(cat)}>
                {list.map((tpl) => (
                  <option key={tpl.slug} value={tpl.slug}>
                    {label(tpl)}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </label>
      {selected && description(selected) && (
        <p className="text-base text-ui-text-muted">{description(selected)}</p>
      )}
      {selected?.legal_review_required && (
        <p className="text-base text-ui-text-muted">{t("legalReview")}</p>
      )}
      {!communityExists && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-base">
            <span className="font-medium text-ui-text">{t("nameLabel")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-base">
            <span className="font-medium text-ui-text">{t("addressLabel")}</span>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1" />
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onSave} disabled={busy}>
          {communityExists ? t("save") : t("create")}
        </Button>
        {saved && (
          <span role="status" className="text-base text-ui-success">
            {t("saved")}
          </span>
        )}
        {error && (
          <span role="alert" className="text-base text-ui-danger">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
