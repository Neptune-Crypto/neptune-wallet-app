import { TimeClock } from "@/components/TimeClock";
import TxOutputs from "@/components/tx-outputs";
import { ExecutionHistory } from "@/database/types/localhistory";
import { removeExecutionTransactionHistory } from "@/store/execution/execution-slice";
import {
  useExecutionAddressId,
  useExecutionDatas,
  useRequesetSendTransactionResponse,
} from "@/store/execution/hooks";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useCurrentWalledId } from "@/store/wallet/hooks";
import { queryWalletBalance, queryWallets } from "@/store/wallet/wallet-slice";
import { forgetPendingTransaction } from "@/utils/api/apis";
import { bigNumberPlusToString } from "@/utils/common";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import {
  Button,
  Card,
  Collapse,
  Divider,
  Flex,
  List,
  NumberFormatter,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { IconChevronDown } from "@tabler/icons-react";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import styles from "./execution.module.css";

export default function ExecutionCard() {
  const [opened, { toggle }] = useDisclosure(false);
  const executions = useExecutionDatas();
  const executionAddressId = useExecutionAddressId();
  const { serverUrl } = useSettingActionData();
  const walletId = useCurrentWalledId();
  const dispatch = useAppDispatch();
  const [loadingForget, setLoadingForget] = useState(false);
  const requesTransactionResponse = useRequesetSendTransactionResponse();

  useEffect(() => {
    if (requesTransactionResponse.transaction && executions && executions.length > 0 && !opened) {
      toggle();
    }
  }, [requesTransactionResponse]);

  // "Forget" only deletes this app's local records (the pending entry and the
  // coins' pending-spent markers) — it does NOT recall the transaction from the
  // network. Spell that out before acting, since users will read it as "cancel".
  function confirmForget(txid: string) {
    modals.openConfirmModal({
      title: "Forget this pending transaction?",
      centered: true,
      children: (
        <Stack gap={12}>
          <Text size="sm">
            Forgetting removes the transaction from this app's pending list — it does not cancel it.
            If it already reached the network, it can still confirm.
          </Text>
          <List size="sm" spacing={8}>
            <List.Item>
              <b>Coins are freed:</b> the coins it uses become available to spend again in this app.
            </List.Item>
            <List.Item>
              <b>If it still confirms:</b> those coins are spent after all, and any new transaction
              that reused them will fail.
            </List.Item>
          </List>
          <Text size="sm">
            Only forget a transaction you believe is permanently stuck or was never broadcast.
          </Text>
        </Stack>
      ),
      labels: { confirm: "Forget", cancel: "Cancel" },
      confirmProps: { color: "red.9", variant: "light" },
      onConfirm: () => forgetTx(txid),
    });
  }

  async function forgetTx(txid: string) {
    const id = notify.loading("Forgetting transaction", "Forgetting transaction, please wait...");
    try {
      setLoadingForget(true);
      await forgetPendingTransaction({ serverUrl, txid });
      dispatch(
        removeExecutionTransactionHistory({
          txid,
          addressId: walletId,
          serverUrl,
        })
      );
      // Forgetting frees the pending coins ("Coins are freed", per the confirm
      // modal) — refetch so the balance cards, the accounts table, and the
      // "awaiting confirmation" hint reflect that immediately.
      dispatch(queryWalletBalance({ serverUrl }));
      dispatch(queryWallets());
      notify.done(id, "Transaction forgotten", "Transaction forgotten successfully");
    } catch (error: any) {
      // Title = the action, body = the reason.
      notify.failed(id, "Couldn't forget transaction", error ? String(error) : "Please try again.");
    }
    setLoadingForget(false);
  }

  function handleAmount(item: ExecutionHistory) {
    let amount = "0";
    if (item && item.batchOutput && item.batchOutput.length > 0) {
      item.batchOutput.forEach((output) => {
        amount = bigNumberPlusToString(amount, output.amount);
      });
    }
    return amount_to_positive_fixed(amount);
  }

  // Total value spent: outputs + fee (+ priority fee, when present).
  function handleTotal(item: ExecutionHistory) {
    let total = bigNumberPlusToString(handleAmount(item), amount_to_positive_fixed(item.fee));
    if (item.priorityFee) {
      total = bigNumberPlusToString(total, amount_to_positive_fixed(item.priorityFee));
    }
    return total;
  }

  // Only show the section when there is something in progress — and only when
  // the stored list actually belongs to the active account: after an account
  // switch the previous account's pending list would otherwise flash here
  // until the refetch for the new account lands.
  if (!executions || executions.length === 0 || executionAddressId !== walletId) {
    return null;
  }

  return (
    // No own Container/padding: this renders inside the Send form's stack, whose
    // scroll viewport already provides the page inset — wrapping again double-
    // indented the section. Section-scale heading (the 24px version read as a
    // second page title).
    <Flex direction={"column"} gap={2} mt="md" style={{ width: "100%" }}>
      {/* The whole header is the disclosure trigger (a real button, so it is
          keyboard-focusable); the chevron is just the state indicator. */}
      <UnstyledButton onClick={toggle} aria-expanded={opened} style={{ width: "100%" }}>
        <Flex direction={"row"} justify={"space-between"} align={"center"}>
          <Text fw={600} fz={16}>
            Transactions awaiting network confirmation
          </Text>
          {executions && executions.length > 0 && (
            <Flex direction={"row"} gap={16} align={"center"}>
              <Text size="sm" c="dimmed">
                {executions.length} pending
              </Text>
              <IconChevronDown
                style={{
                  transform: opened ? "rotate(-180deg) scale(1.2)" : "none",
                  transition: "transform 0.3s ease",
                }}
              />
            </Flex>
          )}
        </Flex>
      </UnstyledButton>
      <Divider />
      <Collapse in={opened}>
        {executions &&
          executions.length > 0 &&
          executions.map((item, index) => {
            return (
              <Card key={index} withBorder radius="md" padding="md" mt={index === 0 ? "sm" : "xs"}>
                {/* Card header: metadata (when it was sent) + the card's action.
                    Kept OUTSIDE the key-value table below — an unlabeled bold
                    time in the label column would read as a key with no value.
                    The absolute timestamp rides on hover (a second text line
                    would add height to an already-tall card). Hidden for
                    node-reported transactions with no local record, whose
                    timestamp of 0 would render as a decades-old epoch age. */}
                <Flex direction="row" justify="space-between" align="center" mb={8}>
                  {item.timestamp ? (
                    <Tooltip label={format(item.timestamp, "yyyy-MM-dd HH:mm:ss")} withArrow>
                      <Text size="sm" c="dimmed" style={{ cursor: "help" }}>
                        Sent <TimeClock timeStamp={Math.floor(item.timestamp / 1000)} />
                      </Text>
                    </Tooltip>
                  ) : (
                    <span />
                  )}
                  <Button
                    variant="light"
                    disabled={loadingForget}
                    size="xs"
                    onClick={() => confirmForget(item.txid)}
                    className={styles.cancleBtn}
                    color="red.9"
                  >
                    Forget
                  </Button>
                </Flex>
                {/* Each pending transaction in its own card so multiple are clearly
                    separated. Default 14px type like the History detail modal;
                    labels bold, cells top-aligned for wrapped values. */}
                <Table
                  variant="vertical"
                  layout="fixed"
                  withRowBorders={false}
                  striped={false}
                  styles={{
                    th: {
                      fontWeight: 600,
                      verticalAlign: "top",
                      background: "transparent",
                    },
                    tr: {
                      verticalAlign: "top",
                    },
                  }}
                >
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Th>Amount:</Table.Th>
                      <Table.Td>
                        <Flex w={"100%"} justify={"end"}>
                          <Text c={"var(--color-positive)"}>
                            <NumberFormatter
                              value={handleAmount(item)}
                              thousandSeparator
                              suffix=" NPT"
                            />
                          </Text>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Th>Fee:</Table.Th>
                      <Table.Td>
                        <Flex w={"100%"} justify={"end"}>
                          <Text c={"var(--color-positive)"}>
                            <NumberFormatter
                              value={amount_to_positive_fixed(item.fee)}
                              thousandSeparator
                              suffix=" NPT"
                            />
                          </Text>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>

                    {item.priorityFee && (
                      <Table.Tr>
                        <Table.Th>Priority fee:</Table.Th>
                        <Table.Td>
                          <Flex w={"100%"} justify={"end"}>
                            <Text c={"var(--color-positive)"}>
                              <NumberFormatter
                                value={amount_to_positive_fixed(item.priorityFee)}
                                thousandSeparator
                                suffix=" NPT"
                              />
                            </Text>
                          </Flex>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    <Table.Tr>
                      <Table.Th>Total:</Table.Th>
                      <Table.Td>
                        <Flex w={"100%"} justify={"end"}>
                          <Text c={"var(--color-positive)"} fw={700}>
                            <NumberFormatter
                              value={handleTotal(item)}
                              thousandSeparator
                              suffix=" NPT"
                            />
                          </Text>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    {/* Outputs last: the money summary above is what a user checks
                        first; the per-output commitments are verbose and secondary. */}
                    <Table.Tr>
                      <Table.Th w={100}>Outputs:</Table.Th>
                      <Table.Td
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        <TxOutputs outputs={item.outputs} batchOutput={item.batchOutput} />
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Card>
            );
          })}
      </Collapse>
    </Flex>
  );
}
