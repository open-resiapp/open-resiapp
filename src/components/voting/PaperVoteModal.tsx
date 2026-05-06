"use client";

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { VoteChoice } from "@/types";

interface Owner {
  id: string;
  name: string;
  flatNumber: string;
}

interface OwnerFlat {
  flatId: string;
  flatNumber: string;
}

interface PaperVoteModalProps {
  isOpen: boolean;
  votingId: string;
  onClose: () => void;
  onRecorded: () => void;
}

const choiceValues: VoteChoice[] = ["za", "proti", "zdrzal_sa"];
const choiceKeys: Record<VoteChoice, string> = {
  za: "for",
  proti: "against",
  zdrzal_sa: "abstain",
};

export default function PaperVoteModal({
  isOpen,
  votingId,
  onClose,
  onRecorded,
}: PaperVoteModalProps) {
  const t = useTranslations("PaperVote");
  const tCommon = useTranslations("Common");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("");
  const [ownerFlats, setOwnerFlats] = useState<OwnerFlat[]>([]);
  const [selectedFlat, setSelectedFlat] = useState("");
  const [selectedChoice, setSelectedChoice] = useState<VoteChoice | "">("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/users?role=owner")
        .then((r) => r.json())
        .then((data) => setOwners(data))
        .catch(() => setOwners([]));
    }
  }, [isOpen]);

  // Fetch flats when owner is selected
  useEffect(() => {
    if (selectedOwner) {
      fetch(`/api/flats?userId=${selectedOwner}`)
        .then((r) => r.json())
        .then((data: OwnerFlat[]) => {
          setOwnerFlats(data);
          if (data.length === 1) {
            setSelectedFlat(data[0].flatId);
          } else {
            setSelectedFlat("");
          }
        })
        .catch(() => setOwnerFlats([]));
    } else {
      setOwnerFlats([]);
      setSelectedFlat("");
    }
  }, [selectedOwner]);

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  if (!isOpen) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    } else {
      setPhotoFile(null);
      setPhotoPreview(null);
    }
  }

  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOwner || !selectedChoice || !selectedFlat) return;

    setLoading(true);
    setError("");

    let paperPhotoUrl: string | null = null;

    // Upload photo first if present
    if (photoFile) {
      const formData = new FormData();
      formData.append("file", photoFile);
      formData.append("category", "paper-votes");

      const uploadRes = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        setError(t("uploadFailed"));
        setLoading(false);
        return;
      }

      const uploadData = await uploadRes.json();
      paperPhotoUrl = uploadData.url;
    }

    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votingId,
        ownerId: selectedOwner,
        flatId: selectedFlat,
        choice: selectedChoice,
        voteType: "paper",
        paperPhotoUrl,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("submitFailed"));
      setLoading(false);
      return;
    }

    setLoading(false);
    setSelectedOwner("");
    setSelectedFlat("");
    setSelectedChoice("");
    setPhotoFile(null);
    setPhotoPreview(null);
    onRecorded();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("title")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none dark:text-gray-400 dark:hover:text-gray-200"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("ownerLabel")}
            </label>
            <select
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="">{t("ownerPlaceholder")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({t("flat", { number: o.flatNumber })})
                </option>
              ))}
            </select>
          </div>

          {ownerFlats.length > 1 && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("flatLabel")}
              </label>
              <select
                value={selectedFlat}
                onChange={(e) => setSelectedFlat(e.target.value)}
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">{t("flatPlaceholder")}</option>
                {ownerFlats.map((f) => (
                  <option key={f.flatId} value={f.flatId}>
                    {t("flat", { number: f.flatNumber })}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-2 dark:text-gray-200">
              {t("voteLabel")}
            </label>
            <div className="space-y-2">
              {choiceValues.map((c) => (
                <label
                  key={c}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedChoice === c
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                      : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="choice"
                    value={c}
                    checked={selectedChoice === c}
                    onChange={(e) =>
                      setSelectedChoice(e.target.value as VoteChoice)
                    }
                    className="w-5 h-5 text-blue-600"
                  />
                  <span className="text-base font-medium dark:text-gray-100">{t(choiceKeys[c])}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Photo upload */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("photoLabel")}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="w-full text-base text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-base file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-200 dark:file:bg-blue-900/40 dark:file:text-blue-200 dark:hover:file:bg-blue-900/60"
            />
            {photoPreview && (
              <div className="mt-2 relative inline-block">
                <img
                  src={photoPreview}
                  alt="Preview"
                  className="max-h-40 rounded-lg border border-gray-200 dark:border-gray-700"
                />
                <button
                  type="button"
                  onClick={removePhoto}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600"
                >
                  &times;
                </button>
              </div>
            )}
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
              disabled={loading || !selectedOwner || !selectedChoice || !selectedFlat}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? tCommon("saving") : t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
