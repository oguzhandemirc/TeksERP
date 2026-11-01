// =============================================================================
// KİMLİK OLAYI — `kimlik.yeni-cihaz-girisi` (web girişinde tanınmayan tarayıcı, 2026-11-01)
// =============================================================================
// TEK yayma noktası `emitNewDeviceLogin` (çağıran `trusted-device.service#noteWebLogin`, oturum
// satırına "yeni cihaz" işaretini yazan tx'in İÇİNDE). Alıcı: girişi yapan kişi + `admin:users`
// sahipleri; ikisi de görme süzgeciyle kesişir (kural yetki genişletmez). Payload'da sır yok.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { factoryDateTimeTr } from "../../constants/time";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { emitNotification } from "../helpers/notification-emit.helper";
import { visibleUsersFor } from "../helpers/notification-visibility.helper";
import { registerRecipientResolver, type InboxReason, type RecipientResolver } from "../notification-dispatch.service";

export const NEW_DEVICE_LOGIN_KIND = "kimlik.yeni-cihaz-girisi" as const;
const ADMIN_PERMISSION = "admin:users";

export interface NewDeviceLoginInput {
  userId: string;
  /** Görünen ad (ad soyad, yoksa kullanıcı adı). */
  displayName: string;
  /** Tarayıcı · işletim sistemi özeti (User-Agent'ın kendisi değil). */
  browser: string;
  ip: string | null;
  at: Date;
}

/** Outbox satırı — iş tx'inin içinde (oturum işaretiyle birlikte). Bayrak kapalıysa no-op (null). */
export async function emitNewDeviceLogin(
  tx: Parameters<typeof emitNotification>[0],
  input: NewDeviceLoginInput,
): Promise<string | null> {
  return emitNotification(
    tx,
    NEW_DEVICE_LOGIN_KIND,
    { type: "user", id: input.userId, key: input.userId },
    {
      kullaniciId: input.userId,
      kullanici: input.displayName,
      tarayici: input.browser,
      ip: input.ip ?? "bilinmiyor",
      saat: factoryDateTimeTr(input.at),
    },
    { actorUserId: input.userId },
  );
}

/** Alıcı: konu kullanıcı (kendi girişi) ∪ kullanıcı yöneticileri — ikisi de görme süzgecinden. */
export const resolveNewDeviceLoginRecipients: RecipientResolver = async (ctx) => {
  if (ctx.grants.size === 0) return [];
  const subject = ctx.row.subjectId;
  const visible = await visibleUsersFor(ctx.tx as Pick<Prisma.TransactionClient, "userPermission">, ctx.kind, ctx.env, { grants: ctx.grants });
  const out: Array<{ userId: string; reason: InboxReason }> = [];
  for (const userId of visible) {
    const isSubject = userId === subject;
    if (isSubject || matchesPermission(ctx.grants.get(userId) ?? [], ADMIN_PERMISSION)) out.push({ userId, reason: "IZIN" });
  }
  return out;
};

export function registerIdentityRecipientResolvers(): void {
  registerRecipientResolver(NEW_DEVICE_LOGIN_KIND, resolveNewDeviceLoginRecipients);
}
