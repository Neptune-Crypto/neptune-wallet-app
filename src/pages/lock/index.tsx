import { input_password, set_password } from "@/commands/password";
import { checkAuthPassword } from "@/store/auth/auth-slice";
import { useAuth } from "@/store/auth/hooks";
import { useAppDispatch } from "@/store/hooks";
import { notify } from "@/utils/notify";
import {
  Button,
  Card,
  Center,
  Flex,
  Group,
  Image,
  PasswordInput,
  Space,
  Text,
} from "@mantine/core";
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
      notify.error(error, "Set password failed");
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
          <Card shadow="sm" padding="lg" radius="md" withBorder w={"60%"}>
            <Group justify="center" mb="xs">
              <Text fz="lg" fw={"800"}>
                Neptune Wallet
              </Text>
            </Group>
            <Flex justify={"center"} align={"center"}>
              <Image data-tauri-drag-region src={"/logo.png"} w={"100%"} h={129} />
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
