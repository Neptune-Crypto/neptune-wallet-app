import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useEffect, useRef } from "react";
import { useUpdate } from "./update/update-context";

// Startup prompt: when the shared updater reports an available version, offer a
// one-click install once. The actual check/install live in UpdateProvider so the
// About view and sidebar badge share the same source of truth.
export const UpdateHandler = () => {
  const { status, version, install } = useUpdate();
  const promptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "available" || !version) return;
    // Only prompt once per version, so dismissing with "Later" doesn't re-nag.
    if (promptedFor.current === version) return;
    promptedFor.current = version;

    modals.openConfirmModal({
      title: "Update available",
      centered: true,
      children: (
        <Text size="sm">A new version ({version}) is available. Download and install it now?</Text>
      ),
      labels: { confirm: "Update now", cancel: "Later" },
      confirmProps: { color: "blue" },
      onConfirm: () => install(),
    });
  }, [status, version, install]);

  return null;
};
