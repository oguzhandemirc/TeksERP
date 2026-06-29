// =============================================================================
// Bluetooth (Classic / SPP) etiket yazıcısı servisi — Argox OS-214 plus + seri
// lehimli HC-05/06. Backend'in ürettiği native komut string'ini (PPLA/PPLB/ZPL)
// eşleşmiş yazıcıya RFCOMM ile yazar.
//
// Artık ince sarmalayıcı: transport `hal/btClassic.transport`. Public API
// (isBtPrinterSupported/listBondedPrinters/testConnection/printPpla/printRaw)
// geriye dönük korunur; çağrı yerleri (LabelPrinter, BtPrinterSettingsCard) değişmez.
// =============================================================================

import {
  isBtSupported,
  listBonded,
  testConnection as halTestConnection,
  writeRaw,
  type BtBondedDevice,
} from './hal/btClassic.transport';

export type BtPrinter = BtBondedDevice;

/** Bu derlemede Bluetooth Classic native modülü mevcut mu? */
export function isBtPrinterSupported(): boolean {
  return isBtSupported();
}

/** Eşleşmiş (bonded) cihazları döner. Modül yoksa boş liste. */
export function listBondedPrinters(): Promise<BtPrinter[]> {
  return listBonded();
}

/** Eşleşmiş yazıcıya RFCOMM soketi açıp bağlantıyı doğrular — fiziksel baskı yapmaz. */
export function testConnection(address: string): Promise<void> {
  return halTestConnection(address);
}

/**
 * Native komut string'ini (PPLA/PPLB/ZPL) eşleşmiş yazıcıya yaz — dil-agnostik.
 * Cihazın diline göre içerik backend'de üretilir; burası yalnız ham baytları yazar.
 */
export function printRaw(address: string, content: string): Promise<void> {
  return printPpla(address, content);
}

/**
 * Native komut string'ini eşleşmiş yazıcıya yaz. İçerik latin1-güvenli (backend
 * asciiFold) + STX/CR kontrol baytları (<0x20) → 'latin1' encoding bayt-bire-bir korur.
 * Bayat soket halinde bir kez yeniden bağlanıp dener.
 */
export async function printPpla(address: string, content: string): Promise<void> {
  if (!content) throw new Error('Etiket verisi boş');
  await writeRaw(address, content, 'latin1', { retry: true });
}
