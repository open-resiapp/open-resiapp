import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
import { getRequestCommunityRoot } from "@/lib/shell.server";
import { timeZoneForCountry } from "@/lib/time-zone";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;
  // Community time zone (from the root entity's country) so server and client
  // render identical times; the host runs in UTC. getRequestCommunityRoot is
  // per-request cached (shared with the shell). Falls back to the default
  // zone when the lookup fails or no DB is reachable.
  let timeZone = timeZoneForCountry(null);
  try {
    const root = await getRequestCommunityRoot();
    timeZone = timeZoneForCountry(root?.country);
  } catch {
    // keep default
  }
  return {
    locale,
    timeZone,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
