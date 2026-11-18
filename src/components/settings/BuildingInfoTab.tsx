"use client";

import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCommunityKinds } from "@/hooks/useCommunityKinds";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import Notice, { type NoticeState } from "./Notice";

export interface BuildingInfo {
  id: string;
  name: string;
  address: string;
  ico: string | null;
  dic: string | null;
  votingMethod: string;
  country: string;
  governanceModel: string;
  legalNotice: string | null;
  /** Stanovy notice lead time — edited in VotingSettingsTab, not here. */
  noticeLeadDays?: number | null;
}

interface BuildingInfoTabProps {
  canEdit: boolean;
  /** Community root resolved by the server page (null = not set up yet). */
  initial: BuildingInfo | null;
}

export default function BuildingInfoTab({ canEdit, initial }: BuildingInfoTabProps) {
  const t = useTranslations("Settings");
  const tc = useTranslations("Common");
  const tRoot = useTranslations();
  const router = useRouter();
  // The template's own name when known, so a garden / garage tenant gets the
  // right vocabulary in the heading.
  const { templateSlug } = useCommunityKinds();
  const displaySlug = getDisplayTemplateSlug(templateSlug);
  const sectionTitle = displaySlug ? tRoot(`Templates.${displaySlug}.name`) : t("buildingInfo");

  const [saved, setSaved] = useState<BuildingInfo | null>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<NoticeState>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [ico, setIco] = useState(initial?.ico ?? "");
  const [dic, setDic] = useState(initial?.dic ?? "");
  const [country, setCountry] = useState(initial?.country || "sk");
  const [governanceModel, setGovernanceModel] = useState(initial?.governanceModel || "chairman_council");

  const dirty =
    !saved ||
    name !== saved.name ||
    address !== saved.address ||
    ico !== (saved.ico ?? "") ||
    dic.trim() !== (saved.dic ?? "") ||
    country !== (saved.country || "sk") ||
    governanceModel !== (saved.governanceModel || "chairman_council");

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/building", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, ico: ico || null, dic: dic.trim() || null, country, governanceModel }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "");
      }
      setSaved(await res.json());
      // Name shows in the shell sidebar — re-resolve the server layout.
      router.refresh();
      setMessage({ type: "success", text: t("buildingSaved") });
    } catch {
      setMessage({ type: "error", text: t("buildingSaveFailed") });
    } finally {
      setSaving(false);
    }
  };

  if (!saved && !canEdit) {
    return <p className="text-base text-ui-text-muted">{t("noInfo")}</p>;
  }

  const governanceLabel =
    governanceModel === "committee"
      ? t("governanceCommittee")
      : governanceModel === "chairman_only"
        ? t("governanceChairmanOnly")
        : governanceModel === "board_supervisory"
          ? t("governanceBoardSupervisory")
          : t("governanceChairmanCouncil");

  return (
    <Card as="section" padding="lg" aria-labelledby="community-heading" className="space-y-5">
      <h2 id="community-heading" className="text-xl font-semibold text-ui-text">
        {sectionTitle}
      </h2>

      {!saved ? <p className="text-base text-ui-text-muted">{t("noInfo")}</p> : null}
      <Notice state={message} />

      {canEdit ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && name && address) handleSave();
          }}
        >
          <Field label={t("name")} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("address")} required>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          <Field label={t("ico")}>
            <Input value={ico} onChange={(e) => setIco(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t("dic")}>
            <Input value={dic} onChange={(e) => setDic(e.target.value)} inputMode="text" maxLength={20} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("country")}>
              <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="sk">{t("countrySk")}</option>
                <option value="cz">{t("countryCz")}</option>
              </Select>
            </Field>
            <Field label={t("governanceModel")}>
              <Select value={governanceModel} onChange={(e) => setGovernanceModel(e.target.value)}>
                <option value="chairman_council">{t("governanceChairmanCouncil")}</option>
                <option value="committee">{t("governanceCommittee")}</option>
                <option value="chairman_only">{t("governanceChairmanOnly")}</option>
                <option value="board_supervisory">{t("governanceBoardSupervisory")}</option>
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 pt-1">
            <Button type="submit" loading={saving} disabled={!dirty || !name || !address}>
              {saving ? tc("saving") : tc("save")}
            </Button>
          </div>
        </form>
      ) : saved ? (
        <dl className="space-y-3">
          <Row label={t("name")} value={saved.name} />
          <Row label={t("address")} value={saved.address} />
          {saved.ico ? <Row label={t("ico")} value={saved.ico} /> : null}
          {saved.dic ? <Row label={t("dic")} value={saved.dic} /> : null}
          <Row label={t("country")} value={saved.country === "cz" ? t("countryCz") : t("countrySk")} />
          <Row label={t("governanceModel")} value={governanceLabel} />
        </dl>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-base text-ui-text-muted">{label}</dt>
      <dd className="text-base text-ui-text">{value}</dd>
    </div>
  );
}
