import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks";
import { queryLatestBlock } from "@/store/sync/sync-slice";
import { Card, Flex, NumberFormatter, Progress, Space, Text } from "@mantine/core";
import { useEffect } from "react";
import classes from "./sync.module.css";
export default function SyncBlockCard() {
  const { serverUrl } = useSettingActionData();
  const syncedBlock = useSyncedBlock();
  const latestBlock = useLatestBlock();
  const dispatch = useAppDispatch();
  function handleProgress() {
    if (latestBlock === 0) {
      return 0;
    }
    // Clamp: during an account switch the synced height can briefly exceed a
    // stale latest height, which would render as "100.0%" (or >100%).
    return Math.min(100, (syncedBlock / latestBlock) * 100);
  }
  useEffect(() => {
    if (latestBlock < syncedBlock) {
      dispatch(queryLatestBlock({ serverUrl }));
    }
  }, [syncedBlock, latestBlock]);
  return (
    <Flex style={{ width: "100%" }}>
      <Card className={classes.card}>
        <Flex direction={"row"} justify={"space-between"}>
          <Flex direction={"row"}>
            <Text fz={"xs"} fw={"bold"} c={"#FFFFFF"}>
              Sync status
            </Text>
          </Flex>
          <Flex direction={"row"} gap={2}>
            <Text fz={"xs"} fw={"bold"} c={"white"}>
              {/* handleProgress guards latestBlock === 0, which would render NaN%. */}
              <NumberFormatter value={handleProgress()} decimalScale={1} suffix="%" />
            </Text>
          </Flex>
        </Flex>
        <Space h={8}></Space>
        <Progress
          value={handleProgress()}
          size="4"
          animated={latestBlock != 0 && syncedBlock != latestBlock}
          radius="xl"
          classNames={{
            root: classes.progressTrack,
            section: classes.progressSection,
          }}
        />
        <Space h={8}></Space>
        <Flex direction={"row"} gap={4}>
          <Text fz={"xs"} fw={"bold"} c={"#FFFFFF"}>
            <NumberFormatter value={syncedBlock ?? 0} thousandSeparator />
          </Text>
          <Text fz={"xs"} fw={"bold"} style={{ color: "rgba(255, 255, 255, 0.65)" }}>
            / <NumberFormatter value={latestBlock ?? 0} thousandSeparator /> blocks
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}
