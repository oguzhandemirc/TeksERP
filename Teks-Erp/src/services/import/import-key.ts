// =============================================================================
// İçe aktarım KOD ANAHTARI — yazan ↔ okuyan TEK katlama
// =============================================================================
// Adaptörlerin `findExisting` haritası (okuyan) ile `import.service`in satır
// anahtarı (yazan) aynı fonksiyondan geçer. Kod bir KİMLİKTİR: Türkçe katlama
// (`upperTr`) "sip" → "SİP" üretir ve DB'deki "SIP" ile eşleşmez — sayfadaki
// küçük harfli kod, aynı kaydı bulamayıp ikinci kayıt doğururdu. Fabrika
// kopyasında ölçüldü (2026-09-14): iki katlamada anahtarı farklı düşen kod 2,
// çarpışma 0 ⇒ geçiş hiçbir anahtarı birleştirmez, yalnız i/İ deliğini kapatır.
import { foldCodeForCompare } from "../../utils/code-format";

/** İçe aktarım kod anahtarı — `foldCodeForCompare`ın adı konmuş hâli. */
export function importKey(code: string): string {
  return foldCodeForCompare(code);
}
