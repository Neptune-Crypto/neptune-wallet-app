import AccountContextLabel from "@/components/account-context-label";
import {
  useBalanceData,
  useCurrentWalledId,
  useLoadingBalance,
  useWallets,
} from "@/store/wallet/hooks";
import { bigNumberMinus, bigNumberPlusToString } from "@/utils/common";
import { Box, Card, Flex, Grid, LoadingOverlay, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";

// Headline balance figure with de-emphasized decimals: the integer part is what
// users scan for, and with the app-wide fixed 4 decimals a round balance would
// otherwise read "29.0000" at full size — half the headline being zeros. Smaller
// decimals extend the existing hierarchy (the NPT suffix is already smaller and
// dimmer). Cards only: tables keep uniform digits for column alignment.
function BalanceFigure({ value }: { value: string | number }) {
  const [intRaw, fracRaw] = value.toString().split(".");
  const intFormatted = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (fracRaw ?? "").padEnd(4, "0").slice(0, 4);
  return (
    <>
      {intFormatted}
      <span style={{ fontSize: "0.6em", opacity: 0.75 }}>.{frac}</span>
    </>
  );
}

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
    let pending_balance =
      balanceData && balanceData.pending_balance ? balanceData.pending_balance : 0;
    let total_balance = balanceData && balanceData.total_balance ? balanceData.total_balance : 0;
    // total = available + time-locked + pending (expected incoming change), so
    // locked here is strictly the time-locked bucket.
    let lock_balance =
      bigNumberMinus(bigNumberMinus(total_balance, available_balance), pending_balance) > 0
        ? bigNumberMinus(bigNumberMinus(total_balance, available_balance), pending_balance)
        : "0.0000";
    // The Wallet page is the OWNERSHIP view: the card includes change awaiting
    // confirmation (it's still the user's money), so the figure doesn't crash to
    // 0 mid-send and agrees with the accounts table below. The SEND page is the
    // action view and shows what's spendable right now — lifecycle detail lives
    // there, where it constrains something. Here it's a tooltip, on demand.
    const withPending = bigNumberPlusToString(
      available_balance.toString(),
      pending_balance.toString()
    );
    const options = [
      {
        title: "Available balance",
        // Ownership view: the figure includes change awaiting confirmation —
        // still the user's money. The spendability story (and the awaiting-
        // confirmation breakdown) lives on the Send page, where it constrains
        // something; this card intentionally carries no pending-state affordance.
        value: <BalanceFigure value={withPending} />,
      },
      {
        title: "Locked balance",
        tooltip: "Time-locked coins — funds you own that become spendable at a set date.",
        value: <BalanceFigure value={lock_balance} />,
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
        // Fill the grid column so the pair always renders at equal height even
        // if one card's content grows a line taller than the other's.
        h={"100%"}
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
              {/* While refreshing (e.g. after an account switch) the value is kept
                  in state, so just dim it gently — a white LoadingOverlay flashed
                  over the figure on the colored card. */}
              <Text
                style={{
                  color: textColor,
                  fontWeight: "500",
                  fontSize: "32px",
                  letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.1,
                  opacity: loading ? 0.5 : 1,
                  transition: "opacity 150ms ease",
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
      <AccountContextLabel name={activeAccountName} />
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
