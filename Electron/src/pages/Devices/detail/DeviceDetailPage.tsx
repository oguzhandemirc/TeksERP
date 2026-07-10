import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { useTabsStore } from "@/store/tabs";
import { SessionHistoryList } from "@/pages/System/WorkSessions/SessionHistoryList";
import { deviceService } from "../service";
import { DeviceHeaderCard } from "./DeviceHeaderCard";

/**
 * Cihaz İşlem Dökümü — Tanımlar → Cihazlar'da bir cihaza tıklayınca açılır.
 * Migration'sız saf okuma: cihaz bağı WorkSession ayak izinden (oturum listesi +
 * oturum penceresi başına RollOperation/RollMovement dökümü).
 */
export function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const detail = useQuery({
    queryKey: ["admin-devices", "detail", id],
    queryFn: () => deviceService.detail(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
  const device = detail.data?.data ?? null;

  useEffect(() => {
    if (!device?.name || !id) return;
    const tab = useTabsStore.getState().tabs.find((t) => t.path === `/access/devices/${id}`);
    if (tab) useTabsStore.getState().updateTabTitle(tab.id, `Cihaz · ${device.name}`);
  }, [device?.name, id]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={device ? device.name : "Cihaz Detayı"}
        description="Cihazın oturumları ve her oturum penceresinde yapılan işlemlerin dökümü."
        onBack={() => navigate("/access/devices")}
        actions={
          <RefreshButton
            queryKey={["admin-devices", "detail", id ?? ""]}
            extraKeys={[["work-sessions", "history"], ["work-sessions", "activity"]]}
          />
        }
      />

      <div className="flex-1 space-y-4 overflow-auto p-6">
        {detail.isLoading ? (
          <>
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        ) : !device ? (
          <p className="rounded-md border py-12 text-center text-sm text-muted-foreground">
            Cihaz bulunamadı.
          </p>
        ) : (
          <>
            <DeviceHeaderCard device={device} />
            <SessionHistoryList filter={{ deviceId: device.id }} variant="device" />
          </>
        )}
      </div>
    </div>
  );
}
