// =============================================================================
// K20 — TOHUM METNİNİN GÜNCEL REJİMLE OKUNMASI (QA 2026-11-03)
// =============================================================================
// Katalog satırları (izin açıklaması, rol şablonu adı/açıklaması) DB'ye bir kez yazılır ve uzlaştırma onları EZMEZ
// ("yalnız ekle"). Rejim (dokuma açık/kapalı) sonradan değişince ya da satır K20'den önce yazıldıysa ekran
// "Terbiye İş Emri" okumaya devam ediyordu. Okuma anında: saklı metin katalog metninin İKİ rejim biçiminden birine
// BAYT-EŞİTSE (dokunulmamış tohum) güncel rejim metni gösterilir; elle düzeltilmiş metin aynen kalır. DB'ye yazılmaz.
// =============================================================================
import { terimDokumaAyarla, terimDokumaRejimi } from "../../constants/terim";
import { PERMISSION_CATALOG, type PermissionCatalogEntry } from "../../constants/permission-catalog";

/** Getter'lı katalog metnini iki rejimde okur (eşzamanlı; araya await girmez → süreç rejimi bozulmaz). */
export function readInBothRegimes(read: () => string | null | undefined): Array<string | null | undefined> {
  const previous = terimDokumaRejimi();
  try {
    terimDokumaAyarla(true);
    const whenOn = read();
    terimDokumaAyarla(false);
    const whenOff = read();
    return [whenOn, whenOff];
  } finally {
    terimDokumaAyarla(previous);
  }
}

/**
 * Saklı metin tohumun bir rejim biçimiyse (ya da `legacySeeds`dan biriyse) güncel biçim; değilse (fabrika düzeltmiş /
 * katalogda yok) saklı metin.
 */
export function currentSeedText(stored: string | null, read: (() => string | null | undefined) | undefined, legacySeeds: readonly string[] = []): string | null {
  if (stored === null || !read) return stored;
  return readInBothRegimes(read).includes(stored) || legacySeeds.includes(stored) ? (read() ?? stored) : stored;
}

/** Katalogda metni sonradan düzeltilmiş izinlerin ESKİ tohum metinleri — dokunulmamış satır yeni metinle okunur. */
const LEGACY_PERMISSION_SEEDS: Readonly<Record<string, readonly string[]>> = {
  // 2026-11-03: ekranın adı "Fason Tarifeleri"; "terbiye tarifesi" rejimden bağımsız sabit yazılmıştı.
  "cost:write": ["Ürün maliyet yapısı, iplik maliyet fiyatı, terbiye tarifesi, makine saat ücreti ve hizmet sarf normu yazma"],
};

/** İzin açıklamasının güncel okuması (saklı → tohumsa katalogun güncel metni). */
export function currentPermissionDescription(code: string, stored: string | null): string | null {
  return currentSeedText(stored, permissionCatalogText(code), LEGACY_PERMISSION_SEEDS[code]);
}

/** İzin kodunun katalog açıklama okuyucusu (getter her çağrıda güncel rejimle çözülür); katalog dışı kod → undefined. */
export function permissionCatalogText(code: string): (() => string | undefined) | undefined {
  const entry = (PERMISSION_CATALOG as readonly PermissionCatalogEntry[]).find((p) => p.code === code);
  return entry ? () => entry.description : undefined;
}
