// =============================================================================
// Etiket Stüdyosu — kanvas lint (taşma / çakışma / taranabilirlik / degrade)
// =============================================================================
// Akış üreticilerinde çakışmayı ÜRETİCİ önlerdi; serbest kanvasta sorumluluk
// EDİTÖRDEDİR — backend basmayı reddetmez (taşanı yazıcı kırpar). Sınırlar
// estimateBounds tahminiyle: kesinlik değil erken uyarı hedeflenir.

import { useMemo } from "react";
import type { LabelElement } from "@/types/label-canvas";
import { skippedLanguages } from "@/types/label-canvas";
import { estimateBounds, type BoundsMm } from "./canvas-model";

export type LintLevel = "error" | "warn" | "info";

export interface LintIssue {
  level: LintLevel;
  elementId: string | null;
  message: string;
}

function overlaps(a: BoundsMm, b: BoundsMm): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function useCanvasLint(
  elements: LabelElement[],
  canvas: { widthMm: number; heightMm: number },
): LintIssue[] {
  return useMemo(() => {
    const issues: LintIssue[] = [];

    // Taranabilir alan zorunlu (backend kaydetmeyi reddeder — erken söyle).
    const scannable = elements.some((e) => e.type === "qr" || e.type === "code128");
    if (elements.length > 0 && !scannable) {
      issues.push({
        level: "error",
        elementId: null,
        message: "Barkod (Code128) veya QR elemanı yok — taranabilir alan zorunlu, kaydedilemez.",
      });
    }

    const bounds = elements.map((el) => ({ el, b: estimateBounds(el, canvas) }));

    for (const { el, b } of bounds) {
      // Tuval taşması
      if (b.x + b.w > canvas.widthMm + 0.6 || b.y + b.h > canvas.heightMm + 0.6) {
        issues.push({
          level: "warn",
          elementId: el.id,
          message: `Eleman tuvali taşıyor (~${Math.round(b.x + b.w)}×${Math.round(b.y + b.h)}mm > ${canvas.widthMm}×${canvas.heightMm}mm) — yazıcı taşan kısmı kırpar.`,
        });
      }
      // Dil degrade bilgisi
      const skipped = skippedLanguages(el.type);
      if (skipped.length > 0) {
        issues.push({
          level: "info",
          elementId: el.id,
          message: `Bu eleman ${skipped.join(", ")} dilinde BASILMAZ (yazıcı desteği yok).`,
        });
      }
    }

    // İkili çakışma (tahmini kutularla; metin genişliği yaklaşıktır)
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i];
        const b = bounds[j];
        if (a && b && overlaps(a.b, b.b)) {
          issues.push({
            level: "warn",
            elementId: b.el.id,
            message: `Olası üst üste binme: ${a.el.id} ↔ ${b.el.id} (tahmini — kesin görünüm backend önizlemesinde).`,
          });
        }
      }
    }

    return issues;
  }, [elements, canvas.widthMm, canvas.heightMm]);
}
