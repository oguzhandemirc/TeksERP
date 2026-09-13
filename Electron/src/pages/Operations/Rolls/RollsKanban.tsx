import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { QualityGrade } from "@/pages/QualityGrades/types";
import { loadAllForPicker } from "@/lib/picker-loader";
import { Cog, Disc3, Layers, Package, Send, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/motion";
import { cn } from "@/lib/utils";
import {
  rollService,
  type ProductionFlowData,
  type ProductionFlowQueueCard,
  type ProductionFlowSackCard,
} from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

// Üretim akışı kolonları — salt-okunur görselleştirme (sürükleme yok). Veri TEK
// istekte (`/api/rolls/production-flow`) gelir: her kolon en güncel/öncelikli 10
// kayıt + gerçek toplam sayaç. HİBRİT model: Ham Stok / Yarı Mamul / Fason / Depo
// rulo statüsünden; Kurşun & Tambur istasyon kuyruğundan (parti = refakat kartı);
// Sevk kolonu çıkış bekleyen (PLANNED) planlı sevkler.
interface KanbanColumn {
  key: keyof ProductionFlowData;
  label: string;
  icon: LucideIcon;
  dot: string;
  bar: string;
}

const COLUMNS: KanbanColumn[] = [
  { key: "hamStok", label: "Ham Stok", icon: Package, dot: "bg-station-kk1", bar: "bg-station-kk1" },
  // Yarı mamul Ham Stok'un YANINDA durur (ikisi de raftaki giriş stoğu) ama AYRI
  // kolondur: boyahaneyi ATLAR, akışa Kurşun'dan girer. Tek kovada toplamak
  // "ham kumaşım ne kadar" sorusuna yanlış cevap veriyordu.
  // Renk Ham Stok'tan AYRI (cyan): iki kolon yan yana ve aynı aileden, aynı
  // tonda olsalar operatör sayaçları karıştırır — ayrımın görünürlüğü bu
  // paketin varlık sebebi. Mobil Depo sekmesiyle aynı ton (#0891b2).
  { key: "yariMamul", label: "Yarı Mamul", icon: Layers, dot: "bg-cyan-600", bar: "bg-cyan-600" },
  { key: "fason", label: "Fason'da", icon: Send, dot: "bg-station-fason", bar: "bg-station-fason" },
  { key: "kursun", label: "Kurşun Bekleyen", icon: Cog, dot: "bg-station-process", bar: "bg-station-process" },
  { key: "tambur", label: "Tambur Bekleyen", icon: Disc3, dot: "bg-station-tambur", bar: "bg-station-tambur" },
  { key: "depo", label: "Depo", icon: Warehouse, dot: "bg-station-depo", bar: "bg-station-depo" },
  { key: "sevk", label: "Sevk", icon: Truck, dot: "bg-emerald-500", bar: "bg-emerald-500" },
];

// Kolon anahtarını cevaptaki dilime çevir — heterojen (rulo / kuyruk / sevk) union.
type Slice =
  | { kind: "roll"; rolls: Roll[]; total: number }
  | { kind: "queue"; cards: ProductionFlowQueueCard[]; total: number }
  | { kind: "sack"; shipments: ProductionFlowSackCard[]; total: number };

function sliceForColumn(key: keyof ProductionFlowData, data: ProductionFlowData): Slice {
  switch (key) {
    case "hamStok": return { kind: "roll", ...data.hamStok };
    case "yariMamul": return { kind: "roll", ...data.yariMamul };
    case "fason": return { kind: "roll", ...data.fason };
    case "depo": return { kind: "roll", ...data.depo };
    case "kursun": return { kind: "queue", ...data.kursun };
    case "tambur": return { kind: "queue", ...data.tambur };
    case "sevk": return { kind: "sack", ...data.sevk };
  }
}

const shownCount = (s: Slice): number =>
  s.kind === "roll" ? s.rolls.length : s.kind === "queue" ? s.cards.length : s.shipments.length;

export function RollsKanban() {
  const [selected, setSelected] = useState<Roll | null>(null);

  // TEK istek — eskiden 6 ayrı sorgu (useQueries) vardı; kuyruk kolonları ~500
  // satırı nested payload'la çekiyordu. Artık kolon başına 10 + count sunucuda.
  // Kalite kataloğu — rozet sınıfı için. Anahtar mevcut `picker` ile AYNI:
  // react-query tekilleştirir, yeni önbellek girdisi doğmaz.
  const qualityGradesQuery = useQuery({
    queryKey: ["quality-grades", "picker"],
    queryFn: () => loadAllForPicker(qualityGradeService, { sortBy: "sortOrder" }),
    // 5 dk — bu anahtarın ÖNCEDEN VAR OLAN dört okuyucusuyla aynı. Farklı
    // yazsaydık aynı önbellek girdisi iki farklı yaşta veriyi taze sayardı
    // (react-query staleTime'ı GÖZLEMCİ BAŞINA uygular): admin bir kaliteyi
    // pasifleştirir, bir sekme 10 dk eski kataloğu doğru sayar, öteki 5'te
    // tazeler. Görünmez, çünkü ikisi de geçerli bir katalog döner.
    staleTime: 5 * 60_000,
  });
  const qualityGrades = qualityGradesQuery.data?.data ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["rolls", "kanban"],
    staleTime: 30_000,
    queryFn: () => rollService.getProductionFlow().then((r) => r.data),
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Her sütun en güncel 10 kaydı gösterir · sağ üstteki sayı toplam kayıttır.
      </p>
      <div className="flex gap-3">
        {COLUMNS.map((col) => {
          const slice = data ? sliceForColumn(col.key, data) : null;
          const total = slice?.total ?? 0;
          const shown = slice ? shownCount(slice) : 0;
          const more = Math.max(0, total - shown);

          return (
            <div key={col.key} className="flex w-64 shrink-0 flex-col rounded-lg border bg-card/40">
              <div className={cn("h-1 rounded-t-lg", col.bar)} />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <col.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="ml-auto rounded bg-muted px-1.5 text-[10px] font-medium tabular-nums">
                  {isLoading ? "…" : total}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {isLoading || !slice ? (
                  Array.from({ length: 3 }).map((_, k) => <Skeleton key={k} className="h-16 w-full" />)
                ) : shown === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">Boş</p>
                ) : (
                  <Stagger className="flex flex-col gap-2">
                    {slice.kind === "roll" &&
                      slice.rolls.map((roll) => (
                        <StaggerItem key={roll.id}>
                          <RollCard grades={qualityGrades} roll={roll} onClick={() => setSelected(roll)} />
                        </StaggerItem>
                      ))}
                    {slice.kind === "queue" &&
                      slice.cards.map((card) => (
                        <StaggerItem key={card.id}>
                          <QueueCard card={card} />
                        </StaggerItem>
                      ))}
                    {slice.kind === "sack" &&
                      slice.shipments.map((s) => (
                        <StaggerItem key={s.id}>
                          <KanbanSackCard shipment={s} />
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

/**
 * Kalite rozetinin sınıfı KATALOGTAN (2026-09-13, karar ①).
 *
 * ⚠️ Burada `grade === "FIRE"` / `=== "A1"` vardı; kod fabrikaya AÇIK bir
 * alandır ve kataloğu `2K/HURDA` olan bir kurulumda HİÇBİR top renkli rozet
 * almazdı (sessiz: hata yok, renk de yok). Karar rolden gelir (rozet çizilsin
 * mi), renk kalitenin KENDİ alanından — rolsüz kademe nötr kalır ve bu bugünkü
 * davranışın aynısıdır.
 * `grades` BOŞ ise (katalog henüz yok) nötr sınıf döner: kod yine yazılır.
 */
function gradeClass(grades: readonly QualityGrade[], grade: string | null): string {
  const row = grade ? grades.find((g) => g.code === grade) : undefined;
  if (row?.role === "SCRAP") return "bg-destructive/15 text-destructive";
  if (row?.role === "SECOND") return "bg-warning/15 text-warning";
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
function RollCard({
  grades,
  roll,
  onClick,
}: {
  /** Kalite kataloğu — rozet sınıfı buradan (gradeClass notuna bak). */
  grades: readonly QualityGrade[];
  roll: Roll;
  onClick: () => void;
}) {
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
            {roll.currentQty.toLocaleString("tr-TR", { useGrouping: false })} m
          </span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", gradeClass(grades, roll.qualityGrade))}>
            {roll.qualityGrade ?? "—"}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Parti (refakat kartı) kartı — Kurşun / Tambur kuyruğu. */
function QueueCard({ card }: { card: ProductionFlowQueueCard }) {
  return (
    <div className="w-full rounded-md border bg-card p-2.5 text-left">
      <FabricHeader itemName={card.itemName} colorName={card.colorName} colorHex={card.colorHex} />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {card.openRollCount} top · {card.totalCurrentQty.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 0 })} m
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

/** Sevk kolonu kartı — çıkış bekleyen (PLANNED) planlı sevk. */
function KanbanSackCard({ shipment }: { shipment: ProductionFlowSackCard }) {
  return (
    <div className="w-full rounded-md border bg-card p-2.5">
      <div className="truncate text-sm font-semibold leading-tight">{shipment.shipmentNo}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {shipment.customer.name}
        {shipment.branch && <span> · {shipment.branch.name}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground">
        <span>{shipment.sackCount} çuval</span>
        <span>·</span>
        <span>{shipment.totalKg.toLocaleString("tr-TR", { useGrouping: false })} kg</span>
        <span>·</span>
        <span>{shipment.totalQty.toLocaleString("tr-TR", { useGrouping: false })} m</span>
      </div>
    </div>
  );
}
