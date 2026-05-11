// Exact rational arithmetic on BigInt numerator/denominator pairs.
// Shared by:
//  - BYT-20260508-003 (easy-import) for share-sum validation and
//    membership.weight derivation.
//  - BYT-20260511-001 (multi-owner voting) for tie-exact comparison
//    of co-owner unit shares in the resolution engine.

export interface Rational {
  num: bigint;
  den: bigint;
}

export function rational(num: bigint | number, den: bigint | number = 1n): Rational {
  const n = typeof num === "bigint" ? num : BigInt(num);
  const d = typeof den === "bigint" ? den : BigInt(den);
  if (d === 0n) throw new Error("Rational denominator must be non-zero");
  return reduce({ num: n, den: d });
}

export const ZERO: Rational = { num: 0n, den: 1n };
export const ONE: Rational = { num: 1n, den: 1n };

export function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcd(a, b)) * b;
}

export function reduce(r: Rational): Rational {
  if (r.num === 0n) return { num: 0n, den: 1n };
  const g = gcd(r.num, r.den);
  let num = r.num / g;
  let den = r.den / g;
  // Canonical sign: denominator always positive.
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  return { num, den };
}

export function add(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den + b.num * a.den, den: a.den * b.den });
}

export function sub(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.den - b.num * a.den, den: a.den * b.den });
}

export function mul(a: Rational, b: Rational): Rational {
  return reduce({ num: a.num * b.num, den: a.den * b.den });
}

export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new Error("Rational division by zero");
  return reduce({ num: a.num * b.den, den: a.den * b.num });
}

/** Sum a list of rationals; returns ZERO for an empty list. */
export function sum(list: Rational[]): Rational {
  let acc: Rational = ZERO;
  for (const r of list) acc = add(acc, r);
  return acc;
}

/** Compare two rationals. Returns -1, 0, or 1. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const lhs = a.num * b.den;
  const rhs = b.num * a.den;
  // Both denominators are positive after reduce, so the sign of (lhs - rhs)
  // matches the sign of (a - b).
  if (lhs < rhs) return -1;
  if (lhs > rhs) return 1;
  return 0;
}

export function eq(a: Rational, b: Rational): boolean {
  return compare(a, b) === 0;
}

export function lt(a: Rational, b: Rational): boolean {
  return compare(a, b) === -1;
}

export function gt(a: Rational, b: Rational): boolean {
  return compare(a, b) === 1;
}

export function isZero(r: Rational): boolean {
  return r.num === 0n;
}

export function isOne(r: Rational): boolean {
  return r.num === r.den;
}

export function toFloat(r: Rational): number {
  // Adequate for percent display; never used for tie comparisons.
  return Number(r.num) / Number(r.den);
}

export function toString(r: Rational): string {
  const reduced = reduce(r);
  return `${reduced.num}/${reduced.den}`;
}

/**
 * Parse a human-typed share into an exact rational. Accepts:
 *   - "1/96", "5614/100000"        (fraction)
 *   - "5,614/100000", "5.614/100000" (decimal numerator with comma or dot)
 *   - "0.01042", "0,01042"          (decimal value)
 *   - "1.042%", "1,042 %"           (percent)
 *   - "5"                           (bare integer → n/1)
 * Returns null if the input is not parseable.
 */
export function parseShare(input: string): Rational | null {
  const raw = input.trim();
  if (raw === "") return null;

  // Percent form
  const percentMatch = raw.match(/^([\d.,]+)\s*%$/);
  if (percentMatch) {
    const dec = parseDecimalToRational(percentMatch[1]);
    if (!dec) return null;
    return reduce({ num: dec.num, den: dec.den * 100n });
  }

  // Fraction form: <num>/<den>, where <num> may be decimal with , or .
  const fracMatch = raw.match(/^(-?[\d.,]+)\s*\/\s*(-?\d+)$/);
  if (fracMatch) {
    const numPart = parseDecimalToRational(fracMatch[1]);
    if (!numPart) return null;
    const den = BigInt(fracMatch[2]);
    if (den === 0n) return null;
    return reduce({ num: numPart.num, den: numPart.den * den });
  }

  // Bare decimal or integer
  return parseDecimalToRational(raw);
}

function parseDecimalToRational(input: string): Rational | null {
  const trimmed = input.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const neg = trimmed.startsWith("-");
  const abs = neg ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = abs.split(".");
  const num = BigInt((intPart === "" ? "0" : intPart) + fracPart);
  const den = 10n ** BigInt(fracPart.length);
  return reduce({ num: neg ? -num : num, den });
}
