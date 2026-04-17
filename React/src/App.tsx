import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useEffect } from "react";

import LoginPage from "@/pages/Auth/LoginPage";
import DashboardPage from "@/pages/Dashboard/DashboardPage";
import ItemsPage from "@/pages/Items/ItemsPage";
import CustomersPage from "@/pages/Customers/CustomersPage";
import StationsPage from "@/pages/Stations/StationsPage";
import MachinesPage from "@/pages/Machines/MachinesPage";
import RoutesPage from "@/pages/Routes/RoutesPage";
import KK1Page from "@/pages/KK1/KK1Page";
import KursunQcPage from "@/pages/KursunQc/KursunQcPage";
import RollsPage from "@/pages/Rolls/RollsPage";
import OrdersPage from "@/pages/Orders/OrdersPage";
import WorkOrdersPage from "@/pages/WorkOrders/WorkOrdersPage";
import AttachRollsPage from "@/pages/Field/AttachRollsPage";
import TravelerCardScanPage from "@/pages/TravelerCards/TravelerCardScanPage";
import ProductionPage from "@/pages/Production/ProductionPage";
import TamburPage from "@/pages/Tambur/TamburPage";
import ShippingPage from "@/pages/Shipping/ShippingPage";
import SystemLogsPage from "@/pages/SystemLogs/SystemLogsPage";
import UsersPage from "@/pages/Users/UsersPage";
import ReportsPage from "@/pages/Reports/ReportsPage";
import OperatorHubPage from "@/pages/OperatorHub/OperatorHubPage";
import DispatchesPage from "@/pages/Subcontractor/DispatchesPage";
import ReceiptsPage from "@/pages/Subcontractor/ReceiptsPage";
import SwatchesPage from "@/pages/Swatches/SwatchesPage";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import { useAuthStore } from "@/store/useAuthStore";
import { useThemeStore } from "@/store/useThemeStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const AppRoutes = () => {
  const { isAuthenticated, isLoading, hydrate } = useAuthStore();
  const initializeTheme = useThemeStore((s) => s.initialize);

  useEffect(() => {
    hydrate();
    initializeTheme();
  }, [hydrate, initializeTheme]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
        }
      />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/stations" element={<StationsPage />} />
          <Route path="/machines" element={<MachinesPage />} />
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/rolls" element={<RollsPage />} />
          <Route path="/kk1" element={<KK1Page />} />
          <Route path="/kursun-qc" element={<KursunQcPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/work-orders" element={<WorkOrdersPage />} />
          <Route path="/field/attach-rolls" element={<AttachRollsPage />} />
          <Route path="/field/traveler-scan" element={<TravelerCardScanPage />} />
          <Route path="/production" element={<ProductionPage />} />
          <Route path="/tambur" element={<TamburPage />} />
          <Route path="/operator-hub" element={<OperatorHubPage />} />
          <Route path="/subcontractor/dispatches" element={<DispatchesPage />} />
          <Route path="/subcontractor/receipts" element={<ReceiptsPage />} />
          <Route path="/swatches" element={<SwatchesPage />} />
          <Route path="/shipping" element={<ShippingPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/logs" element={<SystemLogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
