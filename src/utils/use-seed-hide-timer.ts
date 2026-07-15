import { useEffect, useRef, useState } from "react";

// One shared auto-hide window for every screen that reveals a seed phrase
// (onboarding, add-account, view-seed-phrase), so no surface can accidentally
// invent its own exposure duration. 60s covers the slowest legitimate task —
// carefully hand-writing 18 words — in a single window; re-revealing restarts
// the full window.
export const SEED_HIDE_MS = 60_000;

export function useSeedHideTimer() {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function reveal() {
    clearTimer();
    setVisible(true);
    hideTimer.current = setTimeout(() => {
      clearTimer();
      setVisible(false);
    }, SEED_HIDE_MS);
  }

  function hide() {
    clearTimer();
    setVisible(false);
  }

  useEffect(() => {
    return clearTimer;
  }, []);

  return { visible, reveal, hide };
}
