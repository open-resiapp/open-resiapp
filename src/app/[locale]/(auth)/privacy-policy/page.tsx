import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";

export default function PrivacyPolicyPage() {
  const t = useTranslations("PrivacyPolicy");

  const sections = [
    { title: t("whatDataTitle"), content: t("whatDataContent") },
    { title: t("purposeTitle"), content: t("purposeContent") },
    { title: t("yourRightsTitle"), content: t("yourRightsContent") },
    { title: t("retentionTitle"), content: t("retentionContent") },
    { title: t("contactTitle"), content: t("contactContent") },
  ];

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{t("title")}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {t("version", { version: CURRENT_POLICY_VERSION })}
      </p>

      <div className="space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              {section.title}
            </h2>
            <p className="text-base text-gray-700 leading-relaxed">
              {section.content}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-6 border-t border-gray-200">
        <Link
          href="/login"
          className="inline-block px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-base font-medium rounded-lg transition-colors"
        >
          {t("backToLogin")}
        </Link>
      </div>
    </div>
  );
}
