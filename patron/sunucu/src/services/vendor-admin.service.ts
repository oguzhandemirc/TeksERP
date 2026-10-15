// SATICI YÖNETİMİ (CLI — `scripts/tesis.ts`; göç rolüyle, VDS'te konteyner içinden) — satıcının
// Müşteri → Tesis → Kurulum ağacının buluttaki yansıması (`KURULUM_KAYNAGI=kayit` kipinde) ve İLK
// tesis yöneticisinin daveti. Tesis yöneticisi ekibini kendisi yönetir; satıcı yalnız ilk yöneticiyi
// açar ve yönetici kalmadığında sıfırlar — tesiste AKTİF yönetici varken yönetici daveti/yükseltmesi RED,
// yalnız açık zorlama (talep no + gerekçe) ile ve denetime yazılarak. Her eylem `satici-cli` aktörüyle düşer.
// Paylaşımlı (birden çok tesise üye) kimliğin sırrını YALNIZ satıcı sıfırlar (`resetIdentity`, her zaman zorlamayla).
import type { LicenseClass } from "@prisma/client";
import { createInvite } from "../auth/invite.service";
import { closeIdentitySessions, identityEngagedOutside, membershipRoutes } from "../auth/membership";
import { normalizeEmail } from "../auth/session.service";
import { ROLE_TEMPLATES } from "../catalog/permissions";
import { publicKeyFromX } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { CloudError, notFound, stateConflict } from "../lib/errors";
import { uniqueViolationOn } from "../lib/prisma-errors";
import { withCentral, withTesis } from "../lib/tenant";
import type { Tx } from "../lib/db";
import { ADMIN_PERMISSION, assertEmailFreeInFacility, emailInUseHere } from "./account.service";
import { bindInstallationRoute, safeKeyId } from "./installation-directory";
import type { TesisDbRouter } from "../lib/tesis-db";

export const VENDOR_ACTOR = "satici-cli";
export const RETENTION_CHOICES: readonly (number | null)[] = [3, 13, 25, null];

export async function openFacility(db: TesisDbRouter, g: { tesisId: string; name: string; retentionMonths?: number | null }) {
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

export async function setFacilityStatus(db: TesisDbRouter, g: { tesisId: string; status: "AKTIF" | "PASIF" }) {
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

export async function registerInstallation(db: TesisDbRouter, g: InstallationInput, nowMs: number = Date.now()) {
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
  if (!(await bindInstallationRoute(db, g.installationId, g.tesisId))) throw new CloudError(409, "KURULUM_BASKA_TESISTE", "Bu kurulum başka bir tesise kayıtlı; kurulum tesis değiştiremez");
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
export async function inviteFacilityAdmin(db: TesisDbRouter, g: { tesisId: string; email: string; name: string; validHours: number; zorla?: VendorOverride }, nowMs: number = Date.now()) {
  const invite = createInvite(g.tesisId, nowMs, g.validHours);
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
export async function reinviteAdmin(db: TesisDbRouter, g: { tesisId: string; email: string; validHours: number; zorla?: VendorOverride }, nowMs: number = Date.now()) {
  const invite = createInvite(g.tesisId, nowMs, g.validHours);
  const email = normalizeEmail(g.email);
  const { account, active } = await withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId } }, async (tx) => {
    // Aynı tesiste aynı e-postalı PASİF satır(lar) da olabilir; hedef PASİF OLMAYAN tek hesaptır.
    const a = await tx.account.findFirst({ where: { tesisId: g.tesisId, email, status: { not: "PASIF" } } });
    if (!a) {
      if (await tx.account.findFirst({ where: { tesisId: g.tesisId, email }, select: { id: true } })) throw stateConflict("Arşivdeki hesap yeniden davet edilemez");
      throw notFound("Hesap");
    }
    const active = await assertNoActiveAdmin(tx, g.tesisId, g.zorla);
    // Paylaşımlı kimlik bu yoldan sıfırlanmaz (kabul yeniden sırlamaz, davet ölü kalırdı): `kimlik-sifirla` kullanılır.
    if (a.identityId && (await identityEngagedOutside({ app: db }, a.identityId, { tesisId: g.tesisId }))) {
      throw new CloudError(409, "KIMLIK_PAYLASIMLI", "Hesabın bulut kimliği başka tesise de bağlı; sırrı `kimlik-sifirla --zorla --talep=<no> --gerekce=\"…\"` ile sıfırlayın");
    }
    // Atomik claim: hedef okunduğu durumda değilse (bu arada değişti) dokunulmaz.
    const claimed = await tx.account.updateMany({
      where: { id: a.id, tesisId: g.tesisId, status: a.status },
      data: {
        status: "DAVETLI",
        identityId: null,
        inviteTokenHash: invite.digest,
        inviteExpiresAt: invite.expiresAt,
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

/**
 * Kimlik sırrı sıfırlaması (satıcı; telefon/parola kaybı, kimlik birden çok tesise üye): HER ZAMAN zorlamayla. Kimlik
 * DAVETLİ'ye iner ve sırları silinir (bütün tesislerde giriş durur, bütün üyeliklerin oturumları kapanır); `tesisId`teki
 * üyelik hesabı kimliğe BAĞLI kalarak yeni davet alır — yalnız bu davetin kabulü kimliği yeniden sırlar (`identityReclaimable`
 * (b)); öteki tesislerin hesapları AKTİF kalır ve onayla yeniden açılır. Her üyelik tesisinin denetimine yazılır.
 * Kilit sırası: merkez LOGIN_ROUTE → tesis ACCOUNT_ADMIN.
 */
export async function resetIdentity(db: TesisDbRouter, g: { tesisId: string; email: string; validHours: number; zorla?: VendorOverride }, nowMs: number = Date.now()) {
  const zorla = g.zorla;
  if (!zorla) throw new CloudError(400, "GOVDE_GECERSIZ", "Kimlik sıfırlaması yalnız --zorla --talep=<talep no> --gerekce=\"…\" ile yapılır (denetime yazılır)");
  const emailDigest = db.key.emailDigest(normalizeEmail(g.email));
  const invite = createInvite(g.tesisId, nowMs, g.validHours);
  const { identityId, accountId } = await withCentral(db, { lock: { name: "LOGIN_ROUTE", key: emailDigest } }, async (central) => {
    const identity = await central.identity.findUnique({ where: { emailDigest } });
    if (!identity || identity.identityPurgedAt) throw notFound("Kimlik");
    const route = await central.loginRoute.findUnique({ where: { identityId_tesisId: { identityId: identity.id, tesisId: g.tesisId } } });
    if (!route) throw notFound("Kimliğin bu tesisteki üyeliği");
    const ir = await central.identity.updateMany({
      where: { id: identity.id, status: identity.status, updatedAt: identity.updatedAt },
      data: { status: "DAVETLI", passwordHash: null, totpSecretSealed: null, totpLastStep: null, closedAt: null },
    });
    if (ir.count === 0) throw stateConflict("Kimlik bu arada değişti; tekrar deneyin");
    await withTesis(db, { tesisId: g.tesisId, lock: { name: "ACCOUNT_ADMIN", key: g.tesisId } }, async (tx) => {
      const claimed = await tx.account.updateMany({
        where: { id: route.accountId, tesisId: g.tesisId, identityId: identity.id, status: { in: ["AKTIF", "KILITLI", "DAVETLI"] } },
        data: { status: "DAVETLI", inviteTokenHash: invite.digest, inviteExpiresAt: invite.expiresAt },
      });
      if (claimed.count === 0) throw stateConflict("Üyeliğin hesabı bu tesiste etkin değil; kimlik sıfırlanamaz");
    });
    return { identityId: identity.id, accountId: route.accountId };
  });
  const closed = await closeIdentitySessions({ app: db }, identityId, { nowMs, reason: "SIFIRLAMA" });
  const summary = { zorla: true, talep: zorla.talep, gerekce: zorla.gerekce };
  for (const r of await membershipRoutes({ app: db }, identityId)) {
    const own = r.tesisId === g.tesisId;
    const oturum = closed.find((c) => c.tesisId === r.tesisId)?.count ?? 0;
    await recordAudit(db, { tesisId: r.tesisId, actor: VENDOR_ACTOR, event: "KIMLIK_SIFIRLANDI", entity: "Account", entityId: r.accountId, summary: own ? { ...summary, oturum } : { zorla: true, talep: zorla.talep, oturum } });
  }
  return { accountId, token: invite.token, expiresAt: invite.expiresAt };
}
