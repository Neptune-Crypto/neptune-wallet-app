import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useActivityPerDay, useActivityTransactions } from "@/store/history/hooks";
import { useCurrentWalledId, useWallets } from "@/store/wallet/hooks";
import { BarChart, ChartTooltip } from "@mantine/charts";
import { Box, Flex, Group, ScrollArea, Select, Tabs, Text } from "@mantine/core";
import { useState } from "react";
import ActivityTableCard from "./component/activity-table-card";
import NewUtxoTable from "./component/new-utxo-table";

export default function HistoryPage() {
  const [section, setSection] = useState("activity");
  const [historyType, setHistoryType] = useState("All");
  const perDay = useActivityPerDay();
  const activityTransactions = useActivityTransactions();
  const wallets = useWallets();
  const currentWalletID = useCurrentWalledId();
  const activeAccountName = wallets.find((w) => w.id === currentWalletID)?.name;

  // Y轴刻度格式化函数
  const formatYAxisTick = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}m`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  // Series order is bottom-to-top of the stack: Sent on the bottom, Received on top.
  const series = [
    ...(historyType !== "Received" ? [{ name: "Sent", color: "red.6" }] : []),
    ...(historyType !== "Sent" ? [{ name: "Received", color: "var(--color-positive)" }] : []),
  ];

  const valueFormatter = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(value));

  return (
    <WithTitlePageHeader title="History">
      <Tabs
        value={section}
        onChange={(value) => setSection(value ?? "activity")}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <Box pos="relative" mb="sm">
          <Tabs.List>
            <Tabs.Tab value="activity">Activity</Tabs.Tab>
            <Tabs.Tab value="utxos">UTXOs</Tabs.Tab>
          </Tabs.List>
          {section === "activity" && (
            <Group
              pos="absolute"
              right={0}
              top="50%"
              gap="xs"
              align="center"
              style={{ transform: "translateY(-50%)" }}
            >
              <Text size="sm" c="dimmed">
                Show
              </Text>
              <Select
                w={120}
                size="xs"
                data={["All", "Received", "Sent"]}
                value={historyType}
                onChange={(value) => setHistoryType(value ?? "All")}
                allowDeselect={false}
              />
            </Group>
          )}
        </Box>

        <Flex direction={"row"} gap={6} align={"center"} mb="sm">
          <Text size="sm" c="dimmed">
            Active account:
          </Text>
          <Text size="sm" fw={600}>
            {activeAccountName || "—"}
          </Text>
        </Flex>

        <Tabs.Panel value="activity" className="page-tab-panel">
          <ScrollArea
            type="auto"
            scrollbarSize={8}
            style={{ flex: 1, minHeight: 0, marginRight: -24 }}
            styles={{ viewport: { paddingRight: 24 } }}
          >
            {/* Only worth noting when there IS older history below — with no
                activity at all, the table's own empty state covers it. */}
            {(!perDay || perDay.length === 0) && (activityTransactions?.length ?? 0) > 0 && (
              <Text size="sm" c="dimmed" mb="md">
                No activity in the last 14 days.
              </Text>
            )}
            {perDay && perDay.length > 0 && (
              <>
                <Box pos="relative" mb="xs">
                  <Text size="sm" fw={500} ta="center">
                    Last 14 days
                  </Text>
                  <Group
                    gap="lg"
                    pos="absolute"
                    right={0}
                    top="50%"
                    style={{ transform: "translateY(-50%)" }}
                  >
                    {historyType !== "Sent" && (
                      <Group gap={6}>
                        <Box
                          w={12}
                          h={12}
                          style={{ borderRadius: 2, backgroundColor: "var(--color-positive)" }}
                        />
                        <Text size="sm">Received</Text>
                      </Group>
                    )}
                    {historyType !== "Received" && (
                      <Group gap={6}>
                        <Box
                          w={12}
                          h={12}
                          style={{ borderRadius: 2, backgroundColor: "var(--mantine-color-red-6)" }}
                        />
                        <Text size="sm">Sent</Text>
                      </Group>
                    )}
                  </Group>
                </Box>
                <BarChart
                  h={220}
                  data={perDay}
                  type="stacked"
                  yAxisLabel="NPT"
                  styles={{ axisLabel: { fill: "var(--mantine-color-text)" } }}
                  yAxisProps={{
                    domain: [0, "auto"],
                    tickFormatter: formatYAxisTick,
                    width: 56,
                  }}
                  dataKey="data"
                  valueFormatter={valueFormatter}
                  style={{ marginBottom: 36 }}
                  series={series}
                  tooltipProps={{
                    // Recharts lists tooltip rows in series order (bottom-to-top). Reverse
                    // them so the tooltip reads top-to-bottom, matching the stacked column.
                    content: ({ label, payload }: any) =>
                      payload && payload.length ? (
                        <ChartTooltip
                          label={label}
                          payload={[...payload].reverse()}
                          series={series}
                          valueFormatter={valueFormatter}
                        />
                      ) : null,
                  }}
                />
              </>
            )}
            <ActivityTableCard historyType={historyType} />
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="utxos" className="page-tab-panel">
          <ScrollArea
            type="auto"
            scrollbarSize={8}
            style={{ flex: 1, minHeight: 0, marginRight: -24 }}
            styles={{ viewport: { paddingRight: 24 } }}
          >
            <Text size="sm" c="dimmed" mb={36}>
              Your balance is made up of individual coins called UTXOs (unspent transaction
              outputs). Select any below to spend them in a specific transaction.
            </Text>
            <NewUtxoTable />
          </ScrollArea>
        </Tabs.Panel>
      </Tabs>
    </WithTitlePageHeader>
  );
}
