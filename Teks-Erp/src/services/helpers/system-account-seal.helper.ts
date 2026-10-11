// =============================================================================
// SİSTEM HESABI MÜHRÜ (G1) — `isSystemAccount` tek başına yetki VERMEZ
// =============================================================================
// Mühür = kurulum anahtarıyla (lisans çekirdeği) imzalı `{id, ad, kimlik özeti}`. DB'ye yazabilen
// biri bayrağı kendi hesabına koyabilir ya da süperadminin parola özetini değiştirebilir; anahtar
// LICENSE_DIR'dedir, DB'de değil ⇒ geçerli mührü üretemez.
//
// MANDAL (`LICENSE_DIR/sistem-hesabi-mandali.json`): VAR ⇒ mühür ZORUNLU (fail-closed: okunamayan
// dosya VAR sayılır); YOK ⇒ bugünkü davranış + uyarı bandı (mühürsüz eski kurulum kilitlenmez).
// İmzasızdır: gevşetmenin tek yolu dosyayı SİLMEK, imza silmeyi engellemez; DB-yalnız saldırgan
// dosyaya erişemez. Mandalı mühürleme yazar (doğuş, kurulum aracı, `--muhurle`).
//
// TEK YÜKLEM `isSystemAccountAuthorized`: istek kapısı, izin kümesi ve giriş kapısı bunu okur.
// Kimlik kolonu yazan her yol `credentialReseal` ile AYNI yazımda yeni mührü koyar (önceki mühür
// geçerliyse; geçersizi AKLAMAZ) — kapsamı `test_sistem_hesabi_muhru` §4 ölçer.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { getLicenseCore } from "../../lib/license/native";
import { getLicenseStore, LICENSE_FILES, resolveLicenseDir, writeFileAtomicSync } from "../../lib/license/store";
import type { SealCheckStatus, SystemSealDoc } from "../../lib/license/system-seal";
import { AuditService } from "../audit.service";
import { uyari } from "../../lib/logger";
import { AppError } from "../../utils/app-error";

/** Mührün ve kararın okuduğu satır — kimlik özeti bu kolonlardan doğar. */
export const SEAL_ROW_SELECT = {
  id: true,
  username: true,
  isSystemAccount: true,
  systemAccountSeal: true,
  passwordHash: true,
  quickPinDigest: true,
  quickPin: true,
  cardTokenDigest: true,
  cardToken: true,
} as const;

export interface SealRow {
  readonly id: string;
  readonly username: string;
  readonly isSystemAccount: boolean;
  readonly systemAccountSeal: string | null;
  readonly passwordHash: string;
  readonly quickPinDigest: string | null;
  readonly quickPin: string | null;
  readonly cardTokenDigest: string | null;
  readonly cardToken: string | null;
}

/** Kimlik kolonları (mühre giren); `username` ayrıca belgenin `ad` alanıdır. */
export type CredentialChange = Partial<
  Pick<SealRow, "passwordHash" | "quickPinDigest" | "quickPin" | "cardTokenDigest" | "cardToken" | "username">
>;

/** `MUHURSUZ`: sistem hesabı ama mühür yok · `SISTEM_DEGIL`: sıradan kullanıcı · gerisi çekirdekten. */
export type SealStatus = SealCheckStatus | "MUHURSUZ" | "SISTEM_DEGIL" | "DIZIN_YOK";
export type LatchState = "VAR" | "YOK";

export const SYSTEM_ACCOUNT_SEAL_INVALID_CODE = "SYSTEM_ACCOUNT_SEAL_INVALID";
/** Kurulu sunucuda (Docker konteyneri / Windows uygulama dizini) tek seferlik komut; ayrıntı belgede. */
export const SEAL_COMMAND_HINT = "node dist/tools/superadmin-olustur.cjs --muhurle (belge: SUPERADMIN-KURULUM)";

/** Kimlik özeti: sabit sıralı satırlar → sha256 hex. Eski düz PIN/kart kolonları da girer. */
export function credentialDigest(row: Omit<SealRow, "id" | "username" | "isSystemAccount" | "systemAccountSeal">): string {
  const lines = [
    `p:${row.passwordHash}`,
    `q:${row.quickPinDigest ?? ""}`,
    `Q:${row.quickPin ?? ""}`,
    `c:${row.cardTokenDigest ?? ""}`,
    `C:${row.cardToken ?? ""}`,
  ];
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

function sealDocOf(row: SealRow): SystemSealDoc {
  return { id: row.id, ad: row.username, kimlik: credentialDigest(row) };
}

/** Mührün anahtar dizini; kullanılamayan konum (program/yedek dizini içi) ⇒ null. */
export function sealDir(): string | null {
  const store = getLicenseStore();
  if (store) return store.problem === "APP_ICINDE" || store.problem === "YEDEK_ICINDE" ? null : store.dir;
  const resolved = resolveLicenseDir();
  return resolved.problem ? null : resolved.dir;
}

// ── Mandal ───────────────────────────────────────────────────────────────────
export const SYSTEM_ACCOUNT_LATCH_FILE = LICENSE_FILES.SYSTEM_ACCOUNT_LATCH;
const LATCH_TTL_MS = 5_000;
let latchCache: { dir: string | null; state: LatchState; at: number } | null = null;

/** VAR ⇒ mühür zorunlu. Dosya var ama okunamıyorsa da VAR (fail-closed); dizin yoksa YOK. */
export function readLatch(now: number = Date.now()): LatchState {
  const dir = sealDir();
  if (latchCache && latchCache.dir === dir && now - latchCache.at < LATCH_TTL_MS) return latchCache.state;
  let state: LatchState = "YOK";
  if (dir) {
    try {
      fs.statSync(path.join(dir, SYSTEM_ACCOUNT_LATCH_FILE));
      state = "VAR";
    } catch (e) {
      state = (e as NodeJS.ErrnoException).code === "ENOENT" ? "YOK" : "VAR";
    }
  }
  latchCache = { dir, state, at: now };
  return state;
}

/** Mandalı bir kez yazar (varsa dokunmaz). Yazılamazsa false — mühür yine geçerlidir, zorunluluk açılmaz. */
export function writeLatch(kid: string, now: Date = new Date()): boolean {
  const dir = sealDir();
  if (!dir) return false;
  const file = path.join(dir, SYSTEM_ACCOUNT_LATCH_FILE);
  try {
    if (!fs.existsSync(file)) {
      writeFileAtomicSync(file, `${JSON.stringify({ v: 1, kid, kuruldu: now.toISOString() })}\n`);
    }
    latchCache = null;
    return true;
  } catch (e) {
    uyari("superadmin", `sistem hesabı mandalı yazılamadı (${(e as Error).message})`);
    return false;
  }
}

// ── Mühür durumu ─────────────────────────────────────────────────────────────
const VALID_CACHE_MAX = 64;
const validCache = new Set<string>();

function cacheKey(row: SealRow, dir: string): string {
  return `${dir}\n${row.id}\n${row.username}\n${row.systemAccountSeal ?? ""}\n${credentialDigest(row)}`;
}

export function sealStatus(row: SealRow): SealStatus {
  if (!row.isSystemAccount) return "SISTEM_DEGIL";
  if (row.systemAccountSeal === null) return "MUHURSUZ";
  const dir = sealDir();
  if (!dir) return "DIZIN_YOK";
  const key = cacheKey(row, dir);
  if (validCache.has(key)) return "GECERLI";
  const status = getLicenseCore().verifySystemAccountSeal(dir, sealDocOf(row), row.systemAccountSeal).durum;
  if (status === "GECERLI") {
    if (validCache.size >= VALID_CACHE_MAX) validCache.clear();
    validCache.add(key);
  }
  return status;
}

/**
 * TEK YÜKLEM — sistem hesabının yetkisi (`["*"]`, `req.isSystemAccount`, girişte sistem hesabı).
 * Mandal varken yalnız geçerli mühür; mandal yokken bugünkü davranış (bayrak yeter).
 */
export function isSystemAccountAuthorized(row: SealRow | null | undefined): boolean {
  if (!row?.isSystemAccount) return false;
  if (sealStatus(row) === "GECERLI") return true;
  return readLatch() === "YOK";
}

/** Mandallı kurulumda geçersiz mühürlü sistem hesabı (giriş kapısı 403 bunu okur). */
export function isSealRejected(row: SealRow | null | undefined): boolean {
  return row?.isSystemAccount === true && !isSystemAccountAuthorized(row);
}

const reportedInvalid = new Set<string>();

/** Süreç başına hesap+mühür başına BİR audit izi (giriş denemesi ya da istek reddi). */
export async function reportInvalidSeal(row: SealRow): Promise<void> {
  const key = `${row.id}\n${row.systemAccountSeal ?? ""}`;
  if (reportedInvalid.has(key)) return;
  if (reportedInvalid.size > 256) reportedInvalid.clear();
  reportedInvalid.add(key);
  const status = sealStatus(row);
  uyari("superadmin", `sistem hesabı mührü geçersiz (${status}) — yetki verilmedi; sunucuda: ${SEAL_COMMAND_HINT}`);
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "SYSTEM_ACCOUNT_SEAL_INVALID",
    tableName: "users",
    recordId: row.id,
    payload: { durum: status },
  }).catch(() => undefined);
}

/** Giriş kapısı (tek token üreticisi `issueToken` çağırır): mandallı kurulumda geçersiz mühürlü sistem hesabı 403. */
export async function assertSealAllowsLogin(userId: string): Promise<void> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: SEAL_ROW_SELECT });
  if (!row || !isSealRejected(row)) return;
  await reportInvalidSeal(row);
  throw AppError.forbidden(`Bu hesabın sunucu mührü geçersiz — giriş kapalı. Sunucuda: ${SEAL_COMMAND_HINT}`, {
    code: SYSTEM_ACCOUNT_SEAL_INVALID_CODE,
  });
}

// ── Yazarlar ─────────────────────────────────────────────────────────────────
type SealDb = Pick<Prisma.TransactionClient, "user">;

/**
 * Kimlik kolonu yazan yolun AYNI yazıma eklediği parçalar. Önceki mühür geçerliyse yeni mühür
 * `data`ya, eski mühür `where`e girer (arada başka bir yazar mührü değiştirdiyse 0 satır ⇒ 409).
 * Önceki mühür geçersiz/yoksa boş döner: değişim mührü AKLAMAZ.
 */
export async function credentialReseal(
  db: SealDb,
  userId: string,
  change: CredentialChange,
): Promise<{ where: { systemAccountSeal?: string }; data: { systemAccountSeal?: string } }> {
  const before = await db.user.findUnique({ where: { id: userId }, select: SEAL_ROW_SELECT });
  if (!before?.isSystemAccount || before.systemAccountSeal === null) return { where: {}, data: {} };
  if (sealStatus(before) !== "GECERLI") return { where: {}, data: {} };
  const dir = sealDir();
  if (!dir) return { where: {}, data: {} };
  const after: SealRow = { ...before, ...change };
  const sealed = getLicenseCore().sealSystemAccount(dir, sealDocOf(after));
  if (sealed.durum !== "MUHURLENDI") return { where: {}, data: {} };
  return { where: { systemAccountSeal: before.systemAccountSeal }, data: { systemAccountSeal: sealed.muhur } };
}

export type WriteSealResult =
  | { readonly durum: "MUHURLENDI"; readonly kid: string }
  | { readonly durum: "SISTEM_DEGIL" | "DIZIN_YOK" | "MUHURLENEMEDI"; readonly neden?: string };

/**
 * Hesabın GÜNCEL satırını mühürler (doğuş, kurulum aracı, `--muhurle`). Kimlik kanıtı ÇAĞIRANDADIR
 * (konsol + parola); mühürlenemezse kolon NULL'lanır — eski mühür yeni kimliği taşımaz.
 */
export async function writeSeal(db: SealDb, userId: string): Promise<WriteSealResult> {
  const row = await db.user.findUnique({ where: { id: userId }, select: SEAL_ROW_SELECT });
  if (!row?.isSystemAccount) return { durum: "SISTEM_DEGIL" };
  const dir = sealDir();
  if (!dir) {
    if (row.systemAccountSeal !== null) await db.user.update({ where: { id: userId }, data: { systemAccountSeal: null } });
    return { durum: "DIZIN_YOK" };
  }
  const sealed = getLicenseCore().sealSystemAccount(dir, sealDocOf(row));
  if (sealed.durum !== "MUHURLENDI") {
    if (row.systemAccountSeal !== null) await db.user.update({ where: { id: userId }, data: { systemAccountSeal: null } });
    return { durum: "MUHURLENEMEDI", neden: sealed.durum };
  }
  await db.user.update({ where: { id: userId }, data: { systemAccountSeal: sealed.muhur } });
  return { durum: "MUHURLENDI", kid: sealed.kid };
}

// ── Görünürlük ───────────────────────────────────────────────────────────────
export type SealSummaryStatus = "TAMAM" | "MUHURLENMELI" | "GECERSIZ_HESAP" | "HESAP_YOK";
export interface SealSummary {
  readonly mandal: LatchState;
  readonly durum: SealSummaryStatus;
  readonly hesapSayisi: number;
  /** Geçerli mührü olmayan aktif sistem hesabı (= mühürsüz + bozuk). */
  readonly gecersizSayisi: number;
  readonly muhurluSayisi: number;
  readonly muhursuzSayisi: number;
  /** Mühür var ama doğrulanmıyor (bozuk bayt, başka kurulum, kimlik özeti tutmuyor…). */
  readonly bozukSayisi: number;
}

/** Panel bandı: `pending` mühürlenmemiş kurulum · `invalid` mührü geçersiz hesap · `ok` gerisi. */
export type SealBandStatus = "ok" | "pending" | "invalid";
export function sealBandStatus(summary: SealSummary): SealBandStatus {
  if (summary.durum === "MUHURLENMELI") return "pending";
  if (summary.durum === "GECERSIZ_HESAP") return "invalid";
  return "ok";
}

/**
 * Health + panel bandı: mandal, sistem hesabı sayısı, geçerli mührü olmayan hesap sayısı.
 * Yalnız AKTİF hesaplar: pasife alınan sahte hesap yetki de giriş de alamaz, bandı sonsuza dek tutmaz.
 */
export async function sealSummary(): Promise<SealSummary> {
  const rows = await prisma.user.findMany({
    where: { isSystemAccount: true, isActive: true, deletedAt: null },
    select: SEAL_ROW_SELECT,
  });
  const latch = readLatch();
  const sealed = rows.filter((r) => sealStatus(r) === "GECERLI").length;
  const unsealed = rows.filter((r) => r.systemAccountSeal === null).length;
  const invalid = rows.length - sealed;
  const status: SealSummaryStatus =
    rows.length === 0 ? "HESAP_YOK" : latch === "YOK" ? "MUHURLENMELI" : invalid > 0 ? "GECERSIZ_HESAP" : "TAMAM";
  return {
    mandal: latch,
    durum: status,
    hesapSayisi: rows.length,
    gecersizSayisi: invalid,
    muhurluSayisi: sealed,
    muhursuzSayisi: unsealed,
    bozukSayisi: invalid - unsealed,
  };
}

/** Health alanı: özet ya da okunamadıysa `null` ("sorun yok" sanılmasın diye hata boş özete inmez). */
export async function sealHealthSnapshot(): Promise<SealSummary | null> {
  try {
    return await sealSummary();
  } catch {
    return null;
  }
}

/** Bekçi: önbellekleri sıfırlar (mandal/mühür dosyası test içinde değişir). */
export function resetSystemAccountSealCacheForTest(): void {
  latchCache = null;
  validCache.clear();
  reportedInvalid.clear();
}
