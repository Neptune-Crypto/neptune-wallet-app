import { Flex, Text } from "@mantine/core";

// "Which account am I acting on?" — the answer should look identical and sit in
// the same spot (first element under the page header) on every page, so the
// user's glance always lands. One shared component keeps the styling from
// drifting across pages again.
const AccountContextLabel = ({
  label = "Active account",
  name,
}: {
  label?: string;
  name?: string;
}) => {
  return (
    <Flex direction={"row"} gap={6} align={"center"}>
      <Text size="sm" c="dimmed">
        {label}:
      </Text>
      <Text size="sm" fw={600}>
        {name || "—"}
      </Text>
    </Flex>
  );
};

export default AccountContextLabel;
