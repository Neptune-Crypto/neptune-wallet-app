import { MantineProvider } from "@mantine/core";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      <HashRouter>
        <MantineProvider theme={theme}>
          <Notifications />
          <ModalsProvider>
            <App />
          </ModalsProvider>
        </MantineProvider>
      </HashRouter>
    </Provider>
  </React.StrictMode>
);
