import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { safeFormat } from "@/lib/format";
import { formatCalendarDay } from "@/lib/factory-time";
import type { WorkOrder } from "./types";
import { customerCellView } from "./customer-cell";
import { LocationCell } from "./LocationCell";
import { locationText } from "./location";
import { TERIM } from "@/lib/terim";
import { FasonTag } from "./FasonTag";
import { METER_CELL_BADGE_CLASS, meterCellText, meterCellView } from "./meter-cell";

// İlerleme = üretimden ÇIKAN ÷ üretime GİREN (detay sağlık şeridiyle birebir aynı).
// Hedef metraj %99 girilmediğinden hedef-bazlı oran kullanılmaz. Tamamlanan-adım
// sayımı da ÇOKLU-DALDA yanıltıcıydı (adımlar yeniden açıldığı için hep ACTIVE → 0/N);
// çıkan/giren gerçek "ne kadar bitti"yi verir.
function progressOf(wo: WorkOrder): { input: number; output: number; pct: number; hasFlow: boolean } {
  const input = wo.inputMeters ?? 0;
  const output = wo.producedMeters ?? 0;
  const hasFlow = input > 0;
  const pct = hasFlow ? Math.min(100, Math.round((output / input) * 100)) : 0;
  return { input, output, pct, hasFlow };
}

const fmtM = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 });

// Dışa aktarım metinleri — hücreyle aynı kaynaktan (`progressOf`, `fmtM`).
const progressText = (wo: WorkOrder): string => {
  const p = progressOf(wo);
  return p.hasFlow ? `%${p.pct} (${fmtM(p.output)} / ${fmtM(p.input)} m)` : "";
};
const orderedText = (wo: WorkOrder): string => {
  const m = wo.orderedMeters ?? 0;
  return m > 0 ? `${fmtM(m)} m` : "";
};

export const workOrderColumns: ColumnDef<WorkOrder>[] = [
  {
    accessorKey: "workOrderNumber",
    get header() { return `${TERIM.terbiyeIsEmri.tekil} No`; },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs">{row.original.workOrderNumber}</span>
        <FasonTag type={row.original.type} />
      </span>
    ),
  },
  {
    id: "batches",
    header: "Parti",
    meta: {
      label: "Parti",
      // Ekran ilk partileri + "+N" gösterir; dosyada yüklenen numaralar + toplam sayaç.
      exportValue: (wo: WorkOrder) => {
        const shown = wo.batches ?? [];
        const extra = (wo._count?.batches ?? shown.length) - shown.length;
        return shown.map((b) => b.batchNumber).join(", ") + (extra > 0 ? ` +${extra}` : "");
      },
    },
    cell: ({ row }) => {
      const shown = row.original.batches ?? [];
      if (shown.length === 0) return <span className="text-muted-foreground">—</span>;
      const total = row.original._count?.batches ?? shown.length;
      const extra = total - shown.length;
      return (
        <div className="flex items-center gap-1">
          {shown.map((b) => (
            <span key={b.id} className="font-mono text-xs">
              {b.batchNumber}
            </span>
          ))}
          {extra > 0 && (
            // Farklı ton bilinçli: "+2" bir parti NUMARASI değil, sayaçtır —
            // aynı renkte olsaydı dördüncü bir numara gibi okunurdu.
            <Badge
              variant="muted"
              className="border-amber-500/40 bg-amber-500/10 px-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
              title={`Toplam ${total} parti`}
            >
              +{extra}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "type",
    header: "Tip",
    meta: { label: "Tip", exportValue: (wo: WorkOrder) => workOrderTypeLabels[wo.type] ?? wo.type },
    cell: ({ row }) => (
      <Badge variant="muted" className="text-[10px]">
        {workOrderTypeLabels[row.original.type] ?? row.original.type}
      </Badge>
    ),
  },
  {
    id: "product",
    header: "Kumaş / Renk",
    meta: {
      label: "Kumaş / Renk",
      exportValue: (wo: WorkOrder) => [wo.targetItem?.name, wo.targetColor?.name].filter(Boolean).join(" / "),
    },
    cell: ({ row }) => {
      const wo = row.original;
      if (!wo.targetItem && !wo.targetColor)
        return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="max-w-[10rem] truncate font-medium" title={wo.targetItem?.name}>
            {wo.targetItem?.name ?? "—"}
          </span>
          {wo.targetColor && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full border"
                style={{ background: wo.targetColor.hex ?? "#fff" }}
              />
              {wo.targetColor.name}
            </span>
          )}
        </div>
      );
    },
  },
  {
    // MÜŞTERİ (kullanıcı isteği 2026-09-15): bağlı siparişlerin distinct müşterileri — 0 "—",
    // 1 ad, 2+ ilk ad + "+N" (tooltip hepsi). Bağsız (stok) iş emri boş. Tıklama satır detayına gider.
    id: "customer",
    header: "Müşteri",
    meta: { label: "Müşteri", exportValue: (wo: WorkOrder) => customerCellView(wo).all },
    cell: ({ row }) => {
      const v = customerCellView(row.original);
      if (v.first === null) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex items-center gap-1" title={v.all}>
          <span className="max-w-[10rem] truncate text-xs font-medium">{v.first}</span>
          {v.extra > 0 && (
            // Parti kolonuyla aynı sayaç tonu: "+2" bir müşteri adı değil, sayaçtır.
            <Badge
              variant="muted"
              className="border-amber-500/40 bg-amber-500/10 px-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
            >
              +{v.extra}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    // ŞU AN NEREDE (2026-10-24): canlı topların istasyon dağılımı (backend `konum`); bölünmüşse
    // en kalabalık istasyon + "+N" rozeti, dağılım tıkla açılan kartta. Satır yüksekliği sabit.
    id: "location",
    header: "Şu an nerede",
    meta: { label: "Şu an nerede", exportValue: (wo: WorkOrder) => locationText(wo.konum, wo.status) },
    cell: ({ row }) => <LocationCell konum={row.original.konum} status={row.original.status} />,
  },
  {
    id: "fasonFirms",
    header: "Fason",
    meta: { label: "Fason", exportValue: (wo: WorkOrder) => (wo.fasonFirms ?? []).map((f) => f.name).join(", ") },
    cell: ({ row }) => {
      const firms = row.original.fasonFirms ?? [];
      if (firms.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex flex-wrap items-center gap-1">
          {firms.map((f) => (
            // "Şu an orada" ile "gitmişti" AYNI renkte olsaydı planlamacı malın
            // hâlâ dışarıda olup olmadığını ayırt edemezdi.
            <Badge
              key={f.name}
              variant={f.current ? "secondary" : "muted"}
              className="max-w-[9rem] truncate text-[10px]"
              title={f.current ? `${f.name} — mal şu an burada` : `${f.name} — işi yapmıştı`}
            >
              {f.name}
            </Badge>
          ))}
        </div>
      );
    },
  },
  {
    id: "progress",
    header: "İlerleme",
    meta: { label: "İlerleme", exportValue: progressText },
    cell: ({ row }) => {
      const p = progressOf(row.original);
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/60 transition-all" style={{ width: `${p.pct}%` }} />
          </div>
          {p.hasFlow ? (
            <span className="text-xs tabular-nums">
              <span className="font-medium">%{p.pct}</span>
              <span className="ml-1 text-muted-foreground">
                ({fmtM(p.output)} / {fmtM(p.input)} m)
              </span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      );
    },
  },
  {
    id: "ordered",
    header: "Sipariş",
    // Bağlı sipariş satırlarının toplam talep metrajı — çıkan/giren ile kıyas.
    // Stok üretiminde (siparişe bağlı değil) değer yok → "—".
    meta: { label: "Sipariş", exportValue: orderedText },
    cell: ({ row }) => {
      const text = orderedText(row.original);
      return text ? <span className="tabular-nums text-xs">{text}</span> : <span className="text-muted-foreground">—</span>;
    },
  },
  {
    // METRE (GK 2026-11-10): beyan ↔ ölçülen İE toplamı; uzun turuncu rozet, kısa gri rozet, gerisi sade gri.
    id: "meter",
    header: "Metre",
    meta: { label: "Metre", exportValue: (wo: WorkOrder) => meterCellText(wo.meterSummary) },
    cell: ({ row }) => {
      const v = meterCellView(row.original.meterSummary);
      if (!v) return <span className="text-muted-foreground">—</span>;
      if (!v.badge) return <span className="whitespace-nowrap tabular-nums text-xs text-muted-foreground" title={v.title}>{v.text}</span>;
      return (
        <Badge variant="muted" className={`whitespace-nowrap px-1.5 text-[11px] tabular-nums ${METER_CELL_BADGE_CLASS[v.tone === "longer" ? "longer" : "shorter"]}`} title={v.title}>
          {v.text}
        </Badge>
      );
    },
  },
  {
    accessorKey: "targetQuantity",
    header: () => <SortableHeader field="targetQuantity" label="Hedef" />,
    meta: { label: "Hedef" },
    cell: ({ row }) =>
      row.original.targetQuantity != null ? (
        <span className="tabular-nums text-xs">
          {row.original.targetQuantity.toLocaleString("tr-TR", { useGrouping: false })} m
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "plannedEndDate",
    header: () => <SortableHeader field="plannedEndDate" label="Termin" />,
    meta: {
      label: "Termin",
      exportValue: (wo: WorkOrder) => (wo.plannedEndDate ? formatCalendarDay(wo.plannedEndDate, "dd.MM.yyyy") : ""),
    },
    cell: ({ row }) => <DeadlineBadge deadline={row.original.plannedEndDate} />,
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Oluşturma" />,
    meta: { label: "Oluşturma", exportValue: (wo: WorkOrder) => safeFormat(wo.createdAt, "dd.MM.yyyy", "") },
    cell: ({ row }) => <span className="text-xs">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (wo: WorkOrder) => workOrderStatusLabels[wo.status] ?? wo.status },
    // "Şu an fasonda" rozeti buradan "Şu an nerede" sütununa taşındı (2026-10-24) — aynı bilgi
    // iki sütunda durmasın; eski backend `konum` göndermezse yalnız rozet görünmez.
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} labels={workOrderStatusLabels} tones={workOrderStatusTones} />
    ),
  },
];
