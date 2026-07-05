import { useBalanceData, useLoadingBalance } from "@/store/wallet/hooks";
import { bigNumberMinus } from "@/utils/common";
import {
  Box,
  Button,
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
import { useNavigate } from "react-router-dom";

export default function BalanceCard() {
  const [options, setOptions] = useState([] as any[]);
  const navigate = useNavigate();
  const loading = useLoadingBalance();
  const balanceData = useBalanceData();
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
    return (
      <Card
        radius="md"
        bg={hideButton ? "var(--lockbalancebackground)" : "var(--balancebackground)"}
        w={"100%"}
      >
        <Flex direction={"column"} w={"100%"} gap={16}>
          <Flex
            direction={"row"}
            gap={4}
            justify="center"
            align="center"
            style={{
              whiteSpace: "nowrap",
            }}
          >
            <Text style={{ color: "white", fontWeight: "500", fontSize: "14px" }}>{title}</Text>
            {tooltip && (
              <Tooltip label={tooltip} multiline w={240} withArrow position="top">
                <IconInfoCircle size={14} color="white" style={{ opacity: 0.75, cursor: "help" }} />
              </Tooltip>
            )}
          </Flex>
          <Flex direction={"row"} gap={6} justify="center" align="baseline">
            <Box pos="relative">
              <LoadingOverlay
                visible={loading}
                zIndex={1000}
                overlayProps={{ radius: "sm", blur: 3 }}
                loaderProps={{ color: "orange", type: "dots" }}
              />
              <Text style={{ color: "white", fontWeight: "500", fontSize: "32px" }}>
                {children}
              </Text>
            </Box>
            <Text style={{ color: "white", fontWeight: "500", fontSize: "16px", opacity: 0.75 }}>
              NPT
            </Text>
          </Flex>
          {hideButton ? (
            <Flex direction={"row"} justify="center" align="center">
              <Button
                color="transparent"
                style={{
                  backgroundColor: "transparent",
                  cursor: "default",
                  color: "transparent",
                }}
              ></Button>
            </Flex>
          ) : (
            <Flex direction={"row"} justify="center" align="center">
              <Button
                color="#332526"
                onClick={() => {
                  navigate("/send");
                }}
              >
                Send
              </Button>
            </Flex>
          )}
        </Flex>
      </Card>
    );
  }

  return (
    <Flex direction={"column"} w={"100%"} gap={8}>
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
