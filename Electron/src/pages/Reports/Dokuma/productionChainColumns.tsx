// Üretim Zinciri kolonları — hücreye tıklamak O BELGEYİ açar (satırın tamamına detay yok); rozetler durumdan gelir.
import type { ColumnDef } from "@tanstack/react-table";
import type { MouseEvent, ReactNode } from "react";
import { useDrillTarget } from "@/components/layout/tabs/use-tab-target";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { workOrderStatusLabels } from "@/types/enums";
import { WEAVING_STATUS_META } from "@/pages/Operations/WeavingOrders/types";
import { WARP_BEAM_STATUS_META } from "@/pages/Operations/WarpBeams/types";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { CHAIN_STATUS_LABEL, type ChainRow } from "./productionChain";

/** Tıklanabilir hücre — sol tık yerinde, orta/ctrl yeni sekme, sağ tık arka plan (hub kartıyla aynı sözleşme). */
export function DrillCell({ to, title, children }: { to: string; title: string; children: ReactNode }) {
  const drill = useDrillTarget(to);
  return (
    <button type="button" title={title} className="block w-full rounded px-1 py-0.5 text-left hover:bg-muted/60" onClick={drill.onClick} onAuxClick={drill.onAuxClick as (e: MouseEvent<HTMLButtonElement>) => void} onContextMenu={drill.onContextMenu as (e: MouseEvent<HTMLButtonElement>) => void}>
      {children}
    </button>
  );
}

const Empty = ({ hint }: { hint: string }) => <span className="text-xs text-muted-foreground" title={hint}>—</span>;
const meta = (m: { label: string; badgeClass: string } | undefined, status: string) => m ?? { label: status, badgeClass: "bg-muted text-muted-foreground" };
const Pill = ({ m }: { m: { label: string; badgeClass: string } }) => <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${m.badgeClass}`}>{m.label}</span>;

export function chainColumns(devere: boolean): ColumnDef<ChainRow, unknown>[] {
  const cols: ColumnDef<ChainRow, unknown>[] = [
    { id: "musteri", header: "Müşteri · Kumaş", cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.musteri.ad}</div>
        <div className="text-xs text-muted-foreground">{row.original.kumas.ad}{row.original.renk ? ` · ${row.original.renk.ad}` : ""}</div>
      </div>
    ) },
    { id: "siparis", header: "Sipariş", cell: ({ row }) => (
      <DrillCell to={`/operations/orders?search=${encodeURIComponent(row.original.siparis.no)}`} title="Siparişi aç">
        <div className="font-mono text-xs">{row.original.siparis.no}</div>
        <div className="text-xs tabular-nums">{fmtNum(row.original.sevkM)} / {fmtNum(row.original.siparisM)} m</div>
      </DrillCell>
    ) },
    { id: "isEmri", header: "İş emri", cell: ({ row }) => {
      const w = row.original.isEmri;
      if (!w) return <Empty hint="İş emri açılmamış" />;
      return (
        <DrillCell to={`/operations/work-orders/${w.id}`} title="İş emrini aç">
          <div className="flex items-center gap-1"><span className="font-mono text-xs">{w.no}</span><StatusBadge status={w.durum} labels={workOrderStatusLabels} tones={workOrderStatusTones} /></div>
          {w.adim && <div className="text-xs text-muted-foreground">{w.adim}</div>}
        </DrillCell>
      );
    } },
    { id: "dokuma", header: "Dokuma", cell: ({ row }) => {
      const d = row.original.dokuma;
      if (!d) return <Empty hint="Dokuma işi bağlanmamış" />;
      const pct = d.ilerlemePct;
      return (
        <DrillCell to={`/operations/weaving-orders?search=${encodeURIComponent(d.no)}`} title="Dokuma işini aç">
          <div className="flex items-center gap-1"><span className="font-mono text-xs">{d.no}</span><Pill m={meta(WEAVING_STATUS_META[d.durum as keyof typeof WEAVING_STATUS_META], d.durum)} /></div>
          <div className="text-xs tabular-nums">{fmtNum(d.dokunanM)}{d.planM != null ? ` / ${fmtNum(d.planM)} m · ${fmtPercent(pct)}` : " m · plan yok"}</div>
          {pct != null && <div className="mt-0.5 h-1 w-full rounded bg-muted"><div className="h-1 rounded bg-primary" style={{ width: `${Math.min(100, pct)}%` }} /></div>}
        </DrillCell>
      );
    } },
  ];
  if (devere) cols.push({ id: "levent", header: "Levent", cell: ({ row }) => {
    const b = row.original.levent;
    if (!b) return <Empty hint="Levent bağlanmamış" />;
    return (
      <DrillCell to={`/operations/warp-beams?search=${encodeURIComponent(b.no)}`} title="Leventi aç">
        <div className="flex items-center gap-1"><span className="font-mono text-xs">{b.no}</span><Pill m={meta(WARP_BEAM_STATUS_META[b.durum as keyof typeof WARP_BEAM_STATUS_META], b.durum)} /></div>
        <div className="text-xs tabular-nums">kalan {fmtNum(b.kalanM)} m</div>
      </DrillCell>
    );
  } });
  cols.push({ id: "gecikme", header: () => <div className="text-right">Gecikme</div>, cell: ({ row }) => (
    <div className="text-right">
      {row.original.gecikmeGun != null ? <span className="font-medium text-destructive tabular-nums">{fmtInt(row.original.gecikmeGun)} gün</span> : null}
      <div className="text-[11px] text-muted-foreground">{CHAIN_STATUS_LABEL[row.original.durum]}</div>
    </div>
  ) });
  return cols;
}
