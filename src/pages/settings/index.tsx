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
      <ScrollArea h={"calc(100vh - 110px)"} scrollbarSize={0}>
        <Flex
          direction="column"
          gap="16"
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
