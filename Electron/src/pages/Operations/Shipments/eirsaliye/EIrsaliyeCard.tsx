// e-İrsaliye kartı (hazırlık HAZIR): durum, numara/ETTN, XML sürümü, uyarılar, eylemler,
// olay zaman çizelgesi. Odak: canlı kayıt; yoksa en yeni reddedilmiş kayıt (yerine yenisi
// hazırlanır, yanıtı geri alınabilir).
import { Card, CardContent } from "@/components/ui/card";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { EIrsaliyeActionBar } from "./EIrsaliyeActionBar";
import { EIrsaliyeRecordInfo } from "./EIrsaliyeRecordInfo";
import { EIrsaliyeTitle } from "./EIrsaliyeSection";
import { EIrsaliyeStatusBadge } from "./EIrsaliyeStatusBadge";
import { EIrsaliyeTimeline } from "./EIrsaliyeTimeline";
import { eirsaliyeActions } from "./eirsaliyeActions";
import { useShipmentEIrsaliye, type useEIrsaliyePermissions } from "./useEIrsaliye";
import type { EIrsaliyeRecordView, ShipmentEIrsaliye } from "./types";

type Perms = ReturnType<typeof useEIrsaliyePermissions>;

export function focusRecord(v: ShipmentEIrsaliye): EIrsaliyeRecordView | null {
  if (v.canli) return v.canli;
  const last = v.gecmis[0];
  return last?.status === "REDDEDILDI" ? last : null;
}

export function EIrsaliyeCard({ shipmentId, shipmentStatus, perms }: { shipmentId: string; shipmentStatus: string; perms: Perms }) {
  const q = useShipmentEIrsaliye(shipmentId, true);
  if (q.isError) return null;
  if (!q.data) return <Skeleton className="h-24 w-full" />;
  const v = q.data;
  const focus = focusRecord(v);
  const actions = eirsaliyeActions({
    ready: v.hazirlik.durum === "HAZIR",
    export: v.ihracat,
    shipmentStatus,
    record: focus,
    live: Boolean(v.canli),
    canWrite: perms.canWrite,
    canUndo: perms.canUndo,
  });
  return (
    <Card data-testid="eirsaliye-card" className="overflow-hidden">
      {focus?.simulasyon && (
        <div data-testid="eirsaliye-sim-band" className="bg-destructive px-3 py-1 text-center text-xs font-semibold text-destructive-foreground">
          SİMÜLASYON — bu kayıt GİB'e gönderilmez, yasal belge değildir
        </div>
      )}
      <CardContent className="space-y-2.5 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <EIrsaliyeTitle />
          <EIrsaliyeStatusBadge status={focus?.status ?? null} simulasyon={focus?.simulasyon} />
        </div>
        <CardNotices v={v} focus={focus} shipmentStatus={shipmentStatus} />
        {focus && <EIrsaliyeRecordInfo r={focus} />}
        <EIrsaliyeActionBar shipmentId={shipmentId} record={focus} actions={actions} />
        {focus && <EIrsaliyeTimeline events={focus.olaylar} history={v.gecmis.filter((g) => g.id !== focus.id)} />}
      </CardContent>
    </Card>
  );
}

function CardNotices({ v, focus, shipmentStatus }: { v: ShipmentEIrsaliye; focus: EIrsaliyeRecordView | null; shipmentStatus: string }) {
  return (
    <>
      {v.ihracat && (
        <div data-testid="eirsaliye-export">
          <Callout tone="info">İhracat sevkiyatı için e-İrsaliye v1'de desteklenmiyor.</Callout>
        </div>
      )}
      {!v.ihracat && !focus && shipmentStatus !== "DISPATCHED" && (
        <p className="text-xs text-muted-foreground">Sevkiyat sevk edildikten sonra hazırlanır.</p>
      )}
      {focus?.kaynakDegisti && (
        <div data-testid="eirsaliye-source-changed">
          <Callout tone="warning" title="Kâğıt irsaliye değişti — yeniden üretin">
            Sevk irsaliyesi bu XML üretildikten sonra revize edildi ya da iptal edildi; XML eski içeriği taşıyor.
          </Callout>
        </div>
      )}
      {focus?.status === "REDDEDILDI" && (
        <p className="text-xs text-muted-foreground">Müşteri reddetti; düzeltip yerine yeni e-İrsaliye hazırlayın.</p>
      )}
    </>
  );
}
