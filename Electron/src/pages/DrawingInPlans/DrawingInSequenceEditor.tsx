// Tahar dizisi girişi: 1..N çerçeve düğmeleri + kısaltmalı yazım kutusu, ikisi senkron.
// Kaydedilen değer metindir (sunucu açar); düğme metni ayrıştırıp sona tel ekler ve `compressDrawingIn` ile yeniden yazar.
import type { UseFormReturn } from "react-hook-form";
import { Delete, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { compressDrawingIn, drawingInRepeatUnit, parseDrawingInNotation } from "@/components/weave/drawing-in-plan";
import type { DrawingInPlanFormValues } from "./schema";

/** Düğmeyle sona çerçeve ekler; yazım bozuksa metne dokunmadan sona ekler (kullanıcının yazdığı silinmez). */
export function appendFrame(notation: string, frame: number): string {
  if (notation.trim() === "") return String(frame);
  const r = parseDrawingInNotation(notation);
  return r.ok ? compressDrawingIn([...r.sequence, frame]) : `${notation.trimEnd()} ${frame}`;
}

/** Son teli siler; yazım bozuksa metin aynen kalır. */
export function removeLastFrame(notation: string): string {
  const r = parseDrawingInNotation(notation);
  return r.ok ? compressDrawingIn(r.sequence.slice(0, -1)) : notation;
}

export function DrawingInSequenceEditor({ form }: { form: UseFormReturn<DrawingInPlanFormValues> }) {
  const notation = form.watch("notation");
  const frameCount = form.watch("frameCount");
  const frames = Number.isInteger(frameCount) && frameCount > 0 ? Math.min(frameCount, 16) : 0;
  const parsed = parseDrawingInNotation(notation);
  const set = (v: string) => form.setValue("notation", v, { shouldDirty: true, shouldValidate: true });
  const summary = parsed.ok ? `${parsed.sequence.length} tel · tekrar birimi ${drawingInRepeatUnit(parsed.sequence).length} tel` : null;
  return (
    <FormField
      label="Tahar dizisi"
      required
      htmlFor="dip-notation"
      error={form.formState.errors.notation}
      hint={summary ?? undefined}
      info="Her çözgü telinin hangi çerçeveden geçtiğini tel sırasıyla yazın. Düğmeye basmak sona bir tel ekler. Kısaltma: 3x(1-2-3-4) 5-6 → 1-2-3-4 üç kez, ardından 5 ve 6."
    >
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Çerçeve düğmeleri">
          {Array.from({ length: frames }, (_, i) => i + 1).map((f) => (
            <Button key={f} type="button" size="sm" variant="outline" className="h-9 w-9 p-0 font-mono" onClick={() => set(appendFrame(notation, f))}>
              {f}
            </Button>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => set(removeLastFrame(notation))} disabled={!parsed.ok}>
            <Delete className="mr-1 h-4 w-4" />Son teli sil
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => set("")} disabled={notation === ""}>
            <Eraser className="mr-1 h-4 w-4" />Temizle
          </Button>
        </div>
        <Input id="dip-notation" className="font-mono" maxLength={500} placeholder="3x(1-2-3-4) 5-6" {...form.register("notation")} />
      </div>
    </FormField>
  );
}
