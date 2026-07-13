// =============================================================================
// Yazıcı transport — native komutların yazıcıya gönderimi
// =============================================================================
// FAZ-1 (varsayılan): GÖNDERME SİMÜLE — global ayar `label.nativeSendEnabled`
// KAPALI iken hiçbir socket açılmaz, sadece "ne, nereye, kaç bayt" özeti döner
// (CLAUDE.md "donanım sadece simüle" kuralı korunur).
//
// FAZ-2 (opt-in): ayar AÇIK + hedef yazıcı IP'si varsa → backend RAW TCP (port 9100)
// ile PPLA/ZPL baytlarını DOĞRUDAN yazıcıya gönderir. Backend fabrika LAN'ındadır,
// yazıcıya ulaşır; tablet/Electron sadece tetikler. Default kapalı olduğu için
// hiç yapılandırılmamış kurulumlar Faz-1 davranışında kalır.
//
// Doğrulama: localhost sahte TCP dinleyiciyle bağlantı + bayt doğrulanır
// (scripts/test_printer_transport.ts). Fiziksel baskı sahada gerçek Argox ile teyit.
// =============================================================================

import { PrinterLanguage } from "@prisma/client";
import { sendOverTcp, DEFAULT_TCP_PORT, DEFAULT_TIMEOUT_MS } from "./device-transport";

export interface PrinterTransportResult {
  /** Gerçekten yazıcıya yazıldı mı (Faz-2, ayar açık + IP var + bağlantı OK). */
  delivered: boolean;
  /** Faz-1 simülasyon mu (ayar kapalı). */
  simulated: boolean;
  language: PrinterLanguage;
  bytes: number;
  /** "ip:port" veya açıklama. */
  target: string;
  /** Gönderim hatası (bağlantı/zaman aşımı) — varsa. */
  error?: string;
  note: string;
}

const DEFAULT_PORT = DEFAULT_TCP_PORT;

/**
 * Native komut gönderimini yönet — Faz-1 simüle / Faz-2 gerçek.
 * `enabled=false` (default) → simülasyon (hiç socket yok). `enabled=true` + host → RAW TCP.
 */
export async function dispatchNativeSend(
  content: string | Buffer,
  opts: {
    language: PrinterLanguage;
    enabled: boolean;
    printerIp?: string | null;
    port?: number;
    timeoutMs?: number;
  },
): Promise<PrinterTransportResult> {
  const port = opts.port ?? DEFAULT_PORT;
  const bytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "latin1");

  // FAZ-1 / opt-out → simüle (socket açma)
  if (!opts.enabled) {
    return {
      delivered: false,
      simulated: true,
      language: opts.language,
      bytes,
      target: opts.printerIp ? `${opts.printerIp}:${port}` : "(yazıcı IP'si tanımsız)",
      note: "Simülasyon (label.nativeSendEnabled kapalı) — fiziksel baskı HTML+OS sürücüyle.",
    };
  }

  // FAZ-2 açık ama IP yok → gönderemez
  if (!opts.printerIp) {
    return {
      delivered: false,
      simulated: false,
      language: opts.language,
      bytes,
      target: "(yazıcı IP'si tanımsız)",
      error: "Hedef yazıcı IP'si tanımlı değil (Makine Donanımı → Yazıcı IP).",
      note: "Gönderilemedi.",
    };
  }

  // FAZ-2 gerçek gönderim
  try {
    const sent = await sendOverTcp(content, opts.printerIp, port, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return {
      delivered: true,
      simulated: false,
      language: opts.language,
      bytes: sent,
      target: `${opts.printerIp}:${port}`,
      note: "Yazıcıya gönderildi.",
    };
  } catch (e) {
    return {
      delivered: false,
      simulated: false,
      language: opts.language,
      bytes,
      target: `${opts.printerIp}:${port}`,
      error: e instanceof Error ? e.message : String(e),
      note: "Gönderim hatası.",
    };
  }
}
