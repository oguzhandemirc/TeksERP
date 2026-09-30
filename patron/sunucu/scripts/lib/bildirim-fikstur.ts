// Bildirim bekçilerinin ortak fikstürü (`test_` öneki yok → koşucu bunu bekçi saymaz). Gerçek gönderim YOK:
// taşıyıcı `RecordingTransport` (sahte); olay üretimi ve gönderim servis fonksiyonlarıyla, yalnız bekçinin tesisinde.
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../../src/catalog/notifications";
import { facilityMinute } from "../../src/lib/facility-clock";
import { NO_TENANT, withTesis } from "../../src/lib/tenant";
import type { PushTransport } from "../../src/push/transports";
import { generateForFacility } from "../../src/services/notification-events";
import { deliverDue, type DeliveryTotals } from "../../src/services/notification-sender";
import type { NotificationSettings } from "../../src/wire/api";
import { api, type Ortam, type TestHesabi } from "./test-ortam";

/** Varsayılan ayar, sessiz saat KAPALI (bekçi saatinden bağımsız), üstüne verilen değişiklik. */
export function ayar(g: { acik?: boolean; turler?: Partial<NotificationSettings["turler"]>; sessiz?: NotificationSettings["sessiz"]; esikler?: Partial<NotificationSettings["esikler"]> } = {}): NotificationSettings {
  return {
    acik: g.acik ?? true,
    turler: { ...DEFAULT_SETTINGS.turler, ...g.turler },
    sessiz: g.sessiz ?? { acik: false, baslangic: "22:00", bitis: "07:00" },
    esikler: { ...DEFAULT_SETTINGS.esikler, ...g.esikler },
  };
}

/** Şu anı (tesis saati; bekçi tesisinde `tesis` projeksiyonu yok → varsayılan İstanbul) içine alan sessiz pencere: [şimdi − önce dk, şimdi + sonra dk). */
export function simdikiSessiz(nowMs: number, sonraDk = 60, onceDk = 60): NotificationSettings["sessiz"] {
  const m = facilityMinute(nowMs);
  const saat = (x: number) => {
    const v = ((x % 1440) + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  };
  return { acik: true, baslangic: saat(m - onceDk), bitis: saat(m + sonraDk) };
}

export async function ayarYaz(o: Ortam, h: TestHesabi, ayarlar: NotificationSettings | null): Promise<number> {
  return (await api(o, "POST", "/api/bildirim/ayarlar", { belirtec: h.belirtec, govde: { ayarlar } })).status;
}

export async function cihazKaydet(o: Ortam, h: TestHesabi, belirtec = `ExponentPushToken[${randomUUID()}]`): Promise<string> {
  const r = await api(o, "POST", "/api/cihazlar", { belirtec: h.belirtec, govde: { platform: "android", belirtec } });
  if (r.status !== 201) throw new Error(`cihaz kaydı ${r.status}`);
  return belirtec;
}

/** Anlık projeksiyon satırı (fabrikanın paketiyle aynı biçim: record_id sıfır UUID). */
export async function anlikYaz(o: Ortam, tesisId: string, projeksiyon: string, veri: unknown): Promise<void> {
  await withTesis(o.goc.prisma, { tesisId, projections: [projeksiyon] }, (tx) => tx.$executeRaw`
    INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, sort_at, updated_at)
    VALUES (${tesisId}::uuid, ${projeksiyon}, ${NO_TENANT}::uuid, ${JSON.stringify(veri)}::jsonb, now(), now(), now())
    ON CONFLICT (tesis_id, projection, record_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`);
}

export const GECIKEN = (kalem: number) => ({ acikKalem: 10, acikMiktar: 100, karsilanmayanMiktar: 5, karsilanmaYuzde: 90, gecikenKalem: kalem, gecikenMiktar: 12, enCokCari: [] });

/** Tek tur: olay üretimi + gönderim (yalnız bu tesis). */
export async function tur(o: Ortam, tesisId: string, transport: PushTransport, nowMs = o.saat.simdi()): Promise<{ created: number } & DeliveryTotals> {
  const created = await generateForFacility(o.ctx, tesisId, nowMs);
  return { created, ...(await deliverDue(o.ctx, transport, tesisId, nowMs)) };
}

export interface BildirimSatiri {
  accountId: string;
  kind: string;
  dedupKey: string;
  status: string;
  skipReason: string | null;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  deliveries: unknown;
}

export async function bildirimler(o: Ortam, tesisId: string, kind?: string): Promise<BildirimSatiri[]> {
  return withTesis(o.goc.prisma, { tesisId }, (tx) => tx.notification.findMany({ where: { tesisId, ...(kind ? { kind } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
}
