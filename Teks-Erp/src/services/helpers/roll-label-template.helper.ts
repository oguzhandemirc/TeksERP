// =============================================================================
// Topun bir seferlik şablonu bu basımda uygulanır mı — TEK yüklem (çoklu etiket K3, 2026-11-11)
// =============================================================================
// Seçim, seçildiği bağlamın (`labelTemplateKind`) etiketine aittir: aşama RAW→FINISHED değişince ham etiket için
// seçilen şablon bitmiş etikette UYGULANMAZ → bağlamın varsayılanına döner. `labelTemplateKind` null = bu iş öncesi
// kayıt ya da taslak → bugünkü davranış (her bağlamda uygulanır). Tekil, toplu ve basım izi aynı yüklemi çağırır.
// =============================================================================
import type { LabelKind } from "@prisma/client";

export function rollTemplateApplies(
  roll: { labelTemplateId: string | null | undefined; labelTemplateKind: LabelKind | null | undefined },
  kind: LabelKind,
): boolean {
  return roll.labelTemplateId != null && (roll.labelTemplateKind == null || roll.labelTemplateKind === kind);
}

/** Payload'tan uygulanan bir seferlik şablon id'si (yoksa undefined) — render kind'ı bilinen her çağıran. */
export function appliedRollTemplateId(
  payload: { rollLabelTemplateId?: string; rollLabelTemplateKind?: LabelKind | null },
  kind: LabelKind,
): string | undefined {
  const applies = rollTemplateApplies({ labelTemplateId: payload.rollLabelTemplateId, labelTemplateKind: payload.rollLabelTemplateKind }, kind);
  return applies ? payload.rollLabelTemplateId : undefined;
}
