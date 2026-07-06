import {
  useBalanceData,
  useCurrentWalledId,
  useLoadingBalance,
  useWallets,
} from "@/store/wallet/hooks";
import { bigNumberMinus } from "@/utils/common";
import {
  Box,
  Card,
  Flex,
  Grid,
  LoadingOverlay,
  NumberFormatter,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

export default function BalanceCard() {
  const [options, setOptions] = useState([] as any[]);
  const loading = useLoadingBalance();
  const balanceData = useBalanceData();
  // The cards show the ACTIVE account's balances; name it so that is unambiguous
  // (the accounts table below shows per-account and portfolio totals).
  const wallets = useWallets();
  const currentWalletID = useCurrentWalledId();
  const activeAccountName = wallets.find((w) => w.id === currentWalletID)?.name;
  useEffect(() => {
    handleOverviewData();
  }, [balanceData]);
  function handleOverviewData() {
    let available_balance =
      balanceData && balanceData.available_balance ? balanceData.available_balance : 0;
    let total_balance = balanceData && balanceData.total_balance ? balanceData.total_balance : 0;
    let lock_balance =
      bigNumberMinus(total_balance, available_balance) > 0
        ? bigNumberMinus(total_balance, available_balance)
        : "0.0000";
    const options = [
      {
        title: "Available balance",
        value: <NumberFormatter value={available_balance} thousandSeparator />,
      },
      {
        title: "Locked balance",
        tooltip:
          "Funds you own that aren't spendable yet — e.g. time-locked outputs or coins still awaiting confirmation.",
        value: <NumberFormatter value={lock_balance} thousandSeparator />,
      },
    ];
    setOptions(options);
  }
  function BaseCard({
    title,
    children,
    hideButton,
    tooltip,
  }: {
    title: string;
    children: React.ReactNode;
    hideButton?: boolean;
    tooltip?: string;
  }) {
    // Both cards use white text; the gradients' light end is contrast-tuned to
    // clear WCAG AA, and the deep end only darkens (see app.css, where the
    // gradient classes live).
    const textColor = "white";
    return (
      <Card
        radius="lg"
        p="lg"
        w={"100%"}
        className={hideButton ? "balance-card-locked" : "balance-card-available"}
      >
        <Flex direction={"column"} w={"100%"} gap={8}>
          <Flex
            direction={"row"}
            gap={4}
            justify="center"
            align="center"
            style={{ whiteSpace: "nowrap" }}
          >
            <Text style={{ color: textColor, opacity: 0.8, fontWeight: "500", fontSize: "13px" }}>
              {title}
            </Text>
            {tooltip && (
              <Tooltip label={tooltip} multiline w={240} withArrow position="top">
                <IconInfoCircle
                  size={14}
                  color={textColor}
                  style={{ opacity: 0.75, cursor: "help" }}
                />
              </Tooltip>
            )}
          </Flex>
          <Flex direction={"row"} gap={6} justify="center" align="baseline">
            <Box pos="relative">
              <LoadingOverlay
                visible={loading}
                zIndex={1000}
                overlayProps={{ radius: "sm", blur: 3 }}
                loaderProps={{ color: "blue", type: "dots" }}
              />
              <Text
                style={{
                  color: textColor,
                  fontWeight: "500",
                  fontSize: "32px",
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.1,
                }}
              >
                {children}
              </Text>
            </Box>
            <Text style={{ color: textColor, fontWeight: "500", fontSize: "13px", opacity: 0.65 }}>
              NPT
            </Text>
          </Flex>
        </Flex>
      </Card>
    );
  }

  return (
    <Flex direction={"column"} w={"100%"} gap={8}>
      <Flex direction={"row"} gap={6} align={"center"}>
        <Text size="sm" c="dimmed">
          Active account:
        </Text>
        <Text size="sm" fw={600}>
          {activeAccountName || "—"}
        </Text>
      </Flex>
      <Box pos="relative">
        <LoadingOverlay visible={false} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
        <Grid grow gutter={"lg"}>
          {options.map((item, index) => {
            return (
              <Grid.Col key={index} span={6}>
                <BaseCard title={item.title} hideButton={index === 1} tooltip={item.tooltip}>
                  {item.value}
                </BaseCard>
              </Grid.Col>
            );
          })}
        </Grid>
      </Box>
    </Flex>
  );
}
