import { createTheme, MantineColorsTuple, rem } from "@mantine/core";
const myColor: MantineColorsTuple = [
  "#edefff",
  "#d9dbfa",
  "#b1b4ec",
  "#868bde",
  "#6268d3",
  "#535acf",
  "#3e46ca",
  "#3038b4",
  "#2832a2",
  "#1d2a90",
];
const FONT_FAMILY = "'Inter Variable', 'Segoe UI', system-ui, sans-serif";

const theme = createTheme({
  // Pointer cursor on all checkboxes, radios and switches (they're clickable
  // controls, so the cursor should say so — e.g. the contact-select and UTXO
  // tables). Mantine defaults to the plain arrow.
  cursorType: "pointer",
  // Inter (self-hosted variable font, imported in main.tsx) for all Mantine
  // components; app.css applies the same stack to non-Mantine text.
  fontFamily: FONT_FAMILY,
  headings: {
    fontFamily: FONT_FAMILY,
    sizes: {
      h1: { fontSize: rem(36) },
    },
  },
  primaryColor: "myColor",
  colors: {
    myColor,
    // or replace default theme color
    blue: [
      "#eef3ff",
      "#dee2f2",
      "#bdc2de",
      "#98a0ca",
      "#7a84ba",
      "#6672b0",
      "#5c68ac",
      "#4c5897",
      "#424e88",
      "#364379",
    ],
  },
  components: {
    Notification: {
      styles: {
        // Toast body text: Mantine dims the message to gray-6 (#868e96) when a
        // title is present — only ~3.3:1 on the white toast, failing AA's 4.5:1
        // for 14px text. gray-7 (~8.2:1) keeps the secondary look and passes.
        // Error toasts carry backend messages users must be able to read.
        description: {
          color: "var(--mantine-color-gray-7)",
        },
      },
    },
    Modal: {
      styles: {
        content: {
          borderRadius: 20,
        },
        body: {
          padding: "20px 20px 30px 20px",
        },
        title: {
          fontWeight: 700,
          fontSize: 18,
        },
      },
    },
    Button: {
      // Default all buttons to the blue accent, but let each button's variant
      // (filled/light) and explicit color prop work normally. (Previously this
      // forced backgroundColor with !important, which neutered variants and
      // collided with per-button color props.)
      defaultProps: {
        color: "blue",
      },
      vars: (_theme: any, props: any) => {
        const root: Record<string, string> = {};
        // Light-variant blue text deepened one shade (blue[6] -> blue[7]): on its
        // pale tint, blue[6] is only ~4.6:1 against AA's 4.5 — this buys margin
        // (~5.8:1) without touching filled buttons or other colors.
        if (props.variant === "light" && (!props.color || props.color === "blue")) {
          root["--button-color"] = "#4c5897";
        }
        // Inter renders denser than Arial at 12px, so xs buttons get 14px text
        // while keeping the compact xs height/padding. Larger sizes untouched.
        if (props.size === "xs" || props.size === "compact-xs") {
          root["--button-fz"] = rem(14);
        }
        return { root };
      },
    },
    Text: {
      styles: () => ({
        root: {
          wordWrap: "break-word",
          // 400 (regular) reads lighter than the previous 500 so tables and body
          // copy no longer feel heavy. Cells that set an explicit `fw` keep it.
          fontWeight: 400,
          fontSize: "14px",
        },
      }),
    },
  },
});

export default theme;
