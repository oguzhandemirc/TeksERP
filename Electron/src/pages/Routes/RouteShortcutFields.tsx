// "İş emri oluştur" kısayolu (K6): işaretli rota, seçicinin "Özel iş emirleri" satırında `shortcutOrder` sırasıyla çıkar.
// Eski backend alanı göndermez → `shortcutKnown=false`, alan gövdeye yalnız işaretlenince girer (`shortcutBody`).
import type { Control, UseFormRegister } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import type { RouteFormValues } from "./schema";

interface Props {
  control: Control<RouteFormValues>;
  register: UseFormRegister<RouteFormValues>;
}

export function RouteShortcutFields({ control, register }: Props) {
  return (
    <FormField label="İş emri kısayolu" htmlFor="shortcutOrder">
      <div className="flex h-9 items-center gap-3" data-testid="route-shortcut">
        <Controller
          control={control}
          name="isWorkOrderShortcut"
          render={({ field }) => (
            <label className="flex cursor-pointer items-center gap-2 text-sm" title="İş emri oluştur ekranında özel iş emri olarak çıkar">
              <input type="checkbox" checked={field.value === true} onChange={(e) => field.onChange(e.target.checked)} data-testid="route-shortcut-check" />
              <Zap className="h-3.5 w-3.5 text-primary" />
              Kısayol
            </label>
          )}
        />
        <Input id="shortcutOrder" type="number" min={0} step={1} className="h-9 w-20" title="Sıra (küçük önce)"
          {...register("shortcutOrder", { valueAsNumber: true })} />
      </div>
    </FormField>
  );
}

/** Gövde parçası: alan sunucuda biliniyorsa her zaman, bilinmiyorsa yalnız işaretliyse (eski backend bilinmeyen alanı reddeder). */
export function shortcutBody(v: Pick<RouteFormValues, "isWorkOrderShortcut" | "shortcutOrder" | "shortcutKnown">): { isWorkOrderShortcut?: boolean; shortcutOrder?: number } {
  if (!v.shortcutKnown && !v.isWorkOrderShortcut) return {};
  const order = Number.isFinite(v.shortcutOrder) && v.shortcutOrder >= 0 ? Math.trunc(v.shortcutOrder) : 0;
  return { isWorkOrderShortcut: v.isWorkOrderShortcut, shortcutOrder: order };
}
