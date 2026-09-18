import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { WARP_BEAM_ORIGIN_LABEL, WARP_BEAM_STATUS_META, WARP_KG_SOURCE_LABEL, formatKg, formatM, type WarpBeam } from "./types";

/** Sıralama başlığı YOK: uç en yeni önce sıralar; süzme sunucuda. */
/** Liste hücresi: sarılmamış levent "—", lotsuz sarım "Lot yok", tek lot adı, N lot sayı. */
export function lotSummary(b: Pick<WarpBeam, "lots" | "wound">): string {
  if (!b.wound) return "—";
  if (b.lots.length === 0) return "Lot yok";
  if (b.lots.length === 1) return b.lots[0]!;
  return `${b.lots.length} lot`;
}

/** Durum rozeti — sözlükte olmayan değer Türkçe yedek + ham adla nötr sınıfla döner (eski panel yeni durumu çizer, patlamaz; 5e). */
export function statusMeta(status: string): { label: string; badgeClass: string } {
  return (WARP_BEAM_STATUS_META as Record<string, { label: string; badgeClass: string } | undefined>)[status] ?? { label: `Bilinmeyen durum (${status})`, badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300" };
}

/** Tezgah hücresi: bağlıysa "makine · yuva N", değilse "—". */
export function loomCell(b: Pick<WarpBeam, "currentMachine" | "currentPosition">): string {
  if (!b.currentMachine) return "—";
  return `${b.currentMachine.name} · yuva ${b.currentPosition ?? "?"}`;
}

export const warpBeamColumns: ColumnDef<WarpBeam>[] = [
  { accessorKey: "beamNo", header: "Levent No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.beamNo}</span> },
  {
    id: "spec",
    header: "Çözgü kartı",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.warpSpec.name}</span>
        <span className="text-muted-foreground text-xs">
          <span className="font-mono">{row.original.warpSpec.code}</span> · {row.original.warpSpec.endsCount} tel · {row.original.warpSpec.yarnItem.name}
        </span>
      </span>
    ),
  },
  {
    // Z2: "bu levent hangi iş için sarıldı" (Z1 DTO `weavingOrder`); bağsız = serbest levent.
    id: "weavingOrder",
    header: "Dokuma işi",
    cell: ({ row }) => (row.original.weavingOrder ? <span className="font-mono text-xs">{row.original.weavingOrder.weavingOrderNumber}</span> : <span className="text-muted-foreground">—</span>),
  },
  {
    id: "origin",
    header: "Köken",
    cell: ({ row }) => {
      const r = row.original;
      const party = r.subcontractor?.name ?? r.supplier?.name;
      return (
        <span className="flex flex-col text-xs">
          <span>{WARP_BEAM_ORIGIN_LABEL[r.originKind]}</span>
          {party && <span className="text-muted-foreground">{party}</span>}
          {r.ownerCustomer && <span className="text-amber-700">Emanet: {r.ownerCustomer.name}</span>}
        </span>
      );
    },
  },
  {
    id: "length",
    header: "Metre",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="flex flex-col font-mono text-xs">
          <span>{r.wound ? formatM(r.wound.lengthM) : `plan ${formatM(r.plannedLengthM)}`}</span>
          {r.wound && <span className="text-muted-foreground">{formatKg(r.wound.theoreticalKg)} · {r.wound.kgSource ? WARP_KG_SOURCE_LABEL[r.wound.kgSource] : ""}</span>}
          {/* Faz 3: kalan sunucuda türetilir (Σ işaret × m); sarılan metreden farklıysa tüketim/düzeltme var. */}
          {r.wound && r.remainingM !== r.wound.lengthM && <span className="text-muted-foreground">kalan {formatM(r.remainingM)}</span>}
        </span>
      );
    },
  },
  {
    id: "machine",
    header: "Devere / gövde",
    cell: ({ row }) => (
      <span className="flex flex-col text-xs">
        <span>{row.original.wound?.machine?.name ?? "—"}</span>
        {row.original.physicalBeamNo && <span className="text-muted-foreground font-mono">{row.original.physicalBeamNo}</span>}
      </span>
    ),
  },
  {
    // Faz 3: "şu an ne" — yalnız MOUNTED'da dolu; bayrak kapalıyken hep "—" (sıfır fark).
    id: "loom",
    header: "Tezgah / yuva",
    cell: ({ row }) => <span className="text-xs">{loomCell(row.original)}</span>,
  },
  {
    // Devere Faz 2: lot özeti — tek lot adıyla, N lot sayıyla, lotsuz sarım AÇIKÇA "Lot yok" (iz eksik).
    id: "lots",
    header: "Lot",
    cell: ({ row }) => <span className="text-xs font-mono" title={row.original.lots.join(", ")}>{lotSummary(row.original)}</span>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    // Tanınmayan durum (yeni sunucu + eski panel) ham adıyla nötr rozet — liste ÇÖKMEZ (depo hareketleri emsali; 5e bulgusu).
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status);
      return <Badge className={meta.badgeClass}>{meta.label}</Badge>;
    },
  },
];
