import { useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ClipboardList,
  Fingerprint,
  Link2,
  Package,
  Sparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SECTION_TONE, type SectionTone } from "@/components/forms/FormSection";
import { safeFormat } from "@/lib/format";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { fabricPropertyService } from "@/pages/FabricProperties/service";
import type { WorkOrderFormValues } from "./schema";
import type { DesignerStep } from "./RouteDesignerDialog";
import { LastBatchBadge } from "./LastBatchBadge";
import type { PickedOrderLine } from "./OrderPickerDialog";

interface Props {
  control: Control<WorkOrderFormValues>;
  routeSteps: DesignerStep[];
  pickedLines: PickedOrderLine[];
  isOrderProduction: boolean;
  isEdit: boolean;
  /** Hedef metraj/kg alanları açık mı (targetQuantityEnabled bayrağı). */
  showQuantity: boolean;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * İş emri formunun canlı özet kartı — sağ panelde dururken form doldukça anlık
 * güncellenir. Sol "Bağlı Sipariş Kalemleri" paneliyle simetrik (kendi header +
 * scroll body). Kumaş/renk/özellik adları ID'den çözülür (picker cache'lerini
 * paylaşır); rota adımları + bağlı kalemler zaten ad taşır.
 */
export function WorkOrderLivePreview({
  control,
  routeSteps,
  pickedLines,
  isOrderProduction,
  isEdit,
  showQuantity,
}: Props) {
  const batchNumber = useWatch({ control, name: "batchNumber" });
  const targetItemId = useWatch({ control, name: "targetItemId" });
  const targetColorId = useWatch({ control, name: "targetColorId" });
  const targetPropertyIds = useWatch({ control, name: "targetPropertyIds" }) ?? [];
  const width = useWatch({ control, name: "width" });
  const targetQuantity = useWatch({ control, name: "targetQuantity" });
  const targetWeight = useWatch({ control, name: "targetWeight" });
  const foldType = useWatch({ control, name: "foldType" });
  const plannedStartDate = useWatch({ control, name: "plannedStartDate" });
  const plannedEndDate = useWatch({ control, name: "plannedEndDate" });

  const firstLine = pickedLines[0] ?? null;

  // Kumaş adı/kodu — picker getById cache'i (["item", id]) ile paylaşımlı.
  const itemQ = useQuery({
    queryKey: ["item", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });
  const itemCode = itemQ.data?.data?.code ?? null;
  const itemName = itemQ.data?.data?.name ?? firstLine?.itemName ?? null;

  // Renk — getById; çözülene dek sipariş kaleminin rengine düş (eşleşiyorsa).
  const colorQ = useQuery({
    queryKey: ["color", targetColorId],
    queryFn: () => colorService.getById(targetColorId as string),
    enabled: Boolean(targetColorId),
    staleTime: 300_000,
  });
  const lineColorMatches =
    targetColorId != null && firstLine?.colorId === targetColorId;
  const colorName =
    colorQ.data?.data?.name ?? (lineColorMatches ? firstLine?.itemColorName : null);
  const colorHex =
    colorQ.data?.data?.hex ?? (lineColorMatches ? firstLine?.itemColorHex : null);

  // Üretim özellikleri — RouteEditor ile aynı ["fabric-properties","all"] cache'i.
  const propsQ = useQuery({
    queryKey: ["fabric-properties", "all"],
    queryFn: () =>
      fabricPropertyService.getAll({
        page: 1,
        pageSize: 200,
        sortBy: "sortOrder",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: targetPropertyIds.length > 0,
    staleTime: 300_000,
  });
  const lineProps = new Map<string, string>();
  for (const l of pickedLines)
    for (const p of l.requiredProperties) lineProps.set(p.id, p.name);
  const propNames = targetPropertyIds
    .map(
      (id) =>
        propsQ.data?.data.find((p) => p.id === id)?.name ?? lineProps.get(id) ?? null,
    )
    .filter((n): n is string => Boolean(n));

  const widthVal = num(width);
  const qtyVal = num(targetQuantity);
  const weightVal = num(targetWeight);

  const totalOpen = pickedLines.reduce((s, l) => s + Number(l.openQty), 0);
  const uniqueCustomers = new Set(pickedLines.map((l) => l.customerId)).size;

  const start = (plannedStartDate ?? "").trim();
  const end = (plannedEndDate ?? "").trim();
  const hasPlan = Boolean(start || end);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Sticky header — sol panelle simetrik */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2.5">
        <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Önizleme · İş Emri
        </span>
        <Badge variant="muted" className="ml-auto text-[10px]">
          {isEdit ? "Düzenleniyor" : "Yeni"}
        </Badge>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Kimlik */}
        <Section title="Kimlik" icon={Fingerprint} tone="slate">
          <Row label="Parti Kodu">
            {batchNumber?.trim() ? (
              <span className="font-mono font-medium">{batchNumber}</span>
            ) : (
              <span className="text-muted-foreground">Otomatik atanacak</span>
            )}
          </Row>
          {/* Rozet önizlemenin İLK bölümünde, parti kodunun hemen altında
              (2026-08-17 talebi). Kendini belli etmesi bilinçli: planlamacı
              formu doldururken fabrikadaki fiziksel plaka setiyle kıyaslıyor. */}
          {!isEdit && <LastBatchBadge className="mt-1" />}
          <Row label="Tip">
            <Badge
              variant={isOrderProduction ? "secondary" : "muted"}
              className="text-[10px]"
            >
              {isOrderProduction ? "Siparişe üretim" : "Stoğa üretim"}
            </Badge>
          </Row>
        </Section>

        {/* Hedef */}
        <Section title="Hedef" icon={Package} tone="indigo">
          <Row label="Kumaş">
            {itemName ? (
              <span className="font-medium">
                {itemCode && (
                  <span className="mr-1 font-mono text-[11px] text-muted-foreground">
                    {itemCode}
                  </span>
                )}
                {itemName}
              </span>
            ) : (
              <span className="text-muted-foreground">Seçilmedi</span>
            )}
          </Row>
          <Row label="Renk">
            {colorName ? (
              <span className="inline-flex items-center gap-1.5">
                {colorHex && (
                  <span
                    className="h-3 w-3 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: colorHex }}
                  />
                )}
                <span className="font-medium">{colorName}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Ham / renksiz</span>
            )}
          </Row>
          <Row label="En">
            {widthVal != null ? (
              <span className="tabular-nums">{widthVal} cm</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          {showQuantity && (
            <Row label="Metraj · Kg">
              <span className="tabular-nums">
                {qtyVal != null ? `${qtyVal.toLocaleString("tr-TR", { useGrouping: false })} m` : "—"}
                <span className="text-muted-foreground"> · </span>
                {weightVal != null ? `${weightVal.toLocaleString("tr-TR", { useGrouping: false })} kg` : "—"}
              </span>
            </Row>
          )}
        </Section>

        {/* Üretim akışı */}
        <Section title="Üretim Akışı" icon={Workflow} tone="emerald">
          {routeSteps.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Henüz adım yok — soldaki akıştan ekle.
            </p>
          ) : (
            <ol className="flex flex-wrap items-center gap-1">
              {routeSteps.map((s, i) => {
                const ext = s.stationType === "EXTERNAL";
                return (
                  <li
                    key={s.clientId}
                    className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] ${
                      ext
                        ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
                        : "border-border bg-background"
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted font-mono text-[8px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className={s.stationName ? "font-medium" : "text-muted-foreground"}>
                      {s.stationName || "İstasyon seç"}
                    </span>
                    {ext && (
                      <span className="text-[8px] font-semibold uppercase text-amber-600 dark:text-amber-400">
                        F
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {/* Üretim özellikleri */}
        {propNames.length > 0 && (
          <Section title="Üretim Özellikleri" icon={Sparkles} tone="violet">
            <div className="flex flex-wrap gap-1">
              {propNames.map((n) => (
                <Badge key={n} variant="outline" className="text-[10px]">
                  {n}
                </Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Planlama */}
        <Section title="Planlama" icon={CalendarClock} tone="amber">
          <Row label="Tarih">
            {hasPlan ? (
              <span className="tabular-nums">
                {start ? safeFormat(start, "dd.MM.yyyy") : "bugün"}
                <span className="text-muted-foreground"> → </span>
                {end ? safeFormat(end, "dd.MM.yyyy") : "varsayılan"}
              </span>
            ) : (
              <span className="text-muted-foreground">Varsayılan</span>
            )}
          </Row>
          {foldType?.trim() && <Row label="Kat Tipi">{foldType}</Row>}
        </Section>

        {/* Bağlı sipariş özeti */}
        <Section title="Bağlı Sipariş" icon={Link2} tone="blue">
          {isOrderProduction ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                <span className="text-sm font-bold text-foreground">{pickedLines.length}</span> kalem
              </span>
              <span className="tabular-nums">
                <span className="text-sm font-bold text-foreground">
                  {totalOpen.toLocaleString("tr-TR", { useGrouping: false })}
                </span>{" "}
                m açık
              </span>
              <span>
                <span className="text-sm font-bold text-foreground">{uniqueCustomers}</span> müşteri
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sipariş bağlı değil — toplar stoğa yazılır.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  tone = "slate",
  children,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: SectionTone;
  children: React.ReactNode;
}) {
  const t = SECTION_TONE[tone];
  return (
    <div className={cn("rounded-md border border-l-4 bg-card p-2.5", t.border)}>
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
          t.icon,
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}
