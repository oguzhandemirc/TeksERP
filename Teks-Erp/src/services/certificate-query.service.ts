// =============================================================================
// K4P-SERT — sertifika okuma yolu (ayrıntı · liste + cursor + özet şeridi · iptal önizlemesi)
// =============================================================================
// Liste ve özet şeridi TEK taban where'den (`buildCertificateBaseWhere`) doğar; durum süzgeçleri
// ("etkin", "süresi yaklaşan", "süresi geçmiş") `certificate-active.helper` yüklemleridir — bildirim
// kaynağı da aynı helper'ı çağırır. Dosya baytları (`content`) bu yoldan HİÇ seçilmez.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { decodeOffsetCursor, encodeOffsetCursor } from "../utils/cursor";
import { readFilterList, readIdCondition } from "../utils/query-parser";
import {
  ACTIVE_CERTIFICATE_WHERE, certificateDaysLeft, certificateExpiryWhere, certificateToday, isActiveCertificate,
} from "./helpers/certificate-active.helper";

/** Panelde önerilen standart listesi (serbest metin de kabul edilir). */
export const CERTIFICATE_STANDARD_SUGGESTIONS = [
  "OEKO-TEX Standard 100", "GOTS", "GRS", "ISO 9001", "ISO 14001", "bluesign", "EU Ecolabel", "Yanmazlık test raporu",
] as const;

export const CERTIFICATE_STATUS_FILTERS = ["active", "expiring", "expired", "revoked", "renewed", "all"] as const;
export type CertificateStatusFilter = (typeof CERTIFICATE_STATUS_FILTERS)[number];
export const DEFAULT_EXPIRY_DAYS = 30;

export interface CertificateListQuery {
  status?: CertificateStatusFilter;
  days?: number;
  holder?: "OWN" | "PARTNER";
  partnerId?: string | string[];
  q?: string;
  cursor?: string;
  limit?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROW_SELECT = {
  id: true, holder: true, partnerId: true, standard: true, certificateNo: true, issuer: true, scope: true,
  issuedOn: true, expiresOn: true, note: true, renewsId: true, revokedAt: true, revokeReason: true, createdAt: true, updatedAt: true,
  partner: { select: { id: true, code: true, name: true } },
  renews: { select: { id: true, certificateNo: true, expiresOn: true } },
  renewedBy: { select: { id: true, certificateNo: true, expiresOn: true } },
  _count: { select: { files: true } },
} satisfies Prisma.CertificateSelect;

type Row = Prisma.CertificateGetPayload<{ select: typeof ROW_SELECT }>;

function present(r: Row, today: Date) {
  const { _count, ...rest } = r;
  return { ...rest, fileCount: _count.files, active: isActiveCertificate(r), daysLeft: certificateDaysLeft(r.expiresOn, today) };
}
export type CertificateRow = ReturnType<typeof present>;

const DETAIL_SELECT = {
  ...ROW_SELECT,
  revokedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  files: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true, uploadedBy: { select: { id: true, fullName: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.CertificateSelect;

export type CertificateDetail = CertificateRow & {
  revokedBy: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string } | null;
  files: Prisma.CertificateGetPayload<{ select: typeof DETAIL_SELECT }>["files"];
};

export async function getCertificate(id: string): Promise<CertificateDetail> {
  const r = await prisma.certificate.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!r) throw AppError.notFound("Sertifika bulunamadı.", { code: "CERTIFICATE_NOT_FOUND" });
  const { revokedBy, createdBy, files, ...row } = r;
  return { ...present(row, certificateToday()), revokedBy, createdBy, files };
}

function readDays(days: number | undefined): number {
  const d = days ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(d) || d < 0 || d > 3650) throw AppError.badRequest("Gün süzgeci 0–3650 arası tam sayı olmalı.", { code: "CERTIFICATE_FILTER_INVALID" });
  return d;
}

/** Durum dışı süzgeçler — liste ve özet şeridinin ORTAK tabanı. */
export function buildCertificateBaseWhere(q: CertificateListQuery): Prisma.CertificateWhereInput {
  if (readFilterList(q.partnerId).some((v) => !UUID.test(v))) throw AppError.badRequest("Geçersiz kimlik süzgeci.", { code: "CERTIFICATE_FILTER_INVALID" });
  const and: Prisma.CertificateWhereInput[] = [];
  const partner = readIdCondition(q.partnerId);
  if (partner) and.push({ partnerId: partner });
  if (q.holder) and.push({ holder: q.holder });
  const text = q.q?.trim();
  if (text) {
    and.push({ OR: [
      { certificateNo: { contains: text, mode: "insensitive" } },
      { standard: { contains: text, mode: "insensitive" } },
      { issuer: { contains: text, mode: "insensitive" } },
      { partner: { name: { contains: text, mode: "insensitive" } } },
    ] });
  }
  return and.length ? { AND: and } : {};
}

/** Durum süzgeci → yüklem; "yaklaşan" ve "geçmiş" helper'dan (süresi geçmiş = bugünden en az bir gün önce). */
export function certificateStatusWhere(status: CertificateStatusFilter, today: Date, days: number): Prisma.CertificateWhereInput {
  switch (status) {
    case "active": return ACTIVE_CERTIFICATE_WHERE;
    case "expiring": return certificateExpiryWhere(today, days);
    case "expired": return certificateExpiryWhere(today, -1);
    case "revoked": return { revokedAt: { not: null } };
    case "renewed": return { renewedBy: { isNot: null } };
    case "all": return {};
  }
}

export async function listCertificates(q: CertificateListQuery) {
  const status = q.status ?? "active";
  if (!CERTIFICATE_STATUS_FILTERS.includes(status)) throw AppError.badRequest("Tanınmayan durum süzgeci.", { code: "CERTIFICATE_FILTER_INVALID" });
  const days = readDays(q.days);
  const today = certificateToday();
  const base = buildCertificateBaseWhere(q);
  const where: Prisma.CertificateWhereInput = { AND: [base, certificateStatusWhere(status, today, days)] };
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = decodeOffsetCursor(q.cursor);
  const rows = await prisma.certificate.findMany({
    where, orderBy: [{ expiresOn: "asc" }, { id: "asc" }], skip: offset, take: limit + 1, select: ROW_SELECT,
  });
  const page = rows.slice(0, limit);
  const count = (s: CertificateStatusFilter) => prisma.certificate.count({ where: { AND: [base, certificateStatusWhere(s, today, days)] } });
  const [active, expiring, expired, revoked] = [await count("active"), await count("expiring"), await count("expired"), await count("revoked")];
  return {
    items: page.map((r) => present(r, today)),
    nextCursor: rows.length > limit ? encodeOffsetCursor(offset + limit) : null,
    summary: { active, expiring, expired, revoked, days },
  };
}

/** İptal önizlemesi: etkilenen tek kayıt + ekleri (yıkıcı işlem kuralı). */
export async function revokePreviewCertificate(id: string) {
  const certificate = await getCertificate(id);
  if (!certificate.active) {
    throw AppError.conflict("Sertifika iptal edilmiş ya da yenilenmiş; iptal edilecek etkin kayıt yok.", { code: "CERTIFICATE_NOT_ACTIVE" });
  }
  return { certificate, fileCount: certificate.files.length };
}
