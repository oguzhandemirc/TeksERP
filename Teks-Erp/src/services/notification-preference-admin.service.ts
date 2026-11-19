// =============================================================================
// BİLDİRİM TERCİHİ — YÖNETİCİ GÖRÜNÜMÜ (kişi kartı → Bildirimler; `settings:notifications` route'ta)
// =============================================================================
// Özet ve yazım kişinin DAĞITICIDAKİ izin kümesiyle (`loadEffectiveGrants`: aktif, sistem dışı, süresi geçerli)
// çözülür; görme süzgeci ve tercih çözümü tek kaynaktan (`canSeeNotificationType`, `resolvePreference`).
// Yazım DELTA'dır (yalnız verilen hücre), kişisel tercih tablosuna seyrek; profil tercih kilidi yöneticiyi bağlamaz,
// görme süzgeci ve tür kilidi bağlar (fail-closed). Audit tx DIŞINDA, kişisel satırın kendisi audit muaf.
// =============================================================================
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { getNotificationEntry, NOTIFICATION_KINDS, type NotificationKanal, type NotificationKind } from "../constants/notification-catalog";
import { NOTIFICATION_CHANNELS } from "../constants/notification-preference";
import { MODULE_LABELS } from "../constants/module-flags";
import { PERMISSION_CATALOG } from "../constants/permission-catalog";
import {
  canSeeNotificationType,
  loadNotificationVisibilityEnv,
  notificationHiddenReason,
  visibilityPermissionCodes,
  type NotificationHiddenReason,
} from "./helpers/notification-visibility.helper";
import { loadEffectiveGrants } from "./helpers/loom-alarm-recipient.helper";
import { channelEnabled, loadPreferenceLayers, prefKey, resolvePreference, type PreferenceSubject } from "./helpers/notification-preference.helper";
import { lockView } from "./helpers/notification-preference-lock.helper";
import type { PreferenceContext } from "./notification-preference.service";

const PERMISSION_LABEL = new Map<string, string>(PERMISSION_CATALOG.map((p) => [p.code, p.description]));

function hiddenText(r: NotificationHiddenReason, user: { isActive: boolean; isSystemAccount: boolean }): string {
  if (!user.isActive) return "Kullanıcı pasif; bildirim almaz.";
  if (user.isSystemAccount) return "Sistem hesabı bildirim almaz.";
  if (r.tip === "MODUL") return `${MODULE_LABELS[r.modul] ?? r.modul} modülü kapalı.`;
  if (r.tip === "KAPI") return "Bu türün kurulum ayarı kapalı.";
  const alt = r.requiredPermissions.map((k) => k.map((c) => PERMISSION_LABEL.get(c) ?? c).join(" + "));
  return `Kişinin bu türü görme yetkisi yok (gerekli: ${alt.join(" ya da ")}).`;
}

async function loadTarget(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, username: true, isActive: true, isSystemAccount: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw AppError.notFound("Kullanıcı bulunamadı.", { code: "USER_NOT_FOUND" });
  return user;
}

/** Kişinin dağıtıcıdaki bakışı: izinler `loadEffectiveGrants` (pasif/sistem hesabı → boş küme → her tür gizli). */
async function targetContext(userId: string): Promise<PreferenceContext> {
  const grants = await loadEffectiveGrants(prisma, visibilityPermissionCodes(NOTIFICATION_KINDS), new Date(), [userId]);
  const subject: PreferenceSubject = { userId, permissions: grants.get(userId) ?? [] };
  const env = await loadNotificationVisibilityEnv(prisma);
  const layers = await loadPreferenceLayers(prisma, [userId]);
  return { subject, env, layers };
}

export async function getUserPreferenceSummary(userId: string) {
  const user = await loadTarget(userId);
  const ctx = await targetContext(userId);
  const { subject, env, layers } = ctx;
  const own = layers.prefs.get(userId);
  const profiles = await prisma.notificationProfileMember.findMany({
    where: { userId, profile: { archivedAt: null } },
    select: { profile: { select: { id: true, name: true, prefsLocked: true } } },
    orderBy: [{ profile: { name: "asc" } }, { id: "asc" }],
  });
  const o = { env, layers };
  return {
    kullanici: { id: user.id, ad: user.fullName || user.username, kullaniciAdi: user.username, aktif: user.isActive, sistemHesabi: user.isSystemAccount },
    tercihKilidi: lockView(layers, userId),
    profiller: profiles.map((m) => ({ id: m.profile.id, ad: m.profile.name, tercihKilidi: m.profile.prefsLocked })),
    turler: NOTIFICATION_KINDS.map((kind) => {
      const entry = getNotificationEntry(kind);
      const reason = notificationHiddenReason(subject, kind, env);
      if (reason) return { tur: kind, ad: entry.ad, grup: entry.grup, gorur: false as const, gizliNeden: hiddenText(reason, user), kanallar: [] };
      return {
        tur: kind, ad: entry.ad, grup: entry.grup, gorur: true as const, gizliNeden: null,
        kanallar: entry.kanallar.map((kanal) => {
          const r = resolvePreference(subject, kind, kanal, o);
          const row = own?.get(prefKey(kind, kanal));
          return { kanal, durum: r.durum, kilit: r.kilit, kaynak: r.kaynak, kisisel: row ? { acik: row.enabled, kapsamli: row.scope !== null } : null };
        }),
      };
    }),
  };
}

const AdminItem = z
  .object({ tur: z.string().min(1).max(64), kanal: z.enum(NOTIFICATION_CHANNELS, "Kanal tanınmıyor."), acik: z.boolean().nullable() })
  .strict();
export const AdminPreferencesBody = z.object({ tercihler: z.array(AdminItem).min(1).max(500) }).strict();

type Change = { kind: NotificationKind; channel: NotificationKanal; row: { enabled: boolean; scope: Prisma.InputJsonValue | typeof Prisma.DbNull } | null };

/** DELTA yazım: `acik:null` kişisel satırı kaldırır; taban çözüme eşit ve kapsamsız satır yazılmaz (seyrek). */
export async function putUserPreferences(actorId: string, userId: string, body: unknown) {
  const { tercihler } = AdminPreferencesBody.parse(body);
  await loadTarget(userId);
  const { subject, env, layers } = await targetContext(userId);
  const base = { env, layers, taslak: new Map() };
  const own = layers.prefs.get(userId);
  const changes: Change[] = [];
  const seen = new Set<string>();
  for (const it of tercihler) {
    const kind = it.tur as NotificationKind;
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(it.tur) || !canSeeNotificationType(subject, kind, env)) {
      throw AppError.badRequest("Kişinin bu bildirim türünü görme yetkisi yok; açılamaz.", { code: "NOTIFICATION_KIND_NOT_VISIBLE", tur: it.tur });
    }
    const channel = it.kanal as NotificationKanal;
    if (!getNotificationEntry(kind).kanallar.includes(channel)) {
      throw AppError.badRequest("Bu tür bu kanaldan gönderilmez.", { code: "NOTIFICATION_CHANNEL_INVALID", tur: kind, kanal: channel });
    }
    const key = prefKey(kind, channel);
    if (seen.has(key)) throw AppError.badRequest("Aynı tür ve kanal iki kez gönderildi.", { code: "NOTIFICATION_PREFERENCE_DUPLICATE", tur: kind, kanal: channel });
    seen.add(key);
    const inAppBase = resolvePreference(subject, kind, "UYGULAMA", base);
    if (channel === "UYGULAMA" && inAppBase.kilit && it.acik === false) {
      throw AppError.conflict("Bu bildirim kilitli; uygulama içinde kapatılamaz.", { code: "NOTIFICATION_KIND_LOCKED", tur: kind });
    }
    const existing = own?.get(key);
    const scope = channel === "UYGULAMA" && !inAppBase.kilit ? (existing?.scope ?? null) : null;
    const baseOn = channel === "UYGULAMA" ? inAppBase.durum === "ACIK" : channelEnabled(subject, kind, channel, base).acik;
    const drop = it.acik === null || (it.acik === baseOn && scope === null) || (channel === "UYGULAMA" && inAppBase.kilit);
    changes.push({
      kind, channel,
      row: drop ? null : { enabled: it.acik as boolean, scope: scope ? (scope as Prisma.InputJsonValue) : Prisma.DbNull },
    });
  }
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.row === null) {
        await tx.notificationPreference.deleteMany({ where: { userId, kind: c.kind, channel: c.channel } });
      } else {
        await tx.notificationPreference.upsert({
          where: { userId_kind_channel: { userId, kind: c.kind, channel: c.channel } },
          create: { userId, kind: c.kind, channel: c.channel, enabled: c.row.enabled, scope: c.row.scope },
          update: { enabled: c.row.enabled, scope: c.row.scope },
        });
      }
    }
  });
  await AuditService.log({
    userId: actorId, action: "UPDATE", tableName: "NOTIFICATION_PREFERENCE", recordId: userId,
    oldData: { hedefKullanici: userId, tercihler: changes.map((c) => ({ tur: c.kind, kanal: c.channel, acik: own?.get(prefKey(c.kind, c.channel))?.enabled ?? null })) },
    newData: { hedefKullanici: userId, tercihler: tercihler.map((t) => ({ tur: t.tur, kanal: t.kanal, acik: t.acik })) },
  });
  return getUserPreferenceSummary(userId);
}
