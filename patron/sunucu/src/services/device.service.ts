// BİLDİRİM CİHAZI KAYDI — push belirteci (Expo/FCM/APNs ya da web-push aboneliği); gönderim `notification-sender.ts`.
// Belirtecin KENDİSİ doğal işlem kimliğidir: aynı cihaz aynı belirteçle tekrar kaydolursa aynı satır
// güncellenir (tesis + belirteç özeti TEKİL; kilit CLIENT_TOKEN, anahtar özet). Cihaz başka hesaba
// geçerse satır o hesaba taşınır (bir telefonda tek oturum). Kayıt silinmez: `active=false` (soft).
// Çok tesis: cihaz satırı TESİS BAŞINADIR; kayıt kimliğin bütün AKTİF üyeliklerine (hizmeti KAPALI olmayan), çıkarma
// bütün üyeliklerine uygulanır — her tesis kendi tx'inde, kendi CLIENT_TOKEN kilidiyle (tx başına tek kilit).
import { createHash } from "node:crypto";
import type { DevicePlatform, PushDevice } from "@prisma/client";
import { activeMemberships, membershipRoutes, type MembershipRoute } from "../auth/membership";
import type { SessionContext } from "../auth/session.service";
import { accountActor, recordAudit } from "../lib/audit";
import { badRequest, notFound } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import { validPushToken } from "../push/targets";
import type { Device } from "../wire/api";
import type { CloudContext } from "./context";

export const PLATFORM_WIRE: Readonly<Record<"ios" | "android" | "web", DevicePlatform>> = { ios: "IOS", android: "ANDROID", web: "WEB" };

function deviceView(d: PushDevice): Device {
  return { id: d.id, platform: d.platform.toLowerCase(), ad: d.name, aktif: d.active, sonGorulme: d.lastSeenAt.toISOString(), olusturulma: d.createdAt.toISOString() };
}

const tokenDigestOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** Öteki üyelik tesisinin arızası (hazırlanıyor/bakım) bu tesisin işlemini düşürmez; yalnız kod günlüğe. */
async function otherFacility<T>(tesisId: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[patron] cihaz (üyelik tesisi ${tesisId}): ${(err as { code?: string }).code ?? (err as Error).message}`);
    return null;
  }
}

interface DeviceInput {
  readonly platform: keyof typeof PLATFORM_WIRE;
  readonly token: string;
  readonly ad?: string;
  readonly tokenHash: string;
  readonly now: Date;
}

async function upsertDevice(ctx: CloudContext, m: MembershipRoute, input: DeviceInput) {
  const { tokenHash, now } = input;
  const { device, changed } = await withTesis(ctx.app, { tesisId: m.tesisId, lock: { name: "CLIENT_TOKEN", key: `${m.tesisId}:cihaz:${tokenHash}` } }, async (tx) => {
    const existing = await tx.pushDevice.findUnique({ where: { tesisId_tokenHash: { tesisId: m.tesisId, tokenHash } } });
    const data = { accountId: m.accountId, platform: PLATFORM_WIRE[input.platform], name: input.ad ?? null, active: true, lastSeenAt: now };
    if (existing) {
      const moved = existing.accountId !== m.accountId || !existing.active;
      return { device: await tx.pushDevice.update({ where: { id: existing.id }, data }), changed: moved };
    }
    return { device: await tx.pushDevice.create({ data: { tesisId: m.tesisId, token: input.token, tokenHash, ...data } }), changed: true };
  });
  if (changed) await recordAudit(ctx.app, { tesisId: m.tesisId, actor: accountActor(m.accountId), event: "CIHAZ_KAYIT", entity: "PushDevice", entityId: device.id, summary: { platform: device.platform } });
  return device;
}

export async function registerDevice(ctx: CloudContext, s: SessionContext, input: { platform: keyof typeof PLATFORM_WIRE; token: string; ad?: string }) {
  // Biçim kapısı kayıtta VE gönderimde aynı yüklem (web aboneliği yalnız izinli push servisine; SSRF kapısı).
  if (!validPushToken(PLATFORM_WIRE[input.platform], input.token)) throw badRequest("Bildirim belirteci platformla uyumlu değil ya da izinli bir push servisine ait değil");
  const now = new Date(ctx.now());
  const g: DeviceInput = { ...input, tokenHash: tokenDigestOf(input.token), now };
  const device = await upsertDevice(ctx, { tesisId: s.tesisId, accountId: s.accountId }, g);
  if (s.identityId) {
    for (const m of await activeMemberships(ctx, s.identityId, now.getTime())) {
      if (m.tesisId === s.tesisId || m.hizmet === "KAPALI") continue;
      await otherFacility(m.tesisId, () => upsertDevice(ctx, m, g));
    }
  }
  return deviceView(device);
}

export async function listDevices(ctx: CloudContext, s: SessionContext) {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.pushDevice.findMany({ where: { tesisId: s.tesisId, accountId: s.accountId, active: true }, orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }] }),
  );
  return rows.map(deviceView);
}

/** Cihazı bildirimden çıkar (soft): yalnız kendi cihazı; aynı belirteç kimliğin öteki üyeliklerinden de çıkar; tekrarı aynı sonuç. */
export async function deactivateDevice(ctx: CloudContext, s: SessionContext, id: string) {
  const out = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const r = await tx.pushDevice.updateMany({ where: { id, tesisId: s.tesisId, accountId: s.accountId, active: true }, data: { active: false } });
    const fresh = await tx.pushDevice.findFirst({ where: { id, tesisId: s.tesisId, accountId: s.accountId } });
    if (!fresh) throw notFound("Cihaz");
    return { fresh, changed: r.count > 0 };
  });
  if (out.changed) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "CIHAZ_KALDIRILDI", entity: "PushDevice", entityId: id });
  if (s.identityId) {
    for (const m of await membershipRoutes(ctx, s.identityId)) {
      if (m.tesisId === s.tesisId) continue;
      const gone = await otherFacility(m.tesisId, () =>
        withTesis(ctx.app, { tesisId: m.tesisId }, async (tx) => {
          const rows = await tx.pushDevice.findMany({ where: { tesisId: m.tesisId, accountId: m.accountId, tokenHash: out.fresh.tokenHash, active: true }, select: { id: true } });
          const r = await tx.pushDevice.updateMany({ where: { id: { in: rows.map((x) => x.id) }, tesisId: m.tesisId, accountId: m.accountId, active: true }, data: { active: false } });
          return r.count > 0 ? rows : [];
        }),
      );
      for (const d of gone ?? []) await recordAudit(ctx.app, { tesisId: m.tesisId, actor: accountActor(m.accountId), event: "CIHAZ_KALDIRILDI", entity: "PushDevice", entityId: d.id });
    }
  }
  return deviceView(out.fresh);
}
