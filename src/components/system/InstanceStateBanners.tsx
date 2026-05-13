import { getTranslations } from "next-intl/server";

import { isReadonly } from "@/lib/readonly";

/**
 * Server-rendered banner stack for instance-state flags read from env at
 * request time. Surfaces:
 *
 *   - `IS_SANDBOX=true`  → "DEMO instance" banner (BYT-20260513-001)
 *   - `IS_READONLY=true` → "trial expired, read-only" banner (BYT-20260513-004)
 *
 * Both env flags are cloud-only — self-hosted users leave them unset and
 * see nothing. Rendered in the locale layout so the banner paints on first
 * SSR pass without any flash. Showing both stacked is intentional: a sandbox
 * whose trial just expired should still read "DEMO" too.
 */
export default async function InstanceStateBanners() {
  const sandbox = process.env.IS_SANDBOX === "true";
  const readonly = isReadonly();
  if (!sandbox && !readonly) return null;

  const [tSandbox, tReadonly] = await Promise.all([
    sandbox ? getTranslations("Sandbox") : Promise.resolve(null),
    readonly ? getTranslations("Readonly") : Promise.resolve(null),
  ]);

  return (
    <>
      {sandbox && tSandbox && (
        <div
          role="status"
          className="bg-indigo-100 dark:bg-indigo-950 border-b border-indigo-300 dark:border-indigo-800 px-4 py-2 text-sm text-indigo-900 dark:text-indigo-100 text-center"
        >
          <strong className="font-semibold">{tSandbox("bannerTitle")}</strong>{" "}
          <span>{tSandbox("bannerBody")}</span>
        </div>
      )}
      {readonly && tReadonly && (
        <div
          role="status"
          className="bg-amber-100 dark:bg-amber-950 border-b border-amber-300 dark:border-amber-800 px-4 py-2 text-sm text-amber-900 dark:text-amber-100 text-center"
        >
          <strong className="font-semibold">{tReadonly("bannerTitle")}</strong>{" "}
          <span>{tReadonly("bannerBody")}</span>
          {process.env.CLOUD_PROMOTE_URL ? (
            <>
              {" "}
              <a
                href={process.env.CLOUD_PROMOTE_URL}
                className="font-semibold underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-200"
                rel="noopener noreferrer"
              >
                {tReadonly("bannerCta")}
              </a>
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
