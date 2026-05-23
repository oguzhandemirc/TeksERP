import { createHashRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { LoginPage } from "@/pages/Login/LoginPage";
import { ForbiddenPage } from "@/pages/Forbidden/ForbiddenPage";
import { DashboardPage } from "@/pages/Dashboard/DashboardPage";
import { DefinitionsHubPage } from "@/pages/Definitions/DefinitionsHubPage";
import { PlaceholderPage } from "@/pages/Placeholder/PlaceholderPage";
import { AccessHubPage } from "@/pages/Access/AccessHubPage";
import { AccessUsersPage } from "@/pages/Access/Users/AccessUsersPage";
import { TemplatesPage } from "@/pages/Access/Templates/TemplatesPage";
import { PermissionsCatalogPage } from "@/pages/Access/Permissions/PermissionsCatalogPage";
import { ItemsPage } from "@/pages/Items/ItemsPage";
import { CustomersPage } from "@/pages/Customers/CustomersPage";
import { StationsPage } from "@/pages/Stations/StationsPage";
import { MachinesPage } from "@/pages/Machines/MachinesPage";
import { DefectTypesPage } from "@/pages/DefectTypes/DefectTypesPage";
import { QualityGradesPage } from "@/pages/QualityGrades/QualityGradesPage";
import { ColorsPage } from "@/pages/Colors/ColorsPage";
import { RoutesPage } from "@/pages/Routes/RoutesPage";
import { FabricPropertiesPage } from "@/pages/FabricProperties/FabricPropertiesPage";
import { SubcontractorCategoriesPage } from "@/pages/SubcontractorCategories/SubcontractorCategoriesPage";
import { SubcontractorsPage } from "@/pages/Subcontractors/SubcontractorsPage";
import { StationCapabilitiesPage } from "@/pages/StationCapabilities/StationCapabilitiesPage";
import { ShippingTolerancePage } from "@/pages/ShippingTolerance/ShippingTolerancePage";
import { DeadlineDefaultsPage } from "@/pages/DeadlineDefaults/DeadlineDefaultsPage";
import { GeneralSettingsPage } from "@/pages/GeneralSettings/GeneralSettingsPage";
import { SystemHubPage } from "@/pages/System/SystemHubPage";
import { ActivityPage } from "@/pages/System/Activity/ActivityPage";
import { SystemEventsPage } from "@/pages/System/Events/SystemEventsPage";
import { ActivityArchivePage } from "@/pages/System/Archive/ActivityArchivePage";
import { ArchiveSearchPage } from "@/pages/System/Archive/ArchiveSearchPage";
import { LabelTemplatesPage } from "@/pages/LabelTemplates/LabelTemplatesPage";
import { LabelTemplateEditPage } from "@/pages/LabelTemplates/LabelTemplateEditPage";
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
import { CustomerShipmentsPage } from "@/pages/Reports/Sales/CustomerShipmentsPage";
import { QualityReportsHubPage } from "@/pages/Reports/Quality/QualityReportsHubPage";
import { DefectDistributionPage } from "@/pages/Reports/Quality/DefectDistributionPage";
import { StationDefectRatePage } from "@/pages/Reports/Quality/StationDefectRatePage";
import { Qc2DecisionsPage } from "@/pages/Reports/Quality/Qc2DecisionsPage";
import { KursunApplicationPage } from "@/pages/Reports/Quality/KursunApplicationPage";
import { InventoryReportsHubPage } from "@/pages/Reports/Inventory/InventoryReportsHubPage";
import { RollAgingPage } from "@/pages/Reports/Inventory/RollAgingPage";
import { StockDistributionPage } from "@/pages/Reports/Inventory/StockDistributionPage";
import { CustomerOwnedPage } from "@/pages/Reports/Inventory/CustomerOwnedPage";
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
import { RollsPage } from "@/pages/Operations/Rolls/RollsPage";
import { ShipmentsPage } from "@/pages/Operations/Shipments/ShipmentsPage";
import { ShipmentEditPage } from "@/pages/Operations/Shipments/ShipmentEditPage";
import { ShipFromOrderPage } from "@/pages/Operations/Shipments/ShipFromOrderPage";
import { ShippingQueuePage } from "@/pages/Operations/ShippingQueue/ShippingQueuePage";

export const router = createHashRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/forbidden", element: <ForbiddenPage /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },

      // Tanımlar — hub sayfası ve alt sayfalar
      { path: "definitions", element: <DefinitionsHubPage /> },
      { path: "definitions/items", element: <ItemsPage /> },
      { path: "definitions/customers", element: <CustomersPage /> },
      { path: "definitions/stations", element: <StationsPage /> },
      { path: "definitions/machines", element: <MachinesPage /> },
      { path: "definitions/routes", element: <RoutesPage /> },
      { path: "definitions/defect-types", element: <DefectTypesPage /> },
      { path: "definitions/quality-grades", element: <QualityGradesPage /> },
      { path: "definitions/colors", element: <ColorsPage /> },
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
        path: "definitions/shipping-tolerance",
        element: (
          <ProtectedRoute requirePermission="admin:settings">
            <ShippingTolerancePage />
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
        path: "operations/rolls",
        element: (
          <ProtectedRoute requirePermission="roll:read">
            <RollsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "operations/shipments",
        element: (
          <ProtectedRoute requirePermission="shipment:read">
            <ShipmentsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "operations/shipments/from-order/:orderId",
        element: (
          <ProtectedRoute requirePermission="shipment:write">
            <ShipFromOrderPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "operations/shipments/:id/edit",
        element: (
          <ProtectedRoute requirePermission="shipment:write">
            <ShipmentEditPage />
          </ProtectedRoute>
        ),
      },
      {
        path: "operations/shipping-queue",
        element: (
          <ProtectedRoute requirePermission="allocation:write">
            <ShippingQueuePage />
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
        path: "reports/sales/customer-shipments",
        element: (
          <ProtectedRoute requirePermission="report:sales">
            <CustomerShipmentsPage />
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
        path: "reports/inventory/customer-owned",
        element: (
          <ProtectedRoute requirePermission="report:inventory">
            <CustomerOwnedPage />
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
    ],
  },
]);
