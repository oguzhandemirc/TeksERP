// SATICI ARAYÜZÜ rota tablosu + menü. Menü öğesi yalnız izni olan role çizilir; kararı sunucu verir.
import type { RouteObject } from "react-router-dom";
import { AccountPage } from "../shared/AccountPage";
import { Layout, type NavItem } from "../shared/Layout";
import { NotFoundPage } from "../shared/ui";
import { InstallationDetailPage } from "./installation/InstallationDetailPage";
import { AuditPage, KeysPage } from "./pages/AuditKeys";
import { ChannelsPage } from "./pages/Channels";
import { CustomerDetailPage } from "./pages/CustomerDetail";
import { CustomersPage } from "./pages/Customers";
import { DashboardPage } from "./pages/Dashboard";
import { DealerDetailPage } from "./pages/DealerDetail";
import { DealersPage } from "./pages/Dealers";
import { FilesPage } from "./pages/Files";
import { InstallationsPage } from "./pages/Installations";
import { SupportPage } from "./pages/Support";
import { SupportDetailPage } from "./pages/SupportDetail";
import { CopyAlertsPage, DrPage, PlannedActionsPage, TransfersPage } from "./pages/Queues";
import { ReleasesPage } from "./pages/Releases";
import { UsersPage } from "./pages/Users";

export const PORTAL_PRODUCT = "TeksERP Satıcı Portalı";

export const PORTAL_NAV: readonly NavItem[] = [
  { to: "/", label: "Pano", permission: "portal:oku" },
  { to: "/musteriler", label: "Müşteriler", permission: "portal:oku" },
  { to: "/kurulumlar", label: "Kurulumlar", permission: "portal:oku" },
  { to: "/planli-eylemler", label: "Planlı eylemler", permission: "portal:oku" },
  { to: "/tasima-talepleri", label: "Taşıma talepleri", permission: "portal:oku" },
  { to: "/kopya-uyarilari", label: "Kopya uyarıları", permission: "portal:oku" },
  { to: "/dr", label: "DR", permission: "portal:oku" },
  { to: "/destek", label: "Destek kutusu", permission: "portal:oku" },
  { to: "/bayiler", label: "Bayiler", permission: "portal:oku" },
  { to: "/kanallar", label: "Kanallar", permission: "portal:oku" },
  { to: "/surumler", label: "Sürümler", permission: "portal:oku" },
  { to: "/dosyalar", label: "Dosyalar", permission: "portal:oku" },
  { to: "/kullanicilar", label: "Portal kullanıcıları", permission: "kullanici:yonet" },
  { to: "/denetim", label: "Denetim defteri", permission: "denetim:oku" },
  { to: "/anahtarlar", label: "Anahtarlar", permission: "anahtar:oku" },
];

export const PORTAL_ROUTES: RouteObject[] = [
  {
    path: "/",
    element: <Layout product={PORTAL_PRODUCT} nav={PORTAL_NAV} />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "musteriler", element: <CustomersPage /> },
      { path: "musteriler/:id", element: <CustomerDetailPage /> },
      { path: "kurulumlar", element: <InstallationsPage /> },
      { path: "kurulumlar/:id", element: <InstallationDetailPage /> },
      { path: "planli-eylemler", element: <PlannedActionsPage /> },
      { path: "tasima-talepleri", element: <TransfersPage /> },
      { path: "kopya-uyarilari", element: <CopyAlertsPage /> },
      { path: "dr", element: <DrPage /> },
      { path: "destek", element: <SupportPage /> },
      { path: "destek/:id", element: <SupportDetailPage /> },
      { path: "bayiler", element: <DealersPage /> },
      { path: "bayiler/:id", element: <DealerDetailPage /> },
      { path: "kanallar", element: <ChannelsPage /> },
      { path: "surumler", element: <ReleasesPage /> },
      { path: "dosyalar", element: <FilesPage /> },
      { path: "kullanicilar", element: <UsersPage /> },
      { path: "denetim", element: <AuditPage /> },
      { path: "anahtarlar", element: <KeysPage /> },
      { path: "hesabim", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
