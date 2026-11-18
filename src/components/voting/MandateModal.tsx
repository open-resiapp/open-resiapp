"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

interface Flat {
  id: string;
  flatNumber: string;
  entranceName: string | null;
}

interface Owner {
  id: string;
  name: string;
  flatNumber: string;
}

interface FlatOwner {
  flatId: string;
  flatNumber: string;
  userId: string;
  userName: string;
}

interface MandateModalProps {
  isOpen: boolean;
  votingId: string;
  currentUserId: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function MandateModal({
  isOpen,
  votingId,
  currentUserId,
  onClose,
  onCreated,
}: MandateModalProps) {
  const t = useTranslations("Mandate");
  const tCommon = useTranslations("Common");
  const [allFlats, setAllFlats] = useState<Flat[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selectedFlat, setSelectedFlat] = useState("");
  const [flatOwnerName, setFlatOwnerName] = useState("");
  const [flatOwnerId, setFlatOwnerId] = useState("");
  const [selectedToOwner, setSelectedToOwner] = useState("");
  // §14 ods. 4: the proxy may be any person — an owner account or someone
  // without an account (external proxy, stored on the mandate).
  const [proxyKind, setProxyKind] = useState<"owner" | "external">("owner");
  const [proxyName, setProxyName] = useState("");
  const [proxyBirthDate, setProxyBirthDate] = useState("");
  const [proxyAddress, setProxyAddress] = useState("");
  const [proxyNote, setProxyNote] = useState("");
  const [paperConfirmed, setPaperConfirmed] = useState(false);
  const [verificationNote, setVerificationNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      // Fetch all flats
      fetch("/api/flats")
        .then((r) => r.json())
        .then((data: Flat[]) => setAllFlats(data))
        .catch(() => setAllFlats([]));

      // Fetch all owners
      fetch("/api/users?role=owner")
        .then((r) => r.json())
        .then((data: Owner[]) => setOwners(Array.isArray(data) ? data.filter((o) => o.flatNumber) : []))
        .catch(() => setOwners([]));
    }
  }, [isOpen]);

  // When flat is selected, find the owner via memberships at the flat entity
  useEffect(() => {
    if (selectedFlat) {
      fetch(`/api/flats/${selectedFlat}/owners`)
        .then((r) => r.json())
        .then((data: { userId: string; userName: string }[]) => {
          if (data.length > 0) {
            setFlatOwnerId(data[0].userId);
            setFlatOwnerName(data.map((o) => o.userName).join(", "));
          } else {
            setFlatOwnerId("");
            setFlatOwnerName("—");
          }
        })
        .catch(() => {
          setFlatOwnerId("");
          setFlatOwnerName("—");
        });
    } else {
      setFlatOwnerId("");
      setFlatOwnerName("");
    }
  }, [selectedFlat]);

  if (!isOpen) return null;

  const proxyReady = proxyKind === "owner" ? Boolean(selectedToOwner) : Boolean(proxyName.trim());

  function errorText(code: unknown): string {
    const key = `errors.${String(code ?? "")}`;
    return typeof code === "string" && t.has(key) ? t(key as never) : t("submitFailed");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFlat || !flatOwnerId || !proxyReady || !paperConfirmed) return;

    setLoading(true);
    setError("");

    const res = await fetch("/api/mandates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votingId,
        fromFlatId: selectedFlat,
        fromOwnerId: flatOwnerId,
        ...(proxyKind === "owner"
          ? { toOwnerId: selectedToOwner }
          : {
              proxy: {
                name: proxyName.trim(),
                birthDate: proxyBirthDate || null,
                address: proxyAddress.trim() || null,
                note: proxyNote.trim() || null,
              },
            }),
        paperDocumentConfirmed: true,
        verificationNote: verificationNote || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(errorText(data.error));
      setLoading(false);
      return;
    }

    setLoading(false);
    setSelectedFlat("");
    setSelectedToOwner("");
    setProxyKind("owner");
    setProxyName("");
    setProxyBirthDate("");
    setProxyAddress("");
    setProxyNote("");
    setPaperConfirmed(false);
    setVerificationNote("");
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none dark:text-gray-400 dark:hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        <p className="text-base text-gray-600 mb-4 dark:text-gray-300">
          {t("description")}
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Select flat being delegated */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("fromFlatLabel")}
            </label>
            <select
              value={selectedFlat}
              onChange={(e) => setSelectedFlat(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="">{t("fromFlatPlaceholder")}</option>
              {allFlats.map((f) => (
                <option key={f.id} value={f.id}>
                  {t("flat", { number: f.flatNumber })}
                  {f.entranceName ? ` (${f.entranceName})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Show owner of selected flat */}
          {flatOwnerName && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("fromOwnerLabel")}
              </label>
              <div className="px-4 py-3 text-base bg-gray-50 border border-gray-200 rounded-lg text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-200">
                {flatOwnerName}
              </div>
            </div>
          )}

          {/* Proxy kind — explicit per-state buttons */}
          <fieldset>
            <legend className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("delegateToLabel")}
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(["owner", "external"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={proxyKind === k}
                  onClick={() => setProxyKind(k)}
                  className={`min-h-11 rounded-lg border px-4 py-2 text-base font-medium transition-colors ${
                    proxyKind === k
                      ? "border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-600 dark:bg-blue-900/40 dark:text-blue-100"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700/50"
                  }`}
                >
                  {t(k === "owner" ? "proxyKindOwner" : "proxyKindExternal")}
                </button>
              ))}
            </div>
          </fieldset>

          {proxyKind === "owner" ? (
            <div>
              <label
                htmlFor="mandate-to-owner"
                className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200"
              >
                {t("proxyOwnerLabel")}
              </label>
              <select
                id="mandate-to-owner"
                value={selectedToOwner}
                onChange={(e) => setSelectedToOwner(e.target.value)}
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">{t("ownerPlaceholder")}</option>
                {owners
                  .filter((o) => o.id !== flatOwnerId)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({t("flat", { number: o.flatNumber })})
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-base text-gray-600 dark:text-gray-300">{t("proxyExternalHint")}</p>
              <div>
                <label
                  htmlFor="mandate-proxy-name"
                  className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200"
                >
                  {t("proxyNameLabel")}
                </label>
                <input
                  id="mandate-proxy-name"
                  value={proxyName}
                  onChange={(e) => setProxyName(e.target.value)}
                  required
                  maxLength={255}
                  autoComplete="off"
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="mandate-proxy-birth"
                  className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200"
                >
                  {t("proxyBirthDateLabel")}
                </label>
                <input
                  id="mandate-proxy-birth"
                  type="date"
                  value={proxyBirthDate}
                  onChange={(e) => setProxyBirthDate(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="mandate-proxy-address"
                  className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200"
                >
                  {t("proxyAddressLabel")}
                </label>
                <input
                  id="mandate-proxy-address"
                  value={proxyAddress}
                  onChange={(e) => setProxyAddress(e.target.value)}
                  maxLength={500}
                  autoComplete="off"
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label
                  htmlFor="mandate-proxy-note"
                  className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200"
                >
                  {t("proxyNoteLabel")}
                </label>
                <textarea
                  id="mandate-proxy-note"
                  value={proxyNote}
                  onChange={(e) => setProxyNote(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
                />
              </div>
            </div>
          )}

          {/* Paper document confirmation */}
          <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50">
            <input
              type="checkbox"
              checked={paperConfirmed}
              onChange={(e) => setPaperConfirmed(e.target.checked)}
              required
              className="w-5 h-5 mt-0.5 text-blue-600 rounded dark:border-gray-600 dark:bg-gray-900"
            />
            <span className="text-base text-gray-700 dark:text-gray-200">
              {t("paperDocumentLabel")}
            </span>
          </label>

          {/* Verification note */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("verificationNoteLabel")}
            </label>
            <textarea
              value={verificationNote}
              onChange={(e) => setVerificationNote(e.target.value)}
              rows={2}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !selectedFlat || !proxyReady || !paperConfirmed}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? tCommon("saving") : tCommon("confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
