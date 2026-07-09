import { input_password, set_password } from "@/commands/password";
import { AppMark } from "@/components/loading-card";
import { checkAuthPassword } from "@/store/auth/auth-slice";
import { useAuth } from "@/store/auth/hooks";
import { useAppDispatch } from "@/store/hooks";
import { notify } from "@/utils/notify";
import { Button, Card, Center, Flex, Group, PasswordInput, Space, Text } from "@mantine/core";
import { useCallback, useState } from "react";
import HomeScreen from "../home";
function LockPage() {
  const [password, setPassword] = useState("");
  const dispatch = useAppDispatch();
  const { hasPassword } = useAuth();
  async function handleUnlock() {
    try {
      await input_password(password);
      dispatch(checkAuthPassword());
    } catch (error) {
      notify.error(undefined, "Invalid password");
    }
  }
  async function handleSetPassword() {
    try {
      await set_password("", password);
      dispatch(checkAuthPassword());
    } catch (error: any) {
      console.log(error);
      notify.error(error, "Please try again.", "Couldn't set password");
    }
  }

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (password) {
          if (hasPassword) {
            handleUnlock();
          } else {
            handleSetPassword();
          }
        }
      }
    },
    [handleSetPassword]
  );

  return (
    <Flex direction={"column"} w={"100%"}>
      {!hasPassword ? (
        <HomeScreen />
      ) : (
        <Center w={"100%"} h={"100vh"}>
          {/* 420px is the conventional login-card size; cap the width so the
              password field doesn't stretch on wide windows. */}
          <Card shadow="sm" padding="lg" radius="md" withBorder w="90%" maw={420}>
            <Group justify="center" mb="xs">
              <Text fz="lg" fw={"800"}>
                Neptune Wallet
              </Text>
            </Group>
            {/* The N app mark matches the OS icon; drag-region kept so the window
                stays draggable from here. */}
            <Flex justify={"center"} align={"center"} data-tauri-drag-region py={8}>
              <AppMark size={96} />
            </Flex>
            <Space h={32} />
            <Flex direction={"column"} gap={32} justify="center" w={"100%"}>
              <PasswordInput
                label="Password"
                placeholder="Enter password to unlock"
                value={password}
                onKeyDown={handleKeyPress}
                onChange={(event) => setPassword(event.currentTarget.value)}
                autoFocus={true}
              />
              <Button variant="light" disabled={!password} onClick={handleUnlock}>
                Unlock
              </Button>
            </Flex>
          </Card>
        </Center>
      )}
    </Flex>
  );
}

export default LockPage;
