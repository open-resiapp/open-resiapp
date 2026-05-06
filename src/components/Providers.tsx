"use client";

import { SessionProvider } from "next-auth/react";
import ThemeProvider from "@/components/ThemeProvider";
import type { Theme } from "@/lib/theme";

export default function Providers({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
    </SessionProvider>
  );
}
