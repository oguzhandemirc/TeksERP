// İNDİRME BAĞLANTISI (/d/<belirteç>) — ilk kurulum derlemesi ya da paylaşılan (GIDEN) dosya.
// Süreli + indirme sayısı sınırlı; sayaç ↔ durum çift yüklemi atomik WHERE'de ve DB CHECK'te.
// İndirme hakkı indirme BAŞLARKEN tüketilir (yarıda kalan indirme için yeni bağlantı verilir).
// Defter: BAGLANTI_VERILDI · INDIRILDI · BAGLANTI_IPTAL (iptal ters kayıttır; satır silinmez).
import type { IndirmeBaglantisi, IndirmeTuru } from "@prisma/client";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockDownloadLink, lockSharedFile } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { bodyPath, buildPath } from "./storage";
import { appendLedger, tokenDigest } from "./tokens";

const HOUR_MS = 3_600_000;
export const LINK_MAX_HOURS = 24 * 90;

/** Portal görünümü: belirteç özeti ASLA dışarı çıkmaz. */
export const LINK_VIEW = {
  id: true,
  tur: true,
  musteriId: true,
  kurulumId: true,
  dosyaId: true,
  derlemeAdi: true,
  derlemeSha256: true,
  derlemeBoyut: true,
  belirtecSonu: true,
  bitis: true,
  azamiIndirme: true,
  indirmeSayisi: true,
  sonIndirme: true,
  durum: true,
  aciklama: true,
  olusturan: true,
  createdAt: true,
} as const;

export interface CreateLinkInput {
  readonly kind: IndirmeTuru;
  readonly customerId: string;
  readonly installationDbId?: string;
  readonly fileId?: string;
  readonly buildName?: string;
  readonly build?: { readonly sha256: string; readonly bytes: number };
  readonly validHours: number;
  readonly maxDownloads: number;
  readonly note?: string;
  readonly token: { readonly digest: string; readonly tail: string };
  readonly actor: string;
  readonly nowMs: number;
}

async function requireActiveCustomer(db: Db, customerId: string): Promise<void> {
  const m = await db.musteri.findUnique({ where: { id: customerId }, select: { aktif: true } });
  if (!m) throw notFoundError("Müşteri");
  if (!m.aktif) throw stateConflict("Pasif müşteriye bağlantı verilemez");
}

/** Portal eyleminin tx'inde (işlem kimliği kilidinden sonra): hedefi doğrular, bağlantıyı ve defter satırını yazar. */
export async function createLinkTx(tx: Tx, g: CreateLinkInput): Promise<IndirmeBaglantisi> {
  if (g.kind === "DOSYA") {
    if (!g.fileId) throw badRequest("Dosya bağlantısı dosya kimliği ister");
    await lockSharedFile(tx, g.fileId);
  }
  if (!Number.isInteger(g.validHours) || g.validHours < 1 || g.validHours > LINK_MAX_HOURS) throw badRequest(`Geçerlilik 1–${LINK_MAX_HOURS} saat olmalı`);
  if (!Number.isInteger(g.maxDownloads) || g.maxDownloads < 1 || g.maxDownloads > 1000) throw badRequest("İndirme sayısı 1–1000 olmalı");
  await requireActiveCustomer(tx, g.customerId);
  if (g.kind === "DOSYA") {
    const f = await tx.dagitimDosyasi.findUnique({ where: { id: g.fileId! } });
    if (!f || f.musteriId !== g.customerId) throw notFoundError("Dosya");
    if (f.yon !== "GIDEN") throw stateConflict("Yalnız bizden müşteriye giden dosya paylaşılır");
    if (f.govdeBudandiAt) throw new VendorError(410, "GOVDE_BUDANDI", "Dosyanın saklama süresi dolmuş; gövde budandı");
  } else {
    if (!g.buildName || !g.build) throw badRequest("İlk kurulum bağlantısı derleme dosyası ister");
    if (g.installationDbId) {
      const k = await tx.kurulum.findUnique({ where: { id: g.installationDbId }, select: { aktif: true, tesis: { select: { musteriId: true } } } });
      if (!k || k.tesis.musteriId !== g.customerId) throw notFoundError("Kurulum");
      if (!k.aktif) throw stateConflict("İptal edilmiş kuruluma bağlantı verilemez");
    }
  }
  const link = await tx.indirmeBaglantisi.create({
    data: {
      tur: g.kind,
      musteriId: g.customerId,
      kurulumId: g.kind === "ILK_KURULUM" ? (g.installationDbId ?? null) : null,
      dosyaId: g.kind === "DOSYA" ? g.fileId! : null,
      derlemeAdi: g.kind === "ILK_KURULUM" ? g.buildName! : null,
      derlemeSha256: g.kind === "ILK_KURULUM" ? g.build!.sha256 : null,
      derlemeBoyut: g.kind === "ILK_KURULUM" ? BigInt(g.build!.bytes) : null,
      belirtecOzeti: g.token.digest,
      belirtecSonu: g.token.tail,
      bitis: new Date(g.nowMs + g.validHours * HOUR_MS),
      azamiIndirme: g.maxDownloads,
      aciklama: g.note ?? null,
      olusturan: g.actor,
    },
  });
  await appendLedger(tx, {
    event: "BAGLANTI_VERILDI",
    customerId: g.customerId,
    actor: g.actor,
    linkId: link.id,
    ...(link.dosyaId ? { fileId: link.dosyaId } : {}),
    detail: { tur: link.tur, bitis: link.bitis.toISOString(), azamiIndirme: link.azamiIndirme, ...(link.derlemeAdi ? { derleme: link.derlemeAdi, sha256: link.derlemeSha256 } : {}) },
  });
  return link;
}

/** İptal: AKTIF → IPTAL (atomik claim); iptal edilmiş bağlantı tekrar iptal edilemez (409). */
export async function cancelLinkTx(tx: Tx, g: { linkId: string; reason: string; actor: string }): Promise<IndirmeBaglantisi> {
  await lockDownloadLink(tx, g.linkId);
  const claimed = await tx.indirmeBaglantisi.updateMany({ where: { id: g.linkId, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  const row = await tx.indirmeBaglantisi.findUnique({ where: { id: g.linkId } });
  if (!row) throw notFoundError("Bağlantı");
  if (claimed.count === 0) throw stateConflict("Bağlantı zaten iptal edilmiş");
  await appendLedger(tx, { event: "BAGLANTI_IPTAL", customerId: row.musteriId, actor: g.actor, linkId: row.id, detail: { sebep: g.reason, indirmeSayisi: row.indirmeSayisi } });
  return row;
}

export interface DownloadTarget {
  readonly link: IndirmeBaglantisi;
  readonly path: string;
  readonly name: string;
  readonly mime: string;
  readonly bytes: number;
  /** Bağlantı doğarken donan özet (ILK_KURULUM) ya da dosyanın özeti. */
  readonly sha256: string;
}

const expired = (): VendorError => new VendorError(410, "BAGLANTI_GECERSIZ", "Bağlantının süresi dolmuş, indirme hakkı bitmiş ya da iptal edilmiş");

/** Belirteçten hedef (kilitsiz ön okuma; hak tüketimi `claimDownload`da). Bilinmeyen belirteç 404. */
export async function resolveDownload(ctx: VendorContext, token: string, nowMs: number): Promise<DownloadTarget> {
  const digest = tokenDigest(ctx, token);
  const link = digest ? await prisma.indirmeBaglantisi.findUnique({ where: { belirtecOzeti: digest }, include: { dosya: true } }) : null;
  if (!link) throw notFoundError("Bağlantı");
  if (link.durum !== "AKTIF" || link.bitis.getTime() <= nowMs || link.indirmeSayisi >= link.azamiIndirme) throw expired();
  if (link.tur === "DOSYA") {
    const f = link.dosya!;
    if (f.govdeBudandiAt) throw new VendorError(410, "GOVDE_BUDANDI", "Dosyanın saklama süresi dolmuş");
    return { link, path: bodyPath(ctx.config.DOSYA_DIZINI, f.depoAnahtari), name: f.ad, mime: f.mime, bytes: Number(f.boyut), sha256: f.sha256 };
  }
  const name = link.derlemeAdi!;
  return { link, path: buildPath(ctx.config.DERLEME_DIZINI, name), name, mime: "application/octet-stream", bytes: Number(link.derlemeBoyut), sha256: link.derlemeSha256! };
}

/** İndirme hakkını tüketir: bağlantı hâlâ AKTIF, süresi içinde ve sayacı tavanın altındaysa +1; değilse 410. */
export async function claimDownload(g: { linkId: string; nowMs: number; client: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockDownloadLink(tx, g.linkId);
    const now = new Date(g.nowMs);
    const claimed = await tx.indirmeBaglantisi.updateMany({
      where: { id: g.linkId, durum: "AKTIF", bitis: { gt: now }, indirmeSayisi: { lt: tx.indirmeBaglantisi.fields.azamiIndirme } },
      data: { indirmeSayisi: { increment: 1 }, sonIndirme: now },
    });
    if (claimed.count === 0) throw expired();
    const row = await tx.indirmeBaglantisi.findUniqueOrThrow({ where: { id: g.linkId } });
    await appendLedger(tx, {
      event: "INDIRILDI",
      customerId: row.musteriId,
      actor: "musteri:indirme",
      linkId: row.id,
      ...(row.dosyaId ? { fileId: row.dosyaId } : {}),
      detail: { sira: row.indirmeSayisi, istemci: g.client },
    });
  });
}

export async function listLinks(db: Db, f: { customerId?: string; installationDbId?: string; limit: number }) {
  return db.indirmeBaglantisi.findMany({
    where: { ...(f.customerId ? { musteriId: f.customerId } : {}), ...(f.installationDbId ? { kurulumId: f.installationDbId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: f.limit,
    select: LINK_VIEW,
  });
}
