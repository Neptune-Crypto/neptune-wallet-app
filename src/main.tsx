// Self-hosted variable font (single file, weights 100-900) — bundled so it works
// offline and under the Tauri CSP; no network fetch.
import "@fontsource-variable/inter";
import { MantineProvider, type CSSVariablesResolver } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { store } from "./store";
import theme from "./theme";

// Mantine's default "dimmed" (gray-6, #868e96) is only ~3.2:1 on the app's
// #f7faff background — below WCAG AA (4.5:1) for normal text. Override it app-wide
// with a darker gray that clears AA while still reading as muted secondary text.
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": "#63696f",
  },
  dark: {},
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
        <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
          {/* paddingTop offsets the toasts from the top via padding (not `top`,
              which broke pointer events on the overlay). */}
          <Notifications styles={{ root: { paddingTop: 24 } }} />
          <ModalsProvider>
            <App />
          </ModalsProvider>
        </MantineProvider>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
