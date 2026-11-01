// Top detayını "Aç" kapısı — yalnız istemci süzgeci; çözümü backend tarama çözücüsü verir
// (`roll-scan-resolve.helper.ts`: önce iç barkod, ayar açıksa müşteri kodu, belirsizlikte 409).
import { classifyBarcode, matchesFullFormat } from "./barcode-kind";

/** Müşteri kodu serisizdir (ör. HH-2611-00001): boşluksuz, en az bir rakam, 4–64 karakter. Kumaş adı ("TÜL BEYAZ") geçmez. */
const CUSTOMER_CODE_SHAPE = /^(?=.*\d)\S{4,64}$/;

/**
 * Tam biçimli top barkodu HER ZAMAN açılır. Müşteri kodu yalnız `scan.customerCodeLookup`
 * açıkken ve kod bilinen hiçbir seriye (çuval, sevk …) benzemiyorsa denenir.
 */
export function canOpenRollDetail(code: string, customerCodeLookup: boolean): boolean {
  const classified = classifyBarcode(code);
  if (matchesFullFormat("ROLL", classified.code)) return true;
  if (!customerCodeLookup || classified.kind !== "UNKNOWN") return false;
  return CUSTOMER_CODE_SHAPE.test(code.trim());
}
