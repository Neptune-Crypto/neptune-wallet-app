import { useAppDispatch } from "@/store/hooks";
import { useMnemonic } from "@/store/wallet/hooks";
import { setMnemonic, setOneTimePassword, setOneTimeWalletName } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import { Button, Flex, PasswordInput, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { useCallback, useState } from "react";

interface Props {
  nextStep: () => void;
}

export default function CreatePassword(props: Props) {
  const { nextStep } = props;
  const [password, setPassword] = useState("");
  const [visible, { toggle }] = useDisclosure(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const dispatch = useAppDispatch();
  const mnemonic = useMnemonic();

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        // Same gate as the submit button: Enter must not sneak past a missing
        // or mismatched confirmation — the password would silently be the
        // first field's value, which the user can't necessarily reproduce.
        if (password && confirmPassword && password === confirmPassword) {
          createPassword();
        }
      }
    },
    [createPassword]
  );

  async function createPassword() {
    try {
      let name = "Account 1";
      dispatch(setOneTimePassword(password));
      dispatch(setOneTimeWalletName(name));
      // Only generate when no seed exists yet: "Go Back" returns through this
      // step, and regenerating here would silently invalidate a seed the user
      // already revealed and wrote down at the next step. Fresh seeds come only
      // from the explicit "Change seed phrase" button (which announces itself),
      // or after the previous seed was consumed by a completed creation.
      if (!mnemonic) {
        dispatch(setMnemonic(bip39.generateMnemonic(wordlist, 192)));
      }
      nextStep();
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't create password");
    }
  }
  return (
    <Flex direction="column" justify={"center"} align="center" gap={8} w={"100%"}>
      <Text fz={16} fw={600} style={{ textAlign: "center" }}>
        This password will unlock your Neptune Wallet only on this device. Neptune Wallet cannot
        recover this password.
      </Text>
      <Stack w={"100%"}>
        <PasswordInput
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          visible={visible}
          onVisibilityChange={toggle}
        />
        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          onKeyDown={handleKeyPress}
          onChange={(event) => setConfirmPassword(event.target.value)}
          visible={visible}
          onVisibilityChange={toggle}
        />
      </Stack>
      <Flex justify={"center"} align={"center"} w={"100%"} style={{ marginTop: "10px" }}>
        <Button
          variant="light"
          fullWidth
          disabled={!password || !confirmPassword || password !== confirmPassword}
          onClick={createPassword}
        >
          Continue
        </Button>
      </Flex>
    </Flex>
  );
}
