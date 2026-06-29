// =============================================================================
// HAL — Donanım Soyutlama Katmanı sözleşmeleri (mobil tarafı).
// Bir saha cihazı iki dik eksenle tanımlanır:
//   • DeviceTransport — cihaza NASIL ulaşılır (BT-Classic / TCP / BLE / USB / Serial).
//   • DeviceCodec<T>  — gelen/giden ham veri NASIL anlamlandırılır (yazıcı=yaz-only;
//                       metre/kantar=ham metni sayıya çöz).
// Aynı sözleşme backend'de de var (Teks-Erp/src/services/helpers/device-transport.ts).
// =============================================================================

export interface ReadOptions {
  /** İstek-cevap protokolünde cihaza yollanacak sorgu komutu (boş = sadece dinle). */
  pollCommand?: string;
  /** Yanıtın bittiğini gösteren satır sonu (varsayılan: herhangi CR/LF). */
  terminator?: string;
  /** Yanıt için bekleme süresi (ms). */
  timeoutMs?: number;
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
