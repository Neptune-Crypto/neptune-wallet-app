import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { Tabs } from "@mantine/core";
import { LogView } from "../log";

// Advanced view. Hosts diagnostic tools as tabs; currently just the log viewer,
// but structured so more can be added without another top-level nav item.
export default function AdvancedPage() {
  return (
    <WithTitlePageHeader title="Advanced">
      <Tabs defaultValue="log">
        <Tabs.List mb="md">
          <Tabs.Tab value="log">Log</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="log">
          <LogView />
        </Tabs.Panel>
      </Tabs>
    </WithTitlePageHeader>
  );
}
