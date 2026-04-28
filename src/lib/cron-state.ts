// Last cron run snapshot, exposed via /api/admin/debug/cron.
// In-memory only; resets on process restart.

export type CronRunSnapshot = {
  ok: boolean;
  ranAt: string;
  expiredByTtl: number;
  expiredEvents: number;
  expiryRemindersSent: number;
  eventRemindersSent: number;
  error?: string;
};

let lastCronRun: CronRunSnapshot | null = null;

export function getLastCronRun(): CronRunSnapshot | null {
  return lastCronRun;
}

export function setLastCronRun(snapshot: CronRunSnapshot): void {
  lastCronRun = snapshot;
}
