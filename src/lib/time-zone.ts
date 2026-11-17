// IANA time zone of a community, derived from its country (the root entity's
// `data.country`). Server code (e-mails) formats times with it instead of
// the server's own time zone, which is UTC on most hosts.
import type { Country } from "@/types";

const TIME_ZONE_BY_COUNTRY: Record<Country, string> = {
  sk: "Europe/Bratislava",
  cz: "Europe/Prague",
};

export function timeZoneForCountry(country: Country | null | undefined): string {
  return (country && TIME_ZONE_BY_COUNTRY[country]) || TIME_ZONE_BY_COUNTRY.sk;
}
