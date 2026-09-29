// BİLDİRİM CİHAZI KAYDI — push belirteci (Expo/FCM/APNs ya da web-push aboneliği); GÖNDERİM B5'tir.
// Belirtecin KENDİSİ doğal işlem kimliğidir: aynı cihaz aynı belirteçle tekrar kaydolursa aynı satır
// güncellenir (tesis + belirteç özeti TEKİL; kilit CLIENT_TOKEN, anahtar özet). Cihaz başka hesaba
// geçerse satır o hesaba taşınır (bir telefonda tek oturum). Kayıt silinmez: `active=false` (soft).
import { createHash } from "node:crypto";
import type { DevicePlatform, PushDevice } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import { notFound } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import type { Device } from "../wire/api";
import type { CloudContext } from "./context";

export const PLATFORM_WIRE: Readonly<Record<"ios" | "android" | "web", DevicePlatform>> = { ios: "IOS", android: "ANDROID", web: "WEB" };

function deviceView(d: PushDevice): Device {
  return { id: d.id, platform: d.platform.toLowerCase(), ad: d.name, aktif: d.active, sonGorulme: d.lastSeenAt.toISOString(), olusturulma: d.createdAt.toISOString() };
}

export async function registerDevice(ctx: CloudContext, s: SessionContext, input: { platform: keyof typeof PLATFORM_WIRE; token: string; ad?: string }) {
  const tokenHash = createHash("sha256").update(input.token, "utf8").digest("hex");
  const now = new Date(ctx.now());
  const { device, changed } = await withTesis(ctx.app, { tesisId: s.tesisId, lock: { name: "CLIENT_TOKEN", key: `${s.tesisId}:cihaz:${tokenHash}` } }, async (tx) => {
    const existing = await tx.pushDevice.findUnique({ where: { tesisId_tokenHash: { tesisId: s.tesisId, tokenHash } } });
    const data = { accountId: s.accountId, platform: PLATFORM_WIRE[input.platform], name: input.ad ?? null, active: true, lastSeenAt: now };
    if (existing) {
      const moved = existing.accountId !== s.accountId || !existing.active;
      return { device: await tx.pushDevice.update({ where: { id: existing.id }, data }), changed: moved };
    }
    return { device: await tx.pushDevice.create({ data: { tesisId: s.tesisId, token: input.token, tokenHash, ...data } }), changed: true };
  });
  if (changed) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIHAZ_KAYIT", entity: "PushDevice", entityId: device.id, summary: { platform: device.platform } });
  return deviceView(device);
}

export async function listDevices(ctx: CloudContext, s: SessionContext) {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.pushDevice.findMany({ where: { tesisId: s.tesisId, accountId: s.accountId, active: true }, orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }] }),
  );
  return rows.map(deviceView);
}

/** Cihazı bildirimden çıkar (soft): yalnız kendi cihazı; tekrarı aynı sonuç. */
export async function deactivateDevice(ctx: CloudContext, s: SessionContext, id: string) {
  const out = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const r = await tx.pushDevice.updateMany({ where: { id, tesisId: s.tesisId, accountId: s.accountId, active: true }, data: { active: false } });
    const fresh = await tx.pushDevice.findFirst({ where: { id, tesisId: s.tesisId, accountId: s.accountId } });
    if (!fresh) throw notFound("Cihaz");
    return { fresh, changed: r.count > 0 };
  });
  if (out.changed) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIHAZ_KALDIRILDI", entity: "PushDevice", entityId: id });
  return deviceView(out.fresh);
}
