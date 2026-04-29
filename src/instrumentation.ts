export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { loadAllModules, callOnAppStart } = await import("@/lib/modules/loader");
  const { buildContextFor } = await import("@/lib/modules/sdk-runtime");

  try {
    const loaded = await loadAllModules();
    if (loaded.length > 0) {
      await callOnAppStart(loaded, (mod, communityRow) =>
        buildContextFor(mod, communityRow)
      );
      console.info(`[modules] loaded ${loaded.length} module(s)`);
    }
  } catch (err) {
    console.error("[modules] startup failed:", err);
  }
}
