// BİLDİRİM AYARLARI — etkin ayar TEK çözücüden: hesabın ayarı → tesis yöneticisinin varsayılanı → koddaki
// varsayılan (biçimsiz saklı değer bir üst kaynağa düşer, fail-closed). Olay üretimi ve gönderim aynı çözücüyü
// çağırır; ayar hesabın KULLANICI TERCİHİdir (ayak izi `account_audit`e düşer, iş kararı okumaz).
import { Prisma } from "@prisma/client";
import type { SessionContext } from "../auth/session.service";
import { DEFAULT_SETTINGS, KIND_RULES, kindPermitted, parseStored } from "../catalog/notifications";
import { accountActor, recordAudit } from "../lib/audit";
import type { Tx } from "../lib/db";
import { forbidden } from "../lib/errors";
import { withTesis } from "../lib/tenant";
import { NOTIFICATION_KINDS, type NotificationItem, type NotificationSettings, type NotificationSettingsView, type Page } from "../wire/api";
import type { CloudContext } from "./context";

export interface ResolvedSettings {
  readonly settings: NotificationSettings;
  readonly source: NotificationSettingsView["kaynak"];
}

export function resolveSettings(account: unknown, facility: unknown): ResolvedSettings {
  const own = parseStored(account);
  if (own) return { settings: own, source: "HESAP" };
  const fac = parseStored(facility);
  if (fac) return { settings: fac, source: "TESIS" };
  return { settings: DEFAULT_SETTINGS, source: "VARSAYILAN" };
}

/** Tesisin bütün ayar satırları (olay üretimi ve gönderim için tek okuma). */
export async function loadFacilitySettings(tx: Tx, tesisId: string): Promise<{ facility: unknown; byAccount: ReadonlyMap<string, unknown> }> {
  const def = await tx.notificationDefaults.findUnique({ where: { tesisId } });
  const prefs = await tx.notificationPreference.findMany({ where: { tesisId }, select: { accountId: true, settings: true } });
  return { facility: def?.settings ?? null, byAccount: new Map(prefs.map((p) => [p.accountId, p.settings])) };
}

export async function getSettingsView(ctx: CloudContext, s: SessionContext, webPushKey: string | null): Promise<NotificationSettingsView> {
  const { own, facility } = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => ({
    own: (await tx.notificationPreference.findUnique({ where: { tesisId_accountId: { tesisId: s.tesisId, accountId: s.accountId } } }))?.settings ?? null,
    facility: (await tx.notificationDefaults.findUnique({ where: { tesisId: s.tesisId } }))?.settings ?? null,
  }));
  const r = resolveSettings(own, facility);
  return {
    etkin: r.settings,
    kaynak: r.source,
    hesap: parseStored(own),
    tesis: parseStored(facility),
    turler: NOTIFICATION_KINDS.map((k) => ({ tur: k, ad: KIND_RULES[k].label, aciklama: KIND_RULES[k].description, finans: KIND_RULES[k].finance, izinli: kindPermitted(k, s.permissions) })),
    gonderim: ctx.config.BILDIRIM_KIPI,
    webPushAnahtari: webPushKey,
  };
}

const json = (v: NotificationSettings | null) => (v === null ? Prisma.DbNull : (v as unknown as Prisma.InputJsonValue));

/** Hesabın kendi ayarı (null = tesis varsayılanına dön). Tam yerine koyma: tekrarı aynı sonuç. */
export async function setOwnSettings(ctx: CloudContext, s: SessionContext, settings: NotificationSettings | null, webPushKey: string | null): Promise<NotificationSettingsView> {
  await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.notificationPreference.upsert({
      where: { tesisId_accountId: { tesisId: s.tesisId, accountId: s.accountId } },
      create: { tesisId: s.tesisId, accountId: s.accountId, settings: json(settings) },
      update: { settings: json(settings) },
    }),
  );
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "BILDIRIM_AYARI", entity: "NotificationPreference", entityId: s.accountId, summary: { varsayilanaDon: settings === null } });
  return getSettingsView(ctx, s, webPushKey);
}

/** Tesis yöneticisinin varsayılanı (`bulut:hesap:yonet`). */
export async function setFacilityDefaults(ctx: CloudContext, s: SessionContext, settings: NotificationSettings, webPushKey: string | null): Promise<NotificationSettingsView> {
  if (!s.permissions.has("bulut:hesap:yonet")) throw forbidden();
  const data = settings as unknown as Prisma.InputJsonValue;
  await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.notificationDefaults.upsert({ where: { tesisId: s.tesisId }, create: { tesisId: s.tesisId, settings: data, updatedById: s.accountId }, update: { settings: data, updatedById: s.accountId } }),
  );
  await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "BILDIRIM_TESIS_VARSAYILANI", entity: "NotificationDefaults", entityId: s.tesisId });
  return getSettingsView(ctx, s, webPushKey);
}

/** Hesabın kendi bildirim geçmişi (yeni önce, imleç = son satırın id'si). */
export async function listOwnNotifications(ctx: CloudContext, s: SessionContext, g: { cursor?: string; limit: number }): Promise<Page<NotificationItem>> {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.notification.findMany({
      where: { tesisId: s.tesisId, accountId: s.accountId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: g.limit + 1,
      ...(g.cursor ? { cursor: { id: g.cursor }, skip: 1 } : {}),
    }),
  );
  const page = rows.slice(0, g.limit);
  return {
    kayitlar: page.map((n) => ({
      id: n.id, tur: n.kind, baslik: n.title, metin: n.body, rota: n.route, durum: n.status, atlamaNedeni: n.skipReason,
      olusturulma: n.createdAt.toISOString(), gonderilme: n.sentAt?.toISOString() ?? null,
    })),
    sonraki: rows.length > g.limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
