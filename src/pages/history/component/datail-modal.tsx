import TxOutputs from "@/components/tx-outputs";
import { MerageHistory } from "@/store/types";
import { bigNumberPlusToString } from "@/utils/common";
import { amount_to_positive_fixed } from "@/utils/math-util";
import {
  Divider,
  Flex,
  FocusTrap,
  Modal,
  NumberFormatter,
  ScrollArea,
  Table,
  Text,
} from "@mantine/core";
import { format } from "date-fns";
import HistoryUtxoCard from "./history-utxo";
import "./index.css";

interface Props {
  history: MerageHistory;
  opened: boolean;
  onClose: () => void;
}
export default function DetailModal(props: Props) {
  const { history, opened, onClose } = props;
  function handleAmount() {
    let amount = "0";
    if (history && history.batchOutput && history.batchOutput.length > 0) {
      history.batchOutput.forEach((output) => {
        amount = bigNumberPlusToString(amount, output.amount);
      });
    }
    return amount_to_positive_fixed(amount);
  }
  return (
    <Modal
      centered
      opened={opened}
      size="lg"
      onClose={onClose}
      title={"Activity details"}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <FocusTrap.InitialFocus />
      <Table
        variant="vertical"
        layout="fixed"
        withRowBorders={false}
        striped={false}
        styles={{
          th: {
            fontSize: "14px",
            fontWeight: "600",
            width: 130,
            whiteSpace: "nowrap",
            justifyContent: "center",
            justifyItems: "center",
            alignItems: "center",
            background: "transparent",
            verticalAlign: "top",
          },
          tr: {
            fontSize: "10px",
            fontWeight: "500",
            justifyContent: "center",
            justifyItems: "center",
            alignItems: "center",
            verticalAlign: "top",
          },
        }}
      >
        <Table.Tbody>
          {history && history.height ? (
            <Table.Tr>
              <Table.Th>Block height:</Table.Th>
              <Table.Td>
                <Flex w={"100%"} justify={"end"}>
                  <Text>
                    <NumberFormatter value={history.height} thousandSeparator />
                  </Text>
                </Flex>
              </Table.Td>
            </Table.Tr>
          ) : null}
          {history.batchOutput && history.batchOutput.length > 1 ? (
            <Table.Tr>
              <Table.Th>Amount:</Table.Th>
              <Table.Td>
                <Flex w={"100%"} justify={"end"}>
                  <Text fw={600} c={"var(--color-negative)"}>
                    <NumberFormatter value={handleAmount()} thousandSeparator />
                  </Text>
                </Flex>
              </Table.Td>
            </Table.Tr>
          ) : null}
          {(history.outputs && history.outputs.length > 0) ||
          (history.batchOutput && history.batchOutput.length > 0) ? (
            <Table.Tr>
              <Table.Th>Outputs:</Table.Th>
              <Table.Td
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                }}
              >
                <TxOutputs outputs={history.outputs ?? []} batchOutput={history.batchOutput} />
              </Table.Td>
            </Table.Tr>
          ) : null}
          {history.fee ? (
            <Table.Tr>
              <Table.Th>Fee:</Table.Th>
              <Table.Td>
                <Flex w={"100%"} justify={"end"}>
                  <Text fw={600} c={"var(--color-negative)"}>
                    <NumberFormatter
                      value={amount_to_positive_fixed(history.fee)}
                      thousandSeparator
                    />
                  </Text>
                </Flex>
              </Table.Td>
            </Table.Tr>
          ) : null}
          <Table.Tr>
            <Table.Th>Time:</Table.Th>
            <Table.Td>
              <Flex w={"100%"} justify={"end"}>
                <Text>
                  {format(
                    history && history.timestamp ? history.timestamp : "0",
                    "yyyy-MM-dd HH:mm:ss"
                  )}
                </Text>
              </Flex>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Divider my={16} mx={8} />
      <Flex direction={"column"} gap={8}>
        <Text style={{ fontWeight: "bold", fontSize: "16px" }}>{"UTXO changes"}</Text>
        <HistoryUtxoCard datas={history.utxos} />
      </Flex>
    </Modal>
  );
}
