import { useState, type ReactNode } from "react";
import { ClipboardList, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeFormat, formatNumber } from "@/lib/format";
import { shipmentDestinationLabels, type ShipmentDetail } from "../types";
import { OrdersModal } from "./OrdersModal";
import { ReturnsModal } from "./ReturnsModal";
import { DispatchNoteEditor } from "../DispatchNoteEditor";
import { ManualSackCountEditor } from "../ManualSackCountEditor";

const num = (v: number | null | undefined) => formatNumber(v, 1);
const int = (v: number | null | undefined) => formatNumber(v, 0);

/**
 * Sevkiyat detayının üst özet PANELİ — tek kart: üstte KPI şeridi (Top / Toplam
 * Metraj / Çuval·Kg / İade) + Siparişler/İadeler modallarını açan tuşlar; altında
 * ince ayraçla ayrılmış künye satırı (plaka/sürücü/taşıyıcı/tarih/hedef/prosedür).
 * Metrikler ve künye AYNI kabın içinde → dağınık üç bant yerine sayfayla bütünleşik,
 * kurumsal tek blok. Asıl dikey alan aşağıdaki çuval listesine kalır.
 */
export function ShipmentDetailMeta({ d }: { d: ShipmentDetail }) {
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [returnsOpen, setReturnsOpen] = useState(false);
  const hasReturns = d.summary.returnedCount > 0;

  return (
    <div className="shrink-0 pb-3">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        {/* KPI şeridi + aksiyonlar */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Metric label="Top" value={int(d.summary.rollCount)} />
            <Sep />
            <Metric label="Toplam Metraj" value={`${int(d.summary.totalMeters)} m`} />
            <Sep />
            <Metric label="Çuval · Kg" value={`${d.summary.sackCount} · ${num(d.summary.totalKg)} kg`} />
            <Sep />
            <Metric label="İade" value={int(d.summary.returnedCount)} highlight={hasReturns} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={d.orders.length === 0}
              onClick={() => setOrdersOpen(true)}
            >
              <ClipboardList className="h-3.5 w-3.5" /> Siparişler ({d.orders.length})
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={!hasReturns}
              onClick={() => setReturnsOpen(true)}
            >
              <Undo2 className="h-3.5 w-3.5" /> İadeler ({d.summary.returnedCount})
            </Button>
          </div>
        </div>

        {/* Künye — aynı kartın alt şeridi (ince ayraç + hafif zemin) */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t bg-muted/30 px-4 py-2.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            Künye
          </span>
          <Info label="Plaka" value={d.plateNumber} />
          <Info label="Sürücü" value={d.driverName} />
          <Info label="Taşıyıcı" value={d.carrier} />
          <Info label="Sevk Tarihi" value={d.dispatchedAt ? safeFormat(d.dispatchedAt, "dd.MM.yyyy HH:mm") : null} />
          <Info label="Hedef" value={shipmentDestinationLabels[d.destination]} />
          <Info label="Gümrük/İhracat No" value={d.procedureCode} />
        </div>

        {/* İrsaliye açıklaması — sevkiyata kayıtlı not (annotation); her an düzenlenir,
            irsaliyeye basılır. Opsiyonel, boşsa uyarı yok. */}
        <div className="border-t px-4 py-2.5">
          <DispatchNoteEditor shipmentId={d.id} />
        </div>

        {/* Araca yüklenen gerçek çuval adedi — bayrak kapalıysa hiç çizilmez.
            Sistemin saydığı kayıt adedi karşılaştırma için yanında durur. */}
        <div className="border-t px-4 py-2.5 empty:hidden">
          <ManualSackCountEditor
            shipmentId={d.id}
            systemCount={d.summary?.sackCount ?? 0}
            value={d.manualSackCount ?? null}
          />
        </div>
      </div>

      <OrdersModal d={d} open={ordersOpen} onOpenChange={setOrdersOpen} />
      <ReturnsModal d={d} open={returnsOpen} onOpenChange={setReturnsOpen} />
    </div>
  );
}

/** KPI hücresi — etiket üstte küçük/mat, değer altta büyük/yarı-kalın. */
function Metric({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-lg font-semibold leading-none tabular-nums", highlight && "text-warning")}>
        {value}
      </span>
    </div>
  );
}

/** KPI'lar arası dikey ince ayraç (dar ekranda gizlenir, sarma bozulmasın). */
function Sep() {
  return <span className="hidden h-8 w-px shrink-0 self-center bg-border sm:block" aria-hidden />;
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </span>
  );
}
