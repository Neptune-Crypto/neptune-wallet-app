import {
  IconArrowDownCircle,
  IconHistory,
  IconSettings,
  IconTransfer,
  IconUsers,
  IconWallet,
} from "@tabler/icons-react";
import { lazy } from "react";
import { Navigate, Outlet, type RouteObject } from "react-router-dom";

const WalletPage = lazy(async () => await import("../pages/wallet"));
const SettingsPage = lazy(async () => await import("../pages/settings"));
const AddressesPage = lazy(async () => await import("../pages/addresses"));
const HistoryPage = lazy(async () => await import("../pages/history"));
const BatchPage = lazy(async () => await import("../pages/batch"));
const ContactsPage = lazy(async () => await import("../pages/contacts"));
export const routesConfig: RouteObject[] = [
  {
    path: "/",
    element: (
      <div className="main">
        <div className="main-content">
          <Outlet />
        </div>
      </div>
    ),
    children: [
      {
        index: true,
        element: <Navigate to="/wallet" />,
      },
      {
        // Advanced retired; its Log viewer is now a tab in Settings.
        path: "advanced",
        element: <Navigate to="/settings" />,
      },
      {
        // Log moved into Settings; redirect any persisted /log location.
        path: "log",
        element: <Navigate to="/settings" />,
      },
      {
        path: "wallet",
        element: <WalletPage />,
      },
      {
        path: "send",
        element: <BatchPage />,
      },
      {
        path: "addresses",
        element: <AddressesPage />,
      },
      {
        path: "contacts",
        element: <ContactsPage />,
      },
      {
        path: "history",
        element: <HistoryPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        // About moved into Settings as a tab; redirect any persisted /about location.
        path: "about",
        element: <Navigate to="/settings" />,
      },
    ],
  },
];

export const linkdata = [
  { label: "Wallet", href: "/wallet", icon: IconWallet },
  { label: "Send", href: "/send", icon: IconTransfer },
  { label: "Receive", href: "/addresses", icon: IconArrowDownCircle },
  { label: "Contacts", href: "/contacts", icon: IconUsers },
  { label: "History", href: "/history", icon: IconHistory },
  { label: "Settings", href: "/settings", icon: IconSettings },
];
