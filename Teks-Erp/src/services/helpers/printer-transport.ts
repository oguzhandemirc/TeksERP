// =============================================================================
// Yazıcı transport — native komutların yazıcıya GÖNDERİMİ (FAZ-1 SİMÜLE)
// =============================================================================
// Faz-1 kuralı (CLAUDE.md): "COM port / donanım entegrasyonları sadece simüle
// edilir." Bu modül gerçek socket(9100)/USB/COM AÇMAZ — sadece "ne, nereye, kaç
// bayt" özetini döner (mobil/hardware.service.ts random-değer simülasyon kalıbıyla
// aynı felsefe). RASTER_HTML fiziksel baskı OS-sürücüyle (Electron iframe / mobil
// expo-print) yapılır; bu transport native diller (PPLA/ZPL) içindir.
//
// FAZ-2: gerçek `net.Socket` / USB yazısı buraya takılır; imza değişmeden.
// =============================================================================

import { PrinterLanguage } from "@prisma/client";

export interface PrinterTransportResult {
  /** Faz-1'de daima false — gerçek gönderim yok. */
  delivered: boolean;
  /** Faz-1'de daima true. */
  simulated: boolean;
  language: PrinterLanguage;
  bytes: number;
  /** "ip:port" veya bağlı değilse açıklama. */
  target: string;
  note: string;
}

export function simulateNativeSend(
  content: string,
  opts: { language: PrinterLanguage; printerIp?: string | null; port?: number },
): PrinterTransportResult {
  const target = opts.printerIp
    ? `${opts.printerIp}:${opts.port ?? 9100}`
    : "(yazıcı IP'si tanımsız)";
  return {
    delivered: false,
    simulated: true,
    language: opts.language,
    bytes: Buffer.byteLength(content, "utf8"),
    target,
    note: "Faz-1 simülasyon — fiziksel baskı HTML+OS sürücüyle; native ham-gönderim Faz-2.",
  };
}
