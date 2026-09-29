// Dakikalık bakım işi (tek süreç içinde): telemetri budaması, planlı eylemler, geciken taksitler,
// anahtar deposunun tazelenmesi. `running` koruması üst üste binmeyi engeller; her adım ayrı
// hata sınırında (biri düşerse diğerleri koşar).
//
// BUDAMA BEYANI — yaşa göre SİLİNEN tablolar yalnız bunlardır (TELEMETRİ: hiçbir iş kararı okumaz;
// bekçi: scripts/test_satici_kapilari.ts): nonce_defteri (sonKullanim geçti) · yoklama (saklama günü) ·
// portal_oturumu (bitişinden saklama günü sonra) · portal_islemi (işlem kimliği; saklama günü sonra).
import type { AnahtarTuru } from "@prisma/client";
import { KeyStore } from "../keys/key-store";
import { prisma } from "../lib/prisma";
import type { VendorContext } from "./context";
import { runDuePlannedActions, runOverdueInstallments } from "./sanction.service";

export const PRUNED_MODELS = ["nonceDefteri", "yoklama", "portalOturumu", "portalIslemi"] as const;

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

  constructor(private readonly ctx: VendorContext) {}

  start(): void {
    this.timer = setInterval(() => void this.runOnce(), this.ctx.config.BAKIM_ARALIGI_SN * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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
        ["planlı eylemler", () => runDuePlannedActions(nowMs)],
        ["geciken taksitler", () => runOverdueInstallments(nowMs)],
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
