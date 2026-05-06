import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import Providers from "@/components/Providers";
import { getThemeFromCookie } from "@/lib/theme.server";

// Pre-paint script: reads `theme` cookie and applies the resolved class to
// <html> before the browser paints. Idempotent — only touches the class list
// when the desired class is missing, so a server-rendered explicit choice
// passes through untouched and avoids any flash.
const themeBootstrap = `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=m?decodeURIComponent(m[1]):"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var w=d?"dark":"light";var c=document.documentElement.classList;if(!c.contains(w)){c.remove("light","dark");c.add(w);}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "OpenResiApp",
  description: "Správa bytového spoločenstva",
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/api/manifest",
};

// Next.js 16: themeColor moved out of metadata to viewport export.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [messages, theme] = await Promise.all([
    getMessages(),
    getThemeFromCookie(),
  ]);

  // Server can paint the explicit choice immediately; "system" is resolved
  // by the bootstrap script below before first paint.
  const initialClass = theme === "dark" ? "dark" : theme === "light" ? "light" : undefined;

  return (
    <html lang={locale} className={initialClass} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>
          <Providers initialTheme={theme}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
