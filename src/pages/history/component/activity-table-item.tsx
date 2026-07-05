import { MerageHistory } from "@/store/types";
import { ActionIcon, Center, NumberFormatter, Stack, Table, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { format, formatDistanceToNow } from "date-fns";
import "./index.css";

interface Props {
  element: MerageHistory;
  showMoreDetail: () => void;
}
export default function ActivityTableItem(props: Props) {
  const { element, showMoreDetail } = props;
  return (
    <Table.Tr>
      <Table.Td>
        <Text c={"#0A8030"}>
          <NumberFormatter value={element.height} thousandSeparator />
        </Text>
      </Table.Td>
      <Table.Td>
        <Center>
          {element.changeAmount.startsWith("-") ? (
            <Text fw={600} c={"#C92A2A"}>
              {element.changeAmount}
            </Text>
          ) : (
            <Text fw={600} c={"#0A8030"}>
              {element.changeAmount}
            </Text>
          )}
        </Center>
      </Table.Td>
      <Table.Td>
        <Center>
          <Stack gap={0} align="center">
            <Text c={"#0A8030"}>{format(element.timestamp, "yyyy-MM-dd HH:mm:ss")}</Text>
            <Text size="xs" c="dimmed">
              {formatDistanceToNow(element.timestamp, { addSuffix: true })}
            </Text>
          </Stack>
        </Center>
      </Table.Td>
      <Table.Td>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="View transaction details"
          onClick={() => showMoreDetail()}
        >
          <IconInfoCircle size={18} />
        </ActionIcon>
      </Table.Td>
    </Table.Tr>
  );
}
