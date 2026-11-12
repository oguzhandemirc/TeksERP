// Kumaş Dengesi — ortak DataTable sütunları + dosya sütunları. Satır = (kumaş+renk) grubu; açılan ayrıntı en kırılımı
// ve drill-down (`ProductBalanceDetail`). Renkli hücre parçaları `ProductBalanceRow.tsx`te.
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useLocalTable } from "@/hooks/useLocalTable";
import type { ExportColumn } from "@/lib/list-export";
import { safeFormat } from "@/lib/format";
import { workOrderStatusLabels, type WorkOrderStatus } from "@/types/enums";
import { TERIM } from "@/lib/terim";
import type { BalanceGroup, BalanceSpecRow } from "./types";
import { BalanceHamCell, BalanceNeedCell, BalanceWoButton, fmt, widthLabel } from "./ProductBalanceRow";

type OpenWo = (group: BalanceGroup, spec: BalanceSpecRow) => void;

/**
 * Dışa aktarım satırı — ekran (kumaş+renk) grubu + açılır EN kırılımı; dosya bunun
 * DÜZLEŞTİRİLMİŞİ: bir satır = bir (kumaş, renk, en) alt-satırı, yani ekranın en
 * ince kırılımı. Grup sütunları (Ham / Ham Açığı) tekrarlanır.
 */
export interface BalanceExportRow {
  group: BalanceGroup;
  spec: BalanceSpecRow;
}

/**
 * ⚠️ `summable` YALNIZ en (spec) düzeyinde eklenebilir miktarlara verilir.
 * Ham ve Ham Açığı (kumaş+renk havuzu, en'lere BÖLÜNMEZ) her satırda tekrarlandığı
 * için toplanabilir DEĞİL — TOPLAM satırı onları grup içindeki en sayısı kadar
 * sayardı ve dosya, ekranın söylediğinden fazla ham stok gösterirdi.
 */
export const BALANCE_EXPORT_COLUMNS: ExportColumn<BalanceExportRow>[] = [
  { label: "Kumaş", value: (r) => r.spec.itemName },
  { label: "Renk", value: (r) => r.spec.colorName ?? "—" },
  { label: "En (cm)", value: (r) => r.spec.width ?? "" },
  { label: "Talep (m)", value: (r) => r.spec.talep, summable: true },
  { label: "Depo (m)", value: (r) => r.spec.depo, summable: true },
  { label: "Üretimde (m)", value: (r) => r.spec.uretimde, summable: true },
  { label: "Üretilecek (m)", value: (r) => r.spec.uretilecek, summable: true },
  { label: "Durum", value: (r) => (r.spec.uretilecek > 0 ? "Üretilecek" : "Karşılanıyor") },
  { label: "Ham (m, kumaş+renk)", value: (r) => r.group.ham },
  { label: "Yarı Mamul (m, kumaş+renk)", value: (r) => r.group.yariMamul },
  { label: "Ham Açığı (m, kumaş+renk)", value: (r) => r.group.malzemeAcigi },
  { label: "Sipariş Sayısı", value: (r) => r.spec.lines.length, summable: true },
  // İstenen − Sevk = Talep (yukarıdaki sütun). Ayrı bir "Kalan" sütunu EKLENMEDİ:
  // Talep'in birebir aynısı olurdu ve iki farklı isim aynı sayıyı gösterirdi.
  { label: "İstenen (m)", value: (r) => sum(r.spec.lines, (l) => l.quantity), summable: true },
  { label: "Sevk Edilen (m)", value: (r) => sum(r.spec.lines, (l) => l.shipped), summable: true },
  { label: "Siparişler", value: (r) => uniq(r.spec.lines.map((l) => l.orderNumber)).join(", ") },
  { label: "Müşteriler", value: (r) => uniq(r.spec.lines.map((l) => l.customerName)).join(", ") },
  { label: "En Yakın Termin", value: (r) => earliestDeadline(r.spec) },
  { get label() { return `Canlı ${TERIM.terbiyeIsEmri.tekil} Sayısı`; }, value: (r) => r.spec.wos.length, summable: true },
  {
    get label() { return TERIM.terbiyeIsEmri.cogul; },
    value: (r) =>
      r.spec.wos
        .map(
          (w) =>
            `${w.batchNumber} (${workOrderStatusLabels[w.status as WorkOrderStatus] ?? w.status})`,
        )
        .join(", "),
  },
];

const sum = <T,>(rows: T[], pick: (row: T) => number): number =>
  rows.reduce((acc, row) => acc + pick(row), 0);

const uniq = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

/** En erken termin (ekrandaki drill-down sıralamasıyla aynı ölçüt). */
function earliestDeadline(spec: BalanceSpecRow): string {
  const stamps = spec.lines
    .map((l) => l.deadline)
    .filter((d): d is string => Boolean(d))
    .sort();
  return stamps.length > 0 ? safeFormat(stamps[0], "dd.MM.yyyy") : "";
}

const groupWidthText = (g: BalanceGroup) => (g.specs.length > 1 ? `${g.specs.length} en` : g.specs[0] ? widthLabel(g.specs[0].width) : "—");
// Başlık ipucu her çizimde okunur (terim ayarı canlı değişebilir).
interface NumSpec { id: string; label: string; pick: (g: BalanceGroup) => number; title: () => string; muted?: boolean }
const num = ({ id, label, pick, title, muted = true }: NumSpec): ColumnDef<BalanceGroup> => ({
  id,
  header: () => <span title={title()}>{label}</span>,
  meta: { label, align: "right", summable: true, exportValue: pick },
  cell: ({ row }) => <span className={muted ? "text-muted-foreground" : undefined}>{fmt(pick(row.original))}</span>,
});

function balanceColumns(onOpenWo: { current: OpenWo }): ColumnDef<BalanceGroup>[] {
  return [
    {
      id: "item",
      header: "Kumaş",
      size: 300,
      meta: { label: "Kumaş", exportValue: (g) => [g.itemName, g.colorName].filter(Boolean).join(" · ") },
      cell: ({ row: { original: g } }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {g.colorHex && <span className="h-2.5 w-2.5 shrink-0 rounded-full border" style={{ backgroundColor: g.colorHex }} />}
          <span className="truncate font-medium">{g.itemName}</span>
          {g.colorName && <span className="truncate text-muted-foreground">· {g.colorName}</span>}
        </span>
      ),
    },
    { id: "width", header: () => <span title="En (cm)">En</span>, meta: { label: "En", exportValue: groupWidthText }, cell: ({ row }) => <span className="text-xs text-muted-foreground">{groupWidthText(row.original)}</span> },
    num({ id: "talep", label: "Talep", pick: (g) => g.talep, title: () => "Açık siparişler (istenen − sevk)", muted: false }),
    num({ id: "depo", label: "Depo", pick: (g) => g.depo, title: () => "Depoda hazır (sevksiz)" }),
    num({ id: "uretimde", label: "Üretimde", pick: (g) => g.uretimde, title: () => `Canlı ${TERIM.terbiyeIsEmri.cogulCekimKucuk.bulunma}` }),
    {
      id: "ham",
      header: () => <span title="İşlenecek ham kumaş — kumaş+renk havuzu (eni önemsiz)">Ham</span>,
      meta: { label: "Ham", align: "right", exportValue: (g) => g.ham },
      cell: ({ row }) => <BalanceHamCell group={row.original} />,
    },
    {
      id: "uretilecek",
      header: () => <span title="Talep − Depo − Üretimde">Üretilecek</span>,
      meta: { label: "Üretilecek", align: "right", exportValue: (g) => (g.uretilecek > 0 ? g.uretilecek : "Karşılanıyor") },
      cell: ({ row }) => <BalanceNeedCell group={row.original} />,
    },
    {
      id: "actions",
      header: "",
      size: 180,
      enableHiding: false,
      meta: { label: "Eylem", align: "right", exportValue: () => "" },
      cell: ({ row }) => <BalanceWoButton group={row.original} onOpenWo={onOpenWo.current} />,
    },
  ];
}

/** Grup tablosu — iş emri geri çağrısı ref'te (sütunlar bir kez kurulur). */
export function useProductBalanceTable(groups: BalanceGroup[], onOpenWo: OpenWo) {
  const ref = useRef(onOpenWo);
  ref.current = onOpenWo;
  const columns = useMemo(() => balanceColumns(ref), []);
  return useLocalTable({ tableKey: "product-balance:list", data: groups, columns, getRowId: (g) => g.key });
}
