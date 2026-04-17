import {
  ShoppingCart,
  Cylinder,
  ClipboardList,
  Truck,
  AlertTriangle,
  CircleDot,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import KPICard from "@/components/charts/KPICard";
import BarChartCard from "@/components/charts/BarChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import LineChartCard from "@/components/charts/LineChartCard";

const monthlyOrderData = [
  { month: "Oca", siparis: 12 },
  { month: "Şub", siparis: 19 },
  { month: "Mar", siparis: 15 },
  { month: "Nis", siparis: 22 },
  { month: "May", siparis: 18 },
  { month: "Haz", siparis: 25 },
];

const rollStatusData = [
  { name: "Depoda", value: 45 },
  { name: "Üretimde", value: 30 },
  { name: "Hazır", value: 15 },
  { name: "Sevk Edildi", value: 8 },
  { name: "Fire", value: 2 },
];

const productionTrendData = [
  { hafta: "H1", uretim: 120 },
  { hafta: "H2", uretim: 135 },
  { hafta: "H3", uretim: 98 },
  { hafta: "H4", uretim: 156 },
  { hafta: "H5", uretim: 142 },
  { hafta: "H6", uretim: 168 },
];

const DashboardPage = () => {
  const user = useAuthStore((s) => s.user);
  const { isAdmin, hasAnyPermission } = useRoleAccess();

  const canSeeOrders = isAdmin || hasAnyPermission(["order:read"]);
  const canSeeRolls = isAdmin || hasAnyPermission(["roll:read"]);
  const canSeeWorkOrders = isAdmin || hasAnyPermission(["workorder:read"]);
  const canSeeShipping = isAdmin || hasAnyPermission(["shipment:read"]);
  const canSeeQuality = isAdmin || hasAnyPermission(["quality:read"]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Hoş geldiniz, {user?.username}. İşte güncel üretim özetiniz.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {canSeeOrders && (
          <KPICard
            title="Aktif Siparişler"
            value={24}
            description="Bu ay"
            icon={ShoppingCart}
            trend={{ value: 12, isPositive: true }}
          />
        )}
        {canSeeRolls && (
          <KPICard
            title="Depodaki Toplar"
            value={142}
            description="STOCK durumunda"
            icon={Cylinder}
            trend={{ value: 5, isPositive: true }}
          />
        )}
        {canSeeWorkOrders && (
          <KPICard
            title="Aktif İş Emirleri"
            value={8}
            description="IN_PROGRESS"
            icon={ClipboardList}
          />
        )}
        {canSeeShipping && (
          <KPICard
            title="Bekleyen Sevkiyat"
            value={3}
            description="PREPARING durumunda"
            icon={Truck}
          />
        )}
        {canSeeQuality && (
          <>
            <KPICard
              title="Fire Oranı"
              value="%2.1"
              description="Son 30 gün"
              icon={AlertTriangle}
              trend={{ value: 0.3, isPositive: false }}
            />
            <KPICard
              title="Tambur Bekleyen"
              value={5}
              description="Karar bekliyor"
              icon={CircleDot}
            />
          </>
        )}
      </div>

      {isAdmin && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <BarChartCard
            title="Aylık Sipariş Sayısı"
            data={monthlyOrderData}
            dataKey="siparis"
            xAxisKey="month"
          />
          <PieChartCard
            title="Top Durumu Dağılımı"
            data={rollStatusData}
          />
          <LineChartCard
            title="Haftalık Üretim Trendi"
            data={productionTrendData}
            dataKey="uretim"
            xAxisKey="hafta"
          />
        </div>
      )}

      {!isAdmin && canSeeQuality && (
        <div className="grid gap-4 lg:grid-cols-2">
          <PieChartCard
            title="Top Durumu Dağılımı"
            data={rollStatusData}
          />
          <LineChartCard
            title="Haftalık Üretim Trendi"
            data={productionTrendData}
            dataKey="uretim"
            xAxisKey="hafta"
          />
        </div>
      )}

      {!isAdmin && canSeeShipping && !canSeeQuality && (
        <div className="grid gap-4 lg:grid-cols-2">
          <BarChartCard
            title="Aylık Sipariş Sayısı"
            data={monthlyOrderData}
            dataKey="siparis"
            xAxisKey="month"
          />
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
