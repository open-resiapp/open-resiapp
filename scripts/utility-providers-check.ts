/**
 * `pnpm test:utility-providers` — BYT-20261118-008. Self-contained tsx, NO database.
 * Entry shape + staleness (>400 days since verifiedAt fails).
 */
import {
  STALE_AFTER_DAYS,
  UTILITY_TYPES,
  isValidTel,
  listProviders,
  resolveProviderCountry,
} from "@/lib/utility-providers";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const now = Date.now();
for (const country of ["sk", "cz"] as const) {
  console.log(`providers ${country}`);
  const ids = new Set<string>();
  for (const p of listProviders(country)) {
    check(`${p.id} unique id`, !ids.has(p.id));
    ids.add(p.id);
    check(`${p.id} name`, p.name.trim().length > 0);
    check(`${p.id} utility`, (UTILITY_TYPES as readonly string[]).includes(p.utility));
    check(`${p.id} https url`, p.outageUrl.startsWith("https://"), p.outageUrl);
    check(`${p.id} hotline`, p.hotline === null || isValidTel(p.hotline), String(p.hotline));
    const age = (now - new Date(`${p.verifiedAt}T00:00:00Z`).getTime()) / 86_400_000;
    check(`${p.id} verifiedAt fresh`, age >= 0 && age <= STALE_AFTER_DAYS, p.verifiedAt);
  }
}
check("cz has no SK ids", listProviders("cz").every((p) => !p.id.startsWith("sk-")));
check("missing country → sk", resolveProviderCountry(undefined) === "sk");
check("cz → cz", resolveProviderCountry("cz") === "cz");

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
