import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";

export const UpdateHandler = () => {
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const update = await check();

        if (update?.available) {
          // Trigger Mantine Modal for User Choice
          modals.openConfirmModal({
            title: "Update Available",
            centered: true,
            children: (
              <Text size="sm">
                A new version ({update.version}) is available. Would you like to download and
                install it now?
              </Text>
            ),
            labels: { confirm: "Update Now", cancel: "Later" },
            confirmProps: { color: "blue" },
            onConfirm: async () => {
              // User clicked "Update Now"
              await update.downloadAndInstall();
              // Relaunch the app to apply the update
              await relaunch();
            },
          });
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };

    checkForUpdates();
  }, []);

  return null;
};
