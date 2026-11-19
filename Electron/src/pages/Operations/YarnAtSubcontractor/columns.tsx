// Fasondaki İplik sütunları — ilk sütun seçili kırılımın ANA boyutu (fasoncu ya da iplik); grup adı ve toplamı
// yalnız grubun ilk satırında basılır (dışa aktarımda her satırda). Süzme sunucuda; sıralama `model.toLines`.
// Ad BİRİNCİL, kod küçük ikinci satır (taşarsa ipucunda tam); Değer sütunu yalnız fiyat alanı gelen kullanıcıda.
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { ArrowRightLeft, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtFactoryDate } from "@/lib/factory-time";
import { formatAmount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { kg } from "../Yarn/qty";
import { ageDays, ageText, CARRIED_HINT, CARRIED_LABEL, LONG_WAIT_DAYS, priceMissingText, subLabel, yarnLabel, type YarnAtSubLine, type YarnAtSubView } from "./model";
import { warpingOrderHref } from "./service";

const ownerText = (r: YarnAtSubLine) => (r.ownerCustomerId ? r.ownerCustomerName ?? "Müşteri (adı yok)" : "Bizim");
const fullName = (name: string, code: string | null) => (code && code !== name ? `${name} (${code})` : name);

/** Ad üstte, kod altta — her satır kendi içinde kırpılır, tam metin `title`da. */
export function NameCode({ name, code, strong, badge }: { name: string; code: string | null; strong?: boolean; badge?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col" title={fullName(name, code)}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={cn("truncate", strong ? "font-semibold" : "font-medium")}>{name}</span>
        {badge}
      </span>
      {code && code !== name && <span className="truncate font-mono text-xs text-muted-foreground">{code}</span>}
    </span>
  );
}

// Grup başı: ad + grup toplamı; sonraki satırlarda yalnız ekran okuyucuya ad (görsel tekrar yok).
function GroupCell({ r, code }: { r: YarnAtSubLine; code: string | null }) {
  if (!r.groupFirst) return <span className="sr-only">{r.groupLabel}</span>;
  const badge = (
    <span className="shrink-0 rounded bg-muted px-1.5 text-xs tabular-nums text-foreground">
      {kg(r.groupKg)}
      {r.groupLines > 1 && <span className="text-muted-foreground"> · {r.groupLines} satır</span>}
    </span>
  );
  return <NameCode name={r.groupLabel} code={code} strong badge={badge} />;
}

const subCol = (main: boolean): ColumnDef<YarnAtSubLine> => ({
  id: "subcontractor",
  header: "Fasoncu",
  size: main ? 300 : 220,
  meta: { label: "Fasoncu", exportValue: (r: YarnAtSubLine) => subLabel(r) },
  cell: ({ row: { original: r } }) => (main ? <GroupCell r={r} code={r.subcontractorCode} /> : <NameCode name={subLabel(r)} code={r.subcontractorCode} />),
});

const yarnCol = (main: boolean): ColumnDef<YarnAtSubLine> => ({
  id: "yarn",
  header: "İplik",
  size: main ? 320 : 260,
  meta: { label: "İplik", exportValue: (r: YarnAtSubLine) => fullName(yarnLabel(r), r.yarnItemCode) },
  cell: ({ row: { original: r } }) => (main ? <GroupCell r={r} code={r.yarnItemCode} /> : <NameCode name={yarnLabel(r)} code={r.yarnItemCode} />),
});

const LOT: ColumnDef<YarnAtSubLine> = {
  id: "lot",
  header: "Lot",
  meta: { label: "Lot", exportValue: (r: YarnAtSubLine) => r.lotNo ?? "" },
  cell: ({ row }) => (row.original.lotNo ? <span className="font-mono text-xs" title={row.original.lotNo}>{row.original.lotNo}</span> : <span className="text-muted-foreground">lotsuz</span>),
};

const OWNER: ColumnDef<YarnAtSubLine> = {
  id: "owner",
  header: "Sahibi",
  meta: { label: "Sahibi", exportValue: ownerText },
  cell: ({ row }) => <span className={cn(!row.original.ownerCustomerId && "text-muted-foreground")}>{ownerText(row.original)}</span>,
};

const KG: ColumnDef<YarnAtSubLine> = {
  id: "kg",
  header: "Miktar",
  meta: { label: "Miktar", align: "right", exportValue: (r: YarnAtSubLine) => kg(r.kg) },
  cell: ({ row }) => <span className="font-medium tabular-nums">{kg(row.original.kg)}</span>,
};

/** Değer = kg × lotun mal kabul birim fiyatı (sunucu hesaplar; para birimi fişinki). Fiyatsızda "—" + sebep ipucu. */
const VALUE: ColumnDef<YarnAtSubLine> = {
  id: "value",
  header: "Değer",
  size: 150,
  meta: { label: "Değer", align: "right", exportValue: (r: YarnAtSubLine) => (r.value != null ? `${formatAmount(r.value)} ${r.currency ?? ""}`.trim() : "") },
  cell: ({ row: { original: r } }) => {
    if (r.value == null) return <span className="text-muted-foreground" title={priceMissingText(r) ?? undefined}>—</span>;
    return (
      <span className="flex flex-col items-end" title={`${kg(r.kg)} × ${formatAmount(r.unitPrice, 2, 4)} ${r.currency ?? ""}/kg (mal kabul lot fiyatı)`}>
        <span className="font-medium tabular-nums">{formatMoney(r.value, r.currency)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{formatAmount(r.unitPrice, 2, 4)}/kg</span>
      </span>
    );
  },
};

const ORDERS: ColumnDef<YarnAtSubLine> = {
  id: "orders",
  header: "Sipariş",
  size: 240,
  meta: { label: "Sipariş", exportValue: (r: YarnAtSubLine) => r.orders.map((o) => `${o.orderNo} ${kg(o.kg)}${o.status === "COMPLETED" ? ` (${CARRIED_LABEL})` : ""}`).join("; ") },
  cell: ({ row }) => (
    <span className="flex flex-col gap-0.5">
      {row.original.orders.map((o) => (
        <span key={o.warpingOrderId} className="flex items-baseline gap-x-1.5 whitespace-nowrap text-xs">
          <Link to={warpingOrderHref(o.warpingOrderId)} className="font-mono text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid" onClick={(e) => e.stopPropagation()} title="Sipariş detayını aç">
            {o.orderNo}
          </Link>
          <span className="tabular-nums text-muted-foreground">{kg(o.kg)}</span>
          {o.status === "COMPLETED" && <span className="shrink-0 rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200" title={CARRIED_HINT}>{CARRIED_LABEL}</span>}
        </span>
      ))}
    </span>
  ),
};

const AGE: ColumnDef<YarnAtSubLine> = {
  id: "age",
  header: "Ne zamandır",
  meta: { label: "Ne zamandır", exportValue: (r: YarnAtSubLine) => `${ageText(ageDays(r.oldestDispatchedAt))} (${fmtFactoryDate(r.oldestDispatchedAt)})` },
  cell: ({ row }) => {
    const d = ageDays(row.original.oldestDispatchedAt);
    return (
      <span className="flex flex-col" title="En eski sevkten bugüne (fabrika günü)">
        <span className={cn("tabular-nums", d >= LONG_WAIT_DAYS && "font-medium text-amber-700 dark:text-amber-500")}>{ageText(d)}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{fmtFactoryDate(row.original.oldestDispatchedAt)} sevki</span>
      </span>
    );
  },
};

export type YarnRowAction = "return" | "transfer";

/** Satır eylemleri — devere sipariş sayfasının iade/aktarma pencerelerine iner (ekran yalnız devere satırı taşır). */
const actionsCol = (onAction: (r: YarnAtSubLine, a: YarnRowAction) => void): ColumnDef<YarnAtSubLine> => ({
  id: "actions",
  header: () => <span className="sr-only">İşlem</span>,
  size: 230,
  enableSorting: false,
  meta: { label: "İşlem", exportValue: () => "" },
  cell: ({ row: { original: r } }) => (
    <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onAction(r, "return")} aria-label={`${yarnLabel(r)} ${r.lotNo ?? "lotsuz"} iade al`}>
        <Undo2 className="mr-1 h-4 w-4" /> İade al
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onAction(r, "transfer")} aria-label={`${yarnLabel(r)} ${r.lotNo ?? "lotsuz"} başka siparişe aktar`}>
        <ArrowRightLeft className="mr-1 h-4 w-4" /> Aktar
      </Button>
    </span>
  ),
});

export interface YarnAtSubColumnOpts {
  /** Sahip sütunu yalnız emanet modülü açıkken (tek sahipli kurulumda sıfır görünür fark). */
  showOwner: boolean;
  /** Değer sütunu yalnız fiyat alanını alan kullanıcıda (`goods-receipt:read`). */
  showValue: boolean;
  /** Verilirse (yazma izni) satır sonunda İade al / Aktar. */
  onAction?: (r: YarnAtSubLine, a: YarnRowAction) => void;
}

export function yarnAtSubColumns(view: YarnAtSubView, o: YarnAtSubColumnOpts): ColumnDef<YarnAtSubLine>[] {
  const lead = view === "subcontractor" ? [subCol(true), yarnCol(false)] : [yarnCol(true), subCol(false)];
  return [...lead, LOT, ...(o.showOwner ? [OWNER] : []), KG, ...(o.showValue ? [VALUE] : []), ORDERS, AGE, ...(o.onAction ? [actionsCol(o.onAction)] : [])];
}
