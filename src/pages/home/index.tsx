import { AppMark } from "@/components/loading-card";
import { Button, Card, Center, Flex, Group, Text } from "@mantine/core";
import { useState } from "react";
import CreatePage from "../create";
import ImportPage from "../import";

export default function HomeScreen() {
  const [activityPage, setActivePage] = useState("");
  function onBackFunction() {
    setActivePage("");
  }
  return (
    <Center w={"100%"} h={"100vh"}>
      {activityPage === "create" && <CreatePage onBack={onBackFunction} />}
      {activityPage === "import" && <ImportPage onBack={onBackFunction} />}
      {activityPage === "" && (
        <Card shadow="sm" radius="md" withBorder w={500} h={400}>
          <Group justify="center" mb="xs">
            <Text fz="lg" fw={"800"}>
              Neptune Wallet
            </Text>
          </Group>
          {/* The N app mark matches the OS icon; drag-region kept so the window
              stays draggable from here. */}
          <Flex justify={"center"} align={"center"} data-tauri-drag-region py={16}>
            <AppMark size={96} />
          </Flex>
          <Flex
            direction="column"
            w={"100%"}
            gap={16}
            justify={"center"}
            align={"center"}
            style={{
              position: "absolute",
              bottom: 16,
              left: 0,
              width: "100%",
            }}
          >
            <Button
              variant="light"
              color="blue"
              fullWidth
              w={"60%"}
              radius={"md"}
              onClick={() => setActivePage("create")}
            >
              Create a new account
            </Button>
            <Button
              variant="default"
              color="blue"
              fullWidth
              w={"60%"}
              radius={"md"}
              onClick={() => setActivePage("import")}
            >
              Import an existing account
            </Button>
          </Flex>
        </Card>
      )}
    </Center>
  );
}
