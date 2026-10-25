// =============================================================================
// K4P-SERT — sertifika yazım yolu (oluştur · düzenle · yenile · iptal)
// =============================================================================
// Sertifika DURUM tablosudur (plan §3.4): "iptal" `revokedAt` damgasıdır, yenileme YENİ satırdır
// (`renewsId`) ve eskisi kendiliğinden etkisizleşir — eski satır değişmez. Her geçiş atomik claim:
// `updateMany WHERE {id, etkin}` + count===0 → 409. Çift yenilemenin DB seddi `renewsId @unique`.
// =============================================================================
import { Prisma, type CertificateHolder } from "@prisma/client";
import prisma from "../lib/prisma";
import { factoryYmd } from "../constants/time";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { tokenReplay } from "./helpers/token-replay.helper";
import { ACTIVE_CERTIFICATE_WHERE, isIssuedAfterExpiry } from "./helpers/certificate-active.helper";
import { getCertificate, type CertificateDetail } from "./certificate-query.service";

export interface CertificateInput {
  clientToken?: string | null;
  holder: CertificateHolder;
  partnerId?: string | null;
  standard: string;
  certificateNo: string;
  issuer?: string | null;
  scope?: string | null;
  /** YYYY-MM-DD takvim günü. */
  issuedOn?: string | null;
  expiresOn: string;
  note?: string | null;
}

export type CertificatePatch = Omit<CertificateInput, "clientToken">;

const NOT_FOUND = (): AppError => AppError.notFound("Sertifika bulunamadı.", { code: "CERTIFICATE_NOT_FOUND" });
const NOT_ACTIVE = (): AppError =>
  AppError.conflict("Sertifika iptal edilmiş ya da yenilenmiş; yalnız etkin sertifika değiştirilir.", { code: "CERTIFICATE_NOT_ACTIVE" });

function parseDay(raw: string | null | undefined, label: string): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== raw) throw AppError.badRequest(`${label} geçersiz (YYYY-AA-GG).`, { code: "CERTIFICATE_DATE_INVALID" });
  return d;
}

const clean = (v: string | null | undefined): string | null => v?.trim() || null;

/** Girdiyi kolonlara çevirir; OWN ⇔ iş ortağı yok kuralı DB CHECK'inden ÖNCE Türkçe 400 verir. */
async function toColumns(input: CertificatePatch) {
  const partnerId = input.holder === "PARTNER" ? input.partnerId ?? null : null;
  if (input.holder === "PARTNER" && !partnerId) {
    throw AppError.badRequest("İş ortağı sertifikasında iş ortağı seçilmeli.", { code: "CERTIFICATE_PARTNER_REQUIRED" });
  }
  if (input.holder === "OWN" && input.partnerId) {
    throw AppError.badRequest("Fabrikanın kendi sertifikası bir iş ortağına bağlanamaz.", { code: "CERTIFICATE_PARTNER_FORBIDDEN" });
  }
  if (partnerId && !(await prisma.customer.findUnique({ where: { id: partnerId }, select: { id: true } }))) {
    throw AppError.notFound("İş ortağı bulunamadı.", { code: "CUSTOMER_NOT_FOUND" });
  }
  const standard = input.standard.trim();
  const certificateNo = input.certificateNo.trim();
  if (!standard) throw AppError.badRequest("Standart boş olamaz.", { code: "CERTIFICATE_STANDARD_REQUIRED" });
  if (!certificateNo) throw AppError.badRequest("Sertifika numarası boş olamaz.", { code: "CERTIFICATE_NO_REQUIRED" });
  const expiresOn = parseDay(input.expiresOn, "Geçerlilik sonu");
  if (!expiresOn) throw AppError.badRequest("Geçerlilik sonu zorunlu.", { code: "CERTIFICATE_DATE_INVALID" });
  const issuedOn = parseDay(input.issuedOn, "Düzenleme tarihi");
  if (issuedOn && isIssuedAfterExpiry(issuedOn, expiresOn)) {
    throw AppError.badRequest("Düzenleme tarihi geçerlilik sonundan sonra olamaz.", { code: "CERTIFICATE_DATE_INVALID" });
  }
  if (input.issuedOn && input.issuedOn > factoryYmd()) {
    throw AppError.badRequest("Düzenleme tarihi bugünden ileri olamaz.", { code: "CERTIFICATE_DATE_INVALID" });
  }
  return {
    holder: input.holder, partnerId, standard, certificateNo, expiresOn, issuedOn,
    issuer: clean(input.issuer), scope: clean(input.scope), note: clean(input.note),
  };
}

type Prior = { id: string; holder: CertificateHolder; partnerId: string | null; certificateNo: string; renewsId: string | null; revokedAt: Date | null };
const PRIOR_SELECT = { id: true, holder: true, partnerId: true, certificateNo: true, renewsId: true, revokedAt: true } as const;

function replayFor(input: CertificateInput, renewsId: string | null) {
  return tokenReplay<Prior, CertificateDetail>({
    find: (db, clientToken) => db.certificate.findUnique({ where: { clientToken }, select: PRIOR_SELECT }),
    alive: (p) => {
      if (p.revokedAt) throw AppError.conflict(`Sertifika ${p.certificateNo} iptal edilmiş; yeni kayıt açın.`, { code: "CERTIFICATE_REVOKED" });
    },
    identity: (p) => [
      { ad: "certificateNo", mevcut: p.certificateNo, gelen: input.certificateNo.trim() },
      { ad: "renewsId", mevcut: p.renewsId, gelen: renewsId },
    ],
    collision: "Bu işlem kimliği başka bir sertifikaya ait; formu yeniden gönderin.",
    respond: (p) => getCertificate(p.id),
  });
}

export async function createCertificate(input: CertificateInput, userId: string): Promise<CertificateDetail> {
  return replayFor(input, null).run(input.clientToken, async () => {
    const data = await toColumns(input);
    const row = await prisma.certificate.create({
      data: { ...data, clientToken: input.clientToken ?? null, createdById: userId, updatedById: userId },
      select: { id: true },
    });
    await AuditService.log({ userId, action: "CREATE", tableName: "CERTIFICATE", recordId: row.id, newData: auditView(data) });
    return getCertificate(row.id);
  });
}

/** Etkin sertifikanın künyesini düzeltir (yazım hatası); süre uzatma YENİLEMEDİR, burada da izinlidir ama iz bırakır. */
export async function updateCertificate(id: string, patch: CertificatePatch, userId: string): Promise<CertificateDetail> {
  const before = await prisma.certificate.findUnique({ where: { id }, select: { ...PRIOR_SELECT, standard: true, expiresOn: true, issuedOn: true, issuer: true, scope: true, note: true } });
  if (!before) throw NOT_FOUND();
  const data = await toColumns(patch);
  const claimed = await prisma.certificate.updateMany({ where: { id, ...ACTIVE_CERTIFICATE_WHERE }, data: { ...data, updatedById: userId } });
  if (claimed.count === 0) throw NOT_ACTIVE();
  await AuditService.log({ userId, action: "UPDATE", tableName: "CERTIFICATE", recordId: id, oldData: auditView(before), newData: auditView(data) });
  return getCertificate(id);
}

/** Yenileme: yeni satır `renewsId = eski`; eski satır DEĞİŞMEZ, `renewedBy` bağıyla etkisizleşir. */
export async function renewCertificate(oldId: string, input: CertificateInput, userId: string): Promise<CertificateDetail> {
  return replayFor(input, oldId).run(input.clientToken, async () => {
    const old = await prisma.certificate.findUnique({ where: { id: oldId }, select: { id: true, holder: true, partnerId: true } });
    if (!old) throw NOT_FOUND();
    // Sahiplik yenilemede DEĞİŞMEZ — başka sahibin sertifikası yeni kayıttır.
    const data = await toColumns({ ...input, holder: old.holder, partnerId: old.partnerId });
    let row: { id: string };
    try {
      row = await prisma.$transaction(async (tx) => {
        // Claim: eski satır hâlâ etkin mi (satır kilidi iptalle sıraya girer); kaybeden 409.
        const claimed = await tx.certificate.updateMany({ where: { id: oldId, ...ACTIVE_CERTIFICATE_WHERE }, data: { updatedById: userId } });
        if (claimed.count === 0) throw NOT_ACTIVE();
        return tx.certificate.create({
          data: { ...data, renewsId: oldId, clientToken: input.clientToken ?? null, createdById: userId, updatedById: userId },
          select: { id: true },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && JSON.stringify(err.meta ?? {}).includes("renewsId")) {
        throw AppError.conflict("Bu sertifika zaten yenilenmiş.", { code: "CERTIFICATE_ALREADY_RENEWED" });
      }
      throw err;
    }
    await AuditService.log({ userId, action: "CREATE", tableName: "CERTIFICATE", recordId: row.id, newData: { ...auditView(data), renewsId: oldId } });
    return getCertificate(row.id);
  });
}

export async function revokeCertificate(id: string, reason: string, userId: string): Promise<CertificateDetail> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal gerekçesi en az 3 karakter olmalı.", { code: "CERTIFICATE_REASON_REQUIRED" });
  const claimed = await prisma.certificate.updateMany({
    where: { id, ...ACTIVE_CERTIFICATE_WHERE },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: why, updatedById: userId },
  });
  if (claimed.count === 0) {
    if (!(await prisma.certificate.findUnique({ where: { id }, select: { id: true } }))) throw NOT_FOUND();
    throw NOT_ACTIVE();
  }
  await AuditService.log({ userId, action: "UPDATE", tableName: "CERTIFICATE", recordId: id, oldData: { revokedAt: null }, newData: { revokedAt: "iptal", revokeReason: why } });
  return getCertificate(id);
}

/** Audit yükü yalnız künye — tarih takvim günü dizesi. */
function auditView(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["holder", "partnerId", "standard", "certificateNo", "issuer", "scope", "note"]) if (k in d) out[k] = d[k];
  for (const k of ["expiresOn", "issuedOn"]) if (k in d) out[k] = d[k] instanceof Date ? (d[k] as Date).toISOString().slice(0, 10) : d[k];
  return out;
}
