import { useUpdate } from "@/components/update/update-context";
import { RELEASES_URL } from "@/constant";
import { queryAboutInfo } from "@/store/about/about-slice";
import { useBuildInfo, useVersion } from "@/store/about/hooks";
import { useAppDispatch } from "@/store/hooks";
import { Anchor, Button, Flex, Loader, Table, Text } from "@mantine/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";

// Content-only view of the About info, rendered as the "About" tab inside
// Settings. Kept free of a page header so it composes inside Settings' tabs.
export function AboutView() {
  const buildInfo = useBuildInfo();
  const version = useVersion();
  const update = useUpdate();
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(queryAboutInfo());
  }, [dispatch]);
  return (
    <Table
      variant="vertical"
      layout="fixed"
      withRowBorders={false}
      striped={false}
      styles={{
        th: {
          fontSize: "14px",
          fontWeight: "500",
          color: "var(--mantine-color-dimmed)",
          justifyContent: "flex-start",
          justifyItems: "start",
          alignItems: "center",
          background: "transparent",
        },
        tr: {
          fontSize: "14px",
          fontWeight: "400",
          justifyContent: "flex-start",
          justifyItems: "start",
          alignItems: "center",
        },
      }}
    >
      <Table.Tbody>
        <Table.Tr>
          <Table.Th w={160}>Build time:</Table.Th>
          <Table.Td>
            <Text>{buildInfo?.time}</Text>
          </Table.Td>
        </Table.Tr>

        <Table.Tr>
          <Table.Th>Commit:</Table.Th>
          <Table.Td>
            <Text>{buildInfo?.commit}</Text>
          </Table.Td>
        </Table.Tr>

        <Table.Tr>
          <Table.Th>Version:</Table.Th>
          <Table.Td>
            <Text>{version}</Text>
          </Table.Td>
        </Table.Tr>

        <Table.Tr>
          <Table.Th>Updates:</Table.Th>
          <Table.Td>
            {update.status === "disabled" && (
              <Text c="dimmed">Update checks are disabled in this build.</Text>
            )}
            {update.status === "checking" && (
              <Flex align="center" gap={8}>
                <Loader size="xs" />
                <Text>Checking for updates…</Text>
              </Flex>
            )}
            {update.status === "upToDate" && <Text>You're on the latest version.</Text>}
            {update.status === "available" && (
              <Flex align="center" gap={12} wrap="wrap">
                <Text fw={600} c="var(--color-positive)">
                  Version {update.version} available
                </Text>
                <Button size="xs" variant="light" onClick={() => update.install()}>
                  Install &amp; restart
                </Button>
                {/* One-click install can't service every packaging (e.g. Linux
                    .deb/.rpm installs, which the updater cannot replace in
                    place), so always offer the releases page as a manual path. */}
                <Anchor size="xs" onClick={() => openUrl(RELEASES_URL)}>
                  Download from the releases page
                </Anchor>
              </Flex>
            )}
            {update.status === "installing" && (
              <Flex align="center" gap={8}>
                <Loader size="xs" />
                <Text>Installing update…</Text>
              </Flex>
            )}
            {update.status === "error" && (
              <Flex align="center" gap={12} wrap="wrap">
                <Text>Couldn't check for updates.</Text>
                <Button size="xs" variant="light" onClick={() => update.checkForUpdates()}>
                  Retry
                </Button>
                <Anchor size="xs" onClick={() => openUrl(RELEASES_URL)}>
                  Download from the releases page
                </Anchor>
              </Flex>
            )}
          </Table.Td>
        </Table.Tr>
      </Table.Tbody>
    </Table>
  );
}
