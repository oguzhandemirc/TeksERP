import type { RollStatus } from "@/types/enums";

// Backend qgTargetEnum ile aynı küme (quality-grade.routes.ts) — STOCK dahil:
// ham (renksiz) kesimde "üretime devam" hedefi. Eksik üye boş Badge basıyordu.
export type QualityTargetStatus = Extract<
  RollStatus,
  "WAREHOUSE" | "A1_STOCK" | "STOCK" | "SCRAP"
>;

/**
 * Kalite kataloğu satırının ÜRETİM ROLÜ — backend `enum QualityGradeRole`in
 * aynası (schema.prisma). Rol başına EN FAZLA BİR AKTİF satır (partial unique).
 */
export type QualityGradeRole = "FIRST" | "SECOND" | "SCRAP";

export interface QualityGrade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  targetStatus: QualityTargetStatus;
  /**
   * ÜRETİM ROLÜ (2026-09-13, karar ①) — "aksiyon '1./2./fire' dediğinde hangi
   * satır yazılır". `targetStatus` ile KARIŞTIRILMAZ: o "hangi rafa iner"
   * (kova) sorusunu cevaplar. Bu fabrikada `A1`in targetStatus'u WAREHOUSE
   * ama rolü SECOND'dır — iki soru, iki alan. Rozet rengi ÜÇÜNCÜ sorudur ve
   * `color`dan okunur.
   * ⚠️ Eski sunucuda alan YOK → optional; okuyan taraf `null`da kendi kararını
   * verir (panel bir OKUMA yüzeyi; fail-closed sunucudadır).
   */
  role?: QualityGradeRole | null;
  /** Bu kalitedeki top OTOMATİK etiket ALMAZ (sahada FİRE). Katalogdan gelir;
   *  `scrapGradeLabelEnabled` ayarı AÇIKSA yok sayılır (iki kapı).
   *  Eski sunucuda alan YOK → optional; okurken `=== true` ile daralt. */
  skipLabel?: boolean;
  createdAt: string;
  updatedAt: string;
}
