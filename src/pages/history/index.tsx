import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useActivityPerDay } from "@/store/history/hooks";
import { BarChart, ChartTooltip } from "@mantine/charts";
import { Box, Group, ScrollArea, SegmentedControl, Space, Text } from "@mantine/core";
import { useState } from "react";
import ActivityTableCard from "./component/activity-table-card";
import NewUtxoTable from "./component/new-utxo-table";

export default function HistoryPage() {
  const [section, setSection] = useState("activity");
  const perDay = useActivityPerDay();

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
    { name: "Sent", color: "red.6" },
    { name: "Received", color: "#0A8030" },
  ];

  const valueFormatter = (value: number) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(value));

  return (
    <WithTitlePageHeader title="History">
      <ScrollArea
        h="calc(100vh - 110px)"
        type="auto"
        scrollbarSize={8}
        style={{ marginRight: -24 }}
        styles={{ viewport: { paddingRight: 24 } }}
      >
        {perDay && perDay.length > 0 && (
          <>
            <Text size="sm" fw={500} ta="center" mb={4}>
              Last 7 days
            </Text>
            <Group gap="lg" justify="center" mb="xs">
              <Group gap={6}>
                <Box
                  w={12}
                  h={12}
                  style={{ borderRadius: 2, backgroundColor: "#0A8030" }}
                />
                <Text size="sm">Received</Text>
              </Group>
              <Group gap={6}>
                <Box
                  w={12}
                  h={12}
                  style={{ borderRadius: 2, backgroundColor: "var(--mantine-color-red-6)" }}
                />
                <Text size="sm">Sent</Text>
              </Group>
            </Group>
            <BarChart
              h={250}
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
              style={{ marginBottom: 10 }}
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
        <SegmentedControl
          value={section}
          onChange={(value: any) => setSection(value)}
          transitionTimingFunction="ease"
          fullWidth
          data={[
            { label: "Activity", value: "activity" },
            { label: "Utxos", value: "utxos" },
          ]}
        />
        <Space h={16}></Space>
        {section === "activity" && <ActivityTableCard />}
        {section === "utxos" && <NewUtxoTable />}
      </ScrollArea>
    </WithTitlePageHeader>
  );
}
