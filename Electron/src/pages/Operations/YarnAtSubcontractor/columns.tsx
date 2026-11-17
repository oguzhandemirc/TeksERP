// Fasondaki İplik sütunları — ilk sütun seçili kırılımın ANA boyutu (fasoncu ya da iplik); grup adı ve toplamı
// yalnız grubun ilk satırında basılır (dışa aktarımda her satırda). Süzme sunucuda; sıralama `model.toLines`.
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { kg } from "../Yarn/qty";
import { ageDays, ageText, LONG_WAIT_DAYS, subLabel, yarnLabel, type YarnAtSubLine, type YarnAtSubView } from "./model";
import { warpingOrderHref } from "./service";

const ownerText = (r: YarnAtSubLine) => (r.ownerCustomerId ? r.ownerCustomerName ?? "Müşteri (adı yok)" : "Bizim");

function NameCode({ name, code }: { name: string; code: string | null }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">{name}</span>
      {code && <span className="font-mono text-xs text-muted-foreground">{code}</span>}
    </span>
  );
}

const subCol = (main: boolean): ColumnDef<YarnAtSubLine> => ({
  id: "subcontractor",
  header: "Fasoncu",
  size: main ? 300 : 220,
  meta: { label: "Fasoncu", exportValue: (r: YarnAtSubLine) => subLabel(r) },
  cell: ({ row: { original: r } }) => (main ? <GroupCell r={r} code={r.subcontractorCode} /> : <span title={r.subcontractorCode ?? undefined}>{subLabel(r)}</span>),
});

const yarnCol = (main: boolean): ColumnDef<YarnAtSubLine> => ({
  id: "yarn",
  header: "İplik",
  size: main ? 300 : 220,
  meta: { label: "İplik", exportValue: (r: YarnAtSubLine) => yarnLabel(r) },
  cell: ({ row: { original: r } }) => (main ? <GroupCell r={r} code={r.yarnItemCode} /> : <NameCode name={yarnLabel(r)} code={r.yarnItemCode} />),
});

// Tablo hücreleri tek satır çizilir (DataTable kırpar): ad + grup toplamı yan yana, kod ipucunda.
function GroupCell({ r, code }: { r: YarnAtSubLine; code: string | null }) {
  if (!r.groupFirst) return <span className="sr-only">{r.groupLabel}</span>;
  return (
    <span className="inline-flex items-baseline gap-2" title={code ? `${r.groupLabel} (${code})` : r.groupLabel}>
      <span className="font-semibold">{r.groupLabel}</span>
      <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-foreground">
        {kg(r.groupKg)}
        {r.groupLines > 1 && <span className="text-muted-foreground"> · {r.groupLines} satır</span>}
      </span>
    </span>
  );
}

const LOT: ColumnDef<YarnAtSubLine> = {
  id: "lot",
  header: "Lot",
  meta: { label: "Lot", exportValue: (r: YarnAtSubLine) => r.lotNo ?? "" },
  cell: ({ row }) => (row.original.lotNo ? <span className="font-mono text-xs">{row.original.lotNo}</span> : <span className="text-muted-foreground">lotsuz</span>),
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

const ORDERS: ColumnDef<YarnAtSubLine> = {
  id: "orders",
  header: "Sipariş",
  size: 240,
  meta: { label: "Sipariş", exportValue: (r: YarnAtSubLine) => r.orders.map((o) => `${o.orderNo} ${kg(o.kg)}${o.status === "COMPLETED" ? " (devreden)" : ""}`).join("; ") },
  cell: ({ row }) => (
    <span className="flex flex-col gap-0.5">
      {row.original.orders.map((o) => (
        <span key={o.warpingOrderId} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
          <Link to={warpingOrderHref(o.warpingOrderId)} className="font-mono text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid" onClick={(e) => e.stopPropagation()}>
            {o.orderNo}
          </Link>
          <span className="tabular-nums text-muted-foreground">{kg(o.kg)}</span>
          {o.status === "COMPLETED" && <span className="rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">devreden · sipariş kapandı</span>}
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

/** Sahip sütunu yalnız emanet modülü açıkken (tek sahipli kurulumda sıfır görünür fark). */
export function yarnAtSubColumns(view: YarnAtSubView, showOwner: boolean): ColumnDef<YarnAtSubLine>[] {
  const lead = view === "subcontractor" ? [subCol(true), yarnCol(false)] : [yarnCol(true), subCol(false)];
  return [...lead, LOT, ...(showOwner ? [OWNER] : []), KG, ORDERS, AGE];
}
