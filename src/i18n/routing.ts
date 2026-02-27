import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["sk", "en"],
  defaultLocale: (process.env.LANGUAGE as "sk" | "en") || "sk",
});
