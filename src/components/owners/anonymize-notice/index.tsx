"use client";

import AnonymizeNoticeCz from "./cz";
import AnonymizeNoticeSk from "./sk";

/** Picks the country template module; the two texts are never merged. */
export function AnonymizeNotice({ country }: { country: "sk" | "cz" }) {
  return country === "cz" ? <AnonymizeNoticeCz /> : <AnonymizeNoticeSk />;
}
