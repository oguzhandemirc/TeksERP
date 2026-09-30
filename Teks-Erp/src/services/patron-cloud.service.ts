// =============================================================================
// Patron bulutu — fabrika tarafı yönetim yüzeyi: TEKNİK KULLANICI ve "Bulut hesapları" listesi
// =============================================================================
// Bulut yazmaları (gelen kutusu) fabrikada normal servis yolundan geçer ve `createdById` bir `User` FK'sidir ⇒
// kurulum başına bir teknik kullanıcı "Patron Bulutu": giriş yöntemi YOK (parolası kimsenin bilmediği rastgele
// değer, PIN/kart/TOTP üretilmez), izinleri yalnız `order:write` + `customer:write`. Panelde "Patron bulutunu
// etkinleştir" eylemiyle NORMAL kullanıcı servisinden audit'li doğar; kimliği `system_settings` KAYDINDA durur
// (`User`a işaret kolonu eklenmez). Kimliksiz tablet listesinden beyanlı hariçtir (`AuthService.listMobileUsers`).
// =============================================================================
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { PermissionManagementService } from "./permission-management.service";
import { PATRON_CLOUD_USER_SETTING_KEY } from "../constants/reserved-settings";
import { cloudEligibility, type CloudBlockReason } from "../cloud-sync/eligibility";
import { getCloudUrl, type CloudUrlSource } from "../cloud-sync/cloud-url";
import { cloudPost, egressCloudTransport, type CloudTransport } from "../cloud-sync/cloud-client";
import { AccountLockResponseSchema, ENVELOPE_VERSION, SYNC_PATHS, type CloudAccount } from "../cloud-sync/wire";
import { readPatronCloudUserId } from "./helpers/patron-cloud-user.helper";

/** Teknik kullanıcının kullanıcı adı (panel kuralı: yalnız İngilizce harf + rakam). */
export const PATRON_CLOUD_USERNAME = "patronbulutu";
export const PATRON_CLOUD_FULL_NAME = "Patron Bulutu";
/** Teknik kullanıcının TAM izin kümesi — başka izin verilmez. */
export const PATRON_CLOUD_PERMISSIONS = ["order:write", "customer:write"] as const;

export { readPatronCloudUserId };

/** İşleyicinin aktörü: kayıtlı VE aktif VE silinmemiş teknik kullanıcı; değilse null (gelen kutusu çekilmez). */
export async function resolveActivePatronCloudUserId(): Promise<string | null> {
  const id = await readPatronCloudUserId();
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { isActive: true, deletedAt: true } });
  return u && u.isActive && !u.deletedAt ? id : null;
}

async function ensurePermissions(userId: string, actorUserId: string | undefined): Promise<void> {
  const perms = await prisma.permission.findMany({ where: { code: { in: [...PATRON_CLOUD_PERMISSIONS] } }, select: { id: true, code: true } });
  if (perms.length !== PATRON_CLOUD_PERMISSIONS.length) {
    throw AppError.conflict("İzin kataloğu eksik (sipariş/cari yazma izinleri bulunamadı); sunucuyu yeniden başlatıp tekrar deneyin.", {
      code: "PATRON_BULUT_IZIN_KATALOGU",
    });
  }
  for (const p of perms) await PermissionManagementService.grantPermission(userId, { permissionId: p.id }, actorUserId);
}

export interface PatronCloudActivation {
  readonly userId: string;
  readonly created: boolean;
}

/**
 * "Patron bulutunu etkinleştir" — idempotent: kayıtlı teknik kullanıcı varsa (pasifse yeniden aktifleştirilir)
 * izinleri tamamlanır; yoksa normal kullanıcı servisinden doğar. Kayıt, kullanıcı doğar doğmaz yazılır; izinler
 * ondan SONRA verilir (yarıda kalırsa bir sonraki etkinleştirme tamamlar). Aynı adda BAŞKA bir hesap varsa sahiplenilmez
 * (giriş yöntemi olabilir) — 409, TR mesaj.
 */
export async function activatePatronCloud(actorUserId: string | undefined): Promise<PatronCloudActivation> {
  const existingId = await readPatronCloudUserId();
  if (existingId) {
    const u = await prisma.user.findUnique({ where: { id: existingId }, select: { id: true, isActive: true, deletedAt: true } });
    if (u && !u.deletedAt) {
      if (!u.isActive) await PermissionManagementService.reactivateUser(u.id, actorUserId);
      await ensurePermissions(u.id, actorUserId);
      return { userId: u.id, created: false };
    }
  }
  let userId: string;
  try {
    const user = await PermissionManagementService.createUser(
      {
        username: PATRON_CLOUD_USERNAME,
        fullName: PATRON_CLOUD_FULL_NAME,
        // Kimsenin bilmediği parola: hesap giriş yapamaz (parola hiçbir yere yazılmaz, loglanmaz).
        password: randomBytes(48).toString("base64url"),
        isActive: true,
        grantOperatorDefaults: false,
        generateMobileCredentials: false,
      },
      actorUserId,
    );
    userId = user.id;
  } catch (e) {
    const taken =
      (e instanceof AppError && e.statusCode === 409) ||
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
    if (!taken) throw e;
    throw AppError.conflict(
      `'${PATRON_CLOUD_USERNAME}' kullanıcı adı başka bir hesapta kullanılıyor. O hesabı yeniden adlandırın ya da silin, sonra tekrar deneyin.`,
      { code: "PATRON_BULUT_KULLANICI_ADI_DOLU" },
    );
  }
  await prisma.systemSetting.upsert({
    where: { key: PATRON_CLOUD_USER_SETTING_KEY },
    create: {
      key: PATRON_CLOUD_USER_SETTING_KEY,
      value: userId,
      description: "Patron bulutu teknik kullanıcısı (bulut yazmalarının aktörü). Elle DEĞİŞTİRMEYİN.",
      updatedById: actorUserId ?? null,
    },
    update: { value: userId, updatedById: actorUserId ?? null },
  });
  await AuditService.log({
    userId: actorUserId,
    action: existingId ? "UPDATE" : "CREATE",
    tableName: "SYSTEM_SETTING",
    recordId: PATRON_CLOUD_USER_SETTING_KEY,
    oldData: existingId ? { value: existingId } : null,
    newData: { value: userId },
  });
  await ensurePermissions(userId, actorUserId);
  return { userId, created: true };
}

// ── Bulut hesapları (salt okunur; bulut özetinden imzalı istekle çekilir, bellekte tutulur) ─────────────────
let accounts: { readonly list: readonly CloudAccount[]; readonly fetchedAtMs: number } | null = null;

export function recordCloudAccounts(list: readonly CloudAccount[], nowMs: number = Date.now()): void {
  accounts = { list: [...list], fetchedAtMs: nowMs };
}

/** Bulutun kesin retleri → HTTP durumu (kod aynen `details.code`a geçer). Listede olmayan kesin 4xx 409'dur. */
const LOCK_REJECT_STATUS: Readonly<Record<string, number>> = { BULUNAMADI: 404, SON_YONETICI: 409, DURUM_CAKISMASI: 409, ISLEM_KIMLIGI_CAKISTI: 409 };

/**
 * Bulut hesabını KİLİTLE (B6): fabrika yöneticisi → buluta kurulum imzalı istek (`/v1/hesap-kilitle`). Bulut tek
 * yazardır (durum orada değişir); fabrika yalnız ister, sonucu bellekteki listeye yansıtır ve iz bırakır.
 * `islemKimligi` istemcinin MANTIKSAL deneme kimliğidir: ağ/5xx belirsizliğinde istemci AYNI kimlikle yeniden dener.
 */
export async function lockCloudAccount(
  input: { readonly hesapId: string; readonly islemKimligi: string; readonly actorUserId: string | undefined },
  transport: CloudTransport = egressCloudTransport,
): Promise<CloudAccount> {
  const e = cloudEligibility();
  if (!e.ok) throw AppError.conflict("Patron bulutu bu kurulumda kullanılamıyor; hesap kilitlenemedi.", { code: "PATRON_BULUT_KAPALI", neden: e.reason });
  const actor = input.actorUserId
    ? await prisma.user.findUnique({ where: { id: input.actorUserId }, select: { fullName: true, username: true } })
    : null;
  const isteyen = (actor?.fullName || actor?.username || "Fabrika yöneticisi").slice(0, 120);
  const r = await cloudPost(
    { baseUrl: e.baseUrl, installationId: e.installationId, transport },
    SYNC_PATHS.ACCOUNT_LOCK,
    { v: ENVELOPE_VERSION, hesapId: input.hesapId, islemKimligi: input.islemKimligi, isteyen },
    { gzip: false },
  );
  if (!r.ok) {
    if (r.status === 0 || r.status >= 500) {
      throw new AppError("Patron bulutuna ulaşılamadı; aynı işlemi tekrar deneyin.", 503, true, { code: "BULUT_ULASILAMADI", neden: r.code });
    }
    const status = LOCK_REJECT_STATUS[r.code] ?? 409;
    const message = r.code === "SON_YONETICI"
      ? "Tesisin son aktif bulut yöneticisi kilitlenemez; önce bulutta başka bir yönetici atayın."
      : r.code === "BULUNAMADI" ? "Bulut hesabı bulunamadı." : "Bulut hesabı kilitlenemedi.";
    throw new AppError(message, status, true, { code: r.code });
  }
  const parsed = AccountLockResponseSchema.safeParse(r.json);
  if (!parsed.success) throw new AppError("Patron bulutunun yanıtı sözleşmeye uymuyor.", 502, true, { code: "YANIT_GECERSIZ" });
  const hesap = parsed.data.hesap;
  if (accounts) {
    accounts = { list: accounts.list.map((a) => (a.id === hesap.id ? hesap : a)), fetchedAtMs: accounts.fetchedAtMs };
  }
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "PATRON_CLOUD_ACCOUNT_LOCKED",
    userId: input.actorUserId ?? null,
    recordId: hesap.id,
    payload: { ad: hesap.ad, durum: hesap.durum },
  });
  return hesap;
}

// ── Gelen kutusu son tur özeti (sağlık/panel; iş verisi değil) ────────────────────────────────────────────────
export interface InboxRunSummary {
  readonly atMs: number;
  readonly outcome: string;
  readonly pulled: number;
  readonly processed: number;
  readonly rejected: number;
  readonly uncertain: number;
  readonly errorCode: string | null;
}
let lastRun: InboxRunSummary | null = null;
export function recordInboxRun(s: InboxRunSummary): void {
  lastRun = s;
}

export interface PatronCloudStatus {
  readonly etkin: boolean;
  readonly teknikKullanici: { id: string; username: string; fullName: string; isActive: boolean } | null;
  readonly uygunluk: { ok: boolean; neden: CloudBlockReason | null };
  readonly adres: CloudUrlSource;
  readonly hesaplar: readonly CloudAccount[];
  readonly hesaplarAlinma: string | null;
  readonly sonTur: (Omit<InboxRunSummary, "atMs"> & { at: string }) | null;
}

export async function getPatronCloudStatus(): Promise<PatronCloudStatus> {
  const id = await readPatronCloudUserId();
  const u = id
    ? await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, fullName: true, isActive: true, deletedAt: true } })
    : null;
  const user = u && !u.deletedAt ? { id: u.id, username: u.username, fullName: u.fullName, isActive: u.isActive } : null;
  const e = cloudEligibility();
  return {
    etkin: Boolean(user?.isActive),
    teknikKullanici: user,
    uygunluk: { ok: e.ok, neden: e.ok ? null : e.reason },
    adres: getCloudUrl().source,
    hesaplar: accounts?.list ?? [],
    hesaplarAlinma: accounts ? new Date(accounts.fetchedAtMs).toISOString() : null,
    sonTur: lastRun ? { ...lastRun, at: new Date(lastRun.atMs).toISOString() } : null,
  };
}

/** Test-only. */
export function __resetPatronCloudStateForTests(): void {
  accounts = null;
  lastRun = null;
}
