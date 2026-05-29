"use client";

import { useSession } from "next-auth/react";
import { useLocale, useTranslations, useFormatter } from "next-intl";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import ShellClaimDialog from "@/components/owners/ShellClaimDialog";
import ShellMergeDialog from "@/components/owners/ShellMergeDialog";

interface FlatInfo {
  flatId: string;
  flatNumber: string;
  floor: number;
  entranceId: string;
  entranceName: string;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
}

interface ShareWarning {
  flatId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

interface ShareInput {
  num: string;
  den: string;
}

interface UserDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  isShell: boolean;
  flatId: string | null;
  flats: FlatInfo[];
  flatNumber: string | null;
  floor: number | null;
  entranceId: string | null;
  entranceName: string | null;
  createdAt: string;
}

interface FlatOption {
  id: string;
  flatNumber: string;
  entranceName: string;
}

const roleKeys: Record<UserRole, string> = {
  admin: "roleAdmin",
  owner: "roleOwner",
  tenant: "roleTenant",
  vote_counter: "roleVoteCounter",
  caretaker: "roleCaretaker",
};

type ShellDialog =
  | { kind: "none" }
  | { kind: "claim"; mode: "email" | "qr" }
  | { kind: "merge" };

export default function UserDetailPage() {
  const { data: session } = useSession();
  const t = useTranslations("Owners");
  const tShell = useTranslations("Owners.pending");
  const tCommon = useTranslations("Common");
  const format = useFormatter();
  const locale = useLocale();
  const params = useParams();
  const id = params.id as string;
  const [shellDialog, setShellDialog] = useState<ShellDialog>({ kind: "none" });

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flats, setFlats] = useState<FlatOption[]>([]);

  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("owner");
  const [editFlatIds, setEditFlatIds] = useState<string[]>([]);
  const [editShares, setEditShares] = useState<Record<string, ShareInput>>({});
  const [shareWarnings, setShareWarnings] = useState<ShareWarning[]>([]);

  const router = useRouter();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const role = (session?.user?.role || "owner") as UserRole;
  const canManage = hasPermission(role, "manageUsers");

  const fetchUser = useCallback(async () => {
    const res = await fetch(`/api/users/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const data = await res.json();
      setUser(data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    async function loadFlats() {
      const res = await fetch("/api/flats");
      if (res.ok) {
        setFlats(await res.json());
      }
    }
    if (canManage) loadFlats();
  }, [canManage]);

  function startEditing() {
    if (!user) return;
    setEditName(user.name);
    setEditEmail(user.email ?? "");
    setEditPhone(user.phone || "");
    setEditRole(user.role);
    setEditFlatIds(user.flats?.map((f) => f.flatId) || []);
    setEditShares(
      Object.fromEntries(
        (user.flats || []).map((f) => [
          f.flatId,
          {
            num: String(f.ownerUnitShareNumerator),
            den: String(f.ownerUnitShareDenominator),
          },
        ])
      )
    );
    setError("");
    setEditing(true);
  }

  function toggleFlatId(flatId: string) {
    setEditFlatIds((prev) =>
      prev.includes(flatId)
        ? prev.filter((id) => id !== flatId)
        : [...prev, flatId]
    );
    // Default new selections to a sole-owner 1/1 share.
    setEditShares((prev) =>
      prev[flatId] ? prev : { ...prev, [flatId]: { num: "1", den: "1" } }
    );
  }

  function setShare(flatId: string, field: keyof ShareInput, value: string) {
    setEditShares((prev) => ({
      ...prev,
      [flatId]: {
        num: prev[flatId]?.num ?? "1",
        den: prev[flatId]?.den ?? "1",
        [field]: value,
      },
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    // Per-flat owner share, only for selected flats. Validate positive ints.
    const shares: Array<{ flatId: string; num: number; den: number }> = [];
    for (const flatId of editFlatIds) {
      const s = editShares[flatId] ?? { num: "1", den: "1" };
      const num = Number(s.num);
      const den = Number(s.den);
      if (!Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) {
        setError(t("invalidShare"));
        setSaving(false);
        return;
      }
      shares.push({ flatId, num, den });
    }

    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        email: editEmail,
        phone: editPhone || null,
        role: editRole,
        flatIds: editFlatIds,
        shares,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || tCommon("saveFailed"));
      setSaving(false);
      return;
    }

    const data = await res.json();
    setShareWarnings(data.shareWarnings ?? []);
    setSaving(false);
    setEditing(false);
    await fetchUser();
  }

  async function toggleActive() {
    if (!user) return;
    setSaving(true);

    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !user.isActive }),
    });

    if (res.ok) {
      await fetchUser();
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");

    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      if (res.status === 409) {
        setDeleteError(t("hasRelatedRecords"));
      } else {
        setDeleteError(data.error || t("deleteFailed"));
      }
      setDeleting(false);
      return;
    }

    router.push("/owners");
  }

  if (!canManage) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
        {t("noPermission")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-6 bg-gray-200 rounded w-1/4 dark:bg-gray-700" />
        <div className="h-8 bg-gray-200 rounded w-2/3 dark:bg-gray-700" />
        <div className="h-48 bg-gray-200 rounded dark:bg-gray-700" />
      </div>
    );
  }

  if (notFound || !user) {
    return (
      <div className="text-center py-12">
        <p className="text-lg text-gray-500 mb-4 dark:text-gray-400">{t("userNotFound")}</p>
        <Link href="/owners" className="text-blue-600 hover:underline text-base dark:text-blue-400">
          {tCommon("backToList")}
        </Link>
      </div>
    );
  }

  function flatDisplay() {
    if (!user?.flats || user.flats.length === 0) return tCommon("noDash");
    return user.flats
      .map((f) => {
        const base =
          f.floor !== null && f.entranceName
            ? t("flatDisplay", {
                number: f.flatNumber,
                floor: f.floor,
                entrance: f.entranceName,
              })
            : f.entranceName
              ? t("flatDisplayNoFloor", {
                  number: f.flatNumber,
                  entrance: f.entranceName,
                })
              : `${t("flatLabel")} ${f.flatNumber}`;
        const share = `${f.ownerUnitShareNumerator}/${f.ownerUnitShareDenominator}`;
        return `${base} – ${t("ownerShareLabel")} ${share}`;
      })
      .join(", ");
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/owners"
        className="text-blue-600 hover:underline text-base mb-4 inline-block dark:text-blue-400"
      >
        &larr; {tCommon("backToList")}
      </Link>

      {user.isShell && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 mb-4 dark:bg-amber-900/30 dark:border-amber-700">
          <p className="text-base font-medium text-amber-900 dark:text-amber-100 mb-1">
            {tShell("shellBannerTitle")}
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
            {tShell("shellBannerHint")}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShellDialog({ kind: "claim", mode: "email" })}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {user.email
                ? tShell("sendInvitation")
                : tShell("addEmailAndInvite")}
            </button>
            <button
              onClick={() => setShellDialog({ kind: "claim", mode: "qr" })}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100"
            >
              {tShell("showQr")}
            </button>
            <button
              onClick={() => setShellDialog({ kind: "merge" })}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {tShell("assignExisting")}
            </button>
          </div>
        </div>
      )}

      {shareWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 mb-4 dark:bg-amber-900/30 dark:border-amber-700">
          <p className="text-base font-medium text-amber-900 dark:text-amber-100 mb-1">
            {t("shareSumWarningTitle")}
          </p>
          <ul className="text-sm text-amber-800 dark:text-amber-200 list-disc ml-5">
            {shareWarnings.map((w) => (
              <li key={w.flatId}>
                {t("shareSumWarningItem", {
                  flat: w.flatNumber,
                  sum: `${w.sumNumerator}/${w.sumDenominator}`,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-6 mb-6 dark:bg-gray-800 dark:shadow-black/40">
        <div className="flex items-start justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{user.name}</h1>
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${
                user.isActive
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                  : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
              }`}
            >
              {user.isActive ? t("statusActive") : t("statusInactive")}
            </span>
          </div>
        </div>

        {!editing ? (
          <>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("emailLabel")}</dt>
                <dd className="text-base text-gray-900 dark:text-gray-100">{user.email || tCommon("noDash")}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("phoneLabel")}</dt>
                <dd className="text-base text-gray-900 dark:text-gray-100">{user.phone || tCommon("noDash")}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("roleLabel")}</dt>
                <dd className="text-base text-gray-900 dark:text-gray-100">{t(roleKeys[user.role])}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("flatsLabel")}</dt>
                <dd className="text-base text-gray-900 dark:text-gray-100">{flatDisplay()}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{t("registered")}</dt>
                <dd className="text-base text-gray-900 dark:text-gray-100">
                  {format.dateTime(new Date(user.createdAt), {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </dd>
              </div>
            </dl>

            <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={startEditing}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
              >
                {tCommon("edit")}
              </button>
              <button
                onClick={toggleActive}
                disabled={saving}
                className={`px-5 py-3 text-base font-medium rounded-lg transition-colors ${
                  user.isActive
                    ? "bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-200"
                    : "bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-200"
                }`}
              >
                {user.isActive ? t("deactivate") : t("activate")}
              </button>
              <button
                onClick={() => {
                  setDeleteError("");
                  setShowDeleteModal(true);
                }}
                className="px-5 py-3 bg-red-600 hover:bg-red-700 text-white text-base font-medium rounded-lg transition-colors"
              >
                {tCommon("delete")}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base dark:bg-red-900/30 dark:text-red-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {t("nameLabel")}
                </label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {t("emailLabel")}
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {t("phoneLabel")}
                </label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                  {t("roleLabel")}
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                >
                  <option value="owner">{t("roleOwner")}</option>
                  <option value="tenant">{t("roleTenant")}</option>
                  <option value="admin">{t("roleAdmin")}</option>
                  <option value="vote_counter">{t("roleVoteCounter")}</option>
                  <option value="caretaker">{t("roleCaretaker")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-base font-medium text-gray-700 mb-2 dark:text-gray-200">
                {t("flatsLabel")}
              </label>
              <div className="border border-gray-300 rounded-lg max-h-60 overflow-y-auto divide-y divide-gray-100 dark:border-gray-700 dark:divide-gray-700">
                {flats.length === 0 ? (
                  <p className="px-4 py-3 text-base text-gray-500 dark:text-gray-400">{t("noFlat")}</p>
                ) : (
                  flats.map((f) => {
                    const checked = editFlatIds.includes(f.id);
                    const share = editShares[f.id] ?? { num: "1", den: "1" };
                    return (
                      <div key={f.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFlatId(f.id)}
                            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900"
                          />
                          <span className="text-base text-gray-900 dark:text-gray-100">
                            {t("flatLabel")} {f.flatNumber} ({f.entranceName})
                          </span>
                        </label>
                        {checked && (
                          <div className="mt-2 ml-8 flex items-center gap-2">
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {t("ownerShareLabel")}
                            </span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={share.num}
                              onChange={(e) => setShare(f.id, "num", e.target.value)}
                              aria-label={t("shareNumeratorLabel")}
                              className="w-16 px-2 py-1 text-base text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                            />
                            <span className="text-gray-500 dark:text-gray-400">/</span>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={share.den}
                              onChange={(e) => setShare(f.id, "den", e.target.value)}
                              aria-label={t("shareDenominatorLabel")}
                              className="w-16 px-2 py-1 text-base text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                {tCommon("cancel")}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {saving ? tCommon("saving") : tCommon("save")}
              </button>
            </div>
          </form>
        )}
      </div>

      {shellDialog.kind === "claim" && (
        <ShellClaimDialog
          shellId={user.id}
          shellName={user.name}
          existingEmail={user.email}
          mode={shellDialog.mode}
          locale={locale}
          onClose={() => {
            setShellDialog({ kind: "none" });
            fetchUser();
          }}
        />
      )}

      {shellDialog.kind === "merge" && (
        <ShellMergeDialog
          shellId={user.id}
          shellName={user.name}
          onClose={() => {
            setShellDialog({ kind: "none" });
            fetchUser();
          }}
        />
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-sm p-6 max-w-md w-full dark:bg-gray-800 dark:shadow-black/40">
            <h2 className="text-xl font-bold text-gray-900 mb-2 dark:text-gray-100">
              {t("deleteUser")}
            </h2>
            <p className="text-base text-gray-600 mb-1 dark:text-gray-300">
              {t("confirmDeleteUser", { name: user.name })}
            </p>
            <p className="text-sm text-red-600 mb-4 dark:text-red-400">
              {t("deleteWarning")}
            </p>

            {deleteError && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
                {deleteError}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-5 py-3 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                {tCommon("cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-5 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-base font-medium rounded-lg transition-colors"
              >
                {deleting ? tCommon("loading") : tCommon("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
