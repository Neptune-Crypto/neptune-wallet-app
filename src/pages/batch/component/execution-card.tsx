import CopyedIcon from "@/components/copyed-icon.tsx";
import { TimeClock } from "@/components/TimeClock";
import { ExecutionHistory } from "@/database/types/localhistory";
import { removeExecutionTransactionHistory } from "@/store/execution/execution-slice";
import { useExecutionDatas, useRequesetSendTransactionResponse } from "@/store/execution/hooks";
import { useAppDispatch } from "@/store/hooks";
import { useSettingActionData } from "@/store/settings/hooks";
import { useCurrentWalledId } from "@/store/wallet/hooks";
import { forgetPendingTransaction } from "@/utils/api/apis";
import { bigNumberPlusToString } from "@/utils/common";
import { ellipsisFormatLen } from "@/utils/ellipsis-format";
import { amount_to_positive_fixed } from "@/utils/math-util";
import { notify } from "@/utils/notify";
import {
  Button,
  Collapse,
  Container,
  Divider,
  Flex,
  NumberFormatter,
  Space,
  Table,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import styles from "./execution.module.css";

export default function ExecutionCard() {
  const [opened, { toggle }] = useDisclosure(false);
  const executions = useExecutionDatas();
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
      notify.done(id, "Transaction forgotten", "Transaction forgotten successfully");
    } catch (error: any) {
      notify.failed(
        id,
        error || "Transaction forget failed",
        "Transaction forget failed, please try again later"
      );
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

  // Only show the section when there is something in progress.
  if (!executions || executions.length === 0) {
    return null;
  }

  return (
    <Container fluid style={{ width: "100%" }}>
      <Space h={16} />
      <Flex direction={"column"} gap={2} px={24}>
        <Flex direction={"row"} justify={"space-between"} align={"center"}>
          <Text fw={500} fz={24}>
            In execution
          </Text>
          {executions && executions.length > 0 && (
            <Flex direction={"row"} gap={16}>
              <Text>{executions.length} executions</Text>
              <IconChevronDown
                onClick={toggle}
                style={{
                  cursor: "pointer",
                  transform: opened ? "rotate(-180deg) scale(1.2)" : "none",
                  transition: "transform 0.3s ease",
                }}
              />
            </Flex>
          )}
        </Flex>
        <Divider />
      </Flex>
      <Collapse in={opened} px={24}>
        {executions &&
          executions.length > 0 &&
          executions.map((item, index) => {
            return (
              <Flex
                key={index}
                direction={"column"}
                style={{
                  borderBottom: "1px solid #E5E5E5",
                }}
              >
                <Space h={16} />
                <Table
                  variant="vertical"
                  layout="fixed"
                  withRowBorders={false}
                  striped={false}
                  styles={{
                    th: {
                      fontSize: "12px",
                      fontWeight: "600",
                      justifyContent: "center",
                      justifyItems: "center",
                      alignItems: "center",
                      verticalAlign: "top",
                      background: "transparent",
                    },
                    tr: {
                      fontSize: "10px",
                      fontWeight: "500",
                      verticalAlign: "top",
                      justifyContent: "center",
                      justifyItems: "center",
                      alignItems: "center",
                    },
                  }}
                >
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Th>
                        <TimeClock
                          style={{
                            color: "#0A8430",
                          }}
                          timeStamp={Math.floor(item.timestamp / 1000)}
                        />
                      </Table.Th>
                      <Table.Td>
                        <Flex w={"100%"} justify={"end"}>
                          <Button
                            variant="light"
                            disabled={loadingForget}
                            size="xs"
                            onClick={() => forgetTx(item.txid)}
                            className={styles.cancleBtn}
                            color="red.9"
                          >
                            Forget
                          </Button>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Th w={100}>ID:</Table.Th>
                      <Table.Td
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        <Flex key={index} align={"end"} direction={"column"} gap={8}>
                          <Flex direction={"row"} gap={8} align={"center"}>
                            <Text>{ellipsisFormatLen(item.txid, 15)}</Text>
                            <CopyedIcon size={16} value={item.txid} />
                          </Flex>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Th w={100}>Outputs:</Table.Th>
                      <Table.Td
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        <Flex direction={"column"} gap={8}>
                          {item.outputs?.map((output, index) => {
                            return (
                              <Flex key={index} align={"end"} direction={"column"} gap={8}>
                                <Flex direction={"row"} gap={8} align={"center"}>
                                  <Text>{ellipsisFormatLen(output, 15)}</Text>
                                  <CopyedIcon size={16} value={output} />
                                </Flex>
                              </Flex>
                            );
                          })}
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Th w={100}>To address:</Table.Th>
                      <Table.Td
                        style={{
                          wordWrap: "break-word",
                          overflowWrap: "break-word",
                        }}
                      >
                        <Flex direction={"column"} gap={8}>
                          {item.batchOutput?.map((output, index) => {
                            return (
                              <Flex key={index} align={"end"} direction={"column"} gap={8}>
                                <Flex direction={"row"} gap={8} align={"center"}>
                                  <Text>{ellipsisFormatLen(output.toAddress, 15)}</Text>
                                  <CopyedIcon size={16} value={output.toAddress} />
                                </Flex>
                              </Flex>
                            );
                          })}
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                    <Table.Tr>
                      <Table.Th>Amount:</Table.Th>
                      <Table.Td>
                        <Flex w={"100%"} justify={"end"}>
                          <Text c={"#0A8430"}>
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
                          <Text c={"#0A8430"}>
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
                            <Text c={"#0A8430"}>
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
                          <Text c={"#0A8430"} fw={700}>
                            <NumberFormatter
                              value={handleTotal(item)}
                              thousandSeparator
                              suffix=" NPT"
                            />
                          </Text>
                        </Flex>
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Flex>
            );
          })}
      </Collapse>
    </Container>
  );
}
