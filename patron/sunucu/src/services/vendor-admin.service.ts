// SATICI YÖNETİMİ (CLI — `scripts/tesis.ts`; göç rolüyle, VDS'te konteyner içinden) — satıcının
// Müşteri → Tesis → Kurulum ağacının buluttaki yansıması (`KURULUM_KAYNAGI=kayit` kipinde) ve İLK
// tesis yöneticisinin daveti. Tesis yöneticisi ekibini kendisi yönetir; satıcı yalnız ilk yöneticiyi
// açar ve yönetici kalmadığında sıfırlar — tesiste AKTİF yönetici varken yönetici daveti/yükseltmesi RED,
// yalnız açık zorlama (talep no + gerekçe) ile ve denetime yazılarak. Her eylem `satici-cli` aktörüyle düşer.
import type { LicenseClass, PrismaClient } from "@prisma/client";
import { createInvite } from "../auth/invite.service";
import { normalizeEmail } from "../auth/session.service";
import { ROLE_TEMPLATES } from "../catalog/permissions";
import { publicKeyFromX } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { CloudError, notFound, stateConflict } from "../lib/errors";
import { uniqueViolationOn } from "../lib/prisma-errors";
import { withTesis } from "../lib/tenant";
import type { Tx } from "../lib/db";
import { ADMIN_PERMISSION, assertEmailFreeInFacility, emailInUseHere } from "./account.service";
import { safeKeyId } from "./installation-directory";

export const VENDOR_ACTOR = "satici-cli";
export const RETENTION_CHOICES: readonly (number | null)[] = [3, 13, 25, null];

export async function openFacility(db: PrismaClient, g: { tesisId: string; name: string; retentionMonths?: number | null }) {
  if (g.retentionMonths !== undefined && !RETENTION_CHOICES.includes(g.retentionMonths)) throw new CloudError(400, "GOVDE_GECERSIZ", "Saklama 3, 13, 25 ay ya da 'tumu' olmalı");
  const row = await withTesis(db, { tesisId: g.tesisId }, (tx) =>
    tx.facility.upsert({
      where: { tesisId: g.tesisId },
      create: { tesisId: g.tesisId, name: g.name, ...(g.retentionMonths === undefined ? {} : { retentionMonths: g.retentionMonths }) },
      update: { name: g.name, status: "AKTIF", ...(g.retentionMonths === undefined ? {} : { retentionMonths: g.retentionMonths }) },
    }),
  );
  await recordAudit(db, { tesisId: g.tesisId, actor: VENDOR_ACTOR, event: "TESIS_KAYDI", entity: "Facility", entityId: g.tesisId, summary: { saklamaAy: row.retentionMonths } });
  return row;
}

export async function setFacilityStatus(db: PrismaClient, g: { tesisId: string; status: "AKTIF" | "PASIF" }) {
  const r = await withTesis(db, { tesisId: g.tesisId }, (tx) => tx.facility.updateMany({ where: { tesisId: g.tesisId }, data: { status: g.status } }));
  if (r.count === 0) throw notFound("Tesis");
  await recordAudit(db, { tesisId: g.tesisId, actor: VENDOR_ACTOR, event: `TESIS_${g.status}`, entity: "Facility", entityId: g.tesisId });
}

export interface InstallationInput {
  readonly tesisId: string;
  readonly installationId: string;
  readonly publicKeyX: string;
  readonly licenseClass: LicenseClass;
  readonly modules: readonly string[];
  readonly cloudUntil: Date | null;
  readonly handedOver?: boolean;
  readonly active?: boolean;
}

export async function registerInstallation(db: PrismaClient, g: InstallationInput, nowMs: number = Date.now()) {
  if (!publicKeyFromX(g.publicKeyX)) throw new CloudError(400, "GOVDE_GECERSIZ", "Kurulum açık anahtarı biçimsiz (Ed25519 x, base64url)");
  const fields = {
    publicKeyX: g.publicKeyX,
    keyId: safeKeyId(g.publicKeyX),
    licenseClass: g.licenseClass,
    modules: [...g.modules],
    cloudUntil: g.cloudUntil,
    handedOver: g.handedOver ?? false,
    active: g.active ?? true,
    source: "KAYIT" as const,
    refreshedAt: new Date(nowMs),
  };
  const row = await withTesis(db, { tesisId: g.tesisId }, (tx) =>
    tx.installation.upsert({ where: { installationId: g.installationId }, create: { tesisId: g.tesisId, installationId: g.installationId, ...fields }, update: fields }),
  );
  await recordAudit(db, {
    tesisId: g.tesisId,
    actor: VENDOR_ACTOR,
    event: "KURULUM_KAYDI",
    entity: "Installation",
    entityId: g.installationId,
    summary: { sinif: g.licenseClass, patronBulut: g.modules.includes("patron-bulut"), bitis: g.cloudUntil?.toISOString() ?? null },
  });
  return row;
}

/** Satıcının yönetim kapısını aşması: talep numarası + gerekçe zorunlu; ikisi de denetime yazılır. */
export interface VendorOverride {
  readonly talep: string;
  readonly gerekce: string;
}

/** CLI bayrakları → zorlama: `--zorla` yalnız `--talep` ve `--gerekce` ile; bayraksız talep/gerekçe de RED (açıklık). */
export function overrideFromArgs(a: Readonly<Record<string, string | undefined>>): VendorOverride | undefined {
  const zorla = a.zorla === "true";
  if (!zorla && (a.talep !== undefined || a.gerekce !== undefined)) throw new CloudError(400, "GOVDE_GECERSIZ", "--talep/--gerekce yalnız --zorla ile verilir");
  if (!zorla) return undefined;
  const talep = (a.talep ?? "").trim();
  const gerekce = (a.gerekce ?? "").trim();
  if (talep.length < 3 || talep.length > 60) throw new CloudError(400, "GOVDE_GECERSIZ", "--zorla için --talep=<talep no> (3–60 karakter) zorunlu");
  if (gerekce.length < 10 || gerekce.length > 500) throw new CloudError(400, "GOVDE_GECERSIZ", "--zorla için --gerekce=\"…\" (10–500 karakter) zorunlu");
  return { talep, gerekce };
}

/**
 * Tesiste AKTİF hesap yöneticisi varsa satıcı yönetici açamaz/yükseltemez (yönetim tesisindedir; destek erişimi
 * ayrı, kayıtlı yoldur). Zorlama yalnız açık talep + gerekçeyle; dönen sayı denetim özetine girer.
 */
async function assertNoActiveAdmin(tx: Tx, tesisId: string, override: VendorOverride | undefined): Promise<number> {
  const active = await tx.account.count({ where: { tesisId, status: "AKTIF", permissions: { has: ADMIN_PERMISSION } } });
  if (active > 0 && !override) {
    throw new CloudError(409, "AKTIF_YONETICI_VAR", "Tesiste aktif bir hesap yöneticisi var; hesap yönetimi tesis yöneticisindedir. Zorunluysa --zorla --talep=<no> --gerekce=\"…\" ile (denetime yazılır)");
  }
  return active;
}

const overrideSummary = (override: VendorOverride | undefined, active: number) =>
  override ? { zorla: true, talep: override.talep, gerekce: override.gerekce, aktifYonetici: active } : undefined;

/** İlk tesis yöneticisi (Patron şablonu). Davet belirteci BİR KEZ döner; repoya/loga yazılmaz. */
export async function inviteFacilityAdmin(db: PrismaClient, g: { tesisId: string; email: string; name: string; validHours: number; zorla?: VendorOverride }, nowMs: number = Date.now()) {
  const invite = createInvite(nowMs, g.validHours);
  const email = normalizeEmail(g.email);
  try {
    const { account, active } = await withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId } }, async (tx) => {
      if (!(await tx.facility.findUnique({ where: { tesisId: g.tesisId } }))) throw notFound("Tesis");
      const active = await assertNoActiveAdmin(tx, g.tesisId, g.zorla);
      await assertEmailFreeInFacility(tx, g.tesisId, email);
      const account = await tx.account.create({
        data: { tesisId: g.tesisId, email, name: g.name, permissions: [...ROLE_TEMPLATES.PATRON], status: "DAVETLI", inviteTokenHash: invite.digest, inviteExpiresAt: invite.expiresAt },
      });
      return { account, active };
    });
    const summary = overrideSummary(g.zorla, active);
    await recordAudit(db, { tesisId: g.tesisId, actor: VENDOR_ACTOR, event: "YONETICI_DAVET", entity: "Account", entityId: account.id, ...(summary ? { summary } : {}) });
    return { accountId: account.id, token: invite.token, expiresAt: invite.expiresAt };
  } catch (err) {
    if (uniqueViolationOn(err, "tesis_email")) throw emailInUseHere();
    throw err;
  }
}

/** Yönetici kalmadığında kurtarma: hesabı sıfırlayıp yönetici olarak yeniden davet eder (oturumlar kapanır). */
export async function reinviteAdmin(db: PrismaClient, g: { tesisId: string; email: string; validHours: number; zorla?: VendorOverride }, nowMs: number = Date.now()) {
  const invite = createInvite(nowMs, g.validHours);
  const email = normalizeEmail(g.email);
  const { account, active } = await withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId } }, async (tx) => {
    // Aynı tesiste aynı e-postalı PASİF satır(lar) da olabilir; hedef PASİF OLMAYAN tek hesaptır.
    const a = await tx.account.findFirst({ where: { tesisId: g.tesisId, email, status: { not: "PASIF" } } });
    if (!a) {
      if (await tx.account.findFirst({ where: { tesisId: g.tesisId, email }, select: { id: true } })) throw stateConflict("Arşivdeki hesap yeniden davet edilemez");
      throw notFound("Hesap");
    }
    const active = await assertNoActiveAdmin(tx, g.tesisId, g.zorla);
    // Atomik claim: hedef okunduğu durumda değilse (bu arada değişti) dokunulmaz.
    const claimed = await tx.account.updateMany({
      where: { id: a.id, tesisId: g.tesisId, status: a.status },
      data: {
        status: "DAVETLI",
        passwordHash: null,
        totpSecretSealed: null,
        totpLastStep: null,
        inviteTokenHash: invite.digest,
        inviteExpiresAt: invite.expiresAt,
        failedLogins: 0,
        lockedUntil: null,
        permissions: [...new Set([...a.permissions, ADMIN_PERMISSION])],
      },
    });
    if (claimed.count === 0) throw stateConflict("Hesap bu arada değişti; tekrar deneyin");
    await tx.session.updateMany({ where: { accountId: a.id, closedAt: null }, data: { closedAt: new Date(nowMs), closeReason: "SIFIRLAMA" } });
    return { account: await tx.account.findUniqueOrThrow({ where: { id: a.id } }), active };
  });
  const summary = overrideSummary(g.zorla, active);
  await recordAudit(db, { tesisId: g.tesisId, actor: VENDOR_ACTOR, event: "YONETICI_YENIDEN_DAVET", entity: "Account", entityId: account.id, ...(summary ? { summary } : {}) });
  return { accountId: account.id, token: invite.token, expiresAt: invite.expiresAt };
}
