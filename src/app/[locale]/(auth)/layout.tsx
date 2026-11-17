import { getTranslations } from "next-intl/server";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ThemeToggle from "@/components/ThemeToggle";
import { getBranding } from "@/lib/branding.server";
import { brandingAssetPath } from "@/lib/branding";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // BYT-20260512-008: resolve the instance logo SERVER-SIDE so the login page
  // paints the brand on first render — no client fetch-then-swap, no flash.
  const branding = await getBranding();
  const t = await getTranslations("Branding");
  const logoUrl = branding ? brandingAssetPath("logo", branding.branding.v) : null;

  return (
    // Switchers sit in normal flow above the content (not absolutely
    // positioned): a page taller than the viewport — e.g. the OAuth consent
    // screen on a phone — would otherwise scroll its title under them.
    <div className="min-h-dvh flex flex-col bg-gray-50 px-4 dark:bg-gray-950">
      <div className="flex items-center justify-end gap-2 pt-4">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md">
        {logoUrl && (
          // Fixed-height slot reserves space so the swap causes no layout shift.
          <div className="flex justify-center mb-6 h-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt={t("logoAlt")}
              className="h-16 w-auto max-w-[220px] object-contain"
            />
          </div>
        )}
        {children}
      </div>
      </div>
    </div>
  );
}
