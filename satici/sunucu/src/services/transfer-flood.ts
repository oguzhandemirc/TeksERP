// TAŞIMA SELİ (B1) — kimliksiz/kimlikli taşıma talebi DOĞUMUNUN tavanları. Kuyruk kalır (çıkışsız kapı yok); tavan
// yalnız YENİ talebi durdurur, var olan talebin yoklaması serbest. Sayaç bellek içi, süreç başına (hız sınırı gibi);
// bağsız bekleyen toplamı DB'den. Aşım 429 `HIZ_SINIRI` + kapsam başına pencerede TEK `TASIMA_SELI` denetim satırı
// ve güvenlik olayı (`KIMLIKSIZ_TASIMA`, kod `TAVAN_<tür>`).
import type { VendorConfig } from "../config";
import { VendorError } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import type { Tx } from "../lib/prisma";
import { securityEvent } from "../lib/security-events";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_KEYS = 10_000;
export const FLOOD_REPORT_WINDOW_MS = 10 * MINUTE_MS;

/** Sabit pencereli sayaç (sert anahtar tavanı, en eski düşer). */
class WindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Sayar; aşıldıysa kalan saniye, aşılmadıysa null. */
  hit(key: string, nowMs: number): number | null {
    const w = this.windows.get(key);
    if (!w || nowMs - w.start >= this.windowMs) {
      this.windows.delete(key);
      this.windows.set(key, { start: nowMs, count: 1 });
      for (const [k, old] of this.windows) {
        if (this.windows.size <= MAX_KEYS && nowMs - old.start < this.windowMs) break;
        this.windows.delete(k);
      }
      return null;
    }
    w.count++;
    return w.count > this.limit ? Math.max(1, Math.ceil((w.start + this.windowMs - nowMs) / 1000)) : null;
  }
}

export type FloodKind = "HEDEF_DK" | "HEDEF_GUN" | "IP_GUN" | "BAGSIZ_AZAMI";

export interface TransferFloodGuard {
  /** Yeni talep doğmadan hemen önce (kilit altında, tekrar değilse): tavan aşımı 429 atar. */
  admit(tx: Tx, g: { readonly hedef: string | null; readonly bound: boolean; readonly ip: string | null; readonly nowMs: number }): Promise<void>;
}

type Caps = Pick<VendorConfig, "TASIMA_HEDEF_DK" | "TASIMA_HEDEF_GUN" | "TASIMA_IP_GUN" | "TASIMA_BAGSIZ_AZAMI">;

export function createTransferFloodGuard(caps: Caps): TransferFloodGuard {
  const hedefDk = new WindowCounter(caps.TASIMA_HEDEF_DK, MINUTE_MS);
  const hedefGun = new WindowCounter(caps.TASIMA_HEDEF_GUN, DAY_MS);
  const ipGun = new WindowCounter(caps.TASIMA_IP_GUN, DAY_MS);
  const reported = new WindowCounter(1, FLOOD_REPORT_WINDOW_MS);

  const reject = (kind: FloodKind, scope: string, retrySec: number, nowMs: number): never => {
    if (reported.hit(`${kind}:${scope}`, nowMs) === null) void reportTransferFlood(kind, scope === "*" || scope === "ip" ? null : scope);
    throw new VendorError(429, "HIZ_SINIRI", "Çok fazla taşıma talebi; biraz sonra deneyin", { tekrarSn: retrySec });
  };

  return {
    async admit(tx, g) {
      if (g.hedef) {
        const dk = hedefDk.hit(g.hedef, g.nowMs);
        if (dk !== null) reject("HEDEF_DK", g.hedef, dk, g.nowMs);
        const gun = hedefGun.hit(g.hedef, g.nowMs);
        if (gun !== null) reject("HEDEF_GUN", g.hedef, gun, g.nowMs);
      }
      if (g.ip) {
        const gun = ipGun.hit(g.ip, g.nowMs);
        if (gun !== null) reject("IP_GUN", "ip", gun, g.nowMs);
      }
      // Bağsız bekleyenler operatör kuyruğunu doldurur; ETKİN kuruluma bağlanan talep bu tavana girmez (gerçek taşıma
      // sel sırasında da açılır — bedeli: tavan doluyken bağlı/bağsız farkı görünür, kimlik tahmin edilemez UUID).
      if (g.bound) return;
      const pending = await tx.tasimaTalebi.count({ where: { kurulumId: null, durum: "BEKLIYOR" } });
      if (pending >= caps.TASIMA_BAGSIZ_AZAMI) reject("BAGSIZ_AZAMI", "*", 3600, g.nowMs);
    },
  };
}

/** Güvenlik olayı kaydı: kapsam × pencere başına bir denetim satırı. Adres ve anahtar GİRMEZ; hedef lisans kimliği girer. */
async function reportTransferFlood(kind: FloodKind, hedef: string | null): Promise<void> {
  securityEvent("KIMLIKSIZ_TASIMA", `TAVAN_${kind}`);
  await recordAudit({ event: "TASIMA_SELI", entity: "TasimaTalebi", entityId: null, actor: "kurulum", summary: { tavan: kind, hedefKimlik: hedef } });
}
