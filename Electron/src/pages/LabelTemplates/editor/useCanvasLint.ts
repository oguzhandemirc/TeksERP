// =============================================================================
// Etiket Stüdyosu — kanvas lint (taşma / çakışma / taranabilirlik / degrade)
// =============================================================================
// Akış üreticilerinde çakışmayı ÜRETİCİ önlerdi; serbest kanvasta sorumluluk
// EDİTÖRDEDİR — backend basmayı reddetmez (taşanı yazıcı kırpar). Sınırlar
// estimateBounds tahminiyle: kesinlik değil erken uyarı hedeflenir.

import { useMemo } from "react";
import type { CanvasPad, LabelElement } from "@/types/label-canvas";
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
  canvas: { widthMm: number; heightMm: number; pad?: CanvasPad },
): LintIssue[] {
  return useMemo(() => {
    const issues: LintIssue[] = [];
    // Güvenli alan = tuval − padding (padding varsa taşma buna göre uyarılır).
    const pd = canvas.pad ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const safeR = canvas.widthMm - pd.right;
    const safeB = canvas.heightMm - pd.bottom;
    const hasPad = pd.top || pd.right || pd.bottom || pd.left;

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
      // Güvenli-alan taşması (padding varsa kenar boşluğunu, yoksa tuvali aşma)
      if (b.x + b.w > safeR + 0.6 || b.y + b.h > safeB + 0.6 || b.x < pd.left - 0.6 || b.y < pd.top - 0.6) {
        issues.push({
          level: "warn",
          elementId: el.id,
          message: hasPad
            ? `Eleman güvenli alanı (padding) taşıyor — kenar boşluğunun içinde kalmalı.`
            : `Eleman tuvali taşıyor (~${Math.round(b.x + b.w)}×${Math.round(b.y + b.h)}mm > ${canvas.widthMm}×${canvas.heightMm}mm) — yazıcı taşan kısmı kırpar.`,
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
  }, [elements, canvas.widthMm, canvas.heightMm, canvas.pad]);
}
