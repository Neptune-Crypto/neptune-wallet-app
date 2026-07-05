import WithTitlePageHeader from "@/components/header/withTitlePageHeader.tsx";
import TransferForm from "@/pages/batch/component/transfer-form.tsx";
import {
  queryExecutionHistorys,
  requestSedExecutionTransaction,
} from "@/store/execution/execution-slice.ts";
import {
  usePendingExecution,
  useRequesetSendTransactionResponse,
  useSendState,
} from "@/store/execution/hooks.ts";
import { useAppDispatch } from "@/store/hooks.ts";
import { useSettingActionData } from "@/store/settings/hooks.ts";
import { useLatestBlock, useSyncedBlock } from "@/store/sync/hooks.ts";
import {
  useBalanceData,
  useCurrentAddress,
  useCurrentWalledId,
  useWallets,
} from "@/store/wallet/hooks.ts";
import { Output, SendInputItem, SendTransactionParam } from "@/utils/api/types.ts";
import {
  Alert,
  Box,
  Button,
  Divider,
  Flex,
  HoverCard,
  NumberInput,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconAlertTriangle, IconInfoCircle, IconPlus } from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";

import { useAvailableUtxos } from "@/store/history/hooks";
import { queryCurrentWalletID, queryWalletBalance } from "@/store/wallet/wallet-slice.ts";
import { bigNumberPlusToString } from "@/utils/common";
import { ellipsis } from "@/utils/ellipsis-format";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import { useLocation } from "react-router-dom";
import ExecutionCard from "./component/execution-card";

export default function BatchTranferPage() {
  const { serverUrl } = useSettingActionData();
  const loading = usePendingExecution();
  const dispatch = useAppDispatch();
  const sendStatus = useSendState();
  const location = useLocation();
  const [sendInputs, setSendInputs] = useState([
    {
      index: 0,
      toAddress: "",
      amount: "",
    },
  ] as SendInputItem[]);
  const [fee, setFee] = useState<string>("0.5");

  const [accept_lustrations, setLustrationAcceptance] = useState<boolean>(false);

  const latestBlock = useLatestBlock();
  const currentWalletID = useCurrentWalledId();
  const wallets = useWallets();
  const currentAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  const currentAddress = useCurrentAddress();
  const syncedBlock = useSyncedBlock();
  const requesTransactionResponse = useRequesetSendTransactionResponse();
  const [selectedInputs, setSelectedInputs] = useState([] as number[]);
  const [selectedAmount, setSelectedAmount] = useState("");
  const availableUtxos = useAvailableUtxos();
  const balanceData = useBalanceData();
  useEffect(() => {
    dispatch(queryCurrentWalletID());
    dispatch(queryWalletBalance({ serverUrl }));
  }, [serverUrl]);
  useEffect(() => {
    if (location.state) {
      setSelectedInputs(location.state);
      handleSelectedAmount(location.state);
    }
  }, [location]);

  function handleSelectedAmount(inputs: number[]) {
    let selectedAmount = "0";
    inputs.forEach((item) => {
      let seleced = availableUtxos.find((data) => Number(data.id) === item);
      if (seleced) {
        selectedAmount = bigNumberPlusToString(selectedAmount, seleced.amount);
      }
    });
    setSelectedAmount(amount_to_positive_fixed(selectedAmount));
  }

  useEffect(() => {
    dispatch(queryExecutionHistorys({ addressId: currentWalletID, serverUrl }));
  }, [dispatch, currentWalletID, serverUrl]);

  function checkButtonDisabled() {
    let disabledButton = false;
    if (loading) {
      return disabledButton;
    }
    if (syncedBlock != 0 && syncedBlock < latestBlock) {
      disabledButton = true;
    }
    let findInput = sendInputs.find((item) => !item.toAddress || !item.amount);
    if (findInput) {
      disabledButton = true;
    }
    return disabledButton;
  }

  function queryNextIndex() {
    let maxIndex = 0;
    sendInputs.find((item) => {
      if (item.index > maxIndex) {
        maxIndex = item.index;
      }
    });
    return maxIndex + 1;
  }

  async function handleSendButtonClick() {
    let hasEmptyInput = false;
    let findInput = sendInputs.find((item) => !item.toAddress || !item.amount);
    if (findInput) {
      hasEmptyInput = true;
    }
    if (hasEmptyInput) {
      notify.error(undefined, "Please complete all required fields.");
      return;
    }

    // Require explicit confirmation before broadcasting the irreversible transaction.
    const totalOut = sendInputs.reduce(
      (sum, item) => bigNumberPlusToString(sum, item.amount.toString() || "0"),
      "0"
    );
    const grandTotal = bigNumberPlusToString(totalOut, fee.toString() || "0");

    modals.openConfirmModal({
      title: "Confirm transaction",
      centered: true,
      size: "lg",
      styles: {
        header: { paddingBottom: 8 },
        body: { paddingTop: 8 },
      },
      children: (
        <Stack gap={12}>
          <Flex align="center" gap={6}>
            <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" />
            <Text size="xs" c="orange.8" fw={500}>
              This action is irreversible.
            </Text>
          </Flex>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 16,
              rowGap: 8,
              alignItems: "center",
            }}
          >
            {sendInputs.map((item, index) => (
              <Fragment key={index}>
                {index > 0 && <Divider style={{ gridColumn: "1 / -1" }} variant="dashed" />}
                <Text size="sm" c="dimmed">
                  {sendInputs.length > 1 ? `Address ${index + 1}` : "Address"}
                </Text>
                <Text size="sm" ta="right" style={{ whiteSpace: "nowrap" }}>
                  {ellipsis(item.toAddress)}
                </Text>
                <Text size="sm" c="dimmed">
                  Amount
                </Text>
                <Text size="sm" ta="right" fw={600}>
                  {item.amount} NPT
                </Text>
              </Fragment>
            ))}
            <Divider style={{ gridColumn: "1 / -1" }} />
            <Text size="sm" c="dimmed">
              Fee
            </Text>
            <Text size="sm" ta="right">
              {fee} NPT
            </Text>
            <Text size="sm" c="dimmed">
              Total (amount + fee)
            </Text>
            <Text size="sm" ta="right" fw={700}>
              {grandTotal} NPT
            </Text>
          </Box>
        </Stack>
      ),
      labels: { confirm: "Confirm & Send", cancel: "Cancel" },
      confirmProps: { color: "green" },
      onConfirm: () => sendTransaction(),
    });
  }

  function sendTransaction() {
    let outputs = [] as Output[];
    sendInputs.forEach((item) => {
      outputs.push({ address: item.toAddress, amount: item.amount.toString() });
    });
    let param = {
      outputs,
      fee: fee.toString(),
      input_rule: "maximum",
      inputs: selectedInputs,
      accept_lustrations,
    } as SendTransactionParam;

    dispatch(
      requestSedExecutionTransaction({
        serverUrl,
        param,
        syncedBlock,
        currentWalletID,
        currentAddress,
        sendInputs,
      })
    );
  }

  useEffect(() => {
    handleRequesTransactionResponse();
  }, [requesTransactionResponse]);
  function handleRequesTransactionResponse() {
    if (requesTransactionResponse && requesTransactionResponse.transaction) {
      clearDatas();
    }
  }
  function clearDatas() {
    setSendInputs([
      {
        index: 0,
        toAddress: "",
        amount: "",
      },
    ] as SendInputItem[]);
    (setFee("0.5"), setSelectedInputs([]), setLustrationAcceptance(false));
  }
  return (
    <WithTitlePageHeader title="Send">
      <ScrollArea
        type="auto"
        scrollbarSize={8}
        style={{ flex: 1, minHeight: 0, marginLeft: -24, marginRight: -24 }}
        styles={{ viewport: { paddingLeft: 24, paddingRight: 24 } }}
      >
        <Stack gap="md">
          <Flex direction={"row"} justify={"space-between"} align={"center"} wrap={"wrap"} gap={8}>
            <Flex direction={"row"} gap={8} align={"center"}>
              <Flex direction={"row"} gap={6} align={"center"}>
                <Text size="sm" c="dimmed">
                  Sending from
                </Text>
                <Text size="sm" fw={600}>
                  {currentAccountName || "—"}
                </Text>
              </Flex>
              {selectedInputs && selectedInputs.length > 0 && (
                <Flex direction={"row"} gap={8}>
                  <Text c="dimmed">{`Selected ${selectedInputs.length} UTXOs amount:`}</Text>
                  <HoverCard width={320} shadow="md" withArrow openDelay={200} closeDelay={400}>
                    <HoverCard.Target>
                      <Text
                        fw={600}
                        c="#0A8430"
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        {selectedAmount}{" "}
                        <Text span c="dimmed" fw={400}>
                          NPT
                        </Text>
                      </Text>
                    </HoverCard.Target>
                    <HoverCard.Dropdown>
                      <Stack gap={5}>
                        <Text size="sm" fw={700} style={{ lineHeight: 1 }}>
                          Selected UTXO IDs
                        </Text>
                      </Stack>
                      <Text size="xs" mt="xs">
                        {`[${selectedInputs.join(", ")}]`}
                      </Text>
                    </HoverCard.Dropdown>
                  </HoverCard>
                </Flex>
              )}
            </Flex>

            <Flex direction={"row"} gap={8}>
              <Text c="dimmed">Available balance:</Text>
              <Text fw={600} c="#0A8430">
                {balanceData.available_balance}{" "}
                <Text span c="dimmed" fw={400}>
                  NPT
                </Text>
              </Text>
            </Flex>
          </Flex>

          <Stack gap={16}>
            {sendInputs &&
              sendInputs.length > 0 &&
              sendInputs.map((item, index) => {
                return (
                  <TransferForm
                    key={index}
                    keyIndex={index}
                    showRemove={sendInputs.length > 1}
                    onChangeAmount={(amount) => {
                      setSendInputs((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, amount: amount } : item))
                      );
                    }}
                    onChangeToAddress={(address) => {
                      setSendInputs((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, toAddress: address } : item))
                      );
                    }}
                    onRemoveWallet={(removeIndex) => {
                      const newItems = sendInputs.filter((input) => input.index !== removeIndex);
                      setSendInputs(newItems);
                    }}
                    data={item}
                  />
                );
              })}
          </Stack>

          <Flex>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => {
                let newSendInput = {
                  index: queryNextIndex(),
                  toAddress: "",
                  amount: "",
                };
                setSendInputs([...sendInputs, newSendInput]);
              }}
            >
              Add address
            </Button>
          </Flex>

          <NumberInput
            mt="sm"
            label={"Fee"}
            w={200}
            value={fee}
            onChange={(value) => setFee(value.toString())}
            required
            placeholder="Enter fee"
            hideControls
            rightSection={
              <Text size="sm" c="dimmed">
                NPT
              </Text>
            }
            rightSectionWidth={48}
          />

          <Switch
            mt="sm"
            label="Accept lustrations"
            labelPosition="left"
            size="md"
            checked={accept_lustrations}
            onChange={(event) => setLustrationAcceptance(event.currentTarget.checked)}
          />

          <Flex>
            <Button
              variant="filled"
              size="sm"
              disabled={checkButtonDisabled()}
              loading={loading}
              onClick={handleSendButtonClick}
            >
              Send
            </Button>
          </Flex>

          {syncedBlock != 0 && syncedBlock < latestBlock ? (
            <Text c={"red"} ta="center">
              * Wait for syncing...
            </Text>
          ) : null}
          {sendStatus ? (
            <Alert
              variant="light"
              color="blue"
              title="Send transaction status"
              icon={<IconInfoCircle />}
            >
              {sendStatus}
            </Alert>
          ) : null}
          <ExecutionCard />
        </Stack>
      </ScrollArea>
    </WithTitlePageHeader>
  );
}
