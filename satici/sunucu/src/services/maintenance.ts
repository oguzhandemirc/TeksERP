// Dakikalık bakım işi (tek süreç içinde): telemetri budaması, planlı eylemler, geciken taksitler,
// zamana bağlı bildirim taraması (giden kutusuna yazar; gönderim yan konteynerde), anahtar deposunun
// tazelenmesi. `running` koruması üst üste binmeyi engeller; her adım ayrı hata sınırında (biri düşerse
// diğerleri koşar).
//
// BUDAMA BEYANI — yaşa göre SİLİNEN tablolar yalnız bunlardır (hiçbir iş kararı okumaz; bekçi:
// scripts/test_satici_kapilari.ts): TELEMETRİ nonce_defteri (sonKullanim geçti) · yoklama (saklama günü) ·
// portal_oturumu (bitişinden saklama günü sonra) · portal_islemi (işlem kimliği; saklama günü sonra) ·
// AYAK İZİ denetim (günde bir: başarısız giriş 90 gün, diğeri 2 yıl — yönetici kararı h).
// GÖVDE BUDAMASI (satır SİLİNMEZ): dagitim_dosyasi gövdesi saklama süresi dolunca diskten silinir, satır +
// defter kalır (distribution/retention.ts BODY_PRUNED_MODELS); yarım yükleme oturumu TERK olur, parçaları silinir.
import type { AnahtarTuru } from "@prisma/client";
import { DAY_MS } from "../lisans-protokol";
import { KeyStore } from "../keys/key-store";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "./context";
import { abandonStaleSessions, pruneExpiredBodies } from "../distribution/retention";
import { scanTimedNotifications } from "../notifications/scanner";
import { runDuePlannedActions, runOverdueInstallments } from "./sanction.service";

export const PRUNED_MODELS = ["nonceDefteri", "yoklama", "portalOturumu", "portalIslemi", "denetim"] as const;

/** Kısa saklanan denetim sınıfı: başarısız/reddedilen giriş denemeleri (kaba kuvvet gürültüsü). */
export const AUDIT_FAILED_LOGIN_EVENTS = ["PORTAL_GIRIS_BASARISIZ", "PORTAL_GIRIS_REDDEDILDI"] as const;

export async function pruneExpiredNonces(nowMs: number): Promise<number> {
  const r = await prisma.nonceDefteri.deleteMany({ where: { sonKullanim: { lt: new Date(nowMs) } } });
  return r.count;
}

export async function prunePollTelemetry(nowMs: number, keepDays: number): Promise<number> {
  const r = await prisma.yoklama.deleteMany({ where: { createdAt: { lt: new Date(nowMs - keepDays * 86_400_000) } } });
  return r.count;
}

/** Bitişinin (ya da kapanışının) üstünden saklama günü geçmiş portal oturumları. */
export async function prunePortalSessions(nowMs: number, keepDays: number): Promise<number> {
  const before = new Date(nowMs - keepDays * 86_400_000);
  const r = await prisma.portalOturumu.deleteMany({ where: { OR: [{ bitis: { lt: before } }, { kapanisZamani: { lt: before } }] } });
  return r.count;
}

/** İşlem kimliği satırları: saklama günü dolunca aynı kimlikle tekrar artık beklenmez. */
export async function prunePortalActions(nowMs: number, keepDays: number): Promise<number> {
  const r = await prisma.portalIslemi.deleteMany({ where: { createdAt: { lt: new Date(nowMs - keepDays * 86_400_000) } } });
  return r.count;
}

/**
 * Denetim budaması — iki sınıf TEK tx'te (ikisi birden ya da hiçbiri): başarısız giriş satırları
 * `failedLoginKeepDays`, geri kalan her denetim satırı `keepDays` sonra silinir.
 */
export async function pruneAudit(nowMs: number, g: { failedLoginKeepDays: number; keepDays: number }): Promise<{ failedLogins: number; other: number }> {
  const [failedLogins, other] = await prisma.$transaction([
    prisma.denetim.deleteMany({
      where: { olay: { in: [...AUDIT_FAILED_LOGIN_EVENTS] }, createdAt: { lt: new Date(nowMs - g.failedLoginKeepDays * DAY_MS) } },
    }),
    prisma.denetim.deleteMany({ where: { createdAt: { lt: new Date(nowMs - g.keepDays * DAY_MS) } } }),
  ]);
  return { failedLogins: failedLogins.count, other: other.count };
}

/** Anahtar künyesi: yalnız AÇIK yarı + kid + tür + geçerlilik (özel yarı DB'ye girmez). */
export async function syncKeyRegistry(keys: KeyStore): Promise<number> {
  let n = 0;
  for (const r of keys.publicRecords()) {
    const data = {
      tur: r.kind as AnahtarTuru,
      acikAnahtar: r.x,
      siniflar: [...r.classes],
      sertifika: r.certificate,
      baslangic: r.notBefore,
      bitis: r.notAfter,
    };
    await prisma.anahtarKaydi.upsert({ where: { kid: r.kid }, create: { kid: r.kid, ...data }, update: data });
    n++;
  }
  return n;
}

export class MaintenanceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Denetim budaması günde bir (dakikalık işin içinde; süreç açılışında bir kez). */
  private lastAuditPruneMs: number | null = null;
  /** Zamana bağlı bildirim taraması `BILDIRIM_TARAMA_DK`da bir (açılışta bir kez). */
  private lastNotificationScanMs: number | null = null;

  constructor(private readonly ctx: VendorContext) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.ctx.config.BAKIM_ARALIGI_SN * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pruneAuditDaily(nowMs: number): Promise<void> {
    if (this.lastAuditPruneMs !== null && nowMs - this.lastAuditPruneMs < DAY_MS) return;
    await pruneAudit(nowMs, { failedLoginKeepDays: this.ctx.config.DENETIM_GIRIS_SAKLAMA_GUN, keepDays: this.ctx.config.DENETIM_SAKLAMA_GUN });
    this.lastAuditPruneMs = nowMs;
  }

  private async scanNotifications(nowMs: number): Promise<void> {
    const c = this.ctx.config;
    if (this.lastNotificationScanMs !== null && nowMs - this.lastNotificationScanMs < c.BILDIRIM_TARAMA_DK * 60_000) return;
    await scanTimedNotifications({ silentHours: c.BILDIRIM_SESSIZ_SAAT, dueDays: c.BILDIRIM_VADE_GUN, silentClasses: c.BILDIRIM_SESSIZ_SINIFLAR }, nowMs);
    this.lastNotificationScanMs = nowMs;
  }

  async runOnce(nowMs: number = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const steps: [string, () => Promise<unknown>][] = [
        ["nonce budaması", () => pruneExpiredNonces(nowMs)],
        ["yoklama budaması", () => prunePollTelemetry(nowMs, this.ctx.config.YOKLAMA_SAKLAMA_GUN)],
        ["portal oturumu budaması", () => prunePortalSessions(nowMs, this.ctx.config.PORTAL_OTURUM_SAKLAMA_GUN)],
        ["portal işlem kimliği budaması", () => prunePortalActions(nowMs, this.ctx.config.PORTAL_ISLEM_SAKLAMA_GUN)],
        ["denetim budaması", () => this.pruneAuditDaily(nowMs)],
        ["dağıtım gövde budaması", () => pruneExpiredBodies(this.ctx.config, nowMs)],
        ["yarım yükleme temizliği", () => abandonStaleSessions(this.ctx.config, nowMs)],
        ["planlı eylemler", () => runDuePlannedActions(nowMs)],
        ["geciken taksitler", () => runOverdueInstallments(nowMs)],
        ["bildirim taraması", () => this.scanNotifications(nowMs)],
        [
          "anahtar deposu",
          async () => {
            this.ctx.keys = KeyStore.load(this.ctx.config, nowMs);
            await syncKeyRegistry(this.ctx.keys);
          },
        ],
      ];
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (err) {
          console.error(`[satici] bakım adımı düştü (${name}): ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
