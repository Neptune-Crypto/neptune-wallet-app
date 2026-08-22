import { set_onboarding_password } from "@/commands/password";
import { addWallet } from "@/commands/wallet";
import { startRunRpcServer } from "@/store/auth/auth-slice";
import { useAppDispatch } from "@/store/hooks";
import { useMnemonic, useOneTimePassword, useOneTimeWalletName } from "@/store/wallet/hooks";
import { setMnemonic, setOneTimePassword } from "@/store/wallet/wallet-slice";
import { notify } from "@/utils/notify";
import { Box, Button, Flex, Grid, Text } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
interface Props {
  nextStep: () => void;
}
export default function ConfirmSecret(props: Props) {
  const { nextStep } = props;
  const walletName = useOneTimeWalletName();
  const oneTimePassword = useOneTimePassword();
  const mnemonic = useMnemonic();
  const [numbers, setNumbers] = useState([] as number[]);
  const [loading, setLoading] = useState(false);
  const walletCreated = useRef(false);
  const dispatch = useAppDispatch();
  useEffect(() => {
    generateRandomNumbers();
  }, [mnemonic]);

  const generateRandomNumbers = () => {
    // Generate an array of numbers from 0 to 17
    const arr = Array.from({ length: 18 }, (_, i) => i);

    // Fisher-Yates shuffle algorithm
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Take the first 5 unique numbers
    setNumbers(arr.slice(0, 5));
  };
  const [inputWords, setInputWords] = useState([] as string[]);

  const [verifyWords, setVverifyWords] = useState([] as string[]);

  useEffect(() => {
    if (numbers && numbers.length === 5 && mnemonic) {
      generateRandomWords();
    }
  }, [numbers, mnemonic]);

  function generateRandomWords() {
    const mnemonicList = mnemonic.split(" ");

    const words = numbers.map((num) => mnemonicList[num]);

    // Fisher-Yates shuffle algorithm
    for (let i = words.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [words[i], words[j]] = [words[j], words[i]];
    }

    // Create the verification layout
    const newMnemonicList = mnemonicList.map((item, index) => {
      return numbers.includes(index) ? "" : item;
    });

    setVverifyWords(newMnemonicList);
    setInputWords(words);
  }

  function selecteWord(selectedIndex: number, word: string) {
    // 1. Filter by index to ensure ONLY the clicked duplicate is removed
    const newInputWords = inputWords.filter((_, index) => index !== selectedIndex);

    // 2. Add the word to the first empty slot in verifyWords
    let addOne = false;
    const newVerifyWords = verifyWords.map((item) => {
      if (!addOne && item === "") {
        addOne = true;
        return word;
      }
      return item;
    });

    setVverifyWords(newVerifyWords);
    setInputWords(newInputWords);
  }

  function removeWord(index: number, word: string) {
    const newVerifyWords = verifyWords.map((item, itemIndex) => {
      return index === itemIndex ? "" : item;
    });

    const newInputWords = [...inputWords, word];

    setVverifyWords(newVerifyWords);
    setInputWords(newInputWords);
  }

  async function checkSecret() {
    if (verifyWords.join(" ") != mnemonic) {
      notify.error(undefined, "Some words are in the wrong place. Check them and try again.");
      return;
    }
    setLoading(true);
    try {
      // Order matters: persist the password only after the account exists,
      // so a failed attempt leaves the config untouched. The ref keeps a
      // retry after a password failure from creating a second account.
      if (!walletCreated.current) {
        await addWallet(walletName, mnemonic, 25, 0, true);
        walletCreated.current = true;
      }
      await set_onboarding_password(oneTimePassword);
      dispatch(startRunRpcServer());
      dispatch(setMnemonic(""));
      dispatch(setOneTimePassword(""));
      nextStep();
    } catch (error: any) {
      notify.error(error, "Please try again.", "Couldn't create account");
    }
    setLoading(false);
  }

  return (
    <Flex direction="column" justify={"center"} align="center" gap={8} w={"100%"}>
      <Box
        style={{
          width: "100%",
          border: "1px solid var(--mantine-color-gray-3)",
          borderRadius: "8px",
          padding: "16px",
          backgroundColor: "var(--mantine-color-gray-0)",
          caretColor: "transparent",
        }}
      >
        <Grid gutter={8}>
          {verifyWords &&
            verifyWords.length > 0 &&
            verifyWords.map((word, index) => {
              return (
                <Grid.Col span={4} key={index}>
                  <Flex direction={"row"} justify={"center"} align={"center"} gap={8}>
                    <Text
                      style={{ minWidth: "18px", textAlign: "center" }}
                      size="sm"
                      c="dimmed"
                      fw={500}
                    >{`${index + 1}.`}</Text>
                    <Flex
                      direction={"row"}
                      style={{
                        border: "1px solid var(--mantine-color-gray-3)",
                        borderRadius: "6px",
                        padding: "4px 8px",
                        minWidth: "120px",
                        minHeight: "32px",
                        backgroundColor: "#ffffff",
                        caretColor: "transparent",
                      }}
                      justify={"center"}
                      align={"center"}
                    >
                      <Text fw={500}>{word}</Text>
                      {word && numbers.includes(index) && (
                        <IconX
                          size={14}
                          style={{ cursor: "pointer" }}
                          onClick={() => removeWord(index, word)}
                        />
                      )}
                    </Flex>
                  </Flex>
                </Grid.Col>
              );
            })}
        </Grid>
      </Box>
      <Box
        style={{
          width: "100%",
          padding: "16px",
          caretColor: "transparent",
          minHeight: "120px",
        }}
      >
        <Grid gutter={8}>
          {inputWords &&
            inputWords.map((word, index) => {
              return (
                <Grid.Col
                  span={4}
                  key={index}
                  style={{ cursor: "pointer" }}
                  onClick={() => selecteWord(index, word)}
                >
                  <Flex direction={"row"} justify={"center"} align={"center"} gap={8}>
                    <Text fw={"bold"} style={{ color: "transparent" }}>{`${index + 1}.`}</Text>
                    <Flex
                      style={{
                        // Slightly stronger border than the slots above: these
                        // word-bank chips are clickable.
                        border: "1px solid var(--mantine-color-gray-4)",
                        borderRadius: "6px",
                        padding: "4px 8px",
                        minWidth: "120px",
                        backgroundColor: "#ffffff",
                        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                        caretColor: "transparent",
                      }}
                      justify={"center"}
                    >
                      <Text fw={500}>{word}</Text>
                    </Flex>
                  </Flex>
                </Grid.Col>
              );
            })}
        </Grid>
      </Box>
      <Flex justify={"center"} align={"center"} w={"100%"}>
        <Button
          variant="light"
          fullWidth
          disabled={inputWords && inputWords.length != 0}
          loading={loading}
          onClick={checkSecret}
        >
          Confirm seed phrase
        </Button>
      </Flex>
    </Flex>
  );
}
