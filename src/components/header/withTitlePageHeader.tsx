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
    <Container
      fluid
      w={"100%"}
      pt={10}
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
    >
      <Flex direction={"column"} px={24} w={"100%"} style={{ flex: 1, minHeight: 0 }}>
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
        {/* Flex-fill content region: a page can give its scroll area `flex: 1`
            (instead of a hard-coded `h={calc(100vh - Npx)}`) and it will fill the
            remaining height down to a single consistent bottom margin (paddingBottom
            below). Pages still using a fixed-height scroll area are unaffected. */}
        <Flex direction={"column"} style={{ flex: 1, minHeight: 0, paddingBottom: 24 }}>
          {children}
        </Flex>
      </Flex>
    </Container>
  );
}
