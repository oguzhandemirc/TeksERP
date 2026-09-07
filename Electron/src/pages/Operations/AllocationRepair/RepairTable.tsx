import { AlertTriangle, CheckCircle2, Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RepairableShipment } from "./service";

const NO_LINK = "cursor-pointer underline decoration-dotted underline-offset-4 hover:text-primary";

/** Üstteki özet şeridi — "ne kadar mal defterde yok" tek bakışta. */
export function OzetSerit({
  sevkiyat,
  bosluk,
  onarilabilirSevkiyat,
  kazanc,
}: {
  sevkiyat: number;
  bosluk: number;
  onarilabilirSevkiyat: number;
  kazanc: number;
}) {
  if (sevkiyat === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
        <CheckCircle2 className="h-5 w-5" />
        <span>Siparişe yazılamayan sevkiyat yok — defter temiz.</span>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" /> Deftere işlenmemiş
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(bosluk).toLocaleString("tr-TR")} m</div>
        <div className="text-xs text-muted-foreground">{sevkiyat} sevkiyatta</div>
      </div>
      <div className="rounded-md border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Wrench className="h-4 w-4" /> Bugün onarılabilir
        </div>
        <div className="mt-1 text-2xl font-semibold">{Math.round(kazanc).toLocaleString("tr-TR")} m</div>
        <div className="text-xs text-muted-foreground">{onarilabilirSevkiyat} sevkiyatta</div>
      </div>
    </div>
  );
}

/**
 * Sipariş numaraları — id GELDİYSE tıklanabilir, gelmediyse düz metin.
 *
 * ⚠️ Eski sunucu `orders` alanını göndermez; o zaman numara okunur ama açılmaz.
 * Numaradan id'yi arayarak "yine de tıklanabilir yapmak" mükerrer numarada
 * YANLIŞ siparişi açardı — sessiz yanlış, görünür eksikten kötüdür.
 */
function SiparisNolari({
  satir,
  onSiparis,
}: {
  satir: RepairableShipment;
  onSiparis: (orderId: string) => void;
}) {
  if (satir.orders?.length) {
    return (
      <span className="text-xs">
        {satir.orders.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ", "}
            <button type="button" className={NO_LINK} onClick={() => onSiparis(o.id)} title="Sipariş detayını aç">
              {o.orderNumber}
            </button>
          </span>
        ))}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{satir.orderNumbers.join(", ") || "—"}</span>;
}

/** Tek satır — tablo gövdesinden ayrı: numaralar tıklanabilir olunca uzadı. */
function SevkiyatSatiri({
  s,
  onSec,
  onSiparis,
  onSevkiyat,
  calisanId,
}: {
  s: RepairableShipment;
  onSec: (s: RepairableShipment) => void;
  onSiparis: (orderId: string) => void;
  onSevkiyat: (shipmentId: string) => void;
  calisanId?: string;
}) {
  const onarilir = s.onarilabilirMetraj > 0.001;
  return (
    <tr className="border-t [&>td]:px-3 [&>td]:py-2">
      <td className="font-medium">
        <button
          type="button"
          className={NO_LINK}
          onClick={() => onSevkiyat(s.shipmentId)}
          title="Sevkiyat detayını aç"
        >
          {s.shipmentNo}
        </button>
        <div className="text-xs text-muted-foreground">
          {s.dispatchedAt ? new Date(s.dispatchedAt).toLocaleDateString("tr-TR") : "—"}
        </div>
      </td>
      <td>{s.customer?.name ?? "—"}</td>
      <td>
        <SiparisNolari satir={s} onSiparis={onSiparis} />
      </td>
      <td className="text-right">{Math.round(s.icerikMetraj)}</td>
      <td className="text-right">{Math.round(s.yazilanMetraj)}</td>
      <td className="text-right font-semibold text-amber-700 dark:text-amber-400">
        {Math.round(s.bosluk)}
      </td>
      <td className="text-right font-semibold">
        {onarilir ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            {Math.round(s.onarilabilirMetraj)}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="text-right">
        <Button
          size="sm"
          variant={onarilir ? "default" : "outline"}
          disabled={!onarilir || calisanId === s.shipmentId}
          onClick={() => onSec(s)}
          title={
            onarilir
              ? "Ne yazılacağını göster"
              : "Bugün de yazılamıyor — sipariş dolu ya da kumaş/renk/en tutmuyor"
          }
          className="gap-1.5"
        >
          {calisanId === s.shipmentId && <Loader2 className="h-4 w-4 animate-spin" />}
          İncele
        </Button>
      </td>
    </tr>
  );
}

/** Sevkiyat listesi — onarılabilir olanlar üstte. */
export function SevkiyatTablosu({
  satirlar,
  onSec,
  onSiparis,
  onSevkiyat,
  calisanId,
}: {
  satirlar: RepairableShipment[];
  onSec: (s: RepairableShipment) => void;
  onSiparis: (orderId: string) => void;
  onSevkiyat: (shipmentId: string) => void;
  calisanId?: string;
}) {
  const sirali = [...satirlar].sort((a, b) => b.onarilabilirMetraj - a.onarilabilirMetraj);
  if (sirali.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
            <th>Sevkiyat</th>
            <th>Müşteri</th>
            <th>Sipariş</th>
            <th className="text-right">Çıkan</th>
            <th className="text-right">Yazılan</th>
            <th className="text-right">Eksik</th>
            <th className="text-right">Onarılabilir</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sirali.map((s) => (
            <SevkiyatSatiri
              key={s.shipmentId}
              s={s}
              onSec={onSec}
              onSiparis={onSiparis}
              onSevkiyat={onSevkiyat}
              calisanId={calisanId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
