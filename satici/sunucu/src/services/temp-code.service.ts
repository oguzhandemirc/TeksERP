// GEÇİCİ AÇILIŞ KODU (yazarak etkinleştirme): internetsiz, karekodsuz kurulumun telefonla okunan istek kodundan kökle
// imzalı kısa açılış kodu. Kodda sertifika taşınamaz ⇒ yalnız KÖK imzalar (yönetici, kök parolası); bayi kendi
// müşterisinin kurulumu için TALEP açar, yönetici üretir. Düz kod DB'ye/denetime girmez: özet + son 4; bayi talebinden
// doğan kodun metni portal sır kutusunda sarılıdır (bayi kendi talebinde okur). İmza tx DIŞINDA, kayıt tx İÇİNDE.
import { randomUUID } from "node:crypto";
import type { GeciciAcilisKodu, GeciciKodTalebi, Kurulum } from "@prisma/client";
import {
  TEMP_CODE_DAYS,
  TYP_GECICI,
  dayOfMs,
  decodeTempOpeningCode,
  encodeTempOpeningCode,
  formatTempOpeningCode,
  formatTempRequestCode,
  parseTempRequestCode,
  prepareTrustAnchor,
  tempCodeDigest,
  tempCodeEndMs,
  tempRequestMatchesKid,
  verifyJws,
  type TempConsumedResponse,
  type TempOpeningDoc,
} from "../lisans-protokol";
import { KeyFileError } from "../keys/key-files";
import { signWithWrappedKey } from "../keys/signer";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockCustomer, lockDealer, lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { PortalSecretBox } from "../portal/secret-box";
import type { VendorContext } from "./context";
import { assertDealerOwnsCustomer } from "./dealer-ownership.service";
import { findDealer } from "./dealer.service";
import { requireReason } from "./sanction.service";

const SEAL_PURPOSE = "gecici-acilis-kodu";
const KOD_SONU = 4;

export interface ParsedTempRequest {
  readonly istekKodu: string;
  readonly anahtarOzeti: string;
}

/** Portala yazılan istek kodu: biçim/karakter/sağlama hatası 400 (yeri `details.konum`). */
export function parseRequestCodeOrThrow(raw: string): ParsedTempRequest {
  const p = parseTempRequestCode(raw);
  if (p.ok) return p.value;
  const what = { BICIM: "uzunluğu ya da biçimi hatalı", KARAKTER: "geçersiz karakter içeriyor", SAGLAMA: "sağlaması tutmuyor (yanlış okunmuş olabilir)", SURUM: "sürümü tanınmıyor", IMZACI: "tanınmıyor" }[p.neden];
  throw new VendorError(400, "GOVDE_GECERSIZ", `İstek kodu ${what}`, { neden: p.neden, ...(p.konum !== undefined ? { konum: p.konum } : {}) });
}

export function assertTempDays(days: number): number {
  if (!Number.isInteger(days) || days < TEMP_CODE_DAYS.enAz || days > TEMP_CODE_DAYS.enCok) {
    throw badRequest(`Gün sayısı ${TEMP_CODE_DAYS.enAz}–${TEMP_CODE_DAYS.enCok} olmalı`);
  }
  return days;
}

/** Hedef kurulum: aktif ve iptal edilmemiş; anahtarı bağlıysa istek kodu O anahtarın (taşımayı atlatmasın). */
function assertTarget(inst: Kurulum | null, req: ParsedTempRequest): Kurulum {
  if (!inst) throw notFoundError("Kurulum");
  if (!inst.aktif || inst.durum === "IPTAL") throw stateConflict("Geçici açılış kodu yalnız aktif (iptal edilmemiş) kuruluma verilir");
  if (inst.anahtarKimligi && !tempRequestMatchesKid(req.istekKodu, inst.anahtarKimligi)) {
    throw stateConflict("İstek kodu bu kurulumun kayıtlı anahtarına ait değil — makine değiştiyse taşıma yolu kullanılır");
  }
  return inst;
}

export interface PreparedTempCode {
  readonly id: string;
  readonly installationDbId: string;
  readonly request: ParsedTempRequest;
  readonly doc: TempOpeningDoc;
  readonly days: number;
  readonly endsAt: Date;
  readonly kid: string;
  /** Biçimli (TG-…-…) kod — yalnız canlı yanıtta ve sarılı kolonda yaşar. */
  readonly code: string;
  readonly digest: string;
  readonly tail: string;
  readonly reason: string;
  readonly requestId: string | null;
}

/** Basılan kod, fabrikanın yapacağı gibi istek kodundan yeniden kurulur ve çapaya karşı doğrulanır. */
function verifyIssuedCode(ctx: VendorContext, code: string, istekKodu: string, expected: TempOpeningDoc): boolean {
  const decoded = decodeTempOpeningCode(code, istekKodu);
  if (!decoded.ok || JSON.stringify(decoded.value.doc) !== JSON.stringify(expected)) return false;
  const roots = prepareTrustAnchor(ctx.keys.anchor);
  if (!roots.ok) return false;
  return verifyJws(decoded.value.jws, { typ: TYP_GECICI, findKey: (kid) => roots.value.get(kid)?.key }).ok;
}

/**
 * Hazırlık (tx DIŞI): hedef + kök denetimi, kod kimliği diziden, imza alt süreçte. `requestId` verilirse bayi talebi:
 * istek kodu ve gün talepten okunur (yönetici değiştirmez).
 */
export async function prepareTempCode(
  ctx: VendorContext,
  g: { installationDbId: string; requestCode: string; days: number; reason: string; password: Buffer; nowMs: number; requestId?: string },
): Promise<PreparedTempCode> {
  try {
    const reason = requireReason(g.reason, "Geçici açılış kodu");
    const days = assertTempDays(g.days);
    const request = parseRequestCodeOrThrow(g.requestCode);
    const inst = assertTarget(await prisma.kurulum.findUnique({ where: { id: g.installationDbId } }), request);
    if (g.requestId) {
      const pending = await prisma.geciciKodTalebi.findFirst({ where: { id: g.requestId, kurulumId: inst.id, durum: "BEKLIYOR" }, select: { id: true } });
      if (!pending) throw stateConflict("Talep artık beklemede değil (üretildi ya da reddedildi)");
    }
    const root = ctx.keys.tempCodeRootFor(inst.sinif);
    if (!root) throw stateConflict("Geçici açılış kodunu imzalayacak kök anahtarı bu sunucuda yok");
    const [{ no }] = await prisma.$queryRaw<{ no: bigint }[]>`SELECT nextval('gecici_acilis_kodu_no_seq') AS no`;
    const doc: TempOpeningDoc = { v: 1, istekKodu: request.istekKodu, kodId: Number(no), bitisGunu: dayOfMs(g.nowMs) + days };
    let jws: string;
    try {
      jws = await signWithWrappedKey({ keyFile: root.path, typ: TYP_GECICI, payload: doc, password: g.password });
    } catch (err) {
      if (err instanceof KeyFileError && err.kind === "YANLIS_PAROLA") throw new VendorError(400, "IMZA_PAROLASI_HATALI", "İmza parolası hatalı");
      throw err;
    }
    const body = encodeTempOpeningCode(jws, doc, root.kid);
    const code = formatTempOpeningCode(body);
    if (!verifyIssuedCode(ctx, code, request.istekKodu, doc)) throw new VendorError(500, "SUNUCU_HATASI", "Üretilen geçici kod güven çapasına karşı doğrulanamadı");
    return {
      id: randomUUID(),
      installationDbId: inst.id,
      request,
      doc,
      days,
      endsAt: new Date(tempCodeEndMs(doc.bitisGunu)),
      kid: root.kid,
      code,
      digest: tempCodeDigest(body),
      tail: body.slice(-KOD_SONU),
      reason,
      requestId: g.requestId ?? null,
    };
  } finally {
    g.password.fill(0);
  }
}

/** Kayıt (tx İÇİ): kurulum kilidi ilk ifade; hedef yeniden denetlenir; bayi talebi atomik claim ile kapanır. */
export async function recordTempCodeTx(
  tx: Tx,
  g: { secrets: PortalSecretBox; prepared: PreparedTempCode; actor: string; nowMs: number },
): Promise<GeciciAcilisKodu> {
  const { secrets, prepared: p, actor, nowMs } = g;
  await lockInstallation(tx, p.installationDbId);
  assertTarget(await tx.kurulum.findUnique({ where: { id: p.installationDbId } }), p.request);
  if (p.requestId) {
    const claimed = await tx.geciciKodTalebi.updateMany({
      where: { id: p.requestId, kurulumId: p.installationDbId, durum: "BEKLIYOR" },
      data: { durum: "URETILDI", kapanisZamani: new Date(nowMs), kapatan: actor, kapanisSebebi: p.reason },
    });
    if (claimed.count === 0) throw stateConflict("Talep artık beklemede değil (üretildi ya da reddedildi)");
  }
  return tx.geciciAcilisKodu.create({
    data: {
      id: p.id,
      kurulumId: p.installationDbId,
      kodNo: p.doc.kodId,
      istekKodu: p.request.istekKodu,
      anahtarOzeti: p.request.anahtarOzeti,
      gun: p.days,
      bitisGunu: p.doc.bitisGunu,
      bitis: p.endsAt,
      imzalayanKid: p.kid,
      ozet: p.digest,
      kodSonu: p.tail,
      sariliKod: p.requestId ? secrets.seal(p.code, p.id, SEAL_PURPOSE) : null,
      talepId: p.requestId,
      sebep: p.reason,
      ureten: actor,
    },
  });
}

/** Denetim özeti — kod da son 4'ü de girmez. */
export function tempCodeAuditSummary(row: GeciciAcilisKodu): Record<string, string | number | null> {
  return { geciciKodId: row.id, kodNo: row.kodNo, gun: row.gun, bitis: row.bitis.toISOString(), imzalayanKid: row.imzalayanKid, talepId: row.talepId };
}

// ---------------------------------------------------------------- bayi talebi

export async function createTempCodeRequestTx(
  tx: Tx,
  g: { dealerId: string; customerId: string; installationDbId: string; requestCode: string; days: number; reason: string; actor: string },
): Promise<GeciciKodTalebi> {
  await lockDealer(tx, g.dealerId);
  await lockCustomer(tx, g.customerId);
  await lockInstallation(tx, g.installationDbId);
  await assertDealerOwnsCustomer(tx, g.dealerId, g.customerId, "Kurulum");
  if (!(await findDealer(tx, g.dealerId)).aktif) throw stateConflict("Bayi pasif");
  const request = parseRequestCodeOrThrow(g.requestCode);
  assertTarget(await tx.kurulum.findUnique({ where: { id: g.installationDbId } }), request);
  const pending = await tx.geciciKodTalebi.findFirst({ where: { kurulumId: g.installationDbId, istekKodu: request.istekKodu, durum: "BEKLIYOR" }, select: { id: true } });
  if (pending) throw stateConflict("Bu istek kodu için bekleyen bir talep zaten var");
  return tx.geciciKodTalebi.create({
    data: {
      kurulumId: g.installationDbId,
      bayiId: g.dealerId,
      istekKodu: request.istekKodu,
      anahtarOzeti: request.anahtarOzeti,
      gun: assertTempDays(g.days),
      sebep: requireReason(g.reason, "Geçici kod talebi"),
      yapan: g.actor,
    },
  });
}

/** Talep (kilitsiz ön okuma) — üretim/ret kurulum kilidini ilk ifade alabilsin diye kurulumu verir. */
export async function findTempCodeRequest(db: Db, id: string): Promise<GeciciKodTalebi> {
  const row = await db.geciciKodTalebi.findUnique({ where: { id } });
  if (!row) throw notFoundError("Geçici kod talebi");
  return row;
}

export async function rejectTempCodeRequestTx(tx: Tx, g: { request: GeciciKodTalebi; reason: string; actor: string; nowMs: number }): Promise<GeciciKodTalebi> {
  await lockInstallation(tx, g.request.kurulumId);
  const reason = requireReason(g.reason, "Talep reddi");
  const claimed = await tx.geciciKodTalebi.updateMany({
    where: { id: g.request.id, durum: "BEKLIYOR" },
    data: { durum: "REDDEDILDI", kapanisZamani: new Date(g.nowMs), kapatan: g.actor, kapanisSebebi: reason },
  });
  if (claimed.count === 0) throw stateConflict("Talep artık beklemede değil (üretildi ya da reddedildi)");
  return tx.geciciKodTalebi.findUniqueOrThrow({ where: { id: g.request.id } });
}

// ---------------------------------------------------------------- listeler

const codeView = (r: GeciciAcilisKodu) => ({
  id: r.id,
  kodNo: r.kodNo,
  istekKodu: formatTempRequestCode(r.istekKodu),
  gun: r.gun,
  bitis: r.bitis,
  imzalayanKid: r.imzalayanKid,
  kodSonu: r.kodSonu,
  talepId: r.talepId,
  ureten: r.ureten,
  tuketildiAt: r.tuketildiAt,
  createdAt: r.createdAt,
});

const requestView = (r: GeciciKodTalebi) => ({
  id: r.id,
  kurulumId: r.kurulumId,
  istekKodu: formatTempRequestCode(r.istekKodu),
  gun: r.gun,
  sebep: r.sebep,
  yapan: r.yapan,
  durum: r.durum,
  kapanisZamani: r.kapanisZamani,
  kapatan: r.kapatan,
  kapanisSebebi: r.kapanisSebebi,
  createdAt: r.createdAt,
});

/** Satıcı: kurulumun kodları (metinsiz) + talepleri. */
export async function listInstallationTempCodes(db: Db, installationDbId: string) {
  const kodlar = await db.geciciAcilisKodu.findMany({ where: { kurulumId: installationDbId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  const talepler = await db.geciciKodTalebi.findMany({ where: { kurulumId: installationDbId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
  return { kodlar: kodlar.map(codeView), talepler: talepler.map(requestView) };
}

/** Satıcı kuyruğu: bekleyen bayi talepleri (eskisi önce). */
export async function listPendingTempCodeRequests(db: Db) {
  const rows = await db.geciciKodTalebi.findMany({
    where: { durum: "BEKLIYOR" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    include: { kurulum: { select: { kurulumId: true, ad: true, sinif: true } }, bayi: { select: { ad: true } } },
  });
  return rows.map((r) => ({ ...requestView(r), kurulum: r.kurulum, bayi: r.bayi.ad }));
}

/** Bayi: kendi kurulumunun KENDİ talepleri; üretilen kodun metni sarılı kolondan açılır. */
export async function listDealerTempCodeRequests(db: Db, secrets: PortalSecretBox, g: { dealerId: string; installationDbId: string }) {
  const rows = await db.geciciKodTalebi.findMany({
    where: { kurulumId: g.installationDbId, bayiId: g.dealerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { kod: true },
  });
  return rows.map((r) => ({
    ...requestView(r),
    kod: r.kod ? { kod: r.kod.sariliKod ? secrets.open(r.kod.sariliKod, r.kod.id, SEAL_PURPOSE) : null, bitis: r.kod.bitis, tuketildiAt: r.kod.tuketildiAt } : null,
  }));
}

// ---------------------------------------------------------------- tüketim bildirimi (fabrika → satıcı)

/**
 * Fabrikanın imzalı bildirimi: kodun istek kodundaki anahtar özeti isteği imzalayan anahtarınkiyle aynıysa `tuketildiAt`
 * bir kez dolar (atomik). Tekrar ve tanınmayan özet zararsızdır; cevap yalnız tanınan sayıdır.
 */
export async function markTempCodesConsumed(g: { kid: string; digests: readonly string[]; nowMs: number }): Promise<TempConsumedResponse> {
  const keyDigest = Buffer.from(g.kid.replace(/^kur-/, ""), "base64url").subarray(0, 8).toString("hex");
  const digests = [...new Set(g.digests)];
  const fresh = await prisma.geciciAcilisKodu.updateMany({
    where: { ozet: { in: digests }, anahtarOzeti: keyDigest, tuketildiAt: null },
    data: { tuketildiAt: new Date(g.nowMs) },
  });
  const known = await prisma.geciciAcilisKodu.count({ where: { ozet: { in: digests }, anahtarOzeti: keyDigest } });
  return { v: 1, tanindi: known, yeni: fresh.count };
}
