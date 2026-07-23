import {
  IconArrowDownCircle,
  IconEye,
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
const WatchOnlyPage = lazy(async () => await import("../pages/watch-only"));
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
        path: "watch-only",
        element: <WatchOnlyPage />,
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

// Account-scoped views — everything here reflects the account chosen in the
// switcher directly above, so they stay grouped together under it.
export const linkdata = [
  { label: "Wallet", href: "/wallet", icon: IconWallet },
  { label: "Send", href: "/send", icon: IconTransfer },
  { label: "Receive", href: "/addresses", icon: IconArrowDownCircle },
  { label: "Watch-only", href: "/watch-only", icon: IconEye },
  { label: "History", href: "/history", icon: IconHistory },
];

// App-level items, pinned to the bottom (above the sync card), separated from the
// account-scoped views. Contacts lives here because the address book is shared
// across all accounts — not tied to the active one — the same reason Settings is.
export const bottomLinkdata = [
  { label: "Contacts", href: "/contacts", icon: IconUsers },
  { label: "Settings", href: "/settings", icon: IconSettings },
];
