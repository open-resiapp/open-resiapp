"use client";

import { useTranslations } from "next-intl";
import type { VoteChoice } from "@/types";

const choiceKeys: Record<VoteChoice, string> = {
  za: "for",
  proti: "against",
  zdrzal_sa: "abstain",
};

const choiceGlyphs: Record<VoteChoice, string> = {
  za: "✓",
  proti: "✕",
  zdrzal_sa: "○",
};

const choiceStyles: Record<
  VoteChoice,
  { hoverBg: string; activeBg: string; activeText: string; glyph: string }
> = {
  za: {
    hoverBg: "hover:bg-green-600 hover:text-white",
    activeBg: "bg-green-600 text-white",
    activeText: "text-green-700 dark:text-green-200",
    glyph: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200",
  },
  proti: {
    hoverBg: "hover:bg-red-600 hover:text-white",
    activeBg: "bg-red-600 text-white",
    activeText: "text-red-700 dark:text-red-200",
    glyph: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  },
  zdrzal_sa: {
    hoverBg: "hover:bg-gray-500 hover:text-white",
    activeBg: "bg-gray-500 text-white",
    activeText: "text-gray-700 dark:text-gray-200",
    glyph: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
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
  const t = useTranslations("VoteButton");
  const config = choiceStyles[choice];
  const label = t(choiceKeys[choice]);

  const baseClasses =
    "group flex w-full flex-col items-center justify-center gap-2 rounded-2xl px-3 py-4 text-sm font-semibold transition-colors sm:text-base";

  let stateClasses: string;
  if (disabled) {
    stateClasses = "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-800 dark:text-gray-600";
  } else if (selected) {
    stateClasses = config.activeBg;
  } else {
    stateClasses = `bg-gray-50 dark:bg-gray-800/60 ${config.activeText} ${config.hoverBg}`;
  }

  const glyphClasses = disabled
    ? "bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
    : selected
    ? "bg-white/20 text-white"
    : `${config.glyph} group-hover:bg-white/20 group-hover:text-white`;

  return (
    <button
      onClick={() => onClick(choice)}
      disabled={disabled}
      className={`${baseClasses} ${stateClasses}`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-bold transition-colors ${glyphClasses}`}
      >
        {choiceGlyphs[choice]}
      </span>
      <span>{label}</span>
    </button>
  );
}
