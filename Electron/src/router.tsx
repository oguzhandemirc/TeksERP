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
import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";
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

      // Sistem (Admin)
      {
        path: "system",
        element: (
          <ProtectedRoute requirePermission="admin:settings">
            <PlaceholderPage title="Sistem" description="Ayarlar ve sistem kayıtları" />
          </ProtectedRoute>
        ),
      },
      {
        path: "system/logs",
        element: (
          <ProtectedRoute requirePermission="admin:settings">
            <PlaceholderPage title="Sistem Kayıtları" />
          </ProtectedRoute>
        ),
      },
      {
        path: "system/settings",
        element: (
          <ProtectedRoute requirePermission="admin:settings">
            <PlaceholderPage title="Ayarlar" />
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

      // Raporlar
      { path: "reports", element: <PlaceholderPage title="Raporlar" /> },

      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
