// =============================================================================
// Audit (denetim) etiketleri — TEK KAYNAK.
// -----------------------------------------------------------------------------
// Backend audit kayıtları ham İngilizce tutar (tableName, action, oldData/newData
// alan adları + enum değerleri). Kullanıcıya gösterirken burada Türkçeleştirilir.
// Hem "Aktivite Günlüğü" (System/Activity) hem "Denetim Raporları" (Reports/Audit)
// bu haritalardan besleniyor — iki ayrı harita drift ederdi, artık tek kaynak.
//
// Bilinmeyen anahtar/enum → ham değer geri döner (yeni tablo eklenince ekranda
// görünür, sessizce kaybolmaz; buraya eklemek yeterli).
//
// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-25 — KONU BAŞINA TEK SÖZLÜK. Önceden alan adları için burada İKİNCİ
// bir `FIELD_LABELS` haritası vardı (ham veri bloğu onu, "Ne değişti" listesi
// `audit-field-labels`i kullanıyordu) → aynı çekmecede iki dil. Artık:
//   • alan adı  → `audit-field-labels.ts` (backend aynası)   ← buradan RE-EXPORT
//   • modül adı → TABLE_LABELS            (`audit-tablo-etiketleri.ts`, backend aynası)
//   • olay adı  → EVENT_ACTION_LABELS     (`audit-tablo-etiketleri.ts`)  ← Sistem Kayıtları + Denetim Raporları
//   • değerler  → ENUM_LABELS             (`audit-enum-etiketleri.ts`, backend aynası)
// `Teks-Erp/scripts/test_audit_labels.ts` backend'in bastığı HER tableName ve
// HER sistem olayının burada karşılığı olduğunu mekanik doğrular (KIRMIZI).
// =============================================================================

// 2026-10-25 (B2): modül/olay/değer sözlükleri backend'e taşındı (anlatıcı orada
// cümle kurar); burası yalnız aynaları yeniden dışa aktarır + biçimlendiricileri tutar.

import { parseISO, isValid } from "date-fns";
import { formatFactory } from "@/lib/factory-time";
import { enumValueLabel, type EnumLabelContext } from "./audit-enum-etiketleri";

export { TABLE_LABELS, tableLabel, EVENT_ACTION_LABELS, eventActionLabel } from "./audit-tablo-etiketleri";
export { ENUM_LABELS, SHARED_ENUM_VALUES, enumValueLabel } from "./audit-enum-etiketleri";
export type { EnumLabelContext } from "./audit-enum-etiketleri";


// Alan adı sözlüğü BURADA DEĞİL — `audit-field-labels.ts` (backend aynası).
// `fieldLabel` eski çağrı noktalarını bozmamak için korunan takma addır.
export { AUDIT_FIELD_LABELS, auditFieldLabel } from "./audit-field-labels";
// Takma ad (merge, 2026-09-01): ticaret bekçisi (`audit-labels.trade.test.ts`)
// sözlüğü bu adla import ediyor. İKİNCİ BİR SÖZLÜK DEĞİL — aynı nesne.
export { AUDIT_FIELD_LABELS as FIELD_LABELS } from "./audit-field-labels";
export { auditFieldLabel as fieldLabel } from "./audit-field-labels";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Bir audit alan değerini kullanıcıya okunur Türkçe metne çevirir:
 * null→"—", boolean→Evet/Hayır, ISO tarih→gg.AA.yyyy SS:dd, enum→Türkçe, aksi ham.
 * Nesne/dizi burada ele alınmaz (çağıran taraf ham JSON'a düşer).
 */
export function formatAuditValue(value: unknown, ctx?: EnumLabelContext): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const d = parseISO(value);
      if (isValid(d)) return formatFactory(d, "dd.MM.yyyy HH:mm");
    }
    // ⚠️ Bağlam VARSA alan-kapsamlı katmandan geçer (çelişen enum değerleri);
    // yoksa bugünkü davranış birebir korunur.
    return enumValueLabel(value, ctx);
  }
  return String(value);
}

/**
 * "Ne değişti" satırının değer biçimlendiricisi (eski→yeni).
 *
 * ⚠️ `formatAuditValue`'dan farkı UZUNLUK KIRPMASI ve nesne davranışıdır: diff
 * satırı tek satırda iki değer taşır, ham JSON oraya sığmaz — ham blok zaten
 * hemen altta duruyor. Enum çevirisi İKİSİNDE DE aynı sözlükten gelir; eskiden
 * bu fonksiyon `String(v)` diyordu ve aynı çekmecede ham blok **Depoda** derken
 * diff satırı **WAREHOUSE** diyordu.
 */
export function auditValueText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return "(içerik)";
  if (typeof v === "boolean") return v ? "Evet" : "Hayır";
  const s = formatAuditValue(v);
  // Uzun metin satırı taşırmasın; tam değer title'da gösterilir.
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}
