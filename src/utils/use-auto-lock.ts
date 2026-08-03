import { lockWallet } from "@/store/auth/auth-slice";
import { useAuth } from "@/store/auth/hooks";
import { usePendingExecution } from "@/store/execution/hooks";
import { useAppDispatch } from "@/store/hooks";
import { useAutoLockMinutes } from "@/store/settings/hooks";
import { notify } from "@/utils/notify";
import { useEffect, useRef } from "react";
import { AUTO_LOCK_TICK_MS, shouldAutoLock } from "./auto-lock";

// Only input a user can produce counts as activity. An event the app raises by
// itself (a repainting balance, a sync tick) would hold the lock off while the
// wallet sits untouched.
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

/**
 * Lock the wallet after a period without user interaction.
 *
 * The timestamp lives in a ref and the check runs on an interval, so the
 * hundreds of activity events a minute of mouse movement produces cost one
 * assignment each instead of a re-render.
 */
export function useAutoLock() {
  const dispatch = useAppDispatch();
  const { hasAuth, hasPassword } = useAuth();
  const autoLockMinutes = useAutoLockMinutes();
  const sendInProgress = usePendingExecution();

  const lastActivity = useRef(Date.now());
  // Locking is async: without this a second tick could dispatch again while the
  // first lock is still in flight.
  const locking = useRef(false);
  // Read inside the interval callback, so a send starting or finishing doesn't
  // have to tear down and rebuild the listeners.
  const sendInProgressRef = useRef(sendInProgress);
  useEffect(() => {
    sendInProgressRef.current = sendInProgress;
  }, [sendInProgress]);

  const active = hasAuth && hasPassword && autoLockMinutes > 0;

  useEffect(() => {
    if (!active) return;

    // Unlocking, or picking a timeout, starts a fresh window rather than
    // inheriting idle time that accrued while the feature was off.
    lastActivity.current = Date.now();
    locking.current = false;

    function markActivity() {
      lastActivity.current = Date.now();
    }
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActivity, { passive: true });
    }
    // Scrolling inside Mantine's ScrollArea doesn't bubble to window, so listen
    // in the capture phase to see it.
    window.addEventListener("scroll", markActivity, { passive: true, capture: true });

    const timer = setInterval(async () => {
      if (locking.current) return;
      const expired = shouldAutoLock({
        timeoutMinutes: autoLockMinutes,
        lastActivity: lastActivity.current,
        now: Date.now(),
        sendInProgress: sendInProgressRef.current,
      });
      if (!expired) return;

      locking.current = true;
      try {
        await dispatch(lockWallet()).unwrap();
        // Say why the wallet is asking for a password again: without this the
        // lock screen is indistinguishable from the app having restarted.
        notify.info(
          `Locked after ${autoLockMinutes} minute${autoLockMinutes === 1 ? "" : "s"} of inactivity.`,
          "Wallet locked"
        );
      } catch (error: any) {
        // A lock that silently failed would leave the wallet open on an
        // unattended screen, so say so. The id replaces rather than stacks if
        // the next tick fails again.
        notify.error(error, "The wallet is still unlocked.", "Couldn't lock wallet", {
          id: "auto-lock-error",
        });
        // Re-arm the full timeout instead of retrying every tick.
        lastActivity.current = Date.now();
        locking.current = false;
      }
    }, AUTO_LOCK_TICK_MS);

    return () => {
      clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActivity);
      }
      window.removeEventListener("scroll", markActivity, { capture: true });
    };
  }, [active, autoLockMinutes, dispatch]);
}
