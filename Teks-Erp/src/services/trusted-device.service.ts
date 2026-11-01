// =============================================================================
// GÜVENİLİR CİHAZ — web girişinde "Bu cihazı N gün hatırla" + yeni cihaz bildirimi (2026-11-01)
// =============================================================================
// • Ayar `auth.trustedDeviceDays` (0 = kapalı = bugünkü davranış; yalnız süperadmin yazar).
// • Belirteç 256 bit rastgele; DB'de YALNIZ kısa kimlik halkasıyla HMAC özeti. Halka yoksa
//   FAIL-CLOSED: cihaz ne doğar ne tanınır (kod sorulur).
// • Geçerlilik TEK yüklem `validDeviceWhere`: aynı kullanıcı ∧ iptal yok ∧ süre dolmamış ∧
//   `tokenVersion` kullanıcınınkiyle eşit (oturum düşüren her artış cihazı da düşürür).
// • Kodu atlatma kararının TEK tüketicisi `AuthService.assertSecondFactor` (`consumeTrustedDevice`).
// • Sistem hesabına (süperadmin) HİÇ uygulanmaz: ne doğar ne kabul edilir.
// • İptal DURUM geçişidir (revokedAt + revokeReason), atomik; satır silinmez.
// =============================================================================
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { uyari } from "../lib/logger";
import { getShortCredentialKeyRing } from "../lib/short-credential/keyring";
import { digestTrustedDeviceToken } from "../lib/short-credential/digest";
import { AuditService } from "./audit.service";
import { readTrustedDeviceDays } from "./system-setting.service";
import { emitNewDeviceLogin } from "./notification-sources/kimlik";
import { markSessionNewDeviceTx } from "./session-registry.service";

export const TRUSTED_DEVICE_TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
const LIST_LIMIT = 50;
export const TRUSTED_DEVICE_AUDIT_TABLE = "TRUSTED_DEVICE";

export type TrustedDeviceRevokeReason =
  | "SELF"
  | "ADMIN"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "TOTP_RESET"
  | "DEACTIVATED";

export type TrustedDeviceState = "GECERLI" | "SURESI_DOLDU" | "IPTAL" | "GECERSIZ";

export interface TrustedDeviceView {
  id: string;
  label: string;
  firstIp: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  state: TrustedDeviceState;
}

type TxLike = Pick<Prisma.TransactionClient, "trustedDevice">;

/** Halkadaki HER anahtarla özet adayları (eski kid'li cihaz da tanınır). Halka yok / biçim dışı → boş. */
function candidateHashes(token: string | null | undefined): string[] {
  if (!token || !TOKEN_RE.test(token)) return [];
  const st = getShortCredentialKeyRing();
  if (!st.ok) return [];
  return st.ring.keys.map((k) => digestTrustedDeviceToken(k, token));
}

/** Geçerli cihaz yüklemi — kod atlatma, tanıma ve liste durumu aynı parçayı kullanır. */
function validDeviceWhere(userId: string, tokenVersion: number, now: Date): Prisma.TrustedDeviceWhereInput {
  return { userId, revokedAt: null, expiresAt: { gt: now }, tokenVersion };
}

/** Kullanıcı için etkin gün sayısı: ayar 0 ya da sistem hesabı/pasif → 0 (özellik yok). */
export async function trustedDeviceDaysFor(userId: string): Promise<number> {
  const days = await readTrustedDeviceDays();
  if (days <= 0) return 0;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isSystemAccount: true, isActive: true } });
  if (!u || u.isSystemAccount || !u.isActive) return 0;
  return days;
}

async function userTokenVersion(userId: string): Promise<number | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
  return u?.tokenVersion ?? null;
}

/**
 * Kod adımını bu belirteçle atla: ayar açık ∧ sistem hesabı değil ∧ geçerli satır. `lastUsedAt`
 * yazımı geçerlilik koşuluyla ATOMİK (arada iptal edildiyse count 0 → kod sorulur).
 */
export async function consumeTrustedDevice(userId: string, token: string | null | undefined): Promise<boolean> {
  const hashes = candidateHashes(token);
  if (hashes.length === 0) return false;
  if ((await trustedDeviceDaysFor(userId)) <= 0) return false;
  const tv = await userTokenVersion(userId);
  if (tv === null) return false;
  const now = new Date();
  const res = await prisma.trustedDevice.updateMany({
    where: { ...validDeviceWhere(userId, tv, now), tokenHash: { in: hashes } },
    data: { lastUsedAt: now },
  });
  return res.count === 1;
}

/** Tarayıcı bu kullanıcının geçerli güvenilir cihazı mı (ayardan bağımsız — yalnız "tanıma" için). */
async function isRecognizedDevice(userId: string, token: string | null | undefined): Promise<boolean> {
  const hashes = candidateHashes(token);
  if (hashes.length === 0) return false;
  const tv = await userTokenVersion(userId);
  if (tv === null) return false;
  const row = await prisma.trustedDevice.findFirst({
    where: { ...validDeviceWhere(userId, tv, new Date()), tokenHash: { in: hashes } },
    select: { id: true },
  });
  return row !== null;
}

/** User-Agent → "Chrome · Windows" (paket yok; kaba ama kararlı). UA'nın kendisi saklanmaz. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Bilinmeyen tarayıcı";
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "bilinmeyen sistem";
  return `${browser} · ${os}`;
}

/** Yeni güvenilir cihaz — doğru kodla parolalı web girişinden sonra. Halka yoksa null (hatırlanmaz). */
async function issueTrustedDevice(input: {
  userId: string;
  days: number;
  label: string;
  ip: string | null;
}): Promise<{ token: string; maxAgeSeconds: number } | null> {
  const st = getShortCredentialKeyRing();
  if (!st.ok) {
    uyari("guvenilir-cihaz", "kısa kimlik halkası kullanılamıyor — cihaz hatırlanmadı (her girişte kod sorulur)");
    return null;
  }
  const tv = await userTokenVersion(input.userId);
  if (tv === null) return null;
  const token = randomBytes(TRUSTED_DEVICE_TOKEN_BYTES).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.days * DAY_MS);
  const row = await prisma.trustedDevice.create({
    data: {
      userId: input.userId,
      tokenHash: digestTrustedDeviceToken(st.ring.active, token),
      label: input.label.slice(0, 120),
      firstIp: input.ip ? input.ip.slice(0, 64) : null,
      tokenVersion: tv,
      lastUsedAt: now,
      expiresAt,
      createdAt: now,
    },
    select: { id: true },
  });
  // Ayak izi: belirteç ve özeti audit'e GİRMEZ.
  await AuditService.log({
    userId: input.userId,
    action: "CREATE",
    tableName: TRUSTED_DEVICE_AUDIT_TABLE,
    recordId: row.id,
    newData: { label: input.label, firstIp: input.ip, expiresAt: expiresAt.toISOString() },
  });
  return { token, maxAgeSeconds: input.days * 86_400 };
}

export interface WebLoginFollowUpInput {
  userId: string;
  jti: string | undefined;
  /** İkinci faktör nasıl geçildi (assertSecondFactor yazar). */
  secondFactor: "CODE" | "TRUSTED_DEVICE" | "NONE";
  rememberDevice: boolean;
  viaPassword: boolean;
  trustedDeviceToken: string | null | undefined;
  /** Girişten ÖNCE tarayıcıda duran oturum çerezinin (imzası+süresi geçerli) sahibi. */
  sessionCookieUserId: string | null | undefined;
  userAgent: string | null | undefined;
  ip: string | null | undefined;
}

export interface WebLoginFollowUp {
  trustedDevice: { token: string; maxAgeSeconds: number } | null;
  newDevice: boolean;
}

/**
 * Çerez kipinde başarılı girişin ardı: (1) tarayıcı tanınıyor mu → oturum satırına `newDevice` +
 * tanınmıyorsa bildirim (AYNI tx; OLAY tek yayma noktası) · (2) istenmişse cihazı hatırla.
 * Hata girişi düşürmez (oturum açılmıştır) — iz bırakır.
 */
export async function noteWebLogin(input: WebLoginFollowUpInput): Promise<WebLoginFollowUp> {
  const recognized =
    input.secondFactor === "TRUSTED_DEVICE" ||
    input.sessionCookieUserId === input.userId ||
    (await isRecognizedDevice(input.userId, input.trustedDeviceToken));
  const label = deviceLabel(input.userAgent);
  const ip = input.ip ?? null;
  try {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { fullName: true, username: true } });
    await prisma.$transaction(async (tx) => {
      if (input.jti) await markSessionNewDeviceTx(tx, input.jti, input.userId, !recognized);
      if (!recognized) {
        await emitNewDeviceLogin(tx, {
          userId: input.userId,
          displayName: user?.fullName?.trim() || user?.username || "Kullanıcı",
          browser: label,
          ip,
          at: new Date(),
        });
      }
    });
  } catch (e) {
    uyari("guvenilir-cihaz", `yeni cihaz işareti/bildirimi yazılamadı: ${(e as Error).message}`);
  }
  let trustedDevice: WebLoginFollowUp["trustedDevice"] = null;
  if (input.viaPassword && input.secondFactor === "CODE" && input.rememberDevice) {
    const days = await trustedDeviceDaysFor(input.userId);
    if (days > 0) trustedDevice = await issueTrustedDevice({ userId: input.userId, days, label, ip });
  }
  return { trustedDevice, newDevice: !recognized };
}

/**
 * Kullanıcının BÜTÜN açık cihazlarını iptal et — kimlik bilgisi değişiminin KENDİ tx'inde çağrılır.
 * Döner: iptal edilen sayı (audit çağıranın tx'i bittikten sonra `auditBulkRevoke`).
 */
export async function revokeAllTrustedDevicesTx(
  tx: TxLike,
  userId: string,
  reason: TrustedDeviceRevokeReason,
  actorId: string | null,
): Promise<number> {
  const res = await tx.trustedDevice.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason, revokedById: actorId },
  });
  return res.count;
}

/** Toplu iptalin ayak izi (tx DIŞINDA, best-effort). */
export async function auditBulkRevoke(userId: string, count: number, reason: TrustedDeviceRevokeReason, actorId: string | null): Promise<void> {
  if (count <= 0) return;
  await AuditService.log({
    userId: actorId ?? undefined,
    action: "UPDATE",
    tableName: TRUSTED_DEVICE_AUDIT_TABLE,
    recordId: userId,
    changes: [{ field: "revokedCount", old: null, new: count }, { field: "revokeReason", old: null, new: reason }],
  });
}

function stateOf(
  r: { revokedAt: Date | null; expiresAt: Date; tokenVersion: number },
  tv: number,
  now: Date,
): TrustedDeviceState {
  if (r.revokedAt) return "IPTAL";
  if (r.tokenVersion !== tv) return "GECERSIZ";
  if (r.expiresAt.getTime() <= now.getTime()) return "SURESI_DOLDU";
  return "GECERLI";
}

export class TrustedDeviceService {
  /** Son 50 cihaz (yeniden eskiye; eşitlikte id). Özet hiçbir zaman dönmez. */
  static async list(userId: string): Promise<{ days: number; devices: TrustedDeviceView[] }> {
    const tv = await userTokenVersion(userId);
    if (tv === null) throw AppError.notFound("Kullanıcı bulunamadı.");
    const now = new Date();
    const rows = await prisma.trustedDevice.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIST_LIMIT,
      select: {
        id: true, label: true, firstIp: true, createdAt: true, lastUsedAt: true, expiresAt: true,
        revokedAt: true, revokeReason: true, tokenVersion: true,
      },
    });
    return {
      days: await readTrustedDeviceDays(),
      devices: rows.map((r) => ({
        id: r.id,
        label: r.label,
        firstIp: r.firstIp,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
        revokeReason: r.revokeReason,
        state: stateOf(r, tv, now),
      })),
    };
  }

  /** Tek cihazı iptal — atomik claim {id, userId, revokedAt: null}; zaten iptal 409, yok 404. */
  static async revoke(params: { userId: string; deviceId: string; actorId: string; reason: "SELF" | "ADMIN" }): Promise<void> {
    const res = await prisma.trustedDevice.updateMany({
      where: { id: params.deviceId, userId: params.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: params.reason, revokedById: params.actorId },
    });
    if (res.count === 0) {
      const exists = await prisma.trustedDevice.findFirst({
        where: { id: params.deviceId, userId: params.userId },
        select: { id: true },
      });
      if (!exists) throw AppError.notFound("Cihaz bulunamadı.", { code: "TRUSTED_DEVICE_NOT_FOUND" });
      throw AppError.conflict("Bu cihaz zaten kaldırılmış.", { code: "TRUSTED_DEVICE_ALREADY_REVOKED" });
    }
    await AuditService.log({
      userId: params.actorId,
      action: "UPDATE",
      tableName: TRUSTED_DEVICE_AUDIT_TABLE,
      recordId: params.deviceId,
      changes: [{ field: "revokeReason", old: null, new: params.reason }],
    });
  }

  /** Kullanıcının bütün açık cihazlarını iptal (kendi ya da yönetici). Döner: iptal edilen sayı. */
  static async revokeAll(params: { userId: string; actorId: string; reason: "SELF" | "ADMIN" }): Promise<number> {
    const n = await revokeAllTrustedDevicesTx(prisma, params.userId, params.reason, params.actorId);
    await auditBulkRevoke(params.userId, n, params.reason, params.actorId);
    return n;
  }
}
