import { Navigate, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ForbiddenPage } from "@/pages/Forbidden/ForbiddenPage";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { SettingsPage } from "@/pages/Settings/SettingsPage";
import { DefinitionsHubPage } from "@/pages/Definitions/DefinitionsHubPage";
import { AccessHubPage } from "@/pages/Access/AccessHubPage";
import { AccessUsersPage } from "@/pages/Access/Users/AccessUsersPage";
import { TemplatesPage } from "@/pages/Access/Templates/TemplatesPage";
import { PermissionsCatalogPage } from "@/pages/Access/Permissions/PermissionsCatalogPage";
import { ItemsPage } from "@/pages/Items/ItemsPage";
import { CustomersPage } from "@/pages/Customers/CustomersPage";
import { StationsPage } from "@/pages/Stations/StationsPage";
import { MachinesPage } from "@/pages/Machines/MachinesPage";
import { MachineHardwarePage } from "@/pages/MachineHardware/MachineHardwarePage";
import { PrinterModelsPage } from "@/pages/PrinterModels/PrinterModelsPage";
import { LabelFormatProfilesPage } from "@/pages/LabelFormatProfiles/LabelFormatProfilesPage";
import { DefectTypesPage } from "@/pages/DefectTypes/DefectTypesPage";
import { QualityGradesPage } from "@/pages/QualityGrades/QualityGradesPage";
import { ColorsPage } from "@/pages/Colors/ColorsPage";
import { ReturnReasonsPage } from "@/pages/ReturnReasons/ReturnReasonsPage";
import { RoutesPage } from "@/pages/Routes/RoutesPage";
import { ProductRecipesPage } from "@/pages/ProductRecipes/ProductRecipesPage";
import { FabricPropertiesPage } from "@/pages/FabricProperties/FabricPropertiesPage";
import { SubcontractorCategoriesPage } from "@/pages/SubcontractorCategories/SubcontractorCategoriesPage";
import { SubcontractorsPage } from "@/pages/Subcontractors/SubcontractorsPage";
import { StationCapabilitiesPage } from "@/pages/StationCapabilities/StationCapabilitiesPage";
import { DeadlineDefaultsPage } from "@/pages/DeadlineDefaults/DeadlineDefaultsPage";
import { SystemHubPage } from "@/pages/System/SystemHubPage";
import { ActivityPage } from "@/pages/System/Activity/ActivityPage";
import { GeneralSettingsPage } from "@/pages/GeneralSettings/GeneralSettingsPage";
import { SystemEventsPage } from "@/pages/System/Events/SystemEventsPage";
import { ActivityArchivePage } from "@/pages/System/Archive/ActivityArchivePage";
import { ArchiveSearchPage } from "@/pages/System/Archive/ArchiveSearchPage";
import { ServerStatusPage } from "@/pages/System/ServerStatus/ServerStatusPage";
import { BackupsPage } from "@/pages/System/Backups/BackupsPage";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";
import { LabelTemplateEditPage } from "@/pages/LabelTemplates/LabelTemplateEditPage";
import { DocumentTemplatesPage } from "@/pages/Definitions/DocumentTemplatesPage";
import { TravelerCardSettingsPage } from "@/pages/Definitions/TravelerCardSettingsPage";
import { DevicesPage } from "@/pages/Devices/DevicesPage";
import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";
import { ReportsHubPage } from "@/pages/Reports/ReportsHubPage";
import { ProductionReportsHubPage } from "@/pages/Reports/Production/ProductionReportsHubPage";
import { StationEfficiencyPage } from "@/pages/Reports/Production/StationEfficiencyPage";
import { OperatorPerformancePage } from "@/pages/Reports/Production/OperatorPerformancePage";
import { MachineUsagePage } from "@/pages/Reports/Production/MachineUsagePage";
import { TravelerTracePage } from "@/pages/Reports/Production/TravelerTracePage";
import { ScrapPage } from "@/pages/Reports/Production/ScrapPage";
import { SalesReportsHubPage } from "@/pages/Reports/Sales/SalesReportsHubPage";
import { OrderFulfillmentPage } from "@/pages/Reports/Sales/OrderFulfillmentPage";
import { LateDeliveryPage } from "@/pages/Reports/Sales/LateDeliveryPage";
import { QualityReportsHubPage } from "@/pages/Reports/Quality/QualityReportsHubPage";
import { DefectDistributionPage } from "@/pages/Reports/Quality/DefectDistributionPage";
import { StationDefectRatePage } from "@/pages/Reports/Quality/StationDefectRatePage";
import { Qc2DecisionsPage } from "@/pages/Reports/Quality/Qc2DecisionsPage";
import { KursunApplicationPage } from "@/pages/Reports/Quality/KursunApplicationPage";
import { InventoryReportsHubPage } from "@/pages/Reports/Inventory/InventoryReportsHubPage";
import { RollAgingPage } from "@/pages/Reports/Inventory/RollAgingPage";
import { StockDistributionPage } from "@/pages/Reports/Inventory/StockDistributionPage";
import { MovementsPage } from "@/pages/Reports/Inventory/MovementsPage";
import { SubcontractReportsHubPage } from "@/pages/Reports/Subcontract/SubcontractReportsHubPage";
import { PerformancePage as SubcontractPerformancePage } from "@/pages/Reports/Subcontract/PerformancePage";
import { OpenDispatchesPage } from "@/pages/Reports/Subcontract/OpenDispatchesPage";
import { CustomerReportsHubPage } from "@/pages/Reports/Customer/CustomerReportsHubPage";
import { OrderProfilePage } from "@/pages/Reports/Customer/OrderProfilePage";
import { AliasStatsPage } from "@/pages/Reports/Customer/AliasStatsPage";
import { AuditReportsHubPage } from "@/pages/Reports/Audit/AuditReportsHubPage";
import { SystemLogSummaryPage } from "@/pages/Reports/Audit/SystemLogSummaryPage";
import { UserActivityPage } from "@/pages/Reports/Audit/UserActivityPage";
import { OrdersPage } from "@/pages/Operations/Orders/OrdersPage";
import { WorkOrdersPage } from "@/pages/Operations/WorkOrders/WorkOrdersPage";
import { WorkOrderDetailPage } from "@/pages/Operations/WorkOrders/WorkOrderDetailPage";
import { WorkOrderFormPage } from "@/pages/Operations/WorkOrders/WorkOrderFormPage";
import { RollsPage } from "@/pages/Operations/Rolls/RollsPage";
import { KursunQueuePage } from "@/pages/Operations/KursunQueue/KursunQueuePage";
import { ProductBalancePage } from "@/pages/Operations/ProductBalance/ProductBalancePage";
import { ShipmentsPage } from "@/pages/Operations/Shipments/ShipmentsPage";
import { SackStorePage } from "@/pages/Operations/SackStore/SackStorePage";
import { SackSearchPage } from "@/pages/Operations/SackSearch/SackSearchPage";
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
        <StationsPage />
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
    path: "definitions/machine-hardware",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <MachineHardwarePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/printer-models",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <PrinterModelsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/label-formats",
    element: (
      <ProtectedRoute requirePermission="station:read">
        <LabelFormatProfilesPage />
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
    path: "definitions/deadline-defaults",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DeadlineDefaultsPage />
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
        <LabelTemplateEditPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/document-templates",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DocumentTemplatesPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/traveler-card",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <TravelerCardSettingsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "definitions/devices",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <DevicesPage />
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
    path: "system/server-status",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
        <ServerStatusPage />
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
    path: "system/settings",
    element: (
      <ProtectedRoute requirePermission="admin:settings">
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
    path: "operations/kursun-queue",
    element: (
      <ProtectedRoute requirePermission="quality:write">
        <KursunQueuePage />
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
    path: "operations/sack-store",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <SackStorePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "operations/sack-search",
    element: (
      <ProtectedRoute requirePermission="shipping:read">
        <SackSearchPage />
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
    path: "reports/production/station-efficiency",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <StationEfficiencyPage />
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
    path: "reports/production/machine-usage",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <MachineUsagePage />
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
    path: "reports/production/scrap",
    element: (
      <ProtectedRoute requirePermission="report:production">
        <ScrapPage />
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
    path: "reports/sales/order-fulfillment",
    element: (
      <ProtectedRoute requirePermission="report:sales">
        <OrderFulfillmentPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/sales/late-delivery",
    element: (
      <ProtectedRoute requirePermission="report:sales">
        <LateDeliveryPage />
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
    path: "reports/quality/defect-distribution",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <DefectDistributionPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality/station-defect-rate",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <StationDefectRatePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality/qc2-decisions",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <Qc2DecisionsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/quality/kursun-application",
    element: (
      <ProtectedRoute requirePermission="report:quality">
        <KursunApplicationPage />
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
    path: "reports/inventory/roll-aging",
    element: (
      <ProtectedRoute requirePermission="report:inventory">
        <RollAgingPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/inventory/stock-distribution",
    element: (
      <ProtectedRoute requirePermission="report:inventory">
        <StockDistributionPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/inventory/movements",
    element: (
      <ProtectedRoute requirePermission="report:inventory">
        <MovementsPage />
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
    path: "reports/subcontract/performance",
    element: (
      <ProtectedRoute requirePermission="report:subcontract">
        <SubcontractPerformancePage />
      </ProtectedRoute>
    ),
  },
  {
    path: "reports/subcontract/open-dispatches",
    element: (
      <ProtectedRoute requirePermission="report:subcontract">
        <OpenDispatchesPage />
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
    path: "reports/customer/alias-stats",
    element: (
      <ProtectedRoute requirePermission="report:customer">
        <AliasStatsPage />
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
