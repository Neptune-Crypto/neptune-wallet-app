import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { ReactNode } from "react";

// Single place for toast conventions: position, durations, colors, title casing.
// Success toasts close quickly; errors linger long enough to read a two-sentence
// backend reason. Failures of long-running/unattended operations don't auto-close
// at all (sticky) — the user has likely tabbed away, and an outcome they must see
// cannot expire on a timer (pass { sticky: true } / use failed()).
const POSITION = "top-right" as const;
const SUCCESS_AUTO_CLOSE = 2500;
const ERROR_AUTO_CLOSE = 8000;

// Backend/IPC errors arrive as strings, Error objects, or unknown shapes; render
// something readable and fall back to the caller's message.
function toMessage(error: unknown, fallback: string): ReactNode {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const notify = {
  success(message: ReactNode, title: string = "Success") {
    notifications.show({
      position: POSITION,
      color: "green",
      title,
      message,
      autoClose: SUCCESS_AUTO_CLOSE,
    });
  },

  error(
    error: unknown,
    fallback: string,
    title: string = "Error",
    opts?: { sticky?: boolean; id?: string }
  ) {
    // Replace-not-stack: with an id, a retry swaps the visible toast instead of
    // piling up a second one (e.g. repeated wrong-password attempts).
    if (opts?.id) {
      notifications.hide(opts.id);
    }
    notifications.show({
      id: opts?.id,
      position: POSITION,
      color: "red",
      title,
      message: toMessage(error, fallback),
      autoClose: opts?.sticky ? false : ERROR_AUTO_CLOSE,
      withCloseButton: true,
    });
  },

  info(message: ReactNode, title?: string) {
    notifications.show({
      position: POSITION,
      color: "blue",
      title,
      message,
      autoClose: ERROR_AUTO_CLOSE,
    });
  },

  // For long-running flows: show a spinner toast, then resolve it in place.
  loading(title: string, message: ReactNode): string {
    return notifications.show({
      position: POSITION,
      loading: true,
      title,
      message,
      autoClose: false,
      withCloseButton: false,
    });
  },

  done(id: string, title: string, message: ReactNode) {
    notifications.update({
      id,
      position: POSITION,
      color: "green",
      title,
      message,
      icon: <IconCheck size={18} />,
      loading: false,
      autoClose: SUCCESS_AUTO_CLOSE,
      withCloseButton: true,
    });
  },

  failed(id: string, title: string, message: ReactNode) {
    notifications.update({
      id,
      position: POSITION,
      color: "red",
      title,
      message,
      loading: false,
      // Sticky: failed() always resolves a loading toast, i.e. an operation the
      // user waited on and may have tabbed away from — the outcome must wait to
      // be dismissed, not expire unseen.
      autoClose: false,
      withCloseButton: true,
    });
  },
};
