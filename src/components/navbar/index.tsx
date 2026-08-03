import RustySessionStore from "@/commands/store";
import { lockWallet } from "@/store/auth/auth-slice";
import { useAuth } from "@/store/auth/hooks";
import { useAppDispatch } from "@/store/hooks";
import { notify } from "@/utils/notify";
import { ActionIcon, Box, Flex, Group, Image, Space, Tooltip } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { bottomLinkdata, linkdata } from "../../routers";
import { LinksGroup } from "../base/navbar-links-group";
import SyncBlockCard from "../card/sync-block-card";
import AccountSwitcher from "./account-switcher";
import classes from "./navbar.module.css";
function Navbar() {
  const [active, setActive] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { hasPassword } = useAuth();

  async function handleLock() {
    try {
      await dispatch(lockWallet()).unwrap();
    } catch (error: any) {
      notify.error(error, "The wallet is still unlocked.", "Couldn't lock wallet", {
        id: "lock-error",
      });
    }
  }
  useEffect(() => {
    if (location && location.pathname) {
      setActive(location.pathname);
      RustySessionStore.set("currentPage", location.pathname);
    }
  }, [location]);
  useEffect(() => {
    navigateChange();
  }, []);

  async function navigateChange() {
    let currentPage = await RustySessionStore.get("currentPage");
    if (currentPage && currentPage !== location.pathname) {
      navigate(currentPage);
    } else if (!currentPage) {
      navigate("/wallet");
    }
  }

  const renderLinks = (items: typeof linkdata) =>
    items.map((item) => (
      <LinksGroup
        active={active}
        changeActive={function (active: string): void {
          setActive(active);
        }}
        {...item}
        key={item.label}
      />
    ));
  const links = renderLinks(linkdata);
  const bottomLinks = renderLinks(bottomLinkdata);

  return (
    <Box>
      <Group visibleFrom="sm">
        <nav data-tauri-drag-region className={classes.navbar}>
          <Space data-tauri-drag-region h={34} />
          <Flex justify={"center"} align={"center"}>
            {/* N monogram (white-filled SVG — crisp at any DPI; the app name stays
                on the lock screen and window title). Purely decorative — no click
                handler, and drag-region so this strip stays draggable. */}
            <Image
              src={"/neptune-logo.svg?v=3"}
              data-tauri-drag-region
              w={44}
              h={44}
              fit="contain"
            />
          </Flex>
          <Space data-tauri-drag-region h={16} />
          <AccountSwitcher />
          <Space h={16} />
          <div data-tauri-drag-region className={classes.navbarMain}>
            {links}
          </div>
          {/* Wrap the bottom links in a block box (like navbarMain) so their
              margins collapse to the same gap as the main links — as direct
              flex children of .navbar their margins wouldn't collapse, doubling
              the gap between Contacts and Settings. */}
          <div>{bottomLinks}</div>
          <div className={classes.footer}>
            {hasPassword && (
              <Flex justify={"flex-end"} gap={4} px={12} pb={8}>
                <Tooltip label="Lock wallet" withArrow position="top">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label="Lock wallet"
                    onClick={handleLock}
                  >
                    <IconLock size={18} />
                  </ActionIcon>
                </Tooltip>
              </Flex>
            )}
            <SyncBlockCard />
          </div>
        </nav>
      </Group>
    </Box>
  );
}

export default Navbar;
