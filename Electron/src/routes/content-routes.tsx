import { Navigate, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DOCUMENT_DESIGN_READ } from "@/lib/permissions";
import { ForbiddenPage } from "@/pages/Forbidden/ForbiddenPage";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { SettingsPage } from "@/pages/Settings/SettingsPage";
import { DefinitionsHubPage } from "@/pages/Definitions/DefinitionsHubPage";
import { AccessHubPage } from "@/pages/Access/AccessHubPage";
import { AccessUsersPage } from "@/pages/Access/Users/AccessUsersPage";
import { UserFootprintPage } from "@/pages/Access/Users/footprint/UserFootprintPage";
import { TemplatesPage } from "@/pages/Access/Templates/TemplatesPage";
import { PermissionsCatalogPage } from "@/pages/Access/Permissions/PermissionsCatalogPage";
import { ItemsPage } from "@/pages/Items/ItemsPage";
import { CustomersPage } from "@/pages/Customers/CustomersPage";
import { ProductionStationsPage } from "@/pages/Stations/ProductionStationsPage";
import { EtiketlerPage } from "@/pages/Labels/EtiketlerPage";
import { MachinesPage } from "@/pages/Machines/MachinesPage";
import { PeripheralDevicesPage } from "@/pages/PeripheralDevices/PeripheralDevicesPage";
import { DefectTypesPage } from "@/pages/DefectTypes/DefectTypesPage";
import { QualityGradesPage } from "@/pages/QualityGrades/QualityGradesPage";
import { ColorsPage } from "@/pages/Colors/ColorsPage";
import { ReturnReasonsPage } from "@/pages/ReturnReasons/ReturnReasonsPage";
import { WarehousesPage } from "@/pages/Warehouses/WarehousesPage";
import { GoodsReceiptsPage } from "@/pages/Operations/GoodsReceipts/GoodsReceiptsPage";
import { CarilerPage } from "@/pages/Definitions/CarilerPage";
import { FinanceHubPage } from "@/pages/Finance/FinanceHubPage";
import { CariPage } from "@/pages/Finance/CariPage";
import { InvoicesPage } from "@/pages/Finance/InvoicesPage";
import { PaymentsPage } from "@/pages/Finance/PaymentsPage";
import { AccountsPage } from "@/pages/Finance/AccountsPage";
import { RatesPage } from "@/pages/Finance/RatesPage";
import { WarehouseTransfersPage } from "@/pages/Operations/WarehouseTransfers/WarehouseTransfersPage";
import { RoutesPage } from "@/pages/Routes/RoutesPage";
import { ProductRecipesPage } from "@/pages/ProductRecipes/ProductRecipesPage";
import { FabricPropertiesPage } from "@/pages/FabricProperties/FabricPropertiesPage";
import { SubcontractorCategoriesPage } from "@/pages/SubcontractorCategories/SubcontractorCategoriesPage";
import { SubcontractorsPage } from "@/pages/Subcontractors/SubcontractorsPage";
import { StationCapabilitiesPage } from "@/pages/StationCapabilities/StationCapabilitiesPage";
import { SystemHubPage } from "@/pages/System/SystemHubPage";
import { ActivityPage } from "@/pages/System/Activity/ActivityPage";
import { GeneralSettingsPage } from "@/pages/GeneralSettings/GeneralSettingsPage";
import {
  SETTINGS_ADMIN_PERMISSION,
  WORKSTATION_PERMISSION,
} from "@/pages/GeneralSettings/settings-config";
import { SystemEventsPage } from "@/pages/System/Events/SystemEventsPage";
import { ActivityArchivePage } from "@/pages/System/Archive/ActivityArchivePage";
import { ArchiveSearchPage } from "@/pages/System/Archive/ArchiveSearchPage";
import RollArchivePage from "@/pages/System/RollArchivePage";
import { ServerStatusPage } from "@/pages/System/ServerStatus/ServerStatusPage";
import { PerfPage } from "@/pages/System/Perf/PerfPage";
import { WorkSessionsPage } from "@/pages/System/WorkSessions/WorkSessionsPage";
import { BackupsPage } from "@/pages/System/Backups/BackupsPage";
import { DbRestorePage } from "@/pages/System/DbRestore/DbRestorePage";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";
import { LabelStudioPage } from "@/pages/LabelTemplates/editor/LabelStudioPage";
import { DocumentTemplatesPage } from "@/pages/Definitions/DocumentTemplatesPage";
import { FreeDocumentsPage } from "@/pages/FreeDocuments/FreeDocumentsPage";
import { TravelerCardSettingsPage } from "@/pages/Definitions/TravelerCardSettingsPage";
import { TravelerCardStudioPage } from "@/pages/Definitions/TravelerCardStudio/TravelerCardStudioPage";
import { DevicesPage } from "@/pages/Devices/DevicesPage";
import { DeviceDetailPage } from "@/pages/Devices/detail/DeviceDetailPage";
import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";
import { ReportsHubPage } from "@/pages/Reports/ReportsHubPage";
import { ProductionReportsHubPage } from "@/pages/Reports/Production/ProductionReportsHubPage";
import { WipScorecardPage } from "@/pages/Reports/Production/WipScorecardPage";
import { OperatorPerformancePage } from "@/pages/Reports/Production/OperatorPerformancePage";
import { TravelerTracePage } from "@/pages/Reports/Production/TravelerTracePage";
import { BatchTracePage } from "@/pages/Reports/Production/BatchTracePage";
import { SalesReportsHubPage } from "@/pages/Reports/Sales/SalesReportsHubPage";
import { ReturnScorecardPage } from "@/pages/Reports/Sales/ReturnScorecardPage";
import { ShipmentScorecardPage } from "@/pages/Reports/Sales/ShipmentScorecardPage";
import { QualityReportsHubPage } from "@/pages/Reports/Quality/QualityReportsHubPage";
import { QualityScorecardPage } from "@/pages/Reports/Quality/QualityScorecardPage";
import { ScrapScorecardPage } from "@/pages/Reports/Quality/ScrapScorecardPage";
import { InventoryReportsHubPage } from "@/pages/Reports/Inventory/InventoryReportsHubPage";
import { StockScorecardPage } from "@/pages/Reports/Inventory/StockScorecardPage";
import { SubcontractReportsHubPage } from "@/pages/Reports/Subcontract/SubcontractReportsHubPage";
import { SubcontractScorecardPage } from "@/pages/Reports/Subcontract/SubcontractScorecardPage";
import { CustomerReportsHubPage } from "@/pages/Reports/Customer/CustomerReportsHubPage";
import { OrderProfilePage } from "@/pages/Reports/Customer/OrderProfilePage";
import { AuditReportsHubPage } from "@/pages/Reports/Audit/AuditReportsHubPage";
import { SystemLogSummaryPage } from "@/pages/Reports/Audit/SystemLogSummaryPage";
import { UserActivityPage } from "@/pages/Reports/Audit/UserActivityPage";
import { OrdersPage } from "@/pages/Operations/Orders/OrdersPage";
import { WorkOrdersPage } from "@/pages/Operations/WorkOrders/WorkOrdersPage";
import { WorkOrderDetailPage } from "@/pages/Operations/WorkOrders/WorkOrderDetailPage";
import { WorkOrderFormPage } from "@/pages/Operations/WorkOrders/WorkOrderFormPage";
import { RollsPage } from "@/pages/Operations/Rolls/RollsPage";
import { KursunDagitimPage } from "@/pages/Operations/KursunDagitim/KursunDagitimPage";
import { ProductBalancePage } from "@/pages/Operations/ProductBalance/ProductBalancePage";
import { ShipmentsPage } from "@/pages/Operations/Shipments/ShipmentsPage";
import { ShipmentDetailPage } from "@/pages/Operations/Shipments/detail/ShipmentDetailPage";
import { DirectShipmentDetailPage } from "@/pages/Operations/Shipments/detail/DirectShipmentDetailPage";
import { SackStorePage } from "@/pages/Operations/SackStore/SackStorePage";
import { SackContentEditPage } from "@/pages/Operations/SackContentEdit/SackContentEditPage";
import { RelabelStationPage } from "@/pages/Operations/RelabelStation/RelabelStationPage";
import { AccountingDispatchPage } from "@/pages/Operations/AccountingDispatch/AccountingDispatchPage";
import { KartelaPage } from "@/pages/Operations/Kartela/KartelaPage";
import { ReturnsPage } from "@/pages/Operations/Returns/ReturnsPage";

/**
 * Uygulama içeriği rotaları (kabuk/sekme şeridi hariç). Hem dış HashRouter'ın
 * hem de her sekmenin kendi memory router'ı bu listeyi `/` layout'u altında
 * kullanır — böylece her sekme izole bir konum/searchParams/geçmiş yaşar.
 *
 * `requirePermission` gating'i burada kalır; canEnterApp gate'i dış kabukta
 * (AppShell'i saran ProtectedRoute) yapılır.
 */
export const contentRoutes: RouteObject[] = [
  { index: true, element: <DashboardPage /> },
  { path: "settings", element: <SettingsPage /> },
  { path: "forbidden", element: <ForbiddenPage /> },

  // Tanımlar — hub sayfası ve alt sayfalar.
  // K-A7 fix: rotalar tile-config izinleriyle korunur (URL ile direkt gidilince
  // izinsiz kullanıcı 403 toast yığını yerine net "yetki yok" ekranı görür).
  { path: "definitions", element: <DefinitionsHubPage /> },
  {
    path: "definitions/items",
    element: (
      <ProtectedRoute requirePermission="item:read">
        <ItemsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/customers",
    element: (
      <ProtectedRoute requirePermission="customer:read">
        <CustomersPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/stations",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <ProductionStationsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/machines",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <MachinesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/peripherals",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <PeripheralDevicesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/labels",
    element: (
      // Karo (Definitions/tile-config "labels") ile AYNI liste — ayrışırsa kart
      // görünür, tıklayınca /forbidden.
      <ProtectedRoute requireAnyPermission={["station:read", "label-template:read"]}>
        <EtiketlerPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/routes",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <RoutesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/product-recipes",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <ProductRecipesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/defect-types",
    element: (
      <ProtectedRoute requirePermission="quality:read">
        <DefectTypesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/quality-grades",
    element: (
      <ProtectedRoute requirePermission="quality:read">
        <QualityGradesPage />
      </ProtectedRoute>
    ),
  },
  {
    // Y7 fix: backend color.routes property:read ister — rota da aynı izinle korunur.
    path: "definitions/colors",
    element: (
      <ProtectedRoute requirePermission="property:read">
        <ColorsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/return-reasons",
    element: (
      <ProtectedRoute requirePermission="return:read">
        <ReturnReasonsPage />
      </ProtectedRoute>
    ),
  },
  // ── ÖN MUHASEBE ────────────────────────────────────────────────────────
  // ⚠️ Route izni ile hub karosunun `permissionAny` listesi AYNI olmalı
  // (Finance/tile-config.ts) — ayrışırsa kart görünür, tıklanır, /forbidden.
  // Modülün GÖRÜNÜRLÜK kapısı ise bayrak: menü satırı `financeEnabled`
  // olmadan çizilmez ve backend her ucu 403'ler.
  {
    path: "finance",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <FinanceHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "finance/cari",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <CariPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "finance/invoices",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <InvoicesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "finance/payments",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <PaymentsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "finance/accounts",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <AccountsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "finance/rates",
    element: (
      <ProtectedRoute requirePermission="finance:read">
        <RatesPage />
      </ProtectedRoute>
    ),
  },
  {
    // Birleşik cari görünümü — karo (Definitions/tile-config) ile AYNI izin listesi.
    path: "definitions/cariler",
    element: (
      <ProtectedRoute requireAnyPermission={["customer:read", "subcontractor:read"]}>
        <CarilerPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/goods-receipts",
    element: (
      <ProtectedRoute requirePermission="goods-receipt:read">
        <GoodsReceiptsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/warehouse-transfers",
    element: (
      <ProtectedRoute requirePermission="warehouse:transfer">
        <WarehouseTransfersPage />
      </ProtectedRoute>
    ),
  },
  {
    // Depolar — "tek depo varken gizle" kuralının DIŞINDA (ikinci depoyu açmanın
    // tek yolu burasıdır); yalnız izinle kapılı. Karo ile route AYNI izni taşır.
    path: "definitions/warehouses",
    element: (
      <ProtectedRoute requirePermission="warehouse:read">
        <WarehousesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/fabric-properties",
    element: (
      <ProtectedRoute requirePermission="property:read">
        <FabricPropertiesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/subcontractor-categories",
    element: (
      <ProtectedRoute requirePermission="subcontractor:read">
        <SubcontractorCategoriesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/subcontractors",
    element: (
      <ProtectedRoute requirePermission="subcontractor:read">
        <SubcontractorsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/station-capabilities",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <StationCapabilitiesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/label-templates",
    element: (
      <ProtectedRoute requirePermission="label-template:read">
        <LabelTemplatesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/label-templates/:id",
    element: (
      <ProtectedRoute requirePermission="label-template:write">
        <LabelStudioPage />
      </ProtectedRoute>
    ),
  },
  {
    // Belge tasarım ekranları (4 adet) — `admin:settings` VEYA
    // `document-template:read|write`. Liste `lib/permissions.ts`te tek kaynak;
    // `tile-config.ts` kartları AYNI listeyle süzer (ayrışırsa kart görünür
    // ama tıklayınca /forbidden'a düşer).
    path: "definitions/document-templates",
    element: (
      <ProtectedRoute requireAnyPermission={DOCUMENT_DESIGN_READ}>
        <DocumentTemplatesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/traveler-card",
    element: (
      <ProtectedRoute requireAnyPermission={DOCUMENT_DESIGN_READ}>
        <TravelerCardSettingsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/traveler-card-studio",
    element: (
      <ProtectedRoute requireAnyPermission={DOCUMENT_DESIGN_READ}>
        <TravelerCardStudioPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/free-documents",
    element: (
      <ProtectedRoute requireAnyPermission={DOCUMENT_DESIGN_READ}>
        <FreeDocumentsPage />
      </ProtectedRoute>
    ),
  },
  {
    // Saha tabletleri (allowlist + makine ataması) → Yetkilendirme→Cihaz Erişimi'ne
    // taşındı. "Cihaz Kaydı" (Donanım: metre/yazıcı/tartı) ile karışmasın diye
    // UI'da "Tabletler" adıyla görünür.
    path: "access/devices",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DevicesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "access/devices/:id",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DeviceDetailPage />
      </ProtectedRoute>
    ),
  },

  // Yetkilendirme (Admin)
  {
    path: "access",
    element: (
      <ProtectedRoute requirePermission="admin:users">
        <AccessHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "access/users",
    element: (
      <ProtectedRoute requirePermission="admin:users">
        <AccessUsersPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "access/users/:id",
    element: (
      <ProtectedRoute requirePermission="admin:users">
        <UserFootprintPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "access/templates",
    element: (
      <ProtectedRoute requirePermission="admin:users">
        <TemplatesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "access/permissions",
    element: (
      <ProtectedRoute requirePermission="admin:users">
        <PermissionsCatalogPage />
      </ProtectedRoute>
    ),
  },

  // Sistem — hub + alt sayfalar
  {
    path: "system",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <SystemHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/activity",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <ActivityPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/perf",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <PerfPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/server-status",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <ServerStatusPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/work-sessions",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <WorkSessionsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/backups",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <BackupsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/db-restore",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DbRestorePage />
      </ProtectedRoute>
    ),
  },
  {
    // Sayfanın kapısı GENİŞ, içerik DAR: `settings:workstation` taşıyan personel
    // girer ama yalnız "Bu Bilgisayar" kategorisini görür (sayfa kategorileri
    // `visibleSettingsCategories` ile süzer). Sistem geneli ayarlar hâlâ
    // `admin:settings` ister ve listeye bile girmez.
    path: "system/settings",
    element: (
      <ProtectedRoute requireAnyPermission={[SETTINGS_ADMIN_PERMISSION, WORKSTATION_PERMISSION]}>
        <GeneralSettingsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/logs",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <SystemEventsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/archive",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <ActivityArchivePage />
      </ProtectedRoute>
    ),
  },
  {
    // Top Arşivi — admin:settings ile kilitli (Sistem hub'ının tamamı gibi).
    // Envanter sekmesindeki eski hâli roll:read ile açıktı; taşıma yetkiyi de
    // daralttı, bu bilinçli.
    path: "system/roll-archive",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <RollArchivePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "system/archive/search",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <ArchiveSearchPage />
      </ProtectedRoute>
    ),
  },

  // Operasyon — hub + alt sayfalar
  { path: "operations", element: <OperationsHubPage /> },
  {
    path: "operations/orders",
    element: (
      <ProtectedRoute requirePermission="order:read">
        <OrdersPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/work-orders",
    element: (
      <ProtectedRoute requirePermission="workorder:read">
        <WorkOrdersPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/work-orders/new",
    element: (
      <ProtectedRoute requirePermission="workorder:write">
        <WorkOrderFormPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/work-orders/:id/edit",
    element: (
      <ProtectedRoute requirePermission="workorder:write">
        <WorkOrderFormPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/work-orders/:id",
    element: (
      <ProtectedRoute requirePermission="workorder:read">
        <WorkOrderDetailPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/rolls",
    element: (
      <ProtectedRoute requirePermission="roll:read">
        <RollsPage />
      </ProtectedRoute>
    ),
  },
  {
    // ESKİ "Kurşun Sırası" adresi — 2026-08-05'te ekran Kurşun Planlama ile
    // birleşti. Route SİLİNMEDİ yönlendirildi: kayıtlı sekme / eski komut paleti
    // girişi / kullanıcının ezberlediği adres boş sayfaya düşmesin.
    path: "operations/kursun-queue",
    element: <Navigate to="/operations/kursun-dagitim" replace />,
  },
  {
    path: "operations/kursun-dagitim",
    element: (
      // Kurşun Planlama = eski Kurşun Sırası + Kurşun Dağıtım. Kaliteci sırayı
      // yönetir, dağıtımcı makineye verir → iki izinden HERHANGİ biri yeterli
      // (karo ile birebir aynı kapı). Bayrak (kursunBypassEnabled) route'u
      // KAPATMAZ ve karoyu da etkilemez; yalnız ekranın içindeki dağıtım
      // kontrollerini açar/kapatır.
      <ProtectedRoute requireAnyPermission={["quality:write", "workorder:distribute"]}>
        <KursunDagitimPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/product-balance",
    element: (
      <ProtectedRoute requirePermission="workorder:read">
        <ProductBalancePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/shipments",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <ShipmentsPage />
      </ProtectedRoute>
    ),
  },
  {
    // Fasondan doğrudan sevk tam-sayfa detayı — statik "direct" segmenti dinamik
    // ":id"den önce sıralanır (RR6 ranking) → çuval sevkiyatı detayını gölgelemez.
    path: "operations/shipments/direct/:id",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <DirectShipmentDetailPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/shipments/:id",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <ShipmentDetailPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/sack-store",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <SackStorePage />
      </ProtectedRoute>
    ),
  },
  {
    // "Çuval & Top Arama" ekranı "Çuval Deposu / Paketleme" hub'ına birleşti —
    // kayıtlı sekmeler/scan-anywhere hedefleri kırılmasın diye eski route yönlenir.
    path: "operations/sack-search",
    element: <Navigate to="/operations/sack-content-edit" replace />,
  },
  {
    // Okutarak Sevk, Sevk Kapısı'na (eski Çuval Depo) gömüldü — kayıtlı
    // sekmeler/scan-anywhere hedefleri kırılmasın diye eski route yönlenir.
    path: "operations/scan-dispatch",
    element: <Navigate to="/operations/sack-store" replace />,
  },
  {
    path: "operations/sack-content-edit",
    element: (
      <ProtectedRoute requirePermission="shipping:write">
        <SackContentEditPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/relabel-station",
    element: (
      <ProtectedRoute requireAnyPermission={["roll:write", "label:edit"]}>
        <RelabelStationPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/accounting-dispatch",
    element: (
      <ProtectedRoute requireAnyPermission={["shipping:read", "report:sales"]}>
        <AccountingDispatchPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/kartela",
    element: (
      <ProtectedRoute requirePermission="kartela:read">
        <KartelaPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/returns",
    element: (
      <ProtectedRoute requirePermission="return:read">
        <ReturnsPage />
      </ProtectedRoute>
    ),
  },

  // Raporlar — domain bazlı hub'lar; alt sayfalar etap etap doldurulur
  { path: "reports", element: <ReportsHubPage /> },
  {
    path: "reports/production",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <ProductionReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/production/wip",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <WipScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/production/operator-performance",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <OperatorPerformancePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/production/batch-trace",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <BatchTracePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/production/traveler-trace",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <TravelerTracePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/sales",
    element: (
      <ProtectedRoute requirePermission="report:sales">
        <SalesReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/sales/shipment-scorecard",
    element: (
      <ProtectedRoute requirePermission="report:sales">
        <ShipmentScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/sales/return-scorecard",
    element: (
      <ProtectedRoute requirePermission="report:sales">
        <ReturnScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <QualityReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality/scorecard",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <QualityScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality/scrap-scorecard",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <ScrapScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/inventory",
    element: (
      <ProtectedRoute requirePermission="report:inventory">
        <InventoryReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/inventory/scorecard",
    element: (
      <ProtectedRoute requirePermission="report:inventory">
        <StockScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/subcontract",
    element: (
      <ProtectedRoute requirePermission="report:subcontract">
        <SubcontractReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/subcontract/scorecard",
    element: (
      <ProtectedRoute requirePermission="report:subcontract">
        <SubcontractScorecardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/customer",
    element: (
      <ProtectedRoute requirePermission="report:customer">
        <CustomerReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/customer/order-profile",
    element: (
      <ProtectedRoute requirePermission="report:customer">
        <OrderProfilePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/audit",
    element: (
      <ProtectedRoute requirePermission="report:audit">
        <AuditReportsHubPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/audit/system-log-summary",
    element: (
      <ProtectedRoute requirePermission="report:audit">
        <SystemLogSummaryPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/audit/user-activity",
    element: (
      <ProtectedRoute requirePermission="report:audit">
        <UserActivityPage />
      </ProtectedRoute>
    ),
  },

  { path: "*", element: <Navigate to="/" replace /> },
];
