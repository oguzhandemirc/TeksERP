// =============================================================================
// TeksERP — Zamanlanmış iş HATASININ kalıcı izi (2026-08-09, denetim F-CORE-OPS-004)
// =============================================================================
// Zamanlayıcılar (arşiv, yedek) hatalarını YALNIZCA `console.error`a yazıyordu.
// İki sonucu vardı ve ikisi de sessizdi:
//
//   1. Kalıcı defterde İZ YOK. HTTP hata yolunun aksine (error.middleware
//      SYSTEM/ERROR audit'i yazar) bir zamanlayıcı arızası SystemLog'a hiç
//      düşmüyordu. "Arşiv aylardır koşmuyor" ancak `system_logs` şişip havuza
//      baskı yapmaya başlayınca fark edilirdi — yani sebep, sonucundan aylar
//      sonra aranırdı. Geriye kalan tek iz pm2 log dosyasındaki tek satırdı ve
//      log rotasyonu kurulu değilse o da bir noktada kayboluyordu.
//
//   2. HAVUZ ZAMAN AŞIMI SAYACI eksik kalıyordu. `recordPoolTimeout` tüm kod
//      tabanında TEK yerden — error.middleware'den — çağrılıyordu, yani yalnız
//      bir HTTP isteği sırasında oluşan doygunluk `/health`in
//      `poolAcquireTimeouts` alanına düşüyordu. Gece işlerinde oluşan doygunluk
//      hiçbir metrikte görünmüyordu; oysa gece yedeği tam da havuzun en boş
//      olması beklenen saatte koşar, orada zaman aşımı almak ANLAMLI bir sinyaldir.
//
// Bu yardımcı ikisini birden yapar ve BEST-EFFORT'tur: kendi hatası çağıranı
// düşürmez (audit yazımı zaten best-effort — kök CLAUDE.md).
// =============================================================================

import { AuditService } from "../services/audit.service";
import { classifyPoolTimeout, recordPoolTimeout } from "../lib/pool-health";
import { hata } from "../lib/logger";

/**
 * Bir zamanlanmış işin başarısızlığını konsola + SystemLog'a yazar; hata bir
 * havuz zaman aşımıysa `/health` sayacını da artırır.
 *
 * @param job  İşin kısa adı — audit `recordId`sine yazılır (ör. "audit-archive").
 */
export function reportJobFailure(job: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);

  // Havuz zaman aşımıysa /health sayacına da düşsün (HTTP yolundaki davranışın aynısı).
  const kind = classifyPoolTimeout(err);
  if (kind) recordPoolTimeout(kind, `${job}: ${message}`);

  hata(job, `çalışma başarısız${kind ? ` (havuz zaman aşımı: ${kind})` : ""}`, err);

  void AuditService.logEvent({
    category: "SYSTEM",
    action: "ERROR",
    recordId: `JOB_FAILED:${job}`,
    payload: {
      job,
      message,
      poolTimeoutKind: kind ?? null,
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
    },
  });
}
