import { Container, Divider, Flex, Space, Text } from "@mantine/core";

export default function WithTitlePageHeader({
  children,
  title,
  buttons,
}: {
  children: React.ReactNode | React.ReactNode[];
  title: string;
  buttons?: React.ReactNode;
}) {
  return (
    // pt keeps a small gap below the fixed window titlebar/controls overlay so
    // top-right header buttons (e.g. "Clear logs") don't collide with the window
    // controls. Lifted from 30 -> 10 to bring the title/content ~20px higher.
    <Container fluid w={"100%"} pt={10}>
      <Flex direction={"column"} px={24} w={"100%"}>
        <Space h={16} />
        <Flex direction={"column"} gap={2}>
          <Flex direction={"row"} justify={"space-between"} align={"center"}>
            <Text fw={500} fz={24}>
              {title}
            </Text>
            {buttons ? buttons : null}
          </Flex>
          {/* size="sm" (2px) matches the Tabs.List bottom border thickness. */}
          <Divider size="sm" />
        </Flex>
        <Space h={16} />
        {children}
      </Flex>
    </Container>
  );
}
