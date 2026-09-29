// KAPI ZİLİ (bulut → fabrika): hesap gelen kutusuna ya da rapor isteğine yazınca fabrikaya "şimdi
// çek" denir. Zil İÇERİK TAŞIMAZ ve satıcının SSE kanalından gider (sözleşme §2) — bulut satıcı iç
// API'sine yalnız {tesisId, konu} bildirir. Zil kaçarsa fabrika her eşitleme turunda yine yoklar ⇒
// zil best-effort'tur: hata günlüğe düşer, isteği BOZMAZ. `kayit` kipinde satıcı bağı yok → sessiz.
import type { CloudConfig } from "../config";

export type DoorbellTopic = "gelen-kutusu" | "rapor" | "ozet";

export interface Doorbell {
  ring(tesisId: string, topic: DoorbellTopic): void;
}

export class NoopDoorbell implements Doorbell {
  ring(): void {
    /* kayıt kipi: fabrika tur başına yoklar */
  }
}

export class VendorDoorbell implements Doorbell {
  constructor(
    private readonly baseUrl: string,
    private readonly bearer: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  ring(tesisId: string, topic: DoorbellTopic): void {
    const url = new URL("/ic/v1/zil", this.baseUrl);
    void this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, tesisId, konu: topic }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (!r.ok) console.warn(`[patron] zil iletilemedi (${topic}): HTTP ${r.status}`);
      })
      .catch((err: Error) => console.warn(`[patron] zil iletilemedi (${topic}): ${err.message}`));
  }
}

export function createDoorbell(config: CloudConfig, fetchImpl?: typeof fetch): Doorbell {
  if (config.KURULUM_KAYNAGI === "satici" && config.SATICI_IC_API_URL && config.SATICI_IC_API_BELIRTECI) {
    return new VendorDoorbell(config.SATICI_IC_API_URL, config.SATICI_IC_API_BELIRTECI, fetchImpl);
  }
  return new NoopDoorbell();
}
