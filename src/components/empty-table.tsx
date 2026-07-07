import { Center, Stack, Text } from "@mantine/core";
import { IconInbox } from "@tabler/icons-react";

// Quiet, muted empty state — a dimmed line icon (matching the app's Tabler icon
// language) rather than a heavy filled glyph, and dimmed text.
const EmptyTable = ({ message = "No data" }: { message?: string }) => {
  return (
    <Center style={{ flex: 1, width: "100%", minHeight: 180 }} p={30}>
      <Stack align="center" gap={8}>
        <IconInbox size={44} stroke={1.5} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          {message}
        </Text>
      </Stack>
    </Center>
  );
};

export default EmptyTable;
