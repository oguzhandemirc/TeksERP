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
import { ErrorReportGroupsPage, ErrorReportsPage } from "./pages/ErrorReports";
import { FilesPage } from "./pages/Files";
import { FleetPage } from "./pages/Fleet";
import { GuidePage } from "./pages/Guide";
import { HardwareRequestsPage } from "./pages/HardwareRequests";
import { InstallationsPage } from "./pages/Installations";
import { MaintenanceDuePage } from "./pages/MaintenanceDue";
import { NotificationsPage } from "./pages/Notifications";
import { SupportPage } from "./pages/Support";
import { SupportDetailPage } from "./pages/SupportDetail";
import { CopyAlertsPage, DrPage, PlannedActionsPage, TransfersPage } from "./pages/Queues";
import { ReleasesPage } from "./pages/Releases";
import { RevocationsPage } from "./pages/Revocations";
import { RootQueuePage } from "./pages/RootQueue";
import { UsersPage } from "./pages/Users";

export const PORTAL_PRODUCT = "TeksERP Satıcı Portalı";

export const PORTAL_NAV: readonly NavItem[] = [
  { to: "/", label: "Pano", permission: "portal:oku" },
  { to: "/musteriler", label: "Müşteriler", permission: "portal:oku" },
  { to: "/kurulumlar", label: "Kurulumlar", permission: "portal:oku" },
  { to: "/planli-eylemler", label: "Planlı eylemler", permission: "portal:oku" },
  { to: "/tasima-talepleri", label: "Taşıma talepleri", permission: "portal:oku" },
  { to: "/kopya-uyarilari", label: "Kopya uyarıları", permission: "portal:oku" },
  { to: "/donanim-talepleri", label: "Donanım onayları", permission: "portal:oku" },
  { to: "/kok-kuyrugu", label: "Kök imzası kuyruğu", permission: "portal:oku" },
  { to: "/dr", label: "DR", permission: "portal:oku" },
  { to: "/destek", label: "Destek kutusu", permission: "portal:oku" },
  { to: "/hata-raporlari", label: "Hata raporları", permission: "portal:oku" },
  { to: "/bildirimler", label: "Bildirimler", permission: "bildirim:oku" },
  { to: "/bayiler", label: "Bayiler", permission: "portal:oku" },
  { to: "/kanallar", label: "Kanallar", permission: "portal:oku" },
  { to: "/surumler", label: "Sürümler", permission: "portal:oku" },
  { to: "/filo", label: "Filo", permission: "portal:oku" },
  { to: "/bakim-bitecek", label: "Bakım bitişleri", permission: "portal:oku" },
  { to: "/dosyalar", label: "Dosyalar", permission: "portal:oku" },
  { to: "/kullanicilar", label: "Portal kullanıcıları", permission: "kullanici:yonet" },
  { to: "/denetim", label: "Denetim defteri", permission: "denetim:oku" },
  { to: "/anahtarlar", label: "Anahtarlar", permission: "anahtar:oku" },
  { to: "/iptal-belgeleri", label: "İptal belgeleri", permission: "anahtar:oku" },
  { to: "/kilavuz", label: "Kılavuz", permission: "portal:oku" },
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
      { path: "donanim-talepleri", element: <HardwareRequestsPage /> },
      { path: "kok-kuyrugu", element: <RootQueuePage /> },
      { path: "dr", element: <DrPage /> },
      { path: "destek", element: <SupportPage /> },
      { path: "destek/:id", element: <SupportDetailPage /> },
      { path: "hata-raporlari", element: <ErrorReportsPage /> },
      { path: "hata-raporlari/:id", element: <ErrorReportGroupsPage /> },
      { path: "bildirimler", element: <NotificationsPage /> },
      { path: "bayiler", element: <DealersPage /> },
      { path: "bayiler/:id", element: <DealerDetailPage /> },
      { path: "kanallar", element: <ChannelsPage /> },
      { path: "surumler", element: <ReleasesPage /> },
      { path: "filo", element: <FleetPage /> },
      { path: "bakim-bitecek", element: <MaintenanceDuePage /> },
      { path: "dosyalar", element: <FilesPage /> },
      { path: "kullanicilar", element: <UsersPage /> },
      { path: "denetim", element: <AuditPage /> },
      { path: "anahtarlar", element: <KeysPage /> },
      { path: "iptal-belgeleri", element: <RevocationsPage /> },
      { path: "kilavuz", element: <GuidePage /> },
      { path: "hesabim", element: <AccountPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
