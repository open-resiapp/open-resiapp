"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState, useEffect } from "react";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

interface Entrance {
  id: string;
  name: string;
}

export default function NovaHlasovaniePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const t = useTranslations("VotingNew");
  const tCommon = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [votingType, setVotingType] = useState("written");
  const [initiatedBy, setInitiatedBy] = useState("board");
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);

  const role = (session?.user?.role || "owner") as UserRole;

  useEffect(() => {
    fetch("/api/entrances")
      .then((r) => r.json())
      .then((data) => setEntrances(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/documents/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.projects) setProjects(data.projects);
      })
      .catch(() => {});
  }, []);

  if (!hasPermission(role, "createVoting")) {
    return (
      <div className="text-center py-12 text-gray-500 text-lg dark:text-gray-400">
        {t("noPermission")}
      </div>
    );
  }

  const showRestrictionNote =
    votingType === "meeting" || initiatedBy === "owners_quarter";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/votings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        description: formData.get("description"),
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
        status: formData.get("status"),
        votingType: formData.get("votingType"),
        initiatedBy: formData.get("initiatedBy"),
        quorumType: formData.get("quorumType"),
        entranceId: formData.get("entranceId") || null,
        documentProjectId: formData.get("documentProjectId") || null,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("createFailed"));
      setLoading(false);
      return;
    }

    const voting = await res.json();
    router.push(`/voting/${voting.id}`);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/voting")}
        className="text-blue-600 hover:underline text-base mb-4 inline-block dark:text-blue-400"
      >
        &larr; {tCommon("backToList")}
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6 dark:bg-gray-800 dark:border-gray-700">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 dark:text-gray-100">
          {t("title")}
        </h1>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-base mb-4 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("titleLabel")}
            </label>
            <input
              name="title"
              required
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              placeholder={t("titlePlaceholder")}
            />
          </div>

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("descriptionLabel")}
            </label>
            <textarea
              name="description"
              rows={4}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-vertical dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              placeholder={t("descriptionPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("startsAtLabel")}
              </label>
              <input
                name="startsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("endsAtLabel")}
              </label>
              <input
                name="endsAt"
                type="datetime-local"
                required
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Voting Type */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("votingTypeLabel")}
            </label>
            <select
              name="votingType"
              value={votingType}
              onChange={(e) => setVotingType(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="written">{t("votingTypeWritten")}</option>
              <option value="meeting">{t("votingTypeMeeting")}</option>
            </select>
          </div>

          {/* Initiated By */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("initiatedByLabel")}
            </label>
            <select
              name="initiatedBy"
              value={initiatedBy}
              onChange={(e) => setInitiatedBy(e.target.value)}
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="board">{t("initiatedByBoard")}</option>
              <option value="owners_quarter">{t("initiatedByOwnersQuarter")}</option>
            </select>
          </div>

          {/* Restriction note */}
          {showRestrictionNote && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-base text-amber-800 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200">
              {votingType === "meeting"
                ? t("meetingNote")
                : t("ownersQuarterNote")}
            </div>
          )}

          {/* Quorum Type */}
          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("quorumTypeLabel")}
            </label>
            <select
              name="quorumType"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="simple_all">{t("quorumSimpleAll")}</option>
              <option value="simple_present">{t("quorumSimplePresent")}</option>
              <option value="two_thirds_all">{t("quorumTwoThirdsAll")}</option>
              <option value="all_unanimous">{t("quorumAllUnanimous")}</option>
            </select>
          </div>

          {/* Entrance scope */}
          {entrances.length > 0 && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("entranceScopeLabel")}
              </label>
              <select
                name="entranceId"
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">{t("scopeAll")}</option>
                {entrances.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
              {t("statusLabel")}
            </label>
            <select
              name="status"
              className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <option value="draft">{t("statusDraft")}</option>
              <option value="active">{t("statusActive")}</option>
            </select>
          </div>

          {projects.length > 0 && (
            <div>
              <label className="block text-base font-medium text-gray-700 mb-1 dark:text-gray-200">
                {t("projectLabel")}
              </label>
              <select
                name="documentProjectId"
                className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
              >
                <option value="">{t("noProject")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={() => router.push("/voting")}
              className="flex-1 py-3 px-4 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors dark:text-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600"
            >
              {tCommon("cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 px-4 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
            >
              {loading ? t("submitting") : t("submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
