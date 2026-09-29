// YÜKLEME İSTEĞİ (/y/<belirteç>) — müşterinin bize dosya göndermesi için süreli, kotalı bağlantı.
// Kota yükleme oturumu AÇILIRKEN beyan edilen boyutla rezerve edilir (koşullu UPDATE + CHECK seddi);
// terk edilen oturum iade eder. İptal isteği kapatır ve açık oturumlarını AYNI tx'te terk eder.
import type { YuklemeIstegi } from "@prisma/client";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockUploadScope } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "../services/context";
import { INCOMING_EXTENSIONS } from "./storage";
import { appendLedger, tokenDigest } from "./tokens";
import { MIB } from "./view";

const HOUR_MS = 3_600_000;
export const REQUEST_MAX_HOURS = 24 * 90;

export const REQUEST_VIEW = {
  id: true,
  musteriId: true,
  belirtecSonu: true,
  bitis: true,
  kotaBayt: true,
  kullanilanBayt: true,
  azamiDosyaBayt: true,
  durum: true,
  aciklama: true,
  olusturan: true,
  createdAt: true,
} as const;

export interface CreateRequestInput {
  readonly customerId: string;
  readonly validHours: number;
  readonly quotaMb: number;
  readonly maxFileMb: number;
  readonly note?: string;
  readonly token: { readonly digest: string; readonly tail: string };
  readonly actor: string;
  readonly nowMs: number;
  /** Sunucu tavanı (DOSYA_AZAMI_MB). */
  readonly fileCapMb: number;
}

export async function createUploadRequestTx(tx: Tx, g: CreateRequestInput): Promise<YuklemeIstegi> {
  if (!Number.isInteger(g.validHours) || g.validHours < 1 || g.validHours > REQUEST_MAX_HOURS) throw badRequest(`Geçerlilik 1–${REQUEST_MAX_HOURS} saat olmalı`);
  if (!Number.isInteger(g.maxFileMb) || g.maxFileMb < 1 || g.maxFileMb > g.fileCapMb) throw badRequest(`Dosya tavanı 1–${g.fileCapMb} MB olmalı`);
  if (!Number.isInteger(g.quotaMb) || g.quotaMb < g.maxFileMb || g.quotaMb > 100 * g.fileCapMb) throw badRequest("Kota, dosya tavanından küçük olamaz");
  const m = await tx.musteri.findUnique({ where: { id: g.customerId }, select: { aktif: true } });
  if (!m) throw notFoundError("Müşteri");
  if (!m.aktif) throw stateConflict("Pasif müşteriye yükleme isteği verilemez");
  const row = await tx.yuklemeIstegi.create({
    data: {
      musteriId: g.customerId,
      belirtecOzeti: g.token.digest,
      belirtecSonu: g.token.tail,
      bitis: new Date(g.nowMs + g.validHours * HOUR_MS),
      kotaBayt: BigInt(g.quotaMb) * BigInt(MIB),
      azamiDosyaBayt: BigInt(g.maxFileMb) * BigInt(MIB),
      aciklama: g.note ?? null,
      olusturan: g.actor,
    },
  });
  await appendLedger(tx, {
    event: "YUKLEME_ISTEGI_VERILDI",
    customerId: g.customerId,
    actor: g.actor,
    requestId: row.id,
    detail: { bitis: row.bitis.toISOString(), kotaMb: g.quotaMb, azamiDosyaMb: g.maxFileMb },
  });
  return row;
}

/** İptal: AKTIF → IPTAL + açık oturumlar TERK (kota iadesi gereksiz: istek kapandı). Parça dizinleri çağıran siler. */
export async function cancelUploadRequestTx(tx: Tx, g: { requestId: string; reason: string; actor: string }): Promise<{ request: YuklemeIstegi; abandoned: string[] }> {
  await lockUploadScope(tx, g.requestId, []);
  const open = await tx.yuklemeOturumu.findMany({ where: { istekId: g.requestId, durum: "ACIK" }, select: { id: true } });
  await lockUploadScope(tx, null, open.map((o) => o.id));
  const claimed = await tx.yuklemeIstegi.updateMany({ where: { id: g.requestId, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  const request = await tx.yuklemeIstegi.findUnique({ where: { id: g.requestId } });
  if (!request) throw notFoundError("Yükleme isteği");
  if (claimed.count === 0) throw stateConflict("Yükleme isteği zaten iptal edilmiş");
  const abandoned: string[] = [];
  for (const o of open) {
    const r = await tx.yuklemeOturumu.updateMany({ where: { id: o.id, durum: "ACIK" }, data: { durum: "TERK" } });
    if (r.count === 1) abandoned.push(o.id);
  }
  await appendLedger(tx, { event: "YUKLEME_ISTEGI_IPTAL", customerId: request.musteriId, actor: g.actor, requestId: request.id, detail: { sebep: g.reason, terkEdilenOturum: abandoned.length } });
  return { request, abandoned };
}

export const requestExpired = (): VendorError => new VendorError(410, "BAGLANTI_GECERSIZ", "Yükleme bağlantısının süresi dolmuş ya da iptal edilmiş");

/** Belirteçten istek; bilinmeyen 404, kapalı/süresi dolmuş 410. */
export async function resolveUploadRequest(ctx: VendorContext, token: string, nowMs: number): Promise<YuklemeIstegi> {
  const digest = tokenDigest(ctx, token);
  const row = digest ? await prisma.yuklemeIstegi.findUnique({ where: { belirtecOzeti: digest } }) : null;
  if (!row) throw notFoundError("Yükleme bağlantısı");
  if (row.durum !== "AKTIF" || row.bitis.getTime() <= nowMs) throw requestExpired();
  return row;
}

/** Müşteriye görünen özet (müşteri adı, satıcı kullanıcısı, diğer istekler YOK). */
export function publicRequestView(r: YuklemeIstegi, partBytes: number) {
  return {
    bitis: r.bitis.toISOString(),
    kotaBayt: Number(r.kotaBayt),
    kalanBayt: Number(r.kotaBayt - r.kullanilanBayt),
    azamiDosyaBayt: Number(r.azamiDosyaBayt),
    parcaBayt: partBytes,
    izinliUzantilar: INCOMING_EXTENSIONS,
    aciklama: r.aciklama,
  };
}

export async function listUploadRequests(db: Db, f: { customerId?: string; limit: number }) {
  return db.yuklemeIstegi.findMany({
    where: f.customerId ? { musteriId: f.customerId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: f.limit,
    select: REQUEST_VIEW,
  });
}
