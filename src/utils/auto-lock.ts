/**
 * Decision logic for idle auto-lock, kept free of React and Tauri so it can be
 * tested directly. The hook that drives it lives in use-auto-lock.ts.
 */

/** How often the idle check runs. */
export const AUTO_LOCK_TICK_MS = 5_000;

export type AutoLockInputs = {
  timeoutMinutes: number;
  lastActivity: number;
  now: number;
  /** A send is in flight: locking would stop the RPC server it is waiting on. */
  sendInProgress: boolean;
};

/**
 * Whether the idle timeout has expired and the wallet should lock now.
 *
 * The comparison is against wall-clock time rather than a single long timer,
 * so a machine that slept through the timeout locks on the first tick after
 * waking instead of resuming a stale countdown.
 */
export function shouldAutoLock({
  timeoutMinutes,
  lastActivity,
  now,
  sendInProgress,
}: AutoLockInputs): boolean {
  if (timeoutMinutes <= 0) return false;
  if (sendInProgress) return false;
  return now - lastActivity >= timeoutMinutes * 60_000;
}
