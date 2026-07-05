import { clear_logs } from "@/commands/log";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useAppDispatch } from "@/store/hooks";
import { querySettingActionData } from "@/store/settings/settings-slice";
import { Box, Button, Flex, ScrollArea, Tabs } from "@mantine/core";
import { useEffect, useState } from "react";
import { AboutView } from "../about";
import { LogView } from "../log";
import SettingList from "./component/setting-list";
export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<string | null>("general");
  useEffect(() => {
    dispatch(querySettingActionData());
  }, []);
  return (
    <WithTitlePageHeader title="Settings">
      <Tabs value={activeTab} onChange={setActiveTab}>
        {/*
          "Clear logs" rides on the tab-strip row (right-aligned) but is kept
          OUTSIDE Tabs.List so the list stays a pure ARIA tablist. It shows only
          while the Logs tab is active, since it acts on that tab's content.
        */}
        <Box pos="relative" mb="md">
          <Tabs.List>
            <Tabs.Tab value="general">General</Tabs.Tab>
            <Tabs.Tab value="logs">Logs</Tabs.Tab>
            <Tabs.Tab value="about">About</Tabs.Tab>
          </Tabs.List>
          {activeTab === "logs" && (
            <Button
              pos="absolute"
              right={0}
              top="50%"
              size="xs"
              variant="light"
              style={{ transform: "translateY(-50%)" }}
              onClick={async () => {
                await clear_logs();
              }}
            >
              Clear logs
            </Button>
          )}
        </Box>
        <Tabs.Panel value="general">
          <ScrollArea
            h={"calc(100vh - 160px)"}
            type="auto"
            scrollbarSize={8}
            style={{ marginRight: -24 }}
            styles={{ viewport: { paddingRight: 24 } }}
          >
            <Flex
              direction="column"
              gap="16"
              pb={24}
              style={{
                fontSize: "14px",
                wordWrap: "break-word",
                wordBreak: "break-all",
              }}
            >
              <SettingList />
            </Flex>
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="logs">
          <LogView />
        </Tabs.Panel>
        <Tabs.Panel value="about">
          <AboutView />
        </Tabs.Panel>
      </Tabs>
    </WithTitlePageHeader>
  );
}
