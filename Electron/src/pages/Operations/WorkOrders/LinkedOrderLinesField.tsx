import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Link2,
  Package,
  Pencil,
  Ruler,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedNumber } from "@/components/motion";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { OrderPickerDialog, type PickedOrderLine } from "./OrderPickerDialog";

interface Props {
  lines: PickedOrderLine[];
  onChange: (next: PickedOrderLine[]) => void;
  /** Picker onayında çağrılır. Auto-fill için (kalem silmede tetiklenmez). */
  onPickerConfirm?: (lines: PickedOrderLine[]) => void;
  /** Edit modunda mevcut WO'nun kendi bağladığı kalemler picker'da müsait görünsün. */
  excludeWorkOrderId?: string | null;
  /** Material committed WO için: yeni sipariş satırları sadece bu kumaş + en'de olabilir. */
  requiredItemId?: string | null;
  requiredWidth?: number | null;
  /** Kalem yokken tam panel yerine slim "Sipariş Bağla" çubuğu göster (stoğa üretim). */
  compact?: boolean;
}

const fmt = (n: number) => n.toLocaleString("tr-TR", { useGrouping: false });

/**
 * Bağlı sipariş kalemleri için sol panel. Kendi header + scroll body'sini taşır
 * ki ana formdan bağımsız scroll'lansın. Kalem kartları okunaklılık için
 * hiyerarşik: sipariş no + müşteri → kumaş/renk → metraj kutusu → termin/özellik.
 */
export function LinkedOrderLinesField({
  lines,
  onChange,
  onPickerConfirm,
  excludeWorkOrderId,
  requiredItemId,
  requiredWidth,
  compact,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleConfirm = (next: PickedOrderLine[]) => {
    onChange(next);
    onPickerConfirm?.(next);
  };
  const handleRemove = (lineId: string) =>
    onChange(lines.filter((l) => l.lineId !== lineId));

  const picker = (
    <OrderPickerDialog
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      initialSelected={lines}
      onConfirm={handleConfirm}
      excludeWorkOrderId={excludeWorkOrderId}
      requiredItemId={requiredItemId}
      requiredWidth={requiredWidth}
    />
  );

  const totalQty = lines.reduce((s, l) => s + Number(l.openQty), 0);
  const uniqueCustomers = new Set(lines.map((l) => l.customerId)).size;

  // Kalem yok + compact: 340px panel yerine tek satırlık bağla çubuğu.
  if (compact && lines.length === 0) {
    return (
      <>
        <div className="flex items-center gap-2 rounded-md border bg-muted/10 px-3 py-2 text-xs">
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            Sipariş kalemi bağlanmazsa stoğa üretim yapılır.
          </span>
          <motion.div
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.96 }}
            transition={springSnappy}
            className="ml-auto shrink-0"
          >
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1 bg-gradient-to-b from-primary to-primary/80 text-xs text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10 hover:from-primary hover:to-primary hover:shadow-md hover:shadow-primary/40"
              onClick={() => setPickerOpen(true)}
            >
              <Link2 className="h-3 w-3" /> Sipariş Bağla
            </Button>
          </motion.div>
        </div>
        {picker}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-primary/[0.04] to-transparent">
      {/* Header — ikon rozeti + başlık + aksiyon; altında istatistik kartları */}
      <div className="shrink-0 border-b bg-card/70 px-3 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Package className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">
                Bağlı Sipariş Kalemleri
              </div>
              <div className="text-[11px] leading-tight text-muted-foreground">
                Bu iş emrinin karşıladığı kalemler
              </div>
            </div>
          </div>
          <motion.div whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} transition={springSnappy}>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1 bg-gradient-to-b from-primary to-primary/80 text-xs text-primary-foreground shadow-sm shadow-primary/30 ring-1 ring-inset ring-white/10 hover:from-primary hover:to-primary hover:shadow-md hover:shadow-primary/40"
              onClick={() => setPickerOpen(true)}
            >
              {lines.length > 0 ? (
                <>
                  <Pencil className="h-3 w-3" /> Düzenle
                </>
              ) : (
                <>
                  <Link2 className="h-3 w-3" /> Seç
                </>
              )}
            </Button>
          </motion.div>
        </div>

        {lines.length > 0 && (
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <Stat icon={Link2} value={lines.length} label="kalem" tone="primary" />
            <Stat icon={Ruler} value={totalQty} label="metre" tone="info" />
            <Stat icon={Users} value={uniqueCustomers} label="müşteri" tone="muted" />
          </div>
        )}
      </div>

      {/* Kalem listesi */}
      <div className="flex-1 overflow-y-auto p-2">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed bg-muted/10 p-6 text-center">
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Link2 className="h-5 w-5" />
            </span>
            <div className="text-sm font-semibold text-foreground">Henüz kalem seçilmedi</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Bağlanmazsa stoğa üretim gibi davranır.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {lines.map((line) => (
                <LineCard
                  key={line.lineId}
                  line={line}
                  onRemove={() => handleRemove(line.lineId)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {picker}
    </div>
  );
}

/** Header özet kartı — sayı + etiket, tonlu. */
function Stat({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  tone: "primary" | "info" | "muted";
}) {
  const tones: Record<typeof tone, string> = {
    primary: "bg-primary/10 text-primary ring-primary/15",
    info: "bg-info/10 text-info ring-info/15",
    muted: "bg-muted text-foreground ring-border",
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg px-1 py-1.5 text-center ring-1 ring-inset",
        tones[tone],
      )}
    >
      <div className="flex items-center gap-1 text-sm font-bold leading-none tabular-nums">
        <Icon className="h-3 w-3 opacity-70" />
        <AnimatedNumber value={value} flash />
      </div>
      <div className="mt-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </div>
    </div>
  );
}

/** Tek sipariş kalemi kartı. */
function LineCard({
  line,
  onRemove,
}: {
  line: PickedOrderLine;
  onRemove: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, scale: 0.97 }}
      animate={{ opacity: 1, height: "auto", scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.97 }}
      transition={springSnappy}
      className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40 hover:shadow-md"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-primary/60" aria-hidden />
      <div className="space-y-1.5 py-2 pl-3 pr-2">
        {/* Sipariş no + müşteri + kaldır */}
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
              {line.orderNumber}
            </span>
            <div className="mt-1 truncate text-xs font-semibold text-foreground">
              {line.customerName}
            </div>
            {line.branchName && (
              <div className="truncate text-[11px] font-normal text-muted-foreground">
                Şube: {line.branchName}
                {line.branchCode ? ` (${line.branchCode})` : ""}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive hover:opacity-100 group-hover:opacity-100"
            aria-label={`${line.orderNumber} kaldır`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Kumaş + renk */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium">{line.itemName}</span>
          {line.itemColorName && (
            <Badge variant="muted" className="gap-1 text-[10px]">
              {line.itemColorHex && (
                <span
                  className="h-2 w-2 rounded-full border"
                  style={{ backgroundColor: line.itemColorHex }}
                />
              )}
              {line.itemColorName}
            </Badge>
          )}
        </div>

        {/* Metraj kutusu — sipariş miktarı + en · açık */}
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1">
          <span className="flex items-baseline gap-1">
            <span className="text-sm font-bold tabular-nums text-foreground">
              {fmt(line.quantity)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              m{line.width ? ` × ${line.width}cm` : ""}
            </span>
          </span>
          <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
            {line.openQty === null ? "Açık: ölçülmüyor" : `Açık ${fmt(line.openQty)} m`}
          </span>
        </div>

        {/* Termin + üretim özellikleri */}
        {(line.orderDeadline || line.requiredProperties.length > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {line.orderDeadline && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                <CalendarClock className="h-2.5 w-2.5" />
                {new Date(line.orderDeadline).toLocaleDateString("tr-TR")}
              </span>
            )}
            {line.requiredProperties.map((rp) => (
              <Badge key={rp.id} variant="outline" className="text-[10px]">
                {rp.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
