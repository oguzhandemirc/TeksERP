// Ürün formunun küçük parçaları: stok kodu satırı, izinli liste tetiği, izinli renk/özellik pencereleri.
import { Controller, type UseFormReturn } from "react-hook-form";
import { ChevronRight, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { cn } from "@/lib/utils";
import { AllowedColorsDialog } from "./AllowedColorsDialog";
import { AllowedPropertiesDialog } from "./AllowedPropertiesDialog";
import type { ItemFormValues } from "./schema";

/** Değiştirilemeyen değer (kilitli tip, otomatik birim): açılır liste görünümü vermeyen gri kutu + kilit. */
export function LockedValue({ id, text }: { id?: string; text: string }) {
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input id={id} value={text} readOnly tabIndex={-1} className="cursor-not-allowed bg-muted pl-8" />
    </div>
  );
}

/**
 * Stok kodu satırı — formun EN ALTINDA ve varsayılan KAPALI.
 *
 * Gerekçe (2026-08-17): alan formun ilk kutusuydu ve "boş bırakın, sistem
 * versin" ipucuna rağmen personel oraya kumaşın adını yazıyordu. Kapalı
 * durumda `<input>` HİÇ render edilmez — gri/disabled bir kutu bırakmak
 * "buraya bir şey yazılabilir" izlenimini sürdürürdü ve sekme sırasına da
 * girerdi. Elle giriş bilinçli bir tıklama ister.
 */
export function StockCodeRow({
  isEdit,
  code,
  manual,
  onManualChange,
  error,
  register,
}: {
  isEdit: boolean;
  code: string | null;
  manual: boolean;
  onManualChange: (next: boolean) => void;
  error?: { message?: string };
  register: UseFormReturn<ItemFormValues>["register"];
}) {
  // Düzenlemede kod başlıkta rozet (B11); kodsuz eski kayıtta şerit yine görünür.
  if (isEdit) {
    if (code) return null;
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>Stok Kodu</span>
        <span className="font-mono text-foreground">—</span>
      </div>
    );
  }

  if (!manual) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span>
          Stok kodunu <strong className="text-foreground">sistem verecek</strong>{" "}
          <span className="font-mono">(STK-000123)</span>
        </span>
        <button
          type="button"
          onClick={() => onManualChange(true)}
          className="ml-auto rounded px-2 py-0.5 underline underline-offset-2 transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Elle gir
        </button>
      </div>
    );
  }

  return (
    <FormField
      label="Stok Kodu (elle)"
      htmlFor="code"
      error={error}
      hint="STK- öneki otomatik kodlara ayrılmıştır; kendi kodunuzu yazın."
    >
      <div className="flex items-center gap-2">
        <Input id="code" autoFocus placeholder="ÖRN-001" {...register("code")} />
        <Button type="button" variant="outline" size="sm" onClick={() => onManualChange(false)}>
          Otomatiğe dön
        </Button>
      </div>
    </FormField>
  );
}

export interface PreviewChip {
  key: string;
  label: string;
  swatch: string | null;
}

export function PickerTrigger({
  icon,
  count,
  emptyText,
  previews,
  extra,
  onClick,
}: {
  icon: React.ReactNode;
  count: number;
  emptyText: string;
  previews: PreviewChip[];
  extra: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm",
        "transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        {count === 0 ? (
          <span className="text-muted-foreground italic">{emptyText}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {previews.map((p) => (
              <Badge key={p.key} variant="muted" className="gap-1 text-[10px]">
                {p.swatch && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.swatch }} />}
                {p.label}
              </Badge>
            ))}
            {extra > 0 && (
              <Badge variant="muted" className="text-[10px]">
                +{extra}
              </Badge>
            )}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{count > 0 ? `${count} seçili` : "Seç"}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

/** İzinli renk/özellik pencereleri — formun DIŞINDA çizilir (iç pencerenin olayları dış formu göndermesin). */
export function AllowedListDialogs({ form, colorsOpen, setColorsOpen, propsOpen, setPropsOpen }: {
  form: UseFormReturn<ItemFormValues>;
  colorsOpen: boolean;
  setColorsOpen: (o: boolean) => void;
  propsOpen: boolean;
  setPropsOpen: (o: boolean) => void;
}) {
  return (
    <>
      <Controller
        control={form.control}
        name="allowedColorIds"
        render={({ field }) => <AllowedColorsDialog open={colorsOpen} onOpenChange={setColorsOpen} value={field.value} onChange={field.onChange} />}
      />
      <Controller
        control={form.control}
        name="allowedPropertyIds"
        render={({ field }) => <AllowedPropertiesDialog open={propsOpen} onOpenChange={setPropsOpen} value={field.value} onChange={field.onChange} />}
      />
    </>
  );
}
