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

interface VotingItemRow {
  id: string;
  idx: number;
  title: string;
  description: string | null;
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
  const [items, setItems] = useState<VotingItemRow[]>([]);
  // BYT-20260609-008: per-item choices for the transcribed paper ballot.
  const [choices, setChoices] = useState<Record<string, VoteChoice>>({});
  // Multiple photos (multi-page paper ballot).
  const [photos, setPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/users?role=owner")
      .then((r) => r.json())
      .then((data) => setOwners(data))
      .catch(() => setOwners([]));
    fetch(`/api/votings/${votingId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setItems(d?.items ?? []))
      .catch(() => setItems([]));
  }, [isOpen, votingId]);

  // Fetch the owner's flats when an owner is picked.
  useEffect(() => {
    if (selectedOwner) {
      fetch(`/api/flats?userId=${selectedOwner}`)
        .then((r) => r.json())
        .then((data: OwnerFlat[]) => {
          setOwnerFlats(data);
          setSelectedFlat(data.length === 1 ? data[0].flatId : "");
        })
        .catch(() => setOwnerFlats([]));
    } else {
      setOwnerFlats([]);
      setSelectedFlat("");
    }
  }, [selectedOwner]);

  // Revoke any outstanding object URLs when the component truly unmounts.
  useEffect(
    () => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)),
    []
  );

  if (!isOpen) return null;

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPhotos((prev) => [
      ...prev,
      ...files.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
    // Allow selecting the same file again after removal.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(i: number) {
    setPhotos((prev) => {
      const target = prev[i];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  function setChoice(itemId: string, choice: VoteChoice) {
    setChoices((prev) => ({ ...prev, [itemId]: choice }));
  }

  function bulkSetRemaining(choice: VoteChoice) {
    setChoices((prev) => {
      const next = { ...prev };
      for (const item of items) if (!next[item.id]) next[item.id] = choice;
      return next;
    });
  }

  function resetForm() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setSelectedOwner("");
    setSelectedFlat("");
    setChoices({});
    setPhotos([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOwner || !selectedFlat) return;
    if (photos.length === 0) {
      setError(t("photoRequired"));
      return;
    }

    setLoading(true);
    setError("");

    // Upload every photo, collect the returned URLs.
    const photoUrls: string[] = [];
    for (const p of photos) {
      const formData = new FormData();
      formData.append("file", p.file);
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
      photoUrls.push(uploadData.url);
    }

    const items_ = Object.entries(choices).map(([itemId, choice]) => ({
      itemId,
      choice,
    }));

    const res = await fetch("/api/ballots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votingId,
        ownerId: selectedOwner,
        flatId: selectedFlat,
        voteType: "paper",
        items: items_,
        photoUrls,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = data.error;
      setError(
        code === "PAPER_PHOTO_REQUIRED" ? t("photoRequired") : code || t("submitFailed")
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    resetForm();
    onRecorded();
  }

  const remaining = items.length - Object.keys(choices).length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto dark:bg-gray-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h2>
          <button
            onClick={handleClose}
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

          {/* Per-item choices */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-2 dark:text-gray-200">
              {t("itemsLabel")}
            </label>
            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id}>
                  <p className="text-sm font-semibold text-gray-800 mb-1 dark:text-gray-200">
                    {item.idx + 1}. {item.title}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {choiceValues.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setChoice(item.id, c)}
                        className={`px-2 py-2 text-sm font-medium rounded-lg border transition-colors ${
                          choices[item.id] === c
                            ? "border-blue-500 bg-blue-600 text-white"
                            : "border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {t(choiceKeys[c])}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {items.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500 mb-2 dark:text-gray-400">
                  {t("setRemainingLabel")}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {choiceValues.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={remaining === 0}
                      onClick={() => bulkSetRemaining(c)}
                      className="px-2 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-700 dark:text-gray-200"
                    >
                      {t(choiceKeys[c])}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Photo upload (multiple) */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("photosLabel")}
            </label>
            <p className="text-sm text-gray-500 mb-2 dark:text-gray-400">{t("photosHelp")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleFilesChange}
              className="w-full text-base text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-base file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:text-gray-200 dark:file:bg-blue-900/40 dark:file:text-blue-200 dark:hover:file:bg-blue-900/60"
            />
            {photos.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img
                      src={p.preview}
                      alt={`Paper ${i + 1}`}
                      className="w-full h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm flex items-center justify-center hover:bg-red-600"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !selectedOwner || !selectedFlat || photos.length === 0}
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
