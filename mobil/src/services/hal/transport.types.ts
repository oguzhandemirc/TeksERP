// =============================================================================
// HAL — Donanım Soyutlama Katmanı sözleşmeleri (mobil tarafı).
// Bir saha cihazı iki dik eksenle tanımlanır:
//   • DeviceTransport — cihaza NASIL ulaşılır (BT-Classic / TCP / BLE / USB / Serial).
//   • DeviceCodec<T>  — gelen/giden ham veri NASIL anlamlandırılır (yazıcı=yaz-only;
//                       metre/kantar=ham metni sayıya çöz).
// Aynı sözleşme backend'de de var (Teks-Erp/src/services/helpers/device-transport.ts).
// =============================================================================

export interface ReadOptions {
  /**
   * Okuma davranışı:
   *  • 'POLL' (varsayılan) — `pollCommand`'ı yaz, cevabı oku (Tambur metresi "TTTTTT").
   *  • 'STREAM'            — komut YOLLAMA; cihaz sürekli yayınlar, son kararlı
   *                          çerçeveyi al (Sevkiyat kantarı sürekli kg akıtır).
   */
  readMode?: 'POLL' | 'STREAM';
  /** POLL'de cihaza yollanacak sorgu komutu (TAM gönderilir; escape destekli: \r \n \xNN). */
  pollCommand?: string;
  /** Çerçeveyi (satırı) bitiren ayraç (varsayılan: herhangi CR/LF). */
  terminator?: string;
  /** Yanıt için bekleme süresi (ms). */
  timeoutMs?: number;
  /**
   * Değer çerçevesi regex'i — çok satırlı/gürültülü akışta HANGİ satırın geçerli
   * olduğunu belirler (ör. `(\d+(?:\.\d+)?)B` → yalnız "sabit" satır). Verilirse
   * transport bu desene uyan SON çerçeveyi döndürür; boşsa son tam çerçeveyi.
   */
  framePattern?: string;
}

export interface DeviceTransport {
  /** Bağlantıyı doğrula (yazma/okuma yapmaz). */
  test(): Promise<void>;
  /** Ham içerik yaz (yazıcı). latin1 = native komut baytları, ascii = sorgu komutu. */
  write(content: string, encoding?: 'latin1' | 'ascii'): Promise<void>;
  /** İstek-cevap oku (metre/kantar) — ham metin döner; anlamlandırma codec'in işi. */
  read(opts?: ReadOptions): Promise<string>;
}

export interface DeviceCodec<T> {
  /** Değeri cihaza yazılacak string'e çevir (yazıcı tarafı backend'de render edilir). */
  encode?(value: unknown): string;
  /** Cihazdan gelen ham metni anlamlı değere çöz; çözülemezse null. */
  decode(raw: string): T | null;
}
