import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Palette, Ruler } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { colorService } from "@/pages/Colors/service";
import { workOrderService } from "./service";

type Mode = "color" | "width";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  workOrderId: string;
  workOrderNumber: string;
  currentColorId: string | null;
  currentColorName: string | null;
  currentWidth: number | null;
}

/**
 * "Rengi Değiştir" / "Eni Değiştir" — iş emrinin TEK bir hedefini değiştiren
 * dar kapı (2026-08-17, madde 10 ve 12).
 *
 * Gerçek hayattaki karşılığı: iş emri boyahanedeyken müşteri telefon eder,
 * "maviyi değil ekruyu istiyoruz" der; ya da fasondan gelen mal 300 değil 295
 * cm ölçülür. İkisi de bugüne kadar "Düzenle" ekranından yapılıyordu — yani
 * sebebi de izi de tutulmuyordu ve aynı ekranda rota da bozulabiliyordu.
 *
 * SEBEP ZORUNLU: bu diyaloğun varlık sebebi izlenebilirlik. Sebepsiz
 * değiştirmek zaten mümkündü.
 */
export function ChangeTargetDialog({
  open,
  onOpenChange,
  mode,
  workOrderId,
  workOrderNumber,
  currentColorId,
  currentColorName,
  currentWidth,
}: Props) {
  const qc = useQueryClient();
  const [colorId, setColorId] = useState<string | null>(currentColorId);
  const [width, setWidth] = useState<string>(currentWidth != null ? String(currentWidth) : "");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setColorId(currentColorId);
      setWidth(currentWidth != null ? String(currentWidth) : "");
      setReason("");
    }
  }, [open, currentColorId, currentWidth]);

  const colorsQ = useQuery({
    queryKey: ["colors", "all-active"],
    queryFn: () =>
      colorService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: { isActive: "true" },
      }),
    enabled: open && mode === "color",
    staleTime: 60_000,
  });

  // Dönüş şekilleri farklı (`warnings` ↔ `previousWidth`) — ortak dar bir tipe
  // indiriyoruz; ekranın ihtiyacı yalnız mesaj ve varsa uyarılar.
  const mutation = useMutation<{ message?: string; data: { warnings?: string[] } }>({
    mutationFn: async () => {
      const res =
        mode === "color"
          ? await workOrderService.changeTargetColor(workOrderId, colorId, reason)
          : await workOrderService.changeWidth(workOrderId, width === "" ? null : Number(width), reason);
      return { message: res.message, data: res.data as { warnings?: string[] } };
    },
    onSuccess: (res) => {
      toast.success(res.message ?? "Güncellendi");
      // Bağlı siparişlerle çelişki ENGEL DEĞİL, uyarıdır: kararı müşteri verdi.
      // Ama planlamacı sipariş satırını da düzeltmek isteyebilir → görünür kalsın.
      const warnings = (res.data as { warnings?: string[] }).warnings ?? [];
      for (const w of warnings) toast.warning(w);
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["work-order", workOrderId] });
      onOpenChange(false);
    },
  });

  const isColor = mode === "color";
  const changed = isColor
    ? colorId !== currentColorId
    : (width === "" ? null : Number(width)) !== currentWidth;
  const canSubmit = changed && reason.trim().length >= 3 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isColor ? <Palette className="h-4 w-4" /> : <Ruler className="h-4 w-4" />}
            {isColor ? "Üretim Rengini Değiştir" : "Eni Değiştir"} — {workOrderNumber}
          </DialogTitle>
          <DialogDescription>
            {isColor
              ? "Bu iş emrinin ÜRETİM rengi değişir. Bağlı siparişlerin rengi değişmez."
              : "Bu iş emrinin eni değişir; fason çekisinde basılan EN değeri buradan gelir."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Şu anki değer:{" "}
            <strong className="text-foreground">
              {isColor ? (currentColorName ?? "renksiz") : currentWidth != null ? `${currentWidth} cm` : "—"}
            </strong>
          </div>

          {isColor ? (
            <FormField label="Yeni Renk" htmlFor="new-color">
              <select
                id="new-color"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={colorId ?? ""}
                onChange={(e) => setColorId(e.target.value || null)}
              >
                <option value="">— renksiz —</option>
                {(colorsQ.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Yeni En (cm)" htmlFor="new-width">
              <Input
                id="new-width"
                type="number"
                min={1}
                max={1000}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="örn: 295"
              />
            </FormField>
          )}

          <FormField
            label="Sebep"
            htmlFor="change-reason"
            required
            hint="Kayda geçer — 'müşteri telefonla istedi', 'kabulde ölçüldü' gibi."
          >
            <Input
              id="change-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Neden değişiyor?"
            />
          </FormField>

          {isColor && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Renk değişikliği refakat kartını da etkiler — kart yeniden basılmalı.
                Boyahanedeki mal için ayrıca fasona haber verin.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Kaydediliyor…" : "Değiştir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
