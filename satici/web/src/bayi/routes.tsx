// BAYİ ARAYÜZÜ rota tablosu + menü — satıcı arayüzünün sayfalarını TAŞIMAZ (bekçi: app-isolation.test.ts).
import type { RouteObject } from "react-router-dom";
import { AccountPage } from "../shared/AccountPage";
import { Layout, type NavItem } from "../shared/Layout";
import { NotFoundPage } from "../shared/ui";
import { BayiCustomerDetailPage, BayiCustomersPage } from "./pages/Customers";
import { BayiHomePage } from "./pages/Home";
import { BayiInstallationDetailPage, BayiInstallationsPage } from "./pages/Installations";

export const BAYI_PRODUCT = "TeksERP Bayi Portalı";

export const BAYI_NAV: readonly NavItem[] = [
  { to: "/", label: "Tavanım", permission: "bayi:portal" },
  { to: "/musteriler", label: "Müşterilerim", permission: "bayi:portal" },
  { to: "/kurulumlar", label: "Kurulumlarım", permission: "bayi:portal" },
];

export const BAYI_ROUTES: RouteObject[] = [
  {
    path: "/",
    element: <Layout product={BAYI_PRODUCT} nav={BAYI_NAV} />,
    children: [
      { index: true, element: <BayiHomePage /> },
      { path: "musteriler", element: <BayiCustomersPage /> },
      { path: "musteriler/:id", element: <BayiCustomerDetailPage /> },
      { path: "kurulumlar", element: <BayiInstallationsPage /> },
      { path: "kurulumlar/:id", element: <BayiInstallationDetailPage /> },
      { path: "hesabim", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
