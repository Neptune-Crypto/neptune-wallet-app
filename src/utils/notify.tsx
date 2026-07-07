import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { ReactNode } from "react";

// Single place for toast conventions: position, durations, colors, title casing.
// Success toasts close quickly; errors linger longer so they can be read.
const POSITION = "top-right" as const;
const SUCCESS_AUTO_CLOSE = 2500;
const ERROR_AUTO_CLOSE = 4000;

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

  error(error: unknown, fallback: string, title: string = "Error") {
    notifications.show({
      position: POSITION,
      color: "red",
      title,
      message: toMessage(error, fallback),
      autoClose: ERROR_AUTO_CLOSE,
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
      autoClose: ERROR_AUTO_CLOSE,
      withCloseButton: true,
    });
  },
};
