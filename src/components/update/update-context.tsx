import { notify } from "@/utils/notify";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Single source of truth for app updates: routes all three consumers (startup
// modal, About view, sidebar badge) through Tauri's one-click updater, so every
// surface offers the same install action and check failures are visible.

export type UpdateStatus =
  "disabled" | "checking" | "upToDate" | "available" | "installing" | "error";

// This build ships the watch-only payout-policy feature, which the standard
// releases the updater points at do not have. An upgrade would silently strip
// the feature, so update checks are off entirely: no startup prompt, no
// sidebar badge, and the About page states that checks are disabled.
const UPDATE_CHECKS_DISABLED = true;

interface UpdateState {
  status: UpdateStatus;
  /** The available update's version (only set when status === "available"). */
  version?: string;
  /** Error message from the last check/install, when status === "error". */
  error?: string;
  /** Re-run the update check (e.g. the About page's "Retry"). */
  checkForUpdates: () => Promise<void>;
  /** Download + install the pending update, then relaunch. */
  install: () => Promise<void>;
}

const UpdateContext = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus>(
    UPDATE_CHECKS_DISABLED ? "disabled" : "checking"
  );
  const [version, setVersion] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  // The Tauri Update object carries downloadAndInstall(); it can't live in Redux.
  const updateRef = useRef<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    if (UPDATE_CHECKS_DISABLED) {
      setStatus("disabled");
      return;
    }
    // Not in Tauri (e.g. a plain browser / Playwright): nothing to check.
    if (!isTauri()) {
      setStatus("upToDate");
      return;
    }
    setStatus("checking");
    setError(undefined);
    try {
      const update = await check();
      if (update?.available) {
        updateRef.current = update;
        setVersion(update.version);
        setStatus("available");
      } else {
        updateRef.current = null;
        setVersion(undefined);
        setStatus("upToDate");
      }
    } catch (e: any) {
      // Automatic check failures are surfaced on the About page (with Retry),
      // not as a startup toast — being offline is common and shouldn't nag.
      setError(e?.message ?? String(e));
      setStatus("error");
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setStatus("installing");
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e: any) {
      // Install is a user action, so failing it does deserve a toast.
      setError(e?.message ?? String(e));
      setStatus("available");
      notify.error(e, "Please try again.", "Couldn't install update", { sticky: true });
    }
  }, []);

  useEffect(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  return (
    <UpdateContext.Provider value={{ status, version, error, checkForUpdates, install }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate(): UpdateState {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdate must be used within an UpdateProvider");
  return ctx;
}
