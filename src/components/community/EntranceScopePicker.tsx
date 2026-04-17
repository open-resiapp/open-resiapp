"use client";

import { useTranslations } from "next-intl";

interface Entrance {
  id: string;
  name: string;
}

interface EntranceScopePickerProps {
  entrances: Entrance[];
  value: string | null;
  onChange: (entranceId: string | null) => void;
  disabled?: boolean;
}

export default function EntranceScopePicker({
  entrances,
  value,
  onChange,
  disabled,
}: EntranceScopePickerProps) {
  const t = useTranslations("Community");

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base"
    >
      <option value="">{t("scopeAll")}</option>
      {entrances.map((ent) => (
        <option key={ent.id} value={ent.id}>
          {ent.name}
        </option>
      ))}
    </select>
  );
}
