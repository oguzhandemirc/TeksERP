// PUSH KÖPRÜSÜ MAKBUZ DÖNGÜSÜ — süreç içi zamanlayıcı (bakım/bildirim işinin eşi). Köprü kapısı `BILDIRIM_KIPI`den
// bağımsız olduğundan makbuz turu bulut bildirim işine (kip `kapali` iken kurulmaz) bağlanamaz: tek sahibi bu döngü.
// Satır silmez; `DeviceNotRegistered` bağa `invalidated_at` yazar, silme sonraki dürtte (`push-bridge.ts`, §4k).
import type { CloudContext } from "./context";
import { bridgeTransport, checkBridgeReceipts } from "./push-bridge";

/** Tek tur: köprü kapalıysa (taşıyıcı yok) DB'ye dokunmaz. Hata turu durdurur, süreci değil. */
export async function runBridgeReceiptRound(ctx: CloudContext, nowMs: number): Promise<{ checked: number; invalid: number }> {
  const transport = bridgeTransport(ctx);
  if (!transport) return { checked: 0, invalid: 0 };
  return checkBridgeReceipts(ctx, transport, nowMs);
}

export class BridgeReceiptScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: CloudContext) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.ctx.config.BILDIRIM_ARALIGI_SN * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(nowMs: number = this.ctx.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const t = await runBridgeReceiptRound(this.ctx, nowMs);
      if (t.checked > 0) console.log(`[patron] push köprüsü: ${t.checked} makbuz · ${t.invalid} kayıtsız cihaz`);
    } catch (err) {
      console.error(`[patron] push köprüsü makbuz turu başarısız: ${(err as Error).name}`);
    } finally {
      this.running = false;
    }
  }
}
