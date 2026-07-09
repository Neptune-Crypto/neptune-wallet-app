import AccountContextLabel from "@/components/account-context-label";
import WithTitlePageHeader from "@/components/header/withTitlePageHeader.tsx";
import MonoText from "@/components/mono-text";
import TransferForm from "@/pages/batch/component/transfer-form.tsx";
import { useAllContacts } from "@/store/contact/hooks";
import {
  queryExecutionHistorys,
  requestSedExecutionTransaction,
  updateSendState,
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
import { requiresLustrationRequest } from "@/utils/api/apis.ts";
import { Output, SendInputItem, SendTransactionParam } from "@/utils/api/types.ts";
import { contactDisplayName } from "@/utils/contact-name";
import {
  Box,
  Button,
  Divider,
  Flex,
  HoverCard,
  List,
  NumberFormatter,
  NumberInput,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconAlertTriangle, IconPlus } from "@tabler/icons-react";
import { Fragment, useEffect, useState } from "react";

import { queryCurrentWalletID, queryWalletBalance } from "@/store/wallet/wallet-slice.ts";
import { bigNumberMinus, bigNumberPlusToString } from "@/utils/common";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import { useLocation } from "react-router-dom";
import ExecutionCard from "./component/execution-card";
import SendProgress from "./component/send-progress";

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

  const latestBlock = useLatestBlock();
  const currentWalletID = useCurrentWalledId();
  const wallets = useWallets();
  const currentAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  const currentAddress = useCurrentAddress();
  const syncedBlock = useSyncedBlock();
  const requesTransactionResponse = useRequesetSendTransactionResponse();
  const [selectedInputs, setSelectedInputs] = useState([] as number[]);
  const [selectedAmount, setSelectedAmount] = useState("");
  // True while the cheap lustration pre-check RPC is in flight (before proving).
  const [preflighting, setPreflighting] = useState(false);
  const balanceData = useBalanceData();
  // For resolving recipient addresses to contact/account names in the confirm
  // modal — a name is far easier to verify than a bech32m fragment.
  const contacts = useAllContacts();
  useEffect(() => {
    dispatch(queryCurrentWalletID());
    dispatch(queryWalletBalance({ serverUrl }));
  }, [serverUrl]);
  useEffect(() => {
    if (location.state) {
      // The selected UTXOs (id + amount) travel through navigation, so this page
      // has their values directly — no cross-page store lookup and no id
      // string/number mismatch (UtxoItem.id is a string; the input field is i64).
      const utxos = location.state as { id: string; amount: string }[];
      setSelectedInputs(utxos.map((u) => Number(u.id)));
      const total = utxos.reduce((sum, u) => bigNumberPlusToString(sum, u.amount || "0"), "0");
      const totalFixed = amount_to_positive_fixed(total);
      setSelectedAmount(totalFixed);
      // Sweep prefill: arriving from UTXO selection, the common intent is to send
      // those coins — prefill the single empty recipient with (total - fee).
      // Prefill only; never overwrite typed values.
      const sweep = bigNumberMinus(totalFixed, fee || "0");
      if (sweep > 0) {
        const sweepAmount = sweep.toFixed(4).replace(/\.?0+$/, "");
        setSendInputs((prev) =>
          prev.length === 1 && prev[0].amount === "" && prev[0].toAddress === ""
            ? [{ ...prev[0], amount: sweepAmount }]
            : prev
        );
      }
    }
  }, [location]);

  useEffect(() => {
    dispatch(queryExecutionHistorys({ addressId: currentWalletID, serverUrl }));
  }, [dispatch, currentWalletID, serverUrl]);

  // --- Composing-time validation (feedback before the confirm modal) ---
  const availableBalance =
    (balanceData?.available_balance ?? "0").toString().replace(/\.$/, "") || "0";
  const feeInvalid = fee.toString().trim() === "" || Number.isNaN(Number(fee));
  const totalOut = sendInputs.reduce(
    (sum, item) => bigNumberPlusToString(sum, item.amount || "0"),
    "0"
  );
  const totalWithFee = bigNumberPlusToString(totalOut, feeInvalid ? "0" : fee || "0");
  // Only meaningful once the user has actually entered an amount somewhere —
  // otherwise a pristine form (fee alone vs an empty balance) would already warn.
  const hasAnyAmount = sendInputs.some((item) => item.amount !== "");
  // With UTXOs selected, the backend funds the transaction ONLY from them — so
  // the selection (not the whole wallet) is the spending ceiling. Fall back to
  // the wallet balance if the selected total isn't known yet (e.g. the UTXO list
  // hasn't loaded on this page), so the form is never wrongly disabled.
  const hasSelection = selectedInputs && selectedInputs.length > 0;
  const selectionKnown = hasSelection && Number(selectedAmount) > 0;
  const spendCeiling = selectionKnown ? selectedAmount : availableBalance;
  const overBalance = hasAnyAmount && bigNumberMinus(spendCeiling, totalWithFee) < 0;
  // Rows repeating an address already used by an earlier row.
  const duplicateIndexes = new Set<number>();
  {
    const seen = new Map<string, number>();
    sendInputs.forEach((item, i) => {
      const addr = item.toAddress.trim();
      if (!addr) return;
      if (seen.has(addr)) duplicateIndexes.add(i);
      else seen.set(addr, i);
    });
  }
  const zeroAmountIndexes = new Set(
    sendInputs
      .map((item, i) => (item.amount !== "" && Number(item.amount) === 0 ? i : -1))
      .filter((i) => i >= 0)
  );

  // Max an individual recipient can receive: available minus fee and the other rows.
  function maxAmountFor(index: number) {
    let others = "0";
    sendInputs.forEach((item, i) => {
      if (i !== index) others = bigNumberPlusToString(others, item.amount || "0");
    });
    const spent = bigNumberPlusToString(others, feeInvalid ? "0" : fee || "0");
    const max = bigNumberMinus(spendCeiling, spent);
    return max > 0 ? max.toString() : "0";
  }

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
    if (feeInvalid || overBalance || duplicateIndexes.size > 0 || zeroAmountIndexes.size > 0) {
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
            {/* No stock Mantine orange clears WCAG AA at 12px on white (orange.8
                ~3.6:1, orange.9 ~4.3:1 vs the required 4.5). This deeper warm tone
                is ~5.2:1 and still reads as a warning; the icon stays orange-6. */}
            <Text size="xs" c="#c2410c" fw={500}>
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
                {/* Known recipient: lead with the contact/account name (the thing a
                    human actually verifies) and dim the address to supporting detail. */}
                {contactDisplayName(contacts, item.toAddress) ? (
                  <Flex direction="column" align="flex-end">
                    <Text size="sm" fw={600}>
                      {contactDisplayName(contacts, item.toAddress)}
                    </Text>
                    <MonoText value={item.toAddress} copy={false} size="xs" c="dimmed" ta="right" />
                  </Flex>
                ) : (
                  <MonoText value={item.toAddress} copy={false} size="sm" ta="right" />
                )}
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
      labels: { confirm: "Confirm & send", cancel: "Cancel" },
      confirmProps: { color: "green" },
      onConfirm: () => sendTransaction(),
    });
  }

  function buildOutputs() {
    const outputs = [] as Output[];
    sendInputs.forEach((item) => {
      outputs.push({ address: item.toAddress, amount: item.amount.toString() });
    });
    return outputs;
  }

  // Entry point from the confirm modal. Runs the cheap pre-check, which also PINS
  // the exact inputs the send will spend (the backend returns the ids it selected),
  // then either prompts — if those inputs require lustration — or broadcasts. Pinning
  // means a new block can't change the selection between here and the broadcast: the
  // send reuses these exact coins, so the lustration decision stays authoritative.
  async function sendTransaction() {
    const preCheckParam = {
      outputs: buildOutputs(),
      fee: fee.toString(),
      input_rule: "maximum",
      inputs: selectedInputs,
      accept_lustrations: false,
    } as SendTransactionParam;

    // Default to the user's own selection; the pre-check refines this to the exact
    // set the backend chose (auto-selected inputs included) so the send can pin it.
    let pinnedInputs = selectedInputs;
    try {
      setPreflighting(true);
      const rep = await requiresLustrationRequest({ serverUrl, param: preCheckParam });
      const preCheck = rep.data as { requires_lustration: boolean; input_ids: number[] };
      if (preCheck && Array.isArray(preCheck.input_ids)) {
        pinnedInputs = preCheck.input_ids;
      }
      if (preCheck && preCheck.requires_lustration === true) {
        promptLustration(pinnedInputs);
        return;
      }
    } catch (error) {
      // If the pre-check fails, fall back to sending with the user's selection
      // (unpinned); the backend still enforces lustration and the safety net in
      // broadcast() re-prompts if needed.
      console.log(error);
    } finally {
      setPreflighting(false);
    }

    await broadcast(pinnedInputs, false);
  }

  // Proves and broadcasts the transaction. `inputs` is passed as the must-include
  // set: the pinned selection covers the amount, so the backend spends exactly those;
  // only the pre-check-failed fallback (a partial selection) lets it auto-fill more.
  // `acceptLustrations` is true only after the user confirmed the prompt.
  async function broadcast(inputs: number[], acceptLustrations: boolean) {
    const param = {
      outputs: buildOutputs(),
      fee: fee.toString(),
      input_rule: "maximum",
      inputs,
      accept_lustrations: acceptLustrations,
    } as SendTransactionParam;

    const action = await dispatch(
      requestSedExecutionTransaction({
        serverUrl,
        param,
        syncedBlock,
        currentWalletID,
        currentAddress,
        sendInputs,
      })
    );

    // Safety net: pinning makes the lustration outcome deterministic, so this is
    // normally unreachable. It still guards the rare case where a pinned coin became
    // unavailable (e.g. spent from another instance) and the backend re-selected a
    // below-barrier coin to cover the amount.
    const result = (action as any)?.payload?.data;
    if (!acceptLustrations && result && !result.transaction && result.requiresLustration) {
      promptLustration(inputs);
    }
  }

  function promptLustration(pinnedInputs: number[]) {
    modals.openConfirmModal({
      title: "Reveal older coins to spend them?",
      centered: true,
      children: (
        <Stack gap={12}>
          <Text size="sm">
            Some coins in this transaction are old enough that the network requires them to be made
            public before you can spend them — a standard rule for older coins.
          </Text>
          <List size="sm" spacing={8}>
            <List.Item>
              <b>Revealed:</b> these coins' amount, and the address that holds them (one of yours),
              become public on the blockchain.
            </List.Item>
            <List.Item>
              <b>Not affected:</b> your other coins aren't revealed by this transaction.
            </List.Item>
            <List.Item>
              <b>Going forward:</b> newer coins aren't affected — you'd only see this again if you
              later spend other old coins.
            </List.Item>
          </List>
        </Stack>
      ),
      labels: { confirm: "Reveal & send", cancel: "Cancel" },
      confirmProps: { color: "green" },
      onConfirm: () => broadcast(pinnedInputs, true),
    });
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
    setFee("0.5");
    setSelectedInputs([]);
    // Hide the progress panel: the backend's last status would otherwise linger
    // indefinitely (nothing else ever clears it). The success toast and the
    // Pending transactions section take over from here.
    dispatch(updateSendState(""));
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
              <AccountContextLabel label="Sending from" name={currentAccountName} />
              {selectedInputs && selectedInputs.length > 0 && (
                <Flex direction={"row"} gap={8} align={"center"}>
                  <Text
                    size="sm"
                    c="dimmed"
                  >{`Selected ${selectedInputs.length} UTXOs amount:`}</Text>
                  <HoverCard width={320} shadow="md" withArrow openDelay={200} closeDelay={400}>
                    <HoverCard.Target>
                      <Text
                        size="sm"
                        fw={600}
                        c="var(--color-positive)"
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        {selectedAmount}{" "}
                        <Text span size="sm" c="dimmed" fw={400}>
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
                  {/* Drop the input constraint without going back to History. */}
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => {
                      setSelectedInputs([]);
                      setSelectedAmount("");
                    }}
                  >
                    Clear
                  </Button>
                </Flex>
              )}
            </Flex>

            {/* size="sm" everywhere in this row: the theme already forces 14px, but
                without the size prop the line-height stays at the md default (1.55),
                making these ~1px taller than the account label — which then gets
                center-shifted down relative to its position on other pages. */}
            <Flex direction={"row"} gap={8}>
              <Text size="sm" c="dimmed">
                Available balance:
              </Text>
              <Text size="sm" fw={600} c="var(--color-positive)">
                {balanceData.available_balance}{" "}
                <Text span size="sm" c="dimmed" fw={400}>
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
                    addressError={
                      duplicateIndexes.has(index) ? "Duplicate recipient address" : undefined
                    }
                    amountError={
                      zeroAmountIndexes.has(index) ? "Amount must be greater than 0" : undefined
                    }
                    onMax={() => {
                      const max = maxAmountFor(index);
                      setSendInputs((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, amount: max } : item))
                      );
                    }}
                    onChangeAmount={(amount) => {
                      setSendInputs((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, amount: amount } : item))
                      );
                    }}
                    onChangeToAddress={(address) => {
                      setSendInputs((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, toAddress: address } : item
                        )
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

          <Flex direction={"column"} gap={6} mt="sm">
            <NumberInput
              label={"Fee"}
              w={200}
              value={fee}
              onChange={(value) => setFee(value.toString())}
              required
              allowNegative={false}
              placeholder="Enter fee"
              hideControls
              error={feeInvalid ? "Enter a fee" : undefined}
              rightSection={
                <Text size="sm" c="dimmed">
                  NPT
                </Text>
              }
              rightSectionWidth={48}
            />
            <Flex direction={"row"} gap={6}>
              {[
                { label: "Low", value: "0.1" },
                { label: "Normal", value: "0.5" },
                { label: "High", value: "1" },
              ].map((preset) => (
                <Button
                  key={preset.value}
                  size="compact-xs"
                  variant={fee === preset.value ? "filled" : "light"}
                  onClick={() => setFee(preset.value)}
                >
                  {preset.label} {preset.value}
                </Button>
              ))}
            </Flex>
          </Flex>

          {/* Live total (recipient amounts + fee), so the user sees what will
              leave the wallet before the confirm modal. Set off with a divider and
              an emphasized value so it reads as the summary, not another field.
              Shown once an amount is entered — a fee-only total is noise. */}
          {hasAnyAmount && (
            <>
              <Divider mt={4} />
              <Flex direction={"row"} justify={"space-between"} align={"center"}>
                <Text size="sm" c="dimmed">
                  Total (amount + fee)
                </Text>
                <Text size="sm" fw={600} c={overBalance ? "red" : undefined}>
                  <NumberFormatter value={totalWithFee} thousandSeparator /> NPT
                </Text>
              </Flex>
            </>
          )}
          {overBalance && (
            <Text c="red" size="sm">
              {selectionKnown
                ? `Amounts plus fee exceed the selected UTXOs' value (${spendCeiling} NPT).`
                : `Amounts plus fee exceed your available balance (${availableBalance} NPT).`}
            </Text>
          )}
          <Flex mt="md">
            <Button
              variant="filled"
              size="sm"
              disabled={checkButtonDisabled() || preflighting}
              loading={loading || preflighting}
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
          {sendStatus ? <SendProgress status={sendStatus} /> : null}
          <ExecutionCard />
        </Stack>
      </ScrollArea>
    </WithTitlePageHeader>
  );
}
