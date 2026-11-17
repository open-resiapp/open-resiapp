"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button, Field, Modal, Select } from "@/components/ui";
import type { UnitOption } from "@/lib/owners-board";
import type { UserRole } from "@/types";
import { approveRegistration } from "./owner-requests";

interface PendingUser {
  id: string;
  name: string;
  email: string;
}

const ROLE_OPTIONS: UserRole[] = ["owner", "tenant", "admin", "vote_counter", "caretaker"];

/**
 * Approve a self-registration as a new account. Request unchanged:
 * POST /api/registrations/[id]/approve {flatId|null, role}. The unit list
 * comes from the server-rendered page (no /api/flats fetch).
 */
export default function PendingApprovalModal({
  user,
  units,
  onClose,
  onApproved,
}: {
  user: PendingUser;
  units: UnitOption[];
  onClose: () => void;
  onApproved: () => void;
}) {
  const t = useTranslations("PendingRegistrations");
  const tOwners = useTranslations("Owners");
  const tCommon = useTranslations("Common");

  const [flatId, setFlatId] = useState("");
  const [role, setRole] = useState<UserRole>("owner");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Flat is optional — empty flatId admits the user into the community
    // without assigning a flat.
    setSubmitting(true);
    setError(null);
    const err = await approveRegistration(user.id, flatId || null, role);
    if (err !== null) {
      setError(err || tCommon("saveFailed"));
      setSubmitting(false);
      return;
    }
    onApproved();
  }

  const roleLabels: Record<UserRole, string> = {
    admin: tOwners("roleAdmin"),
    owner: tOwners("roleOwner"),
    tenant: tOwners("roleTenant"),
    vote_counter: tOwners("roleVoteCounter"),
    caretaker: tOwners("roleCaretaker"),
  };

  const formId = `approve-${user.id}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("approveTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            {t("approve")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <p className="break-words text-ui-text-muted">
          {user.name} · {user.email}
        </p>

        {error && (
          <p role="alert" className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-4 py-3 text-ui-danger">
            {error}
          </p>
        )}

        <Field label={t("flatLabel")}>
          <Select value={flatId} onChange={(e) => setFlatId(e.target.value)}>
            <option value="">{t("noFlatOption")}</option>
            {units.map((f) => (
              <option key={f.id} value={f.id}>
                {f.entranceName ? `${f.entranceName} — ` : ""}
                {f.flatNumber}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("roleLabel")}>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}
