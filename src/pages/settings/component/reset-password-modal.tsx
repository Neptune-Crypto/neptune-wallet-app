import { set_password } from "@/commands/password";
import { useAppDispatch } from "@/store/hooks";
import { querySettingActionData } from "@/store/settings/settings-slice";
import { notify } from "@/utils/notify";
import { Button, Flex, Modal, PasswordInput, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useState } from "react";

export default function ResetPasswordModal({
  opened,
  close,
}: {
  opened: boolean;
  close: () => void;
}) {
  const [visible, { toggle }] = useDisclosure(false);
  const [oldpassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const dispatch = useAppDispatch();
  useEffect(() => {
    setOldPassword("");
    setPassword("");
    setConfirmPassword("");
  }, [opened]);
  async function handleSetPassword() {
    if (password === confirmPassword) {
      try {
        await set_password(oldpassword, password);
        dispatch(querySettingActionData());
        notify.success("Password updated successfully");
        close();
      } catch (error: any) {
        notify.error(error, "Please try again.", "Couldn't change password");
      }
    } else {
      notify.error(undefined, "Please enter the same password in both fields");
    }
  }
  return (
    <Modal opened={opened} onClose={close} title="Reset password" centered>
      <Flex direction="column" gap={16}>
        <Stack>
          <PasswordInput
            label="Old password"
            value={oldpassword}
            onChange={(event) => setOldPassword(event.target.value)}
            visible={visible}
            onVisibilityChange={toggle}
          />
          <PasswordInput
            label="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            visible={visible}
            onVisibilityChange={toggle}
          />
          <PasswordInput
            label="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            visible={visible}
            onVisibilityChange={toggle}
          />
        </Stack>
        <Button
          variant={"light"}
          disabled={!oldpassword || !password || password !== confirmPassword}
          onClick={handleSetPassword}
        >
          Update
        </Button>
      </Flex>
    </Modal>
  );
}
