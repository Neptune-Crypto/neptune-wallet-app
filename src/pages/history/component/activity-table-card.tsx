import { queryActivityHistory } from "@/store/history/history-slice";
import { useActivityTransactions, useLoadingActivityTx } from "@/store/history/hooks";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks";
import { MerageHistory } from "@/store/types";
import { useCurrentWalledId } from "@/store/wallet/hooks";
import EmptyTable from "@/components/empty-table";
import { Box, Center, Flex, LoadingOverlay, Table, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import ActivityTableItem from "./activity-table-item";
import DetailModal from "./datail-modal";

export default function ActivityTableCard({ historyType }: { historyType: string }) {
  const loading = useLoadingActivityTx();
  const historyList = useActivityTransactions();
  const { serverUrl } = useSettingActionData();
  const addressId = useCurrentWalledId();
  const dispatch = useAppDispatch();
  const latestBlock = useLatestBlock();
  const syncedBlock = useSyncedBlock();
  const [selectedHistory, setSelectedHistory] = useState({} as MerageHistory);
  const [showDetail, setShowDetail] = useState(false);
  const entryCount = historyList?.length ?? 0;
  useEffect(() => {
    if (latestBlock && syncedBlock && latestBlock <= syncedBlock) {
      dispatch(queryActivityHistory({ serverUrl, addressId, historyType }));
    }
  }, [latestBlock, syncedBlock, addressId, historyType]);

  useEffect(() => {
    dispatch(queryActivityHistory({ serverUrl, addressId, historyType }));
  }, [dispatch, addressId, serverUrl, historyType]);

  return (
    <Flex direction={"column"} gap={8}>
      <DetailModal
        history={selectedHistory}
        opened={showDetail}
        onClose={() => setShowDetail(false)}
      />
      <Text size="sm" fw={500}>
        {`Full history: ${entryCount} balance change${entryCount === 1 ? "" : "s"}`}
      </Text>
      <Box pos="relative">
        <LoadingOverlay
          visible={loading}
          zIndex={1000}
          overlayProps={{ radius: "sm", blur: 2 }}
          loaderProps={{ color: "pink" }}
        />
        {!loading && historyList && historyList.length > 0 ? (
          <Table
            striped
            highlightOnHover
            stickyHeaderOffset={0}
            stickyHeader
            verticalSpacing={"sm"}
            withRowBorders={false}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Block height</Table.Th>
                <Table.Th>
                  <Center>Amount change (NPT)</Center>
                </Table.Th>
                <Table.Th>
                  <Center>Time</Center>
                </Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {historyList &&
                historyList.length > 0 &&
                historyList.map((item, index) => {
                  return (
                    <ActivityTableItem
                      key={index}
                      element={item}
                      showMoreDetail={() => {
                        setSelectedHistory(item);
                        setShowDetail(true);
                      }}
                    />
                  );
                })}
            </Table.Tbody>
          </Table>
        ) : (
          <EmptyTable />
        )}
      </Box>
    </Flex>
  );
}
