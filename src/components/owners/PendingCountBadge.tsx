"use client";

import { useEffect, useState } from "react";

export default function PendingCountBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/registrations/pending")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setCount(data.verified.length);
      })
      .catch(() => {});
  }, []);

  if (count === null || count === 0) return null;

  return (
    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 text-xs font-bold bg-white/20 rounded-full">
      {count > 99 ? "99+" : count}
    </span>
  );
}
