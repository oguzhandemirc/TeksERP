// =============================================================================
// Masaüstü kanalı tercihi (N4-MOTOR geçişi) — okuma sunucu hücresinden, yazma `PUT /tercihler`e
// =============================================================================
// N3'ün `UserPreference.bildirim.masaustuTurler` anahtarı BİR SÜRÜM boyunca okunur (birleşim); ilk yazımda
// o türler tabloya taşınır, anahtar yalnız yeni kümede kalanlarla budanır (kapatılan tür geri gelmesin).
// =============================================================================
import type { NotificationPreferenceCell, NotificationPreferenceInput, NotificationPreferenceRow } from "./types";

/** Masaüstü bildirimi açık türler: sunucunun MASAUSTU çözümü ∪ eski anahtar (sıralı, tekil). */
export function desktopKinds(hucreler: readonly NotificationPreferenceCell[] | undefined, legacy: readonly string[] | undefined): string[] {
  const out = new Set(legacy ?? []);
  for (const h of hucreler ?? []) {
    if (h.kanallar.some((k) => k.kanal === "MASAUSTU" && k.durum === "ACIK")) out.add(h.kind);
  }
  return [...out].sort();
}

/**
 * Tam gövde: görünür türlerdeki diğer kanal satırları AYNEN korunur, seçicideki türlerin MASAUSTU'su yeni
 * kümeye göre yazılır. Görünmeyen türün satırı gönderilmez (sunucu 400 verir; satırı kendisi korur).
 */
export function desktopPreferenceBody(
  satirlar: readonly NotificationPreferenceRow[],
  hucreler: readonly NotificationPreferenceCell[],
  kodlar: readonly string[],
  secili: ReadonlySet<string>,
): NotificationPreferenceInput[] {
  const visible = new Set(hucreler.map((h) => h.kind));
  const desktopCapable = new Set(hucreler.filter((h) => h.kanallar.some((k) => k.kanal === "MASAUSTU")).map((h) => h.kind));
  const picker = new Set(kodlar.filter((k) => desktopCapable.has(k)));
  const body: NotificationPreferenceInput[] = satirlar
    .filter((s) => visible.has(s.tur) && !(s.kanal === "MASAUSTU" && picker.has(s.tur)))
    .map((s) => ({ tur: s.tur, kanal: s.kanal, acik: s.acik, ...(s.kapsam ? { kapsam: s.kapsam } : {}) }));
  for (const kod of [...picker].sort()) body.push({ tur: kod, kanal: "MASAUSTU", acik: secili.has(kod) });
  return body;
}
