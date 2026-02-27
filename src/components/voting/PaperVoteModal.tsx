"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { VoteChoice } from "@/types";

interface Owner {
  id: string;
  name: string;
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
  const [selectedChoice, setSelectedChoice] = useState<VoteChoice | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetch("/api/users?role=owner")
        .then((r) => r.json())
        .then((data) => setOwners(data))
        .catch(() => setOwners([]));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOwner || !selectedChoice) return;

    setLoading(true);
    setError("");

    const res = await fetch("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votingId,
        ownerId: selectedOwner,
        choice: selectedChoice,
        voteType: "paper",
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
    setSelectedChoice("");
    onRecorded();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">
            {t("title")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              {t("ownerLabel")}
            </label>
            <select
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">{t("ownerPlaceholder")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({t("flat", { number: o.flatNumber })})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-2">
              {t("voteLabel")}
            </label>
            <div className="space-y-2">
              {choiceValues.map((c) => (
                <label
                  key={c}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedChoice === c
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:bg-gray-50"
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
                  <span className="text-base font-medium">{t(choiceKeys[c])}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !selectedOwner || !selectedChoice}
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
