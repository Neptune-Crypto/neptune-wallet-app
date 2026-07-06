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
const theme = createTheme({
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
  headings: {
    sizes: {
      h1: { fontSize: rem(36) },
    },
  },
  components: {
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
        // Light-variant blue text deepened one shade (blue[6] -> blue[7]): on its
        // pale tint, blue[6] is only ~4.6:1 against AA's 4.5 — this buys margin
        // (~5.8:1) without touching filled buttons or other colors.
        if (props.variant === "light" && (!props.color || props.color === "blue")) {
          return { root: { "--button-color": "#4c5897" } };
        }
        return { root: {} };
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
