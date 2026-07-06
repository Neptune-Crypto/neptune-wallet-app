import CopyedIcon from "@/components/copyed-icon";
import EmptyTable from "@/components/empty-table";
import { queryAvailableUtxosList } from "@/store/history/history-slice";
import { useAvailableUtxos, useLoadingAvailableUtxos } from "@/store/history/hooks";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks";
import { useCurrentWalledId } from "@/store/wallet/hooks";
import { ellipsisFormatLen } from "@/utils/ellipsis-format";
import { amount_to_fixed } from "@/utils/math-util";
import { bigNumberPlusToString } from "@/utils/common";
import {
  Box,
  Button,
  Center,
  Checkbox,
  Flex,
  LoadingOverlay,
  Menu,
  NumberFormatter,
  Stack,
  Switch,
  Table,
  Text,
} from "@mantine/core";
import { IconSortDescending } from "@tabler/icons-react";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function NewUtxoTable() {
  const loading = useLoadingAvailableUtxos();
  const availableUtxos = useAvailableUtxos();
  const navigate = useNavigate();
  const [sortType, setSortType] = useState<string>("Amount");

  const addressId = useCurrentWalledId();
  const { serverUrl } = useSettingActionData();
  const dispatch = useAppDispatch();

  const latestBlock = useLatestBlock();
  const syncedBlock = useSyncedBlock();
  const [containLocked, setContainLocked] = useState(false);

  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  useEffect(() => {
    if (latestBlock && syncedBlock && latestBlock <= syncedBlock) {
      dispatch(queryAvailableUtxosList({ serverUrl, sortType, containLocked }));
    }
  }, [latestBlock, syncedBlock, addressId, containLocked]);

  function onchangeSortType(type: string) {
    setSortType(type);
  }

  useEffect(() => {
    dispatch(queryAvailableUtxosList({ serverUrl, sortType }));
  }, [sortType, serverUrl]);
  const rows =
    availableUtxos &&
    availableUtxos.map((element) => (
      <Table.Tr key={element.id}>
        <Table.Td>
          <Checkbox
            aria-label="Select row"
            disabled={element.locked}
            checked={selectedRows.includes(element.id)}
            onChange={(event) =>
              setSelectedRows(
                event.currentTarget.checked
                  ? [...selectedRows, element.id]
                  : selectedRows.filter((position) => position !== element.id)
              )
            }
          />
        </Table.Td>
        <Table.Td>
          <Center>
            <NumberFormatter value={element.id} thousandSeparator />
          </Center>
        </Table.Td>
        <Table.Td>
          <Text>
            <NumberFormatter value={element.confirm_height} thousandSeparator />
          </Text>
        </Table.Td>
        <Table.Td>
          <Center>
            <Text fw={600} c={"#0A8430"}>
              <NumberFormatter value={amount_to_fixed(element.amount)} thousandSeparator />
            </Text>
          </Center>
        </Table.Td>
        <Table.Td>
          <Flex direction={"row"} gap={8} align={"center"}>
            <Text>{ellipsisFormatLen(element.hash, 12)}</Text>
            <CopyedIcon size={16} value={element.hash} />
          </Flex>
        </Table.Td>

        <Table.Td>
          <Center>
            <Text c={element.locked ? "grey" : "#0A8430"}>{element.locked ? "Yes" : "No"}</Text>
          </Center>
        </Table.Td>
        <Table.Td>
          <Center>
            <Stack gap={0} align="center">
              <Text>{format(element.confirm_timestamp, "yyyy-MM-dd HH:mm:ss")}</Text>
              <Text size="xs" c="dimmed">
                {formatDistanceToNow(element.confirm_timestamp, { addSuffix: true })}
              </Text>
            </Stack>
          </Center>
        </Table.Td>
      </Table.Tr>
    ));

  function navigateToSend() {
    navigate("/send", { state: selectedRows });
  }

  const selectableIds = (availableUtxos ?? []).filter((u) => !u.locked).map((u) => u.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedRows.includes(id));
  const totalAmount = (availableUtxos ?? []).reduce(
    (sum, u) => bigNumberPlusToString(sum, u.amount),
    "0"
  );
  const utxoCount = availableUtxos?.length ?? 0;

  return (
    <Flex direction={"column"} gap={8}>
      <Flex direction={"row"} justify={"space-between"} align={"center"}>
        <Flex direction={"row"} align={"center"} gap={16}>
          {utxoCount > 0 && (
            <Text size="sm" fw={500}>
              {utxoCount} UTXO{utxoCount === 1 ? "" : "s"} totalling{" "}
              <NumberFormatter value={totalAmount} thousandSeparator decimalScale={4} /> NPT
            </Text>
          )}
          {selectedRows.length > 0 && (
            <>
              <Button size="xs" variant="light" onClick={navigateToSend}>
                Send
              </Button>
              <Text c="dimmed" style={{ fontSize: "14px" }}>
                {`(${selectedRows.length} selected)`}
              </Text>
            </>
          )}
        </Flex>
        <Flex justify={"end"} align={"center"} gap={16}>
          <Flex direction={"row"} align={"center"} gap={8}>
            <Text c="dimmed">Include locked</Text>
            <Switch
              checked={containLocked}
              onChange={(event) => {
                setContainLocked(event.currentTarget.checked);
              }}
            />
          </Flex>
          {utxoCount > 0 && (
            <Flex direction={"row"} align={"center"} gap={8}>
              <Text c="dimmed">Sort by</Text>
              <Menu shadow="md" width={120}>
                <Menu.Target>
                  <Flex direction={"row"} gap={2} align={"center"} style={{ cursor: "pointer" }}>
                    <Text c={"var(--primaryhighlight)"} style={{ fontSize: "14px" }}>
                      {sortType}
                    </Text>
                    <IconSortDescending size={14} style={{ color: "var(--primaryhighlight)" }} />
                  </Flex>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    color={sortType == "Amount" ? "var(--primaryhighlight)" : ""}
                    onClick={() => onchangeSortType("Amount")}
                  >
                    Amount
                  </Menu.Item>
                  <Menu.Item
                    color={sortType == "ID" ? "var(--primaryhighlight)" : ""}
                    onClick={() => onchangeSortType("ID")}
                  >
                    ID
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Flex>
          )}
        </Flex>
      </Flex>
      <Box pos="relative">
        <LoadingOverlay
          visible={loading}
          zIndex={1000}
          overlayProps={{ radius: "sm", blur: 2 }}
          loaderProps={{ color: "blue" }}
        />
        {!loading && availableUtxos && availableUtxos.length > 0 ? (
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
                <Table.Th>
                  <Checkbox
                    aria-label="Select all UTXOs"
                    checked={allSelected}
                    indeterminate={selectedRows.length > 0 && !allSelected}
                    onChange={() => setSelectedRows(allSelected ? [] : selectableIds)}
                  />
                </Table.Th>
                <Table.Th>
                  <Center>ID</Center>
                </Table.Th>
                <Table.Th>Block height</Table.Th>
                <Table.Th>
                  <Center>Amount (NPT)</Center>
                </Table.Th>
                <Table.Th>Hash</Table.Th>
                <Table.Th>
                  <Center>Locked</Center>
                </Table.Th>
                <Table.Th>
                  <Center>Time</Center>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>{rows}</Table.Tbody>
          </Table>
        ) : (
          <EmptyTable />
        )}
      </Box>
    </Flex>
  );
}
