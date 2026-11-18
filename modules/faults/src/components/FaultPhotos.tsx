import { getTranslations } from "next-intl/server";

// Photo grid. Images come ONLY from the visibility-checked
// /api/modules/faults/photos/[id] route. Server component.

export async function FaultPhotos({ photos }: { photos: { id: string }[] }) {
  if (photos.length === 0) return null;
  const t = await getTranslations("Faults");
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {photos.map((p, i) => (
        <li key={p.id}>
          <a href={`/api/modules/faults/photos/${p.id}`} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- auth-gated proxy route, not optimisable */}
            <img
              src={`/api/modules/faults/photos/${p.id}`}
              alt={t("detail.photoAlt", { n: i + 1 })}
              loading="lazy"
              className="aspect-square w-full rounded-lg border border-ui-border object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}
