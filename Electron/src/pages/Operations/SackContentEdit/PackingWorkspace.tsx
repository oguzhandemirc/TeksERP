import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useShipmentDetail } from "./useShipmentDetail";
import { ScanInBar } from "./ScanInBar";
import { SackList } from "./SackList";
import { ShipmentLifecycleFooter } from "./ShipmentLifecycleFooter";
import { shipmentStatusLabels, destinationLabels } from "./types";

interface Props {
  shipmentId: string;
  /** "Başka sevkiyat" — seçim/giriş ekranına dön. */
  onExit: () => void;
}

/**
 * Tek sevkiyatın paketleme/düzeltme workspace'i. PREPARING'de aktif-çuval okutma
 * çubuğu + çuval aç; her düzenlenebilir durumda içerik listesi (çıkar/taşı/takas/
 * tartı); altta yaşam döngüsü (çuval depoya kaldır / kapı önü / sevk).
 */
export function PackingWorkspace({ shipmentId, onExit }: Props) {
  const q = useShipmentDetail(shipmentId);
  const detail = q.data?.data;
  const [activeSackId, setActiveSackId] = useState<string | null>(null);

  // Aktif çuval geçerliliğini koru: PREPARING'de çuval varsa ve seçim yoksa/geçersizse
  // son çuvalı aktif yap (mobil ensureActiveSack davranışı — okutma hep hedefe gider).
  useEffect(() => {
    if (!detail || detail.status !== "PREPARING") {
      setActiveSackId(null);
      return;
    }
    const ids = detail.sacks.map((s) => s.id);
    setActiveSackId((prev) => (prev && ids.includes(prev) ? prev : (ids[ids.length - 1] ?? null)));
  }, [detail]);

  return (
    <div className="flex h-full flex-col">
      {/* Sevkiyat başlığı */}
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" /> Başka Sevkiyat
          </Button>
          {detail ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">{detail.shipmentNo}</span>
                <Badge variant="outline" className="text-[10px]">
                  {shipmentStatusLabels[detail.status]}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {destinationLabels[detail.destination]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {detail.customer.name}
                {detail.branch ? ` · ${detail.branch.name}` : ""}
              </p>
            </div>
          ) : (
            <Skeleton className="h-8 w-40" />
          )}
        </div>
      </div>

      {detail && detail.status === "PREPARING" && (
        <ScanInBar
          shipmentId={shipmentId}
          sacks={detail.sacks}
          activeSackId={activeSackId}
          onSetActiveSack={setActiveSackId}
        />
      )}

      <div className="flex-1 overflow-auto p-6">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </div>
        ) : detail ? (
          <SackList
            detail={detail}
            activeSackId={detail.status === "PREPARING" ? activeSackId : null}
            onSetActiveSack={detail.status === "PREPARING" ? setActiveSackId : undefined}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Sevkiyat bulunamadı.</p>
        )}
      </div>

      {detail && <ShipmentLifecycleFooter detail={detail} />}
    </div>
  );
}
