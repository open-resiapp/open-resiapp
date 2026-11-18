// Client-safe, pure. Floor ("poschodie") normalisation shared by the LV
// parser and the import validator.
//
//   prízemie / p / 0              →  0
//   1, 1., 1.p, 1. posch.         →  1
//   1. NP / 2. NP                 →  0 / 1 (nadzemné podlažie: 1. NP = prízemie)
//   suterén / pivnica / PP        → -1
//   2. PP / 2PP                   → -2
//   -1                            → -1
//
// Range: FLOOR_MIN..FLOOR_MAX. Anything else → undefined (the validator
// reports it, the parser leaves the cell empty for the admin).

export const FLOOR_MIN = -5;
export const FLOOR_MAX = 60;

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseFloor(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : Math.trunc(raw);
  if (typeof raw !== "string") return undefined;
  const t = fold(raw);
  if (t === "") return undefined;
  if (t === "prizemie" || t === "p" || t === "0" || t === "np 0") return 0;
  if (t === "suteren" || t === "pivnica" || t === "pp" || t === "podzemne podlazie") return -1;
  const pp = t.match(/^(\d+)\s*\.?\s*pp$/);
  if (pp) return -Number(pp[1]);
  const np = t.match(/^(\d+)\s*\.?\s*(?:np|nadzemne podlazie)$/);
  if (np) return Math.max(0, Number(np[1]) - 1);
  const pos = t.match(/^(\d+)\s*\.?\s*(?:p|posch\.?|poschodie)?$/);
  if (pos) return Number(pos[1]);
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
