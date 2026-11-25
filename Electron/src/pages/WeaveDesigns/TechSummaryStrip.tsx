// Desen kartı teknik özet şeridi (Seyitoğlu, 2026-11-25): seçili kumaşın tel/sıklık/rapor/gramaj değerleri
// sekme gezmeden tek satırda. Her sayı SUNUCUDAN (`/api/items/:id/computed-gsm`); istemci bölme yapmaz,
// bilinmeyen değer "—". Kumaş yoksa şerit çizilmez.
import { useQuery } from "@tanstack/react-query";
import { InfoPopover } from "@/components/ui/info-popover";
import { qtyFormatter } from "@/lib/format";
import { itemService } from "@/pages/Items/service";
import type { ItemComputedGsm } from "@/pages/Items/types";
import type { DesignFabric } from "./types";

const fmt = qtyFormatter(2);
const show = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? "—" : fmt.format(n));

export interface SummaryCell { key: string; label: string; value: string; unit: string; info: string }

/** `frameCount`: yalnız Armür deseninde verilir (desen kartının kayıtlı değeri; hesap değil) — undefined → hücre yok. */
export function techSummaryCells(d: Partial<ItemComputedGsm> | null | undefined, frameCount?: number | null): SummaryCell[] {
  type NumKey = { [K in keyof ItemComputedGsm]-?: NonNullable<ItemComputedGsm[K]> extends number ? K : never }[keyof ItemComputedGsm];
  const c = (key: NumKey, label: string, unit: string, info: string): SummaryCell => ({ key, label, value: show(d?.[key]), unit, info });
  const frame: SummaryCell[] = frameCount === undefined ? []
    : [{ key: "frameCount", label: "Çerçeve sayısı", value: show(frameCount), unit: "çerçeve", info: "Armürde kullanılan çerçeve sayısı (desen kartından)." }];
  return [
    ...frame,
    c("endsCount", "Toplam tel", "tel", "Zemin çözgüsü ile döner/ikinci çözgü tellerinin toplamı (çözgü kartlarından)."),
    c("endsPerCm", "Çözgü sıklığı", "tel/cm", "Çözgü sıklığı = toplam tel ÷ ham en."),
    c("picksPerCm", "Atkı sıklığı", "atkı/cm", "Santimetreye düşen atkı sayısı (atkı kartından)."),
    c("picksInRepeat", "Rapordaki atkı", "atkı", "Atkı sırası bir kez tamamlanana kadar atılan atkı sayısı (atkı kartındaki adetlerin toplamı)."),
    c("repeatCm", "Rapor boyu", "cm", "Desenin kendini tekrar ettiği boy (desen kartından)."),
    c("repeatsPerM", "1 metrede rapor", "rapor", "1 metre kumaşta desenin kaç kez tekrarlandığı = 100 ÷ rapor boyu."),
    c("warpGPerM", "Çözgü ağırlığı", "g/m", "1 metre kumaştaki çözgü ipliği ağırlığı (fire hariç)."),
    c("weftGPerM", "Atkı ağırlığı", "g/m", "1 metre kumaştaki atkı ipliği ağırlığı (fire hariç)."),
    c("totalGPerM", "Metre ağırlığı", "g/m", "Çözgü + atkı; 1 metre ham kumaşın ağırlığı."),
    c("gsm", "Gramaj", "g/m²", "Metrekare ağırlığı = toplam g/m ÷ ham en (m)."),
  ];
}

export function TechSummaryView({ data, frameCount }: { data: Partial<ItemComputedGsm> | null | undefined; frameCount?: number | null }) {
  const cells = techSummaryCells(data, frameCount);
  return (
    <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 px-3 py-2 ${cells.length > 10 ? "sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-11" : "sm:grid-cols-5 2xl:grid-cols-10"}`} data-testid="tech-summary">
      {cells.map((cell) => (
        <div key={cell.key} className="min-w-0">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{cell.label}</span>
            <InfoPopover desc={cell.info} label={`${cell.label} açıklaması`} />
          </dt>
          <dd className="text-sm font-medium tabular-nums" data-testid={`tech-${cell.key}`}>
            {cell.value}
            {cell.value !== "—" && <span className="ml-1 text-xs font-normal text-muted-foreground">{cell.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TechSummaryStrip({ fabric, frameCount }: { fabric: DesignFabric | null; frameCount?: number | null }) {
  const q = useQuery({
    queryKey: ["item-computed-gsm", fabric?.id ?? ""],
    queryFn: () => itemService.computedGsm(fabric!.id),
    enabled: !!fabric,
    retry: false,
  });
  if (!fabric) return null;
  return <TechSummaryView data={q.isSuccess ? q.data : null} frameCount={frameCount} />;
}
