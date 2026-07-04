import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useActivityPerDay } from "@/store/history/hooks";
import { BarChart } from "@mantine/charts";
import { Box, Group, ScrollArea, SegmentedControl, Space, Text } from "@mantine/core";
import { useState } from "react";
import ActivityTableCard from "./component/activity-table-card";
import NewUtxoTable from "./component/new-utxo-table";

export default function HistoryPage() {
  const [section, setSection] = useState("activity");
  const perDay = useActivityPerDay();

  // 计算数据最大值的1.2倍
  const getYAxisMax = () => {
    if (!perDay || perDay.length === 0) return "auto";
    const maxValue = Math.max(...perDay.flatMap((item) => [item.Received || 0, item.Spent || 0]));
    return maxValue * 1.2;
  };

  // Y轴刻度格式化函数
  const formatYAxisTick = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}m`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

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
            <Group gap="lg" justify="center" mb="xs">
              <Group gap={6}>
                <Box
                  w={12}
                  h={12}
                  style={{ borderRadius: 2, backgroundColor: "var(--mantine-color-violet-6)" }}
                />
                <Text size="sm">Received</Text>
              </Group>
              <Group gap={6}>
                <Box
                  w={12}
                  h={12}
                  style={{ borderRadius: 2, backgroundColor: "var(--mantine-color-teal-6)" }}
                />
                <Text size="sm">Sent</Text>
              </Group>
            </Group>
            <Text size="xs" c="dimmed" mb={2}>
              NPT
            </Text>
            <BarChart
              h={250}
              data={perDay}
              yAxisProps={{
                domain: [0, getYAxisMax()],
                tickFormatter: formatYAxisTick,
              }}
              dataKey="data"
              withTooltip={false}
              valueFormatter={(value) =>
                new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(value))
              }
              withBarValueLabel
              style={{ marginBottom: 10 }}
              series={[
                { name: "Received", color: "violet.6" },
                { name: "Spent", color: "teal.6" },
              ]}
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
