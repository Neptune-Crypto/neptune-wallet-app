import RustySessionStore from "@/commands/store";
import { Box, Flex, Group, Image, Space } from "@mantine/core";
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
          {bottomLinks}
          <div className={classes.footer}>
            <SyncBlockCard />
          </div>
        </nav>
      </Group>
    </Box>
  );
}

export default Navbar;
