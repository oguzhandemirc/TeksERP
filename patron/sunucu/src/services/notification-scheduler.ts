// BİLDİRİM İŞİ — süreç içi zamanlayıcı (bakım işinin eşi): her turda hizmeti AÇIK tesisler için önce olay üretimi, sonra
// gönderim, sonra makbuz yoklaması. `BILDIRIM_KIPI=kapali` (varsayılan = bugünkü davranış) iken iş KURULMAZ. Taşıyıcı kipten seçilir:
// `sahte` → kayıtlı sahte gönderici (ağ yok) · `gercek` → Expo + web push (VAPID). Canlı deneme mağaza hesapları ve
// patron VDS kurulumu sonrasına bırakıldı (runbook notu); yerelde gerçek gönderim DENENMEZ.
import type { CloudConfig } from "../config";
import { withMaintenanceList } from "../lib/tenant";
import { ExpoTransport, RecordingTransport, RoutingTransport, WebPushTransport, type PushTransport } from "../push/transports";
import { VapidKeys } from "../push/vapid";
import type { CloudContext } from "./context";
import { generateForFacility } from "./notification-events";
import { checkReceipts, type ReceiptTotals } from "./notification-receipts";
import { deliverDue, type DeliveryTotals } from "./notification-sender";
import { facilityServiceState } from "./service-lifecycle";

export interface NotificationRuntime {
  readonly transport: PushTransport;
  /** Web push aboneliği için açık anahtar (gizli anahtar yalnız `VapidKeys` içinde). */
  readonly webPushKey: string | null;
}

/** Kipten çalışma zamanı: `kapali` → null. VAPID dosyası yoksa üretilir (0600). */
export function createNotificationRuntime(config: CloudConfig): NotificationRuntime | null {
  if (config.BILDIRIM_KIPI === "kapali") return null;
  const vapid = VapidKeys.load(config.ANAHTAR_DIZINI, { create: true });
  if (config.BILDIRIM_KIPI === "sahte") return { transport: new RecordingTransport(), webPushKey: vapid.publicKey };
  const web = new WebPushTransport(vapid, config.BILDIRIM_VAPID_KONU!);
  return { transport: new RoutingTransport(new ExpoTransport(config), web), webPushKey: vapid.publicKey };
}

export async function runNotificationRound(ctx: CloudContext, transport: PushTransport, nowMs: number): Promise<{ created: number } & DeliveryTotals & ReceiptTotals> {
  const facilities = await withMaintenanceList(ctx.app, (tx) => tx.facility.findMany({ where: { status: "AKTIF" }, select: { tesisId: true }, orderBy: { tesisId: "asc" } }));
  const total = { created: 0, sent: 0, skipped: 0, deferred: 0, retried: 0, failed: 0, checked: 0, invalid: 0 };
  for (const f of facilities) {
    // Hizmet bitince (salt okuma) bildirim üretilmez ve gönderilmez: eşitleme durdu, "veri gelmiyor" yanıltır.
    if ((await facilityServiceState(ctx, f.tesisId, nowMs))?.phase !== "ACIK") continue;
    total.created += await generateForFacility(ctx, f.tesisId, nowMs);
    const d = await deliverDue(ctx, transport, f.tesisId, nowMs);
    total.sent += d.sent;
    total.skipped += d.skipped;
    total.deferred += d.deferred;
    total.retried += d.retried;
    total.failed += d.failed;
    const r = await checkReceipts(ctx, transport, f.tesisId, nowMs);
    total.checked += r.checked;
    total.invalid += r.invalid;
  }
  return total;
}

export class NotificationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly ctx: CloudContext,
    private readonly runtime: NotificationRuntime,
  ) {}

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
      const t = await runNotificationRound(this.ctx, this.runtime.transport, nowMs);
      if (t.created + t.sent + t.failed + t.checked > 0) console.log(`[patron] bildirim: ${t.created} doğdu · ${t.sent} gitti · ${t.skipped} atlandı · ${t.deferred} ertelendi · ${t.retried} yeniden · ${t.failed} başarısız · ${t.checked} makbuz · ${t.invalid} kayıtsız cihaz`);
    } catch (err) {
      console.error(`[patron] bildirim turu başarısız: ${(err as Error).name}`);
    } finally {
      this.running = false;
    }
  }
}
