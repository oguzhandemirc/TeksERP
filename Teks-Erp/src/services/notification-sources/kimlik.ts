// =============================================================================
// KİMLİK OLAYI — `kimlik.yeni-cihaz-girisi` (web girişinde tanınmayan tarayıcı, 2026-11-01)
// =============================================================================
// TEK yayma noktası `emitNewDeviceLogin` (çağıran `trusted-device.service#noteWebLogin`, oturum
// satırına "yeni cihaz" işaretini yazan tx'in İÇİNDE). Alıcı: girişi yapan kişi + `admin:users`
// sahipleri; ikisi de görme süzgeciyle kesişir (kural yetki genişletmez). Payload'da sır yok.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { loadAlarmShiftFacts } from "../helpers/loom-alarm-shift.helper";
import { inQuietHours } from "../helpers/notification-delivery.helper";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { readNotificationInboxEnabled } from "../system-setting/labels";
import { factoryDateTimeTr } from "../../constants/time";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { emitNotification } from "../helpers/notification-emit.helper";
import { visibleUsersFor } from "../helpers/notification-visibility.helper";
import { registerRecipientResolver, type InboxReason, type RecipientResolver } from "../notification-dispatch.service";

export const NEW_DEVICE_LOGIN_KIND = "kimlik.yeni-cihaz-girisi" as const;

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
    "kimlik.yeni-cihaz-girisi",
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
    if (isSubject || matchesPermission(ctx.grants.get(userId) ?? [], "admin:users")) out.push({ userId, reason: "IZIN" });
  }
  return out;
};

export const SUSPICIOUS_LOGIN_KIND = "kimlik.supheli-giris-denemesi" as const;

export interface SuspiciousLoginInput {
  userId: string;
  displayName: string;
  failCount: number;
  sourceCount: number;
  at: Date;
}

/** Hesap başına yumuşak kova uyarı eşiği aşıldı (Y2) — TEK yayma noktası `login-attempt-monitor.service`. */
export async function emitSuspiciousLogin(
  tx: Parameters<typeof emitNotification>[0],
  input: SuspiciousLoginInput,
): Promise<string | null> {
  return emitNotification(
    tx,
    "kimlik.supheli-giris-denemesi", // literal: yayma tarayıcısı türü değişkenden okuyamaz (SUSPICIOUS_LOGIN_KIND)
    { type: "user", id: input.userId, key: input.userId },
    {
      kullaniciId: input.userId,
      kullanici: input.displayName,
      hataSayisi: input.failCount,
      kaynakSayisi: input.sourceCount,
      saat: factoryDateTimeTr(input.at),
    },
    {},
  );
}

export const OFF_HOURS_LOGIN_KIND = "kimlik.mesai-disi-giris" as const;

/** Mesai dışı girişin izlendiği kanallar — tablet (saha) girişi vardiya işidir, izlenmez. */
const OFF_HOURS_CHANNEL_LABEL: Readonly<Record<string, string>> = { web: "Web tarayıcısı", electron: "Yönetim paneli", patron: "Patron uygulaması" };

const hhmm = (hour: number): string => {
  const m = Math.round(hour * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * "Bu an mesai dışı mı" — vardiya TANIMLIYSA (fabrika-geneli takvim kuralı) süren vardiya yokken; tanımlı değilse
 * fabrika saatinde [başlangıç, bitiş) dışında (gece yarısını aşan aralık desteklenir; eşit uçlar = mesai tanımsız → hiç).
 */
export function isOutsideWorkHours(input: { at: Date; shiftDefined: boolean; inShift: boolean; startHour: number; endHour: number }): { outside: boolean; label: string } {
  if (input.shiftDefined) return { outside: !input.inShift, label: "süren vardiya yok" };
  const s = hhmm(input.startHour);
  const e = hhmm(input.endHour);
  if (s === e) return { outside: false, label: "mesai tanımsız" };
  return { outside: !inQuietHours(input.at, s, e), label: `mesai ${s}–${e}` };
}

/**
 * `kimlik.mesai-disi-giris` TEK yayma noktası (çağıran `AuthService.issueToken`, oturum açıldıktan sonra): ayrı kısa tx,
 * hata girişi bozmaz (çağıran yutar). Yükte ad + kanal + saat; IP, tarayıcı ve sır yok.
 */
type ShiftFactsReader = (tx: Prisma.TransactionClient, at: Date) => Promise<{ shiftDefined: boolean; currentShift: unknown }>;
let readShiftFacts: ShiftFactsReader = loadAlarmShiftFacts;
/** Bekçi enjeksiyonu: vardiya okuyucusunu değiştirir (global vardiya tanımı yazmadan), geri alma fonksiyonu döner. */
export function overrideOffHoursShiftFacts(fn: ShiftFactsReader): () => void {
  const previous = readShiftFacts;
  readShiftFacts = fn;
  return () => {
    readShiftFacts = previous;
  };
}

export async function noteOffHoursLogin(input: { userId: string; displayName: string; clientType: string | undefined; at: Date }): Promise<boolean> {
  const kanal = input.clientType ? OFF_HOURS_CHANNEL_LABEL[input.clientType] : undefined;
  if (!kanal) return false;
  return prisma.$transaction(async (tx) => {
    if (!(await readNotificationInboxEnabled(tx))) return false;
    const facts = await readShiftFacts(tx, input.at);
    const p = effectiveNotificationParams(OFF_HOURS_LOGIN_KIND);
    const v = isOutsideWorkHours({ at: input.at, shiftDefined: facts.shiftDefined, inShift: facts.currentShift !== null, startHour: Number(p.baslangicSaat), endHour: Number(p.bitisSaat) });
    if (!v.outside) return false;
    await emitNotification(
      tx,
      "kimlik.mesai-disi-giris",
      { type: "user", id: input.userId, key: input.userId },
      { kullaniciId: input.userId, kullanici: input.displayName, kanal, saat: factoryDateTimeTr(input.at), mesai: v.label },
      { actorUserId: input.userId },
    );
    return true;
  });
}

export function registerIdentityRecipientResolvers(): void {
  registerRecipientResolver(NEW_DEVICE_LOGIN_KIND, resolveNewDeviceLoginRecipients);
  // Aynı alıcı kuralı: konu kullanıcı ∪ admin:users.
  registerRecipientResolver(SUSPICIOUS_LOGIN_KIND, resolveNewDeviceLoginRecipients);
}
