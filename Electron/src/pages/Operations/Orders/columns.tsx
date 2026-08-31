import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, orderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { orderStatusLabels } from "@/types/enums";
import {
  collectLinkedWorkOrders,
  deriveWoRollup,
  deriveLineCoverage,
  woRollupLabels,
  woRollupTones,
} from "./work-order-rollup";
import { deriveDeadlineRisk } from "./deadline-risk";
import type { Order, OrderLine } from "./types";

/**
 * Sipariş kalemlerindeki benzersiz kumaş/renk etiketleri — her zaman BİZDEKİ ad.
 * Satırdaki müşteri override'ı (customerItemName/customerColorName) burada
 * bilinçli basılmaz: override yalnız adın ilk girildiği siparişin satırında dolu
 * olduğundan (sonraki siparişlerde alan kilitli → NULL) aynı kumaş listede iki
 * farklı adla görünüyordu. Müşterideki ad detay panelinde "Müşteride:" rozetiyle
 * etiketli gösterilir. Renksiz kalemler renk listesine girmez.
 */
function distinctLineLabels(
  lines: OrderLine[] | undefined,
  kind: "item" | "color",
): { key: string; label: string; hex?: string | null }[] {
  const map = new Map<string, { label: string; hex?: string | null }>();
  for (const l of lines ?? []) {
    if (kind === "item") {
      const label = l.item?.name;
      if (label && !map.has(l.itemId)) map.set(l.itemId, { label });
    } else {
      if (!l.colorId) continue;
      const label = l.color?.name;
      if (label && !map.has(l.colorId)) map.set(l.colorId, { label, hex: l.color?.hex });
    }
  }
  return [...map.entries()].map(([key, v]) => ({ key, ...v }));
}

function LineLabelsCell({
  lines,
  kind,
}: {
  lines: OrderLine[] | undefined;
  kind: "item" | "color";
}) {
  const labels = distinctLineLabels(lines, kind);
  if (labels.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  // İlk 3 etiketi virgülle ayrılmış göster; fazlası varsa "…" işareti koy.
  // Satıra tıklayınca yan panel (OrderDetailSheet) tüm kalemleri açar.
  const LIMIT = 3;
  const shown = labels.slice(0, LIMIT);
  const hasMore = labels.length > LIMIT;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {shown.map((it, i) => (
        <span key={it.key} className="inline-flex items-center gap-1 text-xs">
          {kind === "color" && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border"
              style={{ backgroundColor: it.hex ?? "transparent" }}
            />
          )}
          <span className="truncate">
            {it.label}
            {i < shown.length - 1 ? "," : ""}
          </span>
        </span>
      ))}
      {hasMore && (
        <span
          className="text-muted-foreground text-xs font-semibold"
          title="Daha fazla kalem — detay için satıra tıklayın"
        >
          …
        </span>
      )}
    </div>
  );
}

/** Dışa aktarma metni: rollup etiketi + (n) — NONE ise "—". */
function rollupExportText(order: Order): string {
  const { state, activeCount } = deriveWoRollup(order.lines);
  if (state === "NONE") return "—";
  const label = woRollupLabels[state];
  return activeCount > 1 ? `${label} (${activeCount})` : label;
}

/**
 * "İş Emri" rollup hücresi (named — rules-of-hooks: useOpenTarget hook'u).
 * Tek aktif WO'da rozet tıklanabilir (İE detayını açar); birden çok WO'da pasif
 * rozet + sayaç, navigasyon detay panelindeki listeden yapılır.
 */
function WorkOrderRollupCell({ order }: { order: Order }) {
  const openTarget = useOpenTarget();
  const rollup = deriveWoRollup(order.lines);
  if (rollup.state === "NONE") {
    return <span className="text-muted-foreground">—</span>;
  }
  // SUPERSEDED rollup'a girmez → tek aktif WO tıklanabilir hedeftir.
  const active = collectLinkedWorkOrders(order.lines).filter((w) => w.status !== "SUPERSEDED");
  const single = active.length === 1 ? active[0] : null;
  const badge = <StatusBadge status={rollup.state} labels={woRollupLabels} tones={woRollupTones} />;
  // "2/3 kalem" — rozetin tek başına söyleyemediği şey (madde 15). Tüm kalemler
  // bağlıysa oran YAZILMAZ: her satırda "3/3" görmek gürültüdür, eksik olan
  // durum görünmez kalırdı.
  const coverage = deriveLineCoverage(order.lines);
  const partial = coverage.total > 0 && coverage.linked < coverage.total;

  return (
    <div className="flex items-center gap-1">
      {single ? (
        // stopPropagation ŞART: satır onRowClick sheet açmasın. Yalnız sol/orta
        // tık dinlenir (onClick + onAuxClick); onContextMenu bağlanmaz → satır
        // sağ-tık context menüsü çalışmaya devam eder.
        <button
          type="button"
          className="cursor-pointer"
          title="Sol tık: bu sekmede · Shift/Ctrl+tık: yeni sekmede"
          onClick={(e) => {
            e.stopPropagation();
            openTarget(`/operations/work-orders/${single.id}`, e);
          }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.stopPropagation();
            e.preventDefault();
            openTarget(`/operations/work-orders/${single.id}`, e);
          }}
        >
          {badge}
        </button>
      ) : (
        badge
      )}
      {rollup.activeCount > 1 && <Badge variant="muted">{rollup.activeCount}</Badge>}
      {partial && (
        <Badge
          variant="outline"
          className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
          title={`${coverage.total} kalemin ${coverage.linked} tanesi bir iş emrine bağlı`}
        >
          {coverage.linked}/{coverage.total} kalem
        </Badge>
      )}
    </div>
  );
}

/**
 * Termin hücresi — DeadlineBadge'in soluna koşullu risk üçgeni. DeadlineBadge'e
 * dokunulmaz (WorkOrders ile paylaşılan saf tarih bileşeni); risk sinyali
 * termin + üretim durumu birleşimidir, burada türetilir.
 */
function DeadlineCell({ order }: { order: Order }) {
  const risk = deriveDeadlineRisk(order);
  return (
    <div className="flex items-center gap-1.5">
      {risk && (
        <span title={risk.label} className="inline-flex shrink-0">
          <AlertTriangle
            className={cn(
              "h-3.5 w-3.5",
              risk.overdue ? "text-destructive" : "text-warning",
            )}
          />
        </span>
      )}
      <DeadlineBadge deadline={order.deadline} />
    </div>
  );
}

/**
 * ⚠️ İŞ EMRİ KOLONU ÜRETİM MODÜLÜ KAPALIYKEN DÜŞER (`productionEnabled`,
 * varsayılan AÇIK — `financeEnabled` ile İLGİSİ YOK): alım-satım
 * firması üretim yapmıyor, o kolon her satırda "İş emri yok" basıyor ve
 * ekranın en geniş kolonlarından birini hiçbir bilgi taşımadan işgal ediyordu.
 * Fabrikada BİREBİR bugünkü (bekçi: orders-regime.test.ts).
 */
export function buildOrderColumns(pricingEnabled: boolean, productionEnabled = true): ColumnDef<Order>[] {
  return [
    ...(productionEnabled ? orderColumns : orderColumns.filter((c) => c.id !== "workOrder")),
    ...(pricingEnabled
      ? [
          {
            id: "totalAmount",
            header: "Tutar",
            cell: ({ row }) => {
              const o = row.original;
              if (!o.totalAmount) {
                return <span className="text-muted-foreground text-xs">—</span>;
              }
              return (
                <span className="tabular-nums text-xs">
                  {Number(o.totalAmount).toLocaleString("tr-TR", { useGrouping: false,
                    minimumFractionDigits: 2,
                  })}{" "}
                  {o.currency}
                </span>
              );
            },
          } as ColumnDef<Order>,
        ]
      : []),
  ];
}

export const orderColumns: ColumnDef<Order>[] = [
  {
    accessorKey: "orderNumber",
    header: "Sipariş No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span>,
  },
  {
    id: "customer",
    header: () => <SortableHeader field="customer" label="Müşteri" />,
    meta: { label: "Müşteri" },
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: () => <SortableHeader field="branch" label="Şube" />,
    meta: { label: "Şube" },
    cell: ({ row }) =>
      row.original.branch?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "items",
    header: "Kumaş",
    meta: { label: "Kumaş" },
    cell: ({ row }) => <LineLabelsCell lines={row.original.lines} kind="item" />,
  },
  {
    id: "colors",
    header: "Renk",
    meta: { label: "Renk" },
    cell: ({ row }) => <LineLabelsCell lines={row.original.lines} kind="color" />,
  },
  {
    accessorKey: "orderDate",
    header: () => <SortableHeader field="orderDate" label="Sipariş Tarihi" />,
    meta: { label: "Sipariş Tarihi" },
    cell: ({ row }) => safeFormat(row.original.orderDate, "dd.MM.yyyy"),
  },
  {
    accessorKey: "deadline",
    header: () => <SortableHeader field="deadline" label="Termin" />,
    meta: { label: "Termin" },
    cell: ({ row }) => <DeadlineCell order={row.original} />,
  },
  {
    id: "lines",
    header: () => <SortableHeader field="lineCount" label="Kalem" />,
    meta: { label: "Kalem" },
    cell: ({ row }) => <Badge variant="muted">{row.original.lines?.length ?? 0}</Badge>,
  },
  {
    id: "shipped",
    header: () => <SortableHeader field="shippedQty" label="Sevk" />,
    meta: { label: "Sevk" },
    cell: ({ row }) => {
      const o = row.original;
      const requested = (o.lines ?? []).reduce((s, l) => s + Number(l.quantity ?? 0), 0);
      if (requested === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      const shipped = o.shippedQty ?? 0;
      const pct = Math.min(100, Math.round((shipped / requested) * 100));
      const fmt = (n: number) =>
        n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });
      return (
        <span className="tabular-nums text-xs">
          {fmt(shipped)}/{fmt(requested)} m
          <span className="text-muted-foreground ml-1">({pct}%)</span>
        </span>
      );
    },
  },
  {
    id: "workOrder",
    header: "İş Emri",
    meta: {
      label: "İş Emri",
      exportValue: (o: Order) => rollupExportText(o),
    },
    cell: ({ row }) => <WorkOrderRollupCell order={row.original} />,
  },
  {
    accessorKey: "status",
    header: () => <SortableHeader field="status" label="Durum" />,
    meta: { label: "Durum" },
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={orderStatusLabels}
        tones={orderStatusTones}
      />
    ),
  },
];
