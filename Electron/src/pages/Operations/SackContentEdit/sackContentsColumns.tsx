import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { isSackAbsent, sackAbsentLabels, type SackContentRoll } from "./types";

const fmtM = (n: number) => `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/**
 * Çuval içeriği (TOP) sütunları — seçilebilir DataTable. Kartelalar ayrı listede.
 * Seçim kolonu (checkbox) DataTable tarafından otomatik eklenir; burada yok.
 */
export const sackContentsColumns: ColumnDef<SackContentRoll>[] = [
  {
    accessorKey: "barcode",
    header: "Barkod",
    meta: {
      label: "Barkod",
      exportValue: (r) =>
        `${r.barcode ?? "Açık Kumaş"}${isSackAbsent(r.status) ? ` (BURADA DEĞİL: ${sackAbsentLabels[r.status!] ?? r.status})` : ""}`,
    },
    // HAYALET ROZETİ: backend sayım/belge yüzeylerinde bu topu dışlar ama döküm onu
    // BİLEREK gösterir — kartela/tambur/fason guard'larının hata mesajı operatörü tam
    // bu ekrana yönlendiriyor ("Paketleme / Çuvallar ekranından çuvaldan çıkarın").
    // Rozet olmadan operatör hangi topun sorunlu olduğunu göremez ve mesaj boşa düşer.
    cell: ({ row }) => {
      const r = row.original;
      const absent = isSackAbsent(r.status);
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={`font-mono text-xs ${absent ? "text-destructive line-through" : ""}`}>
            {r.barcode ?? "Açık Kumaş"}
          </span>
          {absent && (
            <span
              title={`Bu top fiziksel olarak çuvalda DEĞİL (${r.status}). Çuvaldan çıkarın — sayımlara ve belgelere girmiyor, ama sevkiyat kurulumunu bloklar.`}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3" />
              {sackAbsentLabels[r.status!] ?? r.status}
            </span>
          )}
        </span>
      );
    },
  },
  {
    id: "item",
    header: "Kumaş",
    meta: { label: "Kumaş", exportValue: (r) => r.item.name },
    cell: ({ row }) => <span className="text-sm">{row.original.item.name}</span>,
  },
  {
    id: "color",
    header: "Renk",
    meta: { label: "Renk", exportValue: (r) => r.color?.name ?? "Ham" },
    cell: ({ row }) => {
      const c = row.original.color;
      return (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {c?.hex && <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: c.hex }} />}
          {c?.name ?? "Ham"}
        </span>
      );
    },
  },
  {
    id: "width",
    header: "En",
    meta: { label: "En", exportValue: (r) => (r.width ? `${r.width} cm` : "") },
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.width ? `${row.original.width} cm` : "—"}</span>
    ),
  },
  {
    id: "qty",
    // summable → Excel'e SAYI olarak yazılır + altta TOPLAM satırı doğar. Eskiden
    // exportValue "700 m" METNİ dönüyordu; Excel'de toplanamıyor, TOPLAM hiç çıkmıyordu.
    meta: { label: "Metre", summable: true, exportValue: (r) => Number(r.currentQty) },
    header: "Metre",
    cell: ({ row }) => <span className="text-sm tabular-nums">{fmtM(Number(row.original.currentQty))}</span>,
  },
  {
    accessorKey: "qualityGrade",
    header: "Kalite",
    meta: { label: "Kalite" },
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.qualityGrade ?? "—"}</span>,
  },
];
