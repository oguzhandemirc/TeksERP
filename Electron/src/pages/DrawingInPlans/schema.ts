// Tahar planı formu şeması — sunucu kapısının (drawing-in-plan.service) panel ikizi; ayrıştırıcı ortak ayna
// (`components/weave/drawing-in-plan`). Çerçeve tavanı firma ayarından (`dokuma.drawingInMaxFrames`) gelir.
import { z } from "zod";
import { DRAWING_IN_FRAMES_DEFAULT_MAX, drawingInSequenceError, parseDrawingInNotation } from "@/components/weave/drawing-in-plan";
import type { DrawingInPlan, DrawingInPlanInput } from "./types";

export function drawingInPlanSchema(maxFrames: number) {
  return z
    .object({
      name: z.string().trim().min(1, "Tahar planı adı zorunludur.").max(100, "Ad en çok 100 karakter olabilir."),
      frameCount: z
        .number({ message: "Çerçeve sayısı girin." })
        .int("Çerçeve sayısı tam sayı olmalı.")
        .min(1, "En az 1 çerçeve olmalı.")
        .max(maxFrames, `Firma ayarına göre en çok ${maxFrames} çerçeve girilebilir.`),
      notation: z.string(),
      selvedgeThreading: z.string(),
      notes: z.string().max(500, "Not en çok 500 karakter olabilir."),
    })
    .superRefine((v, ctx) => {
      const main = parseDrawingInNotation(v.notation);
      if (!main.ok) ctx.addIssue({ code: "custom", path: ["notation"], message: main.message });
      else {
        const err = drawingInSequenceError(main.sequence, v.frameCount);
        if (err) ctx.addIssue({ code: "custom", path: ["notation"], message: err });
      }
      if (v.selvedgeThreading.trim() === "") return;
      const sel = parseDrawingInNotation(v.selvedgeThreading);
      const selErr = sel.ok ? drawingInSequenceError(sel.sequence, v.frameCount, "Kenar taharı") : sel.message;
      if (selErr) ctx.addIssue({ code: "custom", path: ["selvedgeThreading"], message: selErr });
    });
}

export type DrawingInPlanFormValues = z.infer<ReturnType<typeof drawingInPlanSchema>>;

export function formDefaults(src: Partial<DrawingInPlan> | null, copy = false): DrawingInPlanFormValues {
  return {
    name: src?.name ? (copy ? `${src.name} (kopya)` : src.name) : "",
    frameCount: src?.frameCount ?? Math.min(8, DRAWING_IN_FRAMES_DEFAULT_MAX),
    notation: src?.notation ?? "",
    selvedgeThreading: src?.selvedgeThreading?.length ? src.selvedgeThreading.join("-") : "",
    notes: src?.notes ?? "",
  };
}

export function toPayload(v: DrawingInPlanFormValues): DrawingInPlanInput {
  return {
    name: v.name.trim(),
    frameCount: v.frameCount,
    notation: v.notation.trim(),
    selvedgeThreading: v.selvedgeThreading.trim(),
    notes: v.notes.trim() || null,
  };
}
