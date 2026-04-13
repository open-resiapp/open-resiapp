import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["sk", "en", "cs"],
  defaultLocale: (process.env.LANGUAGE as "sk" | "en" | "cs") || "sk",
});
