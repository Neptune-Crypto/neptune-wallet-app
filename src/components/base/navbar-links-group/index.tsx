import { useUpdate } from "@/components/update/update-context";
import { Box, Collapse, Group, Indicator, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import classes from "./index.module.css";

interface LinksGroupProps {
  icon: React.FC<any>;
  label: string;
  href?: string;
  active: string;
  initiallyOpened?: boolean;
  links?: { label: string; link: string; icon?: React.FC<any> }[];
  changeActive: (active: string) => void;
}

export function LinksGroup({
  icon: Icon,
  label,
  href,
  initiallyOpened,
  links,
  active,
  changeActive: changeActive,
}: LinksGroupProps) {
  const hasLinks = Array.isArray(links) && links.length > 0;
  const [opened, setOpened] = useState(initiallyOpened || false);
  const navigate = useNavigate();
  const update = useUpdate();
  const items = (hasLinks ? links : []).map((link) => (
    <Text<"a">
      component="a"
      className={classes.link}
      data-active={link.link === active || undefined}
      href={link.link}
      key={link.label}
      onClick={(event) => {
        // Navigate from anywhere on the full-width link, not just the label.
        // The whole row shows hover/pointer styling, so the whole row must be clickable.
        event.preventDefault();
        changeActive(link.link);
        navigate(link.link);
      }}
    >
      <Box style={{ display: "flex", alignItems: "center" }}>
        {link.icon && <link.icon size={18} />}
        <Box ml="md">
          <Text fz={"md"} fw={500}>
            {link.label}
          </Text>
        </Box>
      </Box>
    </Text>
  ));

  function onClickLink() {
    if (hasLinks) {
      setOpened((o) => !o);
    } else if (href) {
      changeActive(href);
      navigate(href);
    }
  }
  function checkckDisableIndicator() {
    // The update-available dot rides on Settings (About lives inside it). Show it
    // whenever the shared updater reports an available version.
    if (label != "Settings") {
      return true;
    }
    return update.status !== "available";
  }
  return (
    <>
      <UnstyledButton
        className={classes.control}
        onClick={onClickLink}
        data-active={href === active || undefined}
      >
        <Group justify="space-between" gap={0}>
          <Box style={{ display: "flex", alignItems: "center" }}>
            <Icon size={18} />
            <Indicator
              inline
              color="red"
              offset={-1}
              size={6}
              processing
              disabled={checkckDisableIndicator()}
            >
              <Box ml="md">
                <Text fw={500} style={{ fontSize: 14 }}>
                  {label}
                </Text>
              </Box>
            </Indicator>
          </Box>
        </Group>
      </UnstyledButton>
      {hasLinks ? <Collapse in={opened}>{items}</Collapse> : null}
    </>
  );
}
