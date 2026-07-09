import { Center, Flex, Image, Loader } from "@mantine/core";

// App mark shown while the app boots: the white N monogram needs a brand-blue
// plate to be visible on the light background (same composition as the OS app
// icon, src-tauri/icons/app-icon.svg — keep the two in sync).
export function AppMark({ size = 72 }: { size?: number }) {
  return (
    <Flex
      w={size}
      h={size}
      align="center"
      justify="center"
      style={{
        borderRadius: size * 0.22,
        background: "linear-gradient(135deg, #3e46ca, #1d2a90)",
      }}
    >
      <Image src="/neptune-logo.svg" w={size * 0.72} h={size * 0.72} fit="contain" />
    </Flex>
  );
}

export default function LoadingPage() {
  return (
    <Center h={"100vh"} w={"100%"}>
      <Flex direction={"column"} align="center" gap={20}>
        <AppMark />
        <Loader />
      </Flex>
    </Center>
  );
}
