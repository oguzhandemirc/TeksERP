// =============================================================================
// BİLDİRİM PROFİLİ KİTLESİ — üye seçici adayları + "Bu türü N üye alamaz" bilgi sayımı (N4-PROFIL)
// =============================================================================
// Profil izin VERMEZ: sayım görme süzgecinin TEK yüklemiyle (`canSeeNotificationType`) yapılır, yazmaz.
// =============================================================================
import prisma from "../lib/prisma";
import { NOTIFICATION_KINDS } from "../constants/notification-catalog";
import { loadEffectiveGrants } from "./helpers/loom-alarm-recipient.helper";
import {
  canSeeNotificationType,
  loadNotificationVisibilityEnv,
  visibilityPermissionCodes,
} from "./helpers/notification-visibility.helper";

/**
 * Bilgi satırı "Bu türü N üye alamaz": profil izin VERMEZ, görme süzgeci tek yüklemden
 * (`canSeeNotificationType`) okunur; yalnız sıfırdan büyük sayılar döner.
 */
export async function blindMemberCounts(userIds: readonly string[]) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return () => ({});
  const env = await loadNotificationVisibilityEnv(prisma);
  const grants = await loadEffectiveGrants(prisma, visibilityPermissionCodes(NOTIFICATION_KINDS), new Date(), ids);
  const visible = new Map(ids.map((u) => [u, new Set(NOTIFICATION_KINDS.filter((k) => canSeeNotificationType({ permissions: grants.get(u) ?? [] }, k, env)))]));
  return (members: readonly string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of NOTIFICATION_KINDS) {
      const n = members.filter((u) => !visible.get(u)?.has(k)).length;
      if (n > 0) out[k] = n;
    }
    return out;
  };
}

/** Üye seçicinin aday listesi (aktif, silinmemiş, sistem hesabı olmayan kişiler). */
export async function listMemberCandidates() {
  const users = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null, isSystemAccount: false },
    select: { id: true, fullName: true, username: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
  return { items: users.map((u) => ({ id: u.id, ad: u.fullName || u.username, kullaniciAdi: u.username })) };
}
