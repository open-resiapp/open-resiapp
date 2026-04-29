import { listSlot } from "@/lib/modules/registry";
import type { SlotName, SlotProps } from "@/lib/modules/sdk";

import { SlotErrorBoundary } from "./SlotErrorBoundary";

interface Props extends SlotProps {
  name: SlotName;
}

export async function Slot({ name, community, member }: Props) {
  const entries = listSlot(name);
  if (entries.length === 0) return null;

  const resolved = await Promise.all(
    entries.map(async (entry) => {
      try {
        const mod = await entry.loader();
        return { moduleName: entry.moduleName, Component: mod.default };
      } catch (err) {
        console.error(
          `[modules] failed to load slot component from "${entry.moduleName}":`,
          err
        );
        return { moduleName: entry.moduleName, Component: null };
      }
    })
  );

  return (
    <>
      {resolved.map(({ moduleName, Component }) => {
        if (!Component) {
          return (
            <div
              key={moduleName}
              className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700"
            >
              <strong>{moduleName}</strong>: failed to load
            </div>
          );
        }
        return (
          <SlotErrorBoundary key={moduleName} moduleName={moduleName}>
            <Component community={community} member={member} />
          </SlotErrorBoundary>
        );
      })}
    </>
  );
}
