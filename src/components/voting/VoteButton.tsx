"use client";

import type { VoteChoice } from "@/types";

const choiceConfig: Record<
  VoteChoice,
  { label: string; bg: string; hoverBg: string; activeBg: string }
> = {
  za: {
    label: "ZA",
    bg: "bg-green-600",
    hoverBg: "hover:bg-green-700",
    activeBg: "bg-green-700 ring-4 ring-green-200",
  },
  proti: {
    label: "PROTI",
    bg: "bg-red-600",
    hoverBg: "hover:bg-red-700",
    activeBg: "bg-red-700 ring-4 ring-red-200",
  },
  zdrzal_sa: {
    label: "ZDRŽIAM SA",
    bg: "bg-gray-500",
    hoverBg: "hover:bg-gray-600",
    activeBg: "bg-gray-600 ring-4 ring-gray-200",
  },
};

interface VoteButtonProps {
  choice: VoteChoice;
  selected?: boolean;
  disabled?: boolean;
  onClick: (choice: VoteChoice) => void;
}

export default function VoteButton({
  choice,
  selected,
  disabled,
  onClick,
}: VoteButtonProps) {
  const config = choiceConfig[choice];

  return (
    <button
      onClick={() => onClick(choice)}
      disabled={disabled}
      className={`w-full py-4 px-6 text-xl font-bold text-white rounded-xl transition-all ${
        selected
          ? config.activeBg
          : disabled
          ? "bg-gray-300 cursor-not-allowed"
          : `${config.bg} ${config.hoverBg}`
      }`}
    >
      {selected ? `${config.label} ✓` : config.label}
    </button>
  );
}
