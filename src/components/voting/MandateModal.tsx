"use client";

import { useState, useEffect } from "react";

interface Owner {
  id: string;
  name: string;
  flatNumber: string;
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
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetch("/api/users?role=owner")
        .then((r) => r.json())
        .then((data: Owner[]) =>
          setOwners(data.filter((o) => o.id !== currentUserId))
        )
        .catch(() => setOwners([]));
    }
  }, [isOpen, currentUserId]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOwner) return;

    setLoading(true);
    setError("");

    const res = await fetch("/api/mandates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votingId,
        toOwnerId: selectedOwner,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Nepodarilo sa vytvoriť splnomocnenie");
      setLoading(false);
      return;
    }

    setLoading(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Splnomocnenie</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        <p className="text-base text-gray-600 mb-4">
          Delegujte svoj hlas inému vlastníkovi pre toto hlasovanie.
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1">
              Delegovať na
            </label>
            <select
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            >
              <option value="">Vyberte vlastníka</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (byt {o.flatNumber})
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={loading || !selectedOwner}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? "Ukladám..." : "Potvrdiť"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
