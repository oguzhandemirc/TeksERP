// =============================================================================
// YETKİ / KULLANICI · CİHAZ ONAYI OLAYLARI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Tek yayma noktaları; çağıranlar hesabı/yetkiyi/cihazı yazan tx'in İÇİNDEN, claim'den SONRA çağırır. SIR YOK: parola,
// PIN, TOTP sırrı, kurtarma kodu, cihaz sırrı yüke girmez. Satıcı (sistem) hesabına dair bildirim üretilmez — giriş
// adı/takma ad maskesini çürütürdü. Kritik yetki kümesi = SoD (`SOD_PERMISSION_CODES`) ∪ kullanıcı yöneticisi kodları.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { SOD_PERMISSION_CODES } from "../../constants/role-template-catalog";
import { USER_ADMIN_CODES } from "../helpers/factory-admin.helper";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const CRITICAL_CODES: ReadonlySet<string> = new Set<string>([...SOD_PERMISSION_CODES, ...USER_ADMIN_CODES]);
const subject = (id: string) => ({ type: "user", id, key: id });

async function targetOf(tx: Tx, userId: string): Promise<{ hedefId: string; hedefAd: string; username: string } | null> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true, isSystemAccount: true } });
  if (!u || u.isSystemAccount) return null;
  return { hedefId: userId, hedefAd: u.fullName, username: u.username };
}

/** `yetki.kullanici-olusturuldu` — hesap doğuş tx'i (`createUser`, `createFactoryAdmin`). */
export async function emitUserCreatedTx(tx: Tx, userId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const t = await targetOf(tx, userId);
  if (!t) return;
  await emitNotification(tx, "yetki.kullanici-olusturuldu", subject(userId), { hedefId: t.hedefId, hedefAd: t.hedefAd, hedefKullaniciAdi: t.username }, { actorUserId: who(actor) });
}

/** `yetki.kullanici-pasif` — pasife alma tx'i (`deactivateUser`, son-admin kilidi altında). */
export async function emitUserDeactivatedTx(tx: Tx, userId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const t = await targetOf(tx, userId);
  if (!t) return;
  await emitNotification(tx, "yetki.kullanici-pasif", subject(userId), { hedefId: t.hedefId, hedefAd: t.hedefAd }, { actorUserId: who(actor) });
}

/**
 * `yetki.yetki-degisti` + `yetki.izin-verildi` — kullanıcı yetki satırlarını yazan tx (grant · toplu set · revoke ·
 * şablon birleştirme). Değişiklik yoksa hiçbir şey; eklenenler kritik kümeye değiyorsa ayrıca ⭐ tür.
 */
export async function emitUserPermissionsChangedTx(
  tx: Tx, userId: string, c: { addedPermissionIds: readonly string[]; removedCount: number; changedCount?: number }, actor: Actor,
): Promise<void> {
  const changed = c.addedPermissionIds.length + c.removedCount + (c.changedCount ?? 0);
  if (changed === 0) return;
  if (await off(tx)) return;
  const t = await targetOf(tx, userId);
  if (!t) return;
  const base = { hedefId: t.hedefId, hedefAd: t.hedefAd };
  await emitNotification(tx, "yetki.yetki-degisti", subject(userId), { ...base, eklenen: c.addedPermissionIds.length, cikarilan: c.removedCount }, { actorUserId: who(actor) });
  if (c.addedPermissionIds.length === 0) return;
  const added = await tx.permission.findMany({ where: { id: { in: [...c.addedPermissionIds] } }, select: { code: true } });
  const critical = added.map((p) => p.code).filter((code) => CRITICAL_CODES.has(code)).sort();
  if (critical.length === 0) return;
  await emitNotification(tx, "yetki.izin-verildi", subject(userId), { ...base, kodlar: critical.join(", ") }, { actorUserId: who(actor) });
}

/** `yetki.parola-sifirlandi` — yönetici parola sıfırlaması claim'i (`resetUserPassword`). */
export async function emitPasswordResetTx(tx: Tx, userId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const t = await targetOf(tx, userId);
  if (!t) return;
  await emitNotification(tx, "yetki.parola-sifirlandi", subject(userId), { hedefId: t.hedefId, hedefAd: t.hedefAd }, { actorUserId: who(actor) });
}

/** `yetki.iki-adim-sifirlandi` — TOTP sıfırlama claim'i (`TotpAccountService.reset`). */
export async function emitTotpResetTx(tx: Tx, userId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const t = await targetOf(tx, userId);
  if (!t) return;
  await emitNotification(tx, "yetki.iki-adim-sifirlandi", subject(userId), { hedefId: t.hedefId, hedefAd: t.hedefAd }, { actorUserId: who(actor) });
}

const DEVICE_KIND_LABEL: Record<string, string> = { TABLET: "tablet", PHONE: "telefon", DESKTOP: "masaüstü" };

/** `cihaz.onay-bekliyor` — bilinmeyen cihazın PENDING doğuşu (`DeviceService.createAnnounced`); aktör yok (public uç). */
export async function emitDevicePendingTx(tx: Tx, device: { name: string; kind: string; status: string }): Promise<void> {
  if (device.status !== "PENDING") return;
  if (await off(tx)) return;
  await emitNotification(tx, "cihaz.onay-bekliyor", { type: "device", id: null, key: "onay-bekleyen-cihaz" }, {
    cihazAd: device.name.slice(0, 80), cihazTuru: DEVICE_KIND_LABEL[device.kind] ?? "cihaz",
  }, {});
}
