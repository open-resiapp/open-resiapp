// Payment-allocation engine (BYT-20260512-002 Phase 1) — pure functions,
// no DB access. Domain rules (docs/domain/accounting.md):
//   - sum-preserving splits: the allocated parts always sum to exactly the
//     allocated total; cents never appear or vanish (invariant 10)
//   - across periods/months: FIFO by oldest open assessment, regardless of
//     the within-month strategy
//   - leftover after all open assessments are covered = preplatok; it is
//     returned to the caller, never silently absorbed

export interface OpenAssessment {
  id: string;
  /** Period year + month define FIFO order across time. */
  periodYear: number;
  month: number;
  /** Category slug — only consulted by the priority_ordered strategy. */
  categorySlug: string;
  /** Remaining unpaid amount; must be > 0 to participate. */
  openCents: number;
}

export interface AllocationResult {
  allocations: { assessmentId: string; amountCents: number }[];
  /** Preplatok — what remains after every open assessment is covered. */
  unallocatedCents: number;
}

export type AllocationStrategy = "proportional" | "priority_ordered";

/**
 * Splits `totalCents` across parts proportionally to their open amounts.
 * Sum-preserving: every part except the last rounds half-even; the last
 * part absorbs the rounding remainder (spec: "banker's rounding on the
 * last component"). Assumes totalCents <= Σ openCents — full coverage is
 * handled by the caller before calling this.
 */
export function splitProportional(
  totalCents: number,
  parts: { id: string; openCents: number }[]
): { id: string; amountCents: number }[] {
  const weightSum = parts.reduce((s, p) => s + p.openCents, 0);
  if (totalCents > weightSum) {
    throw new Error(
      `splitProportional: total ${totalCents} exceeds open sum ${weightSum}`
    );
  }
  const result: { id: string; amountCents: number }[] = [];
  let assigned = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    let amount: number;
    if (i === parts.length - 1) {
      amount = totalCents - assigned;
    } else {
      amount = roundHalfEven((totalCents * part.openCents) / weightSum);
      // Never allocate above the part's own open amount, and never leave
      // the last component negative — clamp against both bounds.
      const remainingAfterThis = totalCents - assigned - amount;
      const maxOthersCanTake = parts
        .slice(i + 1)
        .reduce((s, p) => s + p.openCents, 0);
      if (remainingAfterThis > maxOthersCanTake) {
        amount = totalCents - assigned - maxOthersCanTake;
      }
      amount = Math.min(Math.max(amount, 0), part.openCents);
    }
    assigned += amount;
    result.push({ id: part.id, amountCents: amount });
  }
  return result;
}

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Splits `totalCents` across parts proportionally to arbitrary non-negative
 * weights (ownership share, m², person count, …). Sum-preserving via
 * largest-remainder: floors every share, then distributes the leftover
 * cents to the largest fractional remainders — no part drifts more than
 * one cent from its exact proportion and the parts always sum to the total
 * (domain invariant 10). Used by predpis assessment generation.
 */
export function splitByWeights(
  totalCents: number,
  parts: { id: string; weight: number }[]
): { id: string; amountCents: number }[] {
  if (totalCents < 0) {
    throw new Error(`splitByWeights: negative total ${totalCents}`);
  }
  if (parts.some((p) => p.weight < 0 || !Number.isFinite(p.weight))) {
    throw new Error("splitByWeights: weights must be finite and >= 0");
  }
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  if (weightSum <= 0) {
    throw new Error("splitByWeights: weight sum must be > 0");
  }
  const exact = parts.map((p) => (totalCents * p.weight) / weightSum);
  const floors = exact.map(Math.floor);
  let leftover = totalCents - floors.reduce((s, f) => s + f, 0);
  // Stable order: biggest remainder first; ties keep input order.
  const order = exact
    .map((v, i) => ({ i, rem: v - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (leftover <= 0) break;
    result[i] += 1;
    leftover -= 1;
  }
  // Float-edge safety net: exact shares are computed in floating point, so
  // a value can land epsilon above the integer it mathematically is,
  // leaving the floors summing high (leftover < 0) or the distribution
  // short. Reconcile against the largest-weight part and re-assert the
  // invariant — sum preservation must hold unconditionally (invariant 10).
  const sum = result.reduce((s, v) => s + v, 0);
  if (sum !== totalCents) {
    const largest = parts.reduce(
      (best, p, i) => (p.weight > parts[best].weight ? i : best),
      0
    );
    result[largest] += totalCents - sum;
    if (result[largest] < 0) {
      throw new Error(
        `splitByWeights: could not reconcile rounding (sum ${sum}, total ${totalCents})`
      );
    }
  }
  return parts.map((p, i) => ({ id: p.id, amountCents: result[i] }));
}

/**
 * Allocates an incoming payment across open assessments.
 *
 * FIFO across (periodYear, month) groups: the oldest month is settled (or
 * partially covered) before any cent reaches a newer one. Within a month:
 *   - proportional: split across the month's open assessments by their
 *     open amounts (sum-preserving)
 *   - priority_ordered: pay categories in `priorityOrder` sequence until
 *     the remainder is exhausted; categories missing from the list come
 *     last, in input order
 */
export function allocatePayment(
  paymentCents: number,
  openAssessments: OpenAssessment[],
  strategy: AllocationStrategy,
  priorityOrder: string[] = []
): AllocationResult {
  if (paymentCents <= 0) {
    throw new Error(`allocatePayment: non-positive payment ${paymentCents}`);
  }
  const open = openAssessments.filter((a) => a.openCents > 0);
  const groups = new Map<string, OpenAssessment[]>();
  for (const a of open) {
    const key = `${a.periodYear}-${String(a.month).padStart(2, "0")}`;
    const group = groups.get(key);
    if (group) group.push(a);
    else groups.set(key, [a]);
  }
  const orderedKeys = [...groups.keys()].sort();

  const allocations: { assessmentId: string; amountCents: number }[] = [];
  let remaining = paymentCents;

  for (const key of orderedKeys) {
    if (remaining <= 0) break;
    const group = groups.get(key)!;
    const groupOpen = group.reduce((s, a) => s + a.openCents, 0);

    if (remaining >= groupOpen) {
      // Full coverage — strategy irrelevant.
      for (const a of group) {
        allocations.push({ assessmentId: a.id, amountCents: a.openCents });
      }
      remaining -= groupOpen;
      continue;
    }

    if (strategy === "priority_ordered") {
      const rank = (slug: string) => {
        const idx = priorityOrder.indexOf(slug);
        return idx === -1 ? priorityOrder.length : idx;
      };
      const ordered = [...group].sort(
        (a, b) => rank(a.categorySlug) - rank(b.categorySlug)
      );
      for (const a of ordered) {
        if (remaining <= 0) break;
        const amount = Math.min(remaining, a.openCents);
        allocations.push({ assessmentId: a.id, amountCents: amount });
        remaining -= amount;
      }
    } else {
      const split = splitProportional(
        remaining,
        group.map((a) => ({ id: a.id, openCents: a.openCents }))
      );
      for (const s of split) {
        if (s.amountCents > 0) {
          allocations.push({ assessmentId: s.id, amountCents: s.amountCents });
        }
      }
      remaining = 0;
    }
  }

  return { allocations, unallocatedCents: remaining };
}
