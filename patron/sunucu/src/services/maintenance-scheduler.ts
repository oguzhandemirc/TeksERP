// BAKIM ZAMANLAYICISI — süreç içi dakikalık tik + UTC gün başına bir kez günlük budama. İşlerin kendisi ve silme
// beyanı (`PRUNED_TABLES`) `maintenance.ts`te; bu dosya yalnız sıra ve hata yalıtımı taşır, satır silmez.
import type { CloudContext } from "./context";
import { expireClaims, IDENTITY_PURGE_DAYS, listFacilities, perFacility, prunePushBridge, purgeCentralIdentities, purgeClosedIdentities, runDaily, stripAgedIps } from "./maintenance";
import { refreshAllServiceEnds } from "./service-lifecycle";

export class MaintenanceScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastDailyDay: string | null = null;

  constructor(private readonly ctx: CloudContext) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.ctx.config.BAKIM_ARALIGI_SN * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Tek tur (bekçi saati enjekte eder). Günlük budama UTC gün başına bir kez. */
  async runOnce(nowMs: number = this.ctx.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await expireClaims(this.ctx, nowMs);
      // Köprü nonce'u her tikte: tablo nonce penceresinden (10 dk) uzun büyümesin (kimlikli sel bile günlük birikmez).
      await perFacility("merkez", "push köprüsü nonce budaması", () => prunePushBridge(this.ctx, nowMs, true));
      const service = await refreshAllServiceEnds(this.ctx, nowMs);
      let purged = 0;
      for (const f of await listFacilities(this.ctx)) {
        purged += (await perFacility(f.tesisId, "kimlik silme", () => purgeClosedIdentities(this.ctx, f.tesisId, nowMs))) ?? 0;
        await perFacility(f.tesisId, "IP alanı", () => stripAgedIps(this.ctx, f.tesisId, nowMs));
      }
      if (purged > 0) console.log(`[patron] bakım: ${purged} kapanmış hesabın kimliği silindi (Ek-6/A §2.5)`);
      const central = await purgeCentralIdentities(this.ctx, nowMs).catch((err: Error) => {
        console.error(`[patron] bakım (merkez kimlik): ${(err as { code?: string }).code ?? err.message}`);
        return { closed: 0, purged: 0 };
      });
      if (central.purged > 0) console.log(`[patron] bakım: ${central.purged} merkez kimliği silindi (kapanıştan ${IDENTITY_PURGE_DAYS} gün)`);
      const day = new Date(nowMs).toISOString().slice(0, 10);
      if (this.lastDailyDay !== day) {
        const n = await runDaily(this.ctx, nowMs);
        this.lastDailyDay = day;
        if (n > 0) console.log(`[patron] bakım: ${n} satır budandı (saklama + telemetri)`);
        // İmha insan işidir (tutanak): salt okuma süresi dolan tesis her gün hatırlatılır (Ek-6/A §4.3).
        if (service.awaitingDestruction.length > 0) console.warn(`[patron] imha bekleyen tesis (salt okuma süresi doldu — scripts/tesis.ts imha): ${service.awaitingDestruction.join(", ")}`);
      }
    } catch (err) {
      console.error(`[patron] bakım turu başarısız: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

