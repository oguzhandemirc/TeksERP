// Çözgü ihtiyacı (D8): kart başına gerekli · eldeki + yoldaki (stok, planlı levent, deverecide; açık dokuma işlerine
// ayrılan düşülür) · eksik · öneri. "Devere siparişi aç" formu kart + adet × boy + devereci (+ sipariş bağı) dolu açar.
// Sayılar sunucudan; burada yalnız biçim. Tablo Çözgü Hesabı sekmesinde, dar liste dokuma işi panelinde.
import type { MouseEvent } from "react";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { cn } from "@/lib/utils";
import { fmtNeedM, needOrderHref, needStatusText, roleLabel } from "./need-model";
import type { WarpNeedResult, WarpNeedRow } from "./need-types";

interface Props {
  res: WarpNeedResult;
  /** Bağlantı açılmadan önce (ör. paneli kapat). */
  onNavigate?: () => void;
}

const NUM = "text-right tabular-nums whitespace-nowrap";
const rowKey = (r: WarpNeedRow) => `${r.demandKey}:${r.role}:${r.warpSpecId}`;
const isShort = (r: WarpNeedRow) => r.shortfallM != null && r.shortfallM > 0;
const shortText = (r: WarpNeedRow) => (r.ownBeam ? (isShort(r) ? fmtNeedM(r.shortfallM) : "yok") : "—");

/** Arz kırılımı: yalnız sıfır olmayan kalemler; açık dokuma işlerine ayrılan eksi olarak. */
function supplyParts(r: WarpNeedRow): string[] {
  const s = r.supply;
  if (!s) return [];
  const out = [`stok ${fmtNeedM(s.stockM)}`];
  if (s.plannedBeamM > 0) out.push(`planlı levent ${fmtNeedM(s.plannedBeamM)}`);
  if (s.openWarpingM > 0) out.push(`deverecide ${fmtNeedM(s.openWarpingM)}`);
  if (r.committedM != null && r.committedM > 0) out.push(`açık işlere ayrılan −${fmtNeedM(r.committedM)}`);
  return out;
}

function OrderButton({ r, res, onNavigate }: { r: WarpNeedRow } & Props) {
  const openTarget = useOpenTarget();
  const href = needOrderHref(r, res.salesOrder);
  if (!href) return null;
  return (
    <PermissionGate permission="warping-order:write">
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5"
        onClick={(e: MouseEvent) => {
          onNavigate?.();
          openTarget(href, e);
        }}
      >
        <Truck className="mr-1 h-4 w-4" /> Devere siparişi aç
      </Button>
      {r.subcontractor && <div className="mt-1 text-xs text-muted-foreground">Devereci: {r.subcontractor.name} (son sipariş)</div>}
    </PermissionGate>
  );
}

function SpecHead({ r, multiItem }: { r: WarpNeedRow; multiItem: boolean }) {
  return (
    <>
      <div className="font-medium">
        <span className="font-mono">{r.warpSpecCode}</span>
        <span className="ml-1 text-xs font-normal text-muted-foreground">{roleLabel(r)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {multiItem && `${r.itemName} · `}
        {r.warpSpecName !== r.warpSpecCode && `${r.warpSpecName} · `}
        {r.fabricM != null && `${fmtNeedM(r.fabricM)} kumaş`}
        {r.takeUpPct != null && ` · çekme %${r.takeUpPct}`}
      </div>
      {r.openWarpingOrders.length > 0 && (
        <div className="mt-1 text-xs text-muted-foreground">
          Açık devere: {r.openWarpingOrders.map((o) => `${o.orderNo} (${o.subcontractorName}, kalan ${fmtNeedM(o.remainingM)})`).join(", ")}
        </div>
      )}
    </>
  );
}

export function NeedTable({ res, onNavigate }: Props) {
  if (res.rows.length === 0) return null;
  const multiItem = new Set(res.rows.map((r) => r.itemId)).size > 1;
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Çözgü kartı</TableHead>
            <TableHead className={NUM}>Gerekli</TableHead>
            <TableHead className={NUM}>Eldeki + yoldaki</TableHead>
            <TableHead className={NUM}>Eksik</TableHead>
            <TableHead>Öneri</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.rows.map((r) => (
            <TableRow key={rowKey(r)} data-testid="warp-need-row">
              <TableCell className="min-w-[14rem] max-w-[24rem] whitespace-normal align-top">
                <SpecHead r={r} multiItem={multiItem} />
              </TableCell>
              <TableCell className={cn(NUM, "align-top font-medium")}>{fmtNeedM(r.requiredM)}</TableCell>
              <TableCell className={cn(NUM, "align-top")}>
                {r.supply ? (
                  <>
                    <div>{fmtNeedM(r.supply.totalM)}</div>
                    {supplyParts(r).map((t) => (
                      <div key={t} className="text-xs text-muted-foreground">{t}</div>
                    ))}
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className={cn(NUM, "align-top", isShort(r) && "font-semibold text-destructive")}>{shortText(r)}</TableCell>
              <TableCell className="align-top">
                <div className={cn("text-sm", r.suggestion ? "font-medium" : "text-muted-foreground")}>{needStatusText(r)}</div>
                <OrderButton r={r} res={res} onNavigate={onNavigate} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Dar yüzey (dokuma işi paneli, `wo-v3` kabı — `card` ve `--border` oradan): satır başına kart + üç sayı + öneri. */
export function NeedCompactList({ res, onNavigate }: Props) {
  if (res.rows.length === 0) return null;
  return (
    <ul className="card text-sm">
      {res.rows.map((r, i) => (
        <li key={rowKey(r)} className="space-y-1 px-4 py-3" style={i > 0 ? { borderTop: "1px solid var(--border)" } : undefined} data-testid="warp-need-row">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono font-medium">{r.warpSpecCode}</span>
            <span className="text-xs text-muted-foreground">{roleLabel(r)}</span>
            <span className="ml-auto tabular-nums text-xs text-muted-foreground">
              gerekli <b className="text-foreground">{fmtNeedM(r.requiredM)}</b>
              {r.supply && <> · eldeki + yoldaki <b className="text-foreground">{fmtNeedM(r.supply.totalM)}</b></>}
              {r.ownBeam && <> · eksik <b className={isShort(r) ? "text-destructive" : "text-foreground"}>{shortText(r)}</b></>}
            </span>
          </div>
          <div className={cn(r.suggestion ? "font-medium" : "text-muted-foreground")}>{needStatusText(r)}</div>
          <OrderButton r={r} res={res} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}
