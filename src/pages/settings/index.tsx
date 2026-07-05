import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import { useAppDispatch } from "@/store/hooks";
import { querySettingActionData } from "@/store/settings/settings-slice";
import { Flex, ScrollArea } from "@mantine/core";
import { useEffect } from "react";
import SettingList from "./component/setting-list";
export default function SettingsPage() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(querySettingActionData());
  }, []);
  return (
    <WithTitlePageHeader title="Settings">
      <ScrollArea
        h={"calc(100vh - 110px)"}
        type="auto"
        scrollbarSize={8}
        style={{ marginRight: -24 }}
        styles={{ viewport: { paddingRight: 24 } }}
      >
        <Flex
          direction="column"
          gap="16"
          pb={24}
          style={{
            fontSize: "14px",
            wordWrap: "break-word",
            wordBreak: "break-all",
          }}
        >
          <SettingList />
        </Flex>
      </ScrollArea>
    </WithTitlePageHeader>
  );
}
