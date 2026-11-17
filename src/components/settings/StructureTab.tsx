"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingBlock } from "@/components/ui";
import EntrancesTab, { type Entrance } from "./EntrancesTab";
import FlatsTab, { type FlatRow } from "./FlatsTab";

interface StructureTabProps {
  canEdit: boolean;
}

/**
 * "Budova a byty": entrances + flats. One fetch of each list, shared by both
 * sections (previously each section fetched /api/entrances on its own).
 */
export default function StructureTab({ canEdit }: StructureTabProps) {
  const [entrances, setEntrances] = useState<Entrance[]>([]);
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [flatsRes, entrancesRes] = await Promise.all([fetch("/api/flats"), fetch("/api/entrances")]);
      if (flatsRes.ok) setFlats(await flatsRes.json());
      if (entrancesRes.ok) setEntrances(await entrancesRes.json());
    } catch {
      /* keep what we have */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingBlock />;

  return (
    <div className="space-y-10">
      <EntrancesTab canEdit={canEdit} entrances={entrances} onChanged={load} />
      <FlatsTab canEdit={canEdit} flats={flats} entrances={entrances} onChanged={load} />
    </div>
  );
}
