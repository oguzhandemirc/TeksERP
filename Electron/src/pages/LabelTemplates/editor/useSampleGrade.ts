// =============================================================================
// Etiket Stüdyosu — önizleme/test baskısı "örnek top kalitesi"
// =============================================================================
// Koşullu (showIf) eleman örnek topun kalitesine göre değerlendirilir. Bu seçim
// TEK YERDE yaşar ve İKİ tüketicisi vardır: canlı önizleme (CanvasPreview) ve
// Test Baskısı (TemplateTestPrintDialog). Ayrı ayrı tutulursa önizlemede görünen
// eleman test baskısında ÇIKMAZ — tasarımcı "kural bozuk" sanar (bu hook tam da
// o sapmayı kapatmak için doğdu).
//
// Koşulsuz tasarımda `qualityGrade` UNDEFINED döner → istek gövdesine hiç
// eklenmez, backend mock varsayılanını kullanır (bugünkü çıktı birebir korunur).

import { useState } from "react";
import type { LabelElement } from "@/types/label-canvas";
import { useQualityGrades } from "./useQualityGrades";
import type { QualityGrade } from "@/pages/QualityGrades/types";

/** "Kalitesi belirlenmemiş top" seçeneği — Radix Select boş string kabul etmediği
 *  için sentinel; istek gövdesine boş metin olarak gider (fail-closed senaryosu). */
export const NO_GRADE = "__none__";

export interface SampleGrade {
  grades: QualityGrade[];
  /** Tasarımda koşullu eleman var mı — seçici yalnız o zaman gösterilir. */
  hasConditions: boolean;
  /** Select'e bağlanan değer (kod ya da NO_GRADE). */
  value: string;
  setValue: (v: string) => void;
  /** İstek gövdesine giden değer: kod · "" (kalitesiz) · undefined (koşul yok). */
  qualityGrade: string | undefined;
}

export function useSampleGrade(elements: LabelElement[]): SampleGrade {
  const { grades } = useQualityGrades();
  const [choice, setChoice] = useState<string | null>(null);
  const hasConditions = elements.some((el) => el.showIf);
  const value = choice ?? grades[0]?.code ?? NO_GRADE;
  return {
    grades,
    hasConditions,
    value,
    setValue: setChoice,
    qualityGrade: hasConditions ? (value === NO_GRADE ? "" : value) : undefined,
  };
}
