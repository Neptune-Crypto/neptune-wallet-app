import { Info } from "@/store/types";
import { Box, Divider, Flex, LoadingOverlay, Paper, Text } from "@mantine/core";

interface Props {
  leftSection: React.ReactNode;
  label: string;
  hide?: boolean;
  rightSection: React.ReactNode;
  value?: string;
  valueColor?: string;
  info?: Info;
  description?: string;
}
export default function BaseItem({
  leftSection,
  label,
  rightSection,
  hide,
  value,
  valueColor,
  info,
  description,
}: Props) {
  return (
    <Flex direction={"column"} px={4}>
      <Paper shadow="xs" radius="md" p={"xs"} w={"100%"}>
        <Flex direction="row" justify="space-between" align={"flex-start"} gap={12}>
          {/* The text column grows to fill the row's spare width (flex:1). The
              description overrides the global overflow-wrap:break-word to break at
              spaces only — otherwise it chops words mid-way ("bal / ance"). */}
          <Flex direction={"row"} gap={8} align={"center"} style={{ flex: 1, minWidth: 0 }}>
            {leftSection}
            <Flex direction={"column"} style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="md">
                {label}
              </Text>
              {description && (
                <Text size="xs" c="dimmed" style={{ overflowWrap: "normal", wordBreak: "normal" }}>
                  {description}
                </Text>
              )}
            </Flex>
          </Flex>
          {/* Keep the action/value control at its natural size instead of shrinking. */}
          <Box style={{ flexShrink: 0 }}>{rightSection}</Box>
        </Flex>
        {value && <Divider my={8} />}
        {value && (
          <Box pos="relative">
            <LoadingOverlay
              visible={hide}
              zIndex={200}
              overlayProps={{ radius: "sm", blur: 3 }}
              loaderProps={{ children: <></> }}
            />
            <Text px={"xl"} c={valueColor ?? ""}>
              {value}
            </Text>
          </Box>
        )}
        {info && <Divider my={8} />}
        {info && (
          <Flex direction={"column"} px={"xl"} gap={4}>
            <Text>Type: {info.os_type}</Text>
            <Text>Edition: {info.edition}</Text>
            <Text>Version: {JSON.stringify(info.version)}</Text>
            <Text>Bitness: {info.bitness}</Text>
            <Text>Architecture: {info.architecture}</Text>
          </Flex>
        )}
      </Paper>
    </Flex>
  );
}
