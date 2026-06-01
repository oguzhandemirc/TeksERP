import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Cog, Disc3, Package, Send, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/motion";
import { cn } from "@/lib/utils";
import { rollService } from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import {
  fetchKursunQueueCards,
  fetchTamburQueueCards,
  type KanbanQueueCard,
} from "./kanbanQueueService";
import type { Roll } from "./types";

// Üretim akışı kolonları — salt-okunur görselleştirme (sürükleme yok).
// HİBRİT model: Ham Stok / Fason / Depo rulo statüsünden (tek tek rulo);
// Kurşun & Tambur "bekleyen" istasyon kuyruğundan (parti = refakat kartı).
type ColType = "roll" | "kursun" | "tambur" | "placeholder";

interface KanbanColumn {
  key: string;
  type: ColType;
  status?: string;
  label: string;
  icon: LucideIcon;
  dot: string;
  bar: string;
}

const COLUMNS: KanbanColumn[] = [
  { key: "ham-stok", type: "roll", status: "STOCK", label: "Ham Stok", icon: Package, dot: "bg-station-kk1", bar: "bg-station-kk1" },
  { key: "fason", type: "roll", status: "AT_SUBCONTRACTOR", label: "Fason'da", icon: Send, dot: "bg-station-fason", bar: "bg-station-fason" },
  { key: "kursun", type: "kursun", label: "Kurşun Bekleyen", icon: Cog, dot: "bg-station-process", bar: "bg-station-process" },
  { key: "tambur", type: "tambur", label: "Tambur Bekleyen", icon: Disc3, dot: "bg-station-tambur", bar: "bg-station-tambur" },
  { key: "depo", type: "roll", status: "WAREHOUSE", label: "Depo", icon: Warehouse, dot: "bg-station-depo", bar: "bg-station-depo" },
  { key: "sevk", type: "placeholder", label: "Sevk", icon: Truck, dot: "bg-emerald-500", bar: "bg-emerald-500" },
];
const PREVIEW_LIMIT = 12;

type ColumnData =
  | { kind: "roll"; rolls: Roll[]; total: number }
  | { kind: "queue"; cards: KanbanQueueCard[]; total: number }
  | { kind: "placeholder" };

export function RollsKanban() {
  const [selected, setSelected] = useState<Roll | null>(null);

  const results = useQueries({
    queries: COLUMNS.map((c) => ({
      queryKey: ["rolls", "kanban", c.key],
      enabled: c.type !== "placeholder",
      staleTime: 30_000,
      queryFn: async (): Promise<ColumnData> => {
        if (c.type === "roll") {
          const res = await rollService.listCursor({
            cursor: null,
            limit: PREVIEW_LIMIT,
            sortBy: "createdAt",
            sortOrder: "desc",
            withTotal: true,
            filters: { status: c.status! },
          });
          return { kind: "roll", rolls: res.data, total: res.pagination.totalEstimate ?? res.data.length };
        }
        const q = c.type === "kursun" ? await fetchKursunQueueCards() : await fetchTamburQueueCards();
        return { kind: "queue", cards: q.cards.slice(0, PREVIEW_LIMIT), total: q.total };
      },
    })),
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="flex gap-3">
        {COLUMNS.map((col, i) => {
          const r = results[i]!;
          const data = r.data;
          const isPlaceholder = col.type === "placeholder";
          const total =
            data?.kind === "roll" ? data.total : data?.kind === "queue" ? data.total : 0;
          const shown =
            data?.kind === "roll" ? data.rolls.length : data?.kind === "queue" ? data.cards.length : 0;
          const more = Math.max(0, total - shown);

          return (
            <div key={col.key} className="flex w-64 shrink-0 flex-col rounded-lg border bg-card/40">
              <div className={cn("h-1 rounded-t-lg", col.bar)} />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <col.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="ml-auto rounded bg-muted px-1.5 text-[10px] font-medium tabular-nums">
                  {isPlaceholder ? "—" : r.isLoading ? "…" : total}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {isPlaceholder ? (
                  <p className="px-1 py-8 text-center text-[11px] text-muted-foreground">
                    Sevkiyat modülü yakında
                  </p>
                ) : r.isLoading ? (
                  Array.from({ length: 3 }).map((_, k) => <Skeleton key={k} className="h-16 w-full" />)
                ) : shown === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">Boş</p>
                ) : (
                  <Stagger className="flex flex-col gap-2">
                    {data?.kind === "roll" &&
                      data.rolls.map((roll) => (
                        <StaggerItem key={roll.id}>
                          <RollCard roll={roll} onClick={() => setSelected(roll)} />
                        </StaggerItem>
                      ))}
                    {data?.kind === "queue" &&
                      data.cards.map((card) => (
                        <StaggerItem key={card.id}>
                          <QueueCard card={card} />
                        </StaggerItem>
                      ))}
                    {more > 0 && (
                      <p className="px-1 pt-1 text-center text-[11px] text-muted-foreground">
                        +{more} daha
                      </p>
                    )}
                  </Stagger>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function gradeClass(grade: string): string {
  if (grade === "FIRE") return "bg-destructive/15 text-destructive";
  if (grade === "A1") return "bg-warning/15 text-warning";
  return "bg-muted text-muted-foreground";
}

/** Ortak kart başlığı: kumaş adı büyük + renk küçük (swatch + ad). */
function FabricHeader({
  itemName,
  colorName,
  colorHex,
}: {
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
}) {
  return (
    <>
      <div className="truncate text-sm font-semibold leading-tight">{itemName ?? "—"}</div>
      {(colorName || colorHex) && (
        <div className="mt-0.5 flex items-center gap-1.5">
          {colorHex && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border"
              style={{ background: colorHex }}
            />
          )}
          <span className="truncate text-[11px] text-muted-foreground">{colorName ?? ""}</span>
        </div>
      )}
    </>
  );
}

/** Tek rulo kartı (Ham Stok / Fason / Depo) — tıklayınca detay açılır. */
function RollCard({ roll, onClick }: { roll: Roll; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-glow w-full rounded-md border bg-card p-2.5 text-left"
    >
      <FabricHeader
        itemName={roll.item?.name ?? null}
        colorName={roll.color?.name ?? null}
        colorHex={roll.color?.hex ?? null}
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] uppercase text-muted-foreground">
          {roll.barcode ?? "açık kumaş"}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs font-medium tabular-nums">
            {roll.currentQty.toLocaleString("tr-TR")} m
          </span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", gradeClass(roll.qualityGrade))}>
            {roll.qualityGrade}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Parti (refakat kartı) kartı — Kurşun / Tambur kuyruğu. */
function QueueCard({ card }: { card: KanbanQueueCard }) {
  return (
    <div className="w-full rounded-md border bg-card p-2.5 text-left">
      <FabricHeader itemName={card.itemName} colorName={card.colorName} colorHex={card.colorHex} />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {card.openRollCount} top · {card.totalCurrentQty.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} m
        </span>
        {card.isUrgent && (
          <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            Acil
          </span>
        )}
      </div>
    </div>
  );
}
