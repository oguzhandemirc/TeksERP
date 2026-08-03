// =============================================================================
// Etiket Stüdyosu — kanvas lint (taşma / çakışma / taranabilirlik / degrade)
// =============================================================================
// Akış üreticilerinde çakışmayı ÜRETİCİ önlerdi; serbest kanvasta sorumluluk
// EDİTÖRDEDİR — backend basmayı reddetmez (taşanı yazıcı kırpar). Sınırlar
// estimateBounds tahminiyle: kesinlik değil erken uyarı hedeflenir.

import { useMemo } from "react";
import type { CanvasPad, LabelElement } from "@/types/label-canvas";
import { skippedLanguages } from "@/types/label-canvas";
import { conditionsMutuallyExclusive, estimateBounds, type BoundsMm } from "./canvas-model";

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
  /** Kalite kataloğundaki kodlar — koşulda geçen ÖLÜ kodu yakalamak için. Boş/eksik
   *  (katalog daha yüklenmedi) → o kontrol ATLANIR; yoksa açılışta her koşul
   *  yanlışlıkla "ölü" damgası yerdi. */
  knownGradeCodes?: string[],
): LintIssue[] {
  const codesKey = (knownGradeCodes ?? []).join("|");
  return useMemo(() => {
    const issues: LintIssue[] = [];
    const known = new Set((knownGradeCodes ?? []).map((c) => c.trim().toUpperCase()));
    // Güvenli alan = tuval − padding (padding varsa taşma buna göre uyarılır).
    const pd = canvas.pad ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const safeR = canvas.widthMm - pd.right;
    const safeB = canvas.heightMm - pd.bottom;
    const hasPad = pd.top || pd.right || pd.bottom || pd.left;

    // Okutulabilir eleman önerilir ama zorunlu DEĞİL (statik etiket — örn. yalnız
    // bakım sembolleri — kaydedilebilir; rulo/kartela atamasında kullanılamaz).
    const scannable = elements.some((e) => e.type === "qr" || e.type === "code128");
    if (elements.length > 0 && !scannable) {
      issues.push({
        level: "warn",
        elementId: null,
        message: "Okutulabilir eleman yok — şablon rulo/kartela atamalarında kullanılamaz (statik etiket)",
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
      // ÖLÜ KOŞUL: katalogda olmayan kalite kodu → koşul hiçbir topta eşleşmez ve
      // eleman SESSİZCE hiç basılmaz. Tipik sebep: kalite kodunun panelden
      // değiştirilmesi/silinmesi (şablon eski kodu taşımaya devam eder).
      if (el.showIf && known.size > 0) {
        const dead = el.showIf.values.filter((v) => !known.has(v.trim().toUpperCase()));
        if (dead.length > 0) {
          issues.push({
            level: "warn",
            elementId: el.id,
            message:
              `Koşulda katalogda olmayan kalite kodu var (${dead.join(", ")}) — ` +
              `bu kod hiçbir topta eşleşmez, eleman ` +
              (el.showIf.op === "in" ? "HİÇ basılmaz." : "koşulu daraltmaz.") +
              ` Kalite kodu değişmiş ya da silinmiş olabilir.`,
          });
        }
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
        // Koşulları birbirini dışlayan elemanlar aynı baskıda ASLA birlikte çıkmaz
        // (örn. "1. KALİTE" ve "2. KALİTE" damgaları aynı noktada) → uyarma.
        if (a && b && conditionsMutuallyExclusive(a.el.showIf, b.el.showIf)) continue;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- codesKey, knownGradeCodes dizisinin kararlı özeti
  }, [elements, canvas.widthMm, canvas.heightMm, canvas.pad, codesKey]);
}
