// D8 "şimdi eşitle" kuyruğu — bulutun `rapor/al` yanıtındaki işaret buraya düşer, eşitleme işi tıkta/zilde boşaltır.
// Tur koşumu işin kendi bağımlılıklarıyla (tek uçuş `exclusive`, ön koşul); burada yalnız aralık + kapsam durumu tutulur.
import type { SyncNowScope } from "../cloud-sync/report-requests";

/** İki istek turu arası en az (bulut da 60 sn'de birden fazla işaret açmaz). */
export const SYNC_NOW_GAP_MS = 60 * 1000;
/** TAM istekte uzlaştırma turu en çok bu aralıkla (bulut seddi 15 dk; fabrika kendi seddini ayrıca tutar). */
export const SYNC_NOW_FULL_GAP_MS = 15 * 60 * 1000;

export interface SyncNowDeps {
  readonly now: () => number;
  /** Ön koşul (fail-closed): kapalıysa istek DÜŞER, dışarı istek atılmaz. */
  readonly eligible: (t: number) => boolean;
  readonly exclusive: (fn: () => Promise<void>) => Promise<void>;
  /** Tek tur koşar; HATA değilse true. */
  readonly round: (kind: "ARTIMLI" | "UZLASTIRMA", t: number) => Promise<boolean>;
}

export interface SyncNowQueue {
  /** Bekleyen TAM, KISMI ile küçülmez. Asla atmaz. */
  trigger(scope: SyncNowScope): void;
  /** Bekleyeni koşar: 60 sn içinde ikinci istek DÜŞER; KISMI = artımlı tur, TAM = + uzlaştırma (15 dk'da bir). */
  drain(): Promise<void>;
  reset(): void;
}

export function createSyncNowQueue(d: SyncNowDeps): SyncNowQueue {
  let pending: SyncNowScope | null = null;
  let lastAt = 0;
  let lastFullAt = 0;
  return {
    trigger(scope) {
      pending = pending === "TAM" ? "TAM" : scope;
    },
    async drain() {
      const scope = pending;
      if (!scope) return;
      pending = null;
      const t = d.now();
      if (t - lastAt < SYNC_NOW_GAP_MS || !d.eligible(t)) return;
      lastAt = t;
      await d.exclusive(async () => {
        const ok = await d.round("ARTIMLI", t);
        if (scope === "TAM" && ok && t - lastFullAt >= SYNC_NOW_FULL_GAP_MS) {
          lastFullAt = t;
          await d.round("UZLASTIRMA", t);
        }
      });
    },
    reset() {
      pending = null;
      lastAt = 0;
      lastFullAt = 0;
    },
  };
}
