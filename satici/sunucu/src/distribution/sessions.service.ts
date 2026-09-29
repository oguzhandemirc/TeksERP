// YÜKLEME OTURUMU — sürdürülebilir parçalı yükleme. Başlatma işlem kimliğiyle (clientToken) idempotent;
// her parça sıra + sha256 ile gelir, boyutu ve özeti tutmazsa REDDEDİLİR (422 PARCA_BUTUNLUGU);
// aynı sıra aynı özetle tekrar gelirse idempotent. Tamamlama birleşik gövdenin özetini beyanla karşılaştırır.
// GELEN (müşteri → biz) oturum bir yükleme isteğine bağlıdır ve kotayı açılırken rezerve eder.
import type { Readable } from "node:stream";
import type { DagitimDosyasi, YuklemeIstegi, YuklemeOturumu } from "@prisma/client";
import type { VendorConfig } from "../config";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { lockUploadScope } from "../lib/locks";
import { prisma } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { requestExpired } from "./requests.service";
import { INCOMING_EXTENSIONS, OUTGOING_EXTENSIONS, assembleParts, bodyPath, moveInto, newBodyKey, partDir, partPath, removeQuietly, streamToTemp, vetFile } from "./storage";
import { appendLedger } from "./tokens";
import { MIB } from "./view";

const DAY_MS = 86_400_000;
const SHA = /^[0-9a-f]{64}$/;

export type SessionOwner =
  | { readonly kind: "ISTEK"; readonly request: YuklemeIstegi; readonly actor: string }
  | { readonly kind: "SATICI"; readonly customerId: string; readonly actor: string };

export interface StartInput {
  readonly owner: SessionOwner;
  readonly clientToken: string;
  readonly name: string;
  readonly mime?: string;
  readonly size: number;
  readonly sha256: string;
}

export function sessionView(s: YuklemeOturumu, received: readonly number[]) {
  return {
    oturumId: s.id,
    durum: s.durum,
    dosyaAdi: s.dosyaAdi,
    toplamBayt: Number(s.toplamBayt),
    parcaBayt: s.parcaBayt,
    parcaSayisi: s.parcaSayisi,
    alinanlar: [...received].sort((a, b) => a - b),
    dosyaId: s.dosyaId,
  };
}

async function receivedParts(sessionId: string): Promise<number[]> {
  return (await prisma.yuklemeParcasi.findMany({ where: { oturumId: sessionId }, select: { sira: true } })).map((p) => p.sira);
}

function sameStart(s: YuklemeOturumu, g: StartInput, name: string): boolean {
  const owner = g.owner.kind === "ISTEK" ? s.istekId === g.owner.request.id : s.istekId === null && s.musteriId === g.owner.customerId;
  return owner && s.dosyaAdi === name && s.toplamBayt === BigInt(g.size) && s.sha256 === g.sha256;
}

/** Oturum açar (ya da aynı kimlikle açılmış olanı döndürür — sürdürme). GELEN oturumda kota rezerve edilir. */
export async function startSession(config: VendorConfig, g: StartInput, nowMs: number) {
  const incoming = g.owner.kind === "ISTEK";
  const { name, mime } = vetFile(g.name, g.mime, incoming ? INCOMING_EXTENSIONS : OUTGOING_EXTENSIONS);
  if (!SHA.test(g.sha256)) throw badRequest("Dosya özeti 64 haneli küçük harf sha256 olmalı");
  const cap = incoming ? Number((g.owner as { request: YuklemeIstegi }).request.azamiDosyaBayt) : config.DOSYA_AZAMI_MB * MIB;
  if (!Number.isSafeInteger(g.size) || g.size < 1) throw badRequest("Dosya boyutu pozitif tamsayı olmalı");
  if (g.size > cap) throw new VendorError(413, "DOSYA_COK_BUYUK", `Dosya tavanı aşıldı (${Math.floor(cap / MIB)} MB)`);
  const prior = await prisma.yuklemeOturumu.findUnique({ where: { clientToken: g.clientToken } });
  if (prior) return replayStart(prior, g, name);
  const partBytes = config.PARCA_AZAMI_MB * MIB;
  const data = {
    clientToken: g.clientToken,
    musteriId: incoming ? g.owner.request.musteriId : (g.owner as { customerId: string }).customerId,
    yon: incoming ? ("GELEN" as const) : ("GIDEN" as const),
    istekId: incoming ? g.owner.request.id : null,
    dosyaAdi: name,
    mime,
    toplamBayt: BigInt(g.size),
    parcaBayt: partBytes,
    parcaSayisi: Math.ceil(g.size / partBytes),
    sha256: g.sha256,
    sonEtkinlik: new Date(nowMs),
    olusturan: g.owner.actor,
  };
  try {
    const row = incoming ? await reserveAndCreate(g.owner.request.id, data, g.size, nowMs) : await prisma.yuklemeOturumu.create({ data });
    return sessionView(row, []);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await prisma.yuklemeOturumu.findUnique({ where: { clientToken: g.clientToken } });
    if (!again) throw err;
    return replayStart(again, g, name);
  }
}

async function replayStart(s: YuklemeOturumu, g: StartInput, name: string) {
  if (!sameStart(s, g, name)) throw new VendorError(409, "ISLEM_KIMLIGI_CAKISTI", "Bu işlem kimliği başka bir yüklemede kullanılmış");
  return sessionView(s, await receivedParts(s.id));
}

/** Kota rezervasyonu: istek AKTIF + süresi içinde + kullanılan + boyut ≤ kota (koşullu UPDATE; CHECK seddi). */
async function reserveAndCreate(requestId: string, data: Parameters<typeof prisma.yuklemeOturumu.create>[0]["data"], size: number, nowMs: number) {
  return prisma.$transaction(async (tx) => {
    await lockUploadScope(tx, requestId, []);
    const now = new Date(nowMs);
    const n = await tx.$executeRaw`
      UPDATE "yukleme_istegi" SET "kullanilanBayt" = "kullanilanBayt" + ${BigInt(size)}, "updatedAt" = ${now}
      WHERE "id" = ${requestId}::uuid AND "durum" = 'AKTIF' AND "bitis" > ${now} AND "kullanilanBayt" + ${BigInt(size)} <= "kotaBayt"`;
    if (n === 0) {
      const fresh = await tx.yuklemeIstegi.findUnique({ where: { id: requestId } });
      if (!fresh || fresh.durum !== "AKTIF" || fresh.bitis.getTime() <= nowMs) throw requestExpired();
      throw new VendorError(413, "KOTA_ASILDI", `Yükleme kotası yetmiyor (kalan ${Math.floor(Number(fresh.kotaBayt - fresh.kullanilanBayt) / MIB)} MB)`);
    }
    return tx.yuklemeOturumu.create({ data });
  });
}

/** Oturum sahibinin oturumu (başka isteğin/müşterinin oturumu "bulunamadı"). */
export async function findOwnedSession(owner: SessionOwner, sessionId: string): Promise<YuklemeOturumu> {
  const s = await prisma.yuklemeOturumu.findUnique({ where: { id: sessionId } });
  const mine = s && (owner.kind === "ISTEK" ? s.istekId === owner.request.id : s.istekId === null && s.musteriId === owner.customerId);
  if (!s || !mine) throw notFoundError("Yükleme oturumu");
  return s;
}

export async function sessionState(owner: SessionOwner, sessionId: string) {
  const s = await findOwnedSession(owner, sessionId);
  return sessionView(s, await receivedParts(s.id));
}

function requireOpen(s: YuklemeOturumu): void {
  if (s.durum === "TAMAMLANDI") throw stateConflict("Yükleme zaten tamamlandı");
  if (s.durum !== "ACIK") throw new VendorError(410, "BAGLANTI_GECERSIZ", "Yükleme oturumu terk edildi; yeniden başlatın");
}

export function expectedPartBytes(s: Pick<YuklemeOturumu, "toplamBayt" | "parcaBayt" | "parcaSayisi">, index: number): number {
  return index < s.parcaSayisi - 1 ? s.parcaBayt : Number(s.toplamBayt) - s.parcaBayt * (s.parcaSayisi - 1);
}

/** Parça: sıra aralıkta, boyut beklenenle ve özet başlıktakiyle birebir; aynı sıra aynı özet → idempotent. */
export async function writePart(config: VendorConfig, g: { owner: SessionOwner; sessionId: string; index: number; sha256: string; body: Readable; nowMs: number }) {
  const s = await findOwnedSession(g.owner, g.sessionId);
  requireOpen(s);
  if (g.owner.kind === "ISTEK" && (g.owner.request.durum !== "AKTIF" || g.owner.request.bitis.getTime() <= g.nowMs)) throw requestExpired();
  if (!Number.isInteger(g.index) || g.index < 0 || g.index >= s.parcaSayisi) throw badRequest(`Parça sırası 0–${s.parcaSayisi - 1} olmalı`);
  if (!SHA.test(g.sha256)) throw badRequest("Parça özeti (X-Parca-Sha256) 64 haneli küçük harf sha256 olmalı");
  const existing = await prisma.yuklemeParcasi.findUnique({ where: { oturumId_sira: { oturumId: s.id, sira: g.index } } });
  if (existing) {
    if (existing.sha256 !== g.sha256) throw new VendorError(422, "PARCA_BUTUNLUGU", "Bu sıradaki parça farklı içerikle alınmış");
    return { sira: g.index, tekrar: true };
  }
  const expected = expectedPartBytes(s, g.index);
  const dir = partDir(config.DOSYA_DIZINI, s.id);
  const written = await streamToTemp(g.body, dir, expected);
  if (written.bytes !== expected || written.sha256 !== g.sha256) {
    await removeQuietly(written.tmp);
    throw new VendorError(422, "PARCA_BUTUNLUGU", written.bytes !== expected ? `Parça boyutu tutmadı (${written.bytes} ≠ ${expected})` : "Parça özeti tutmadı");
  }
  await moveInto(written.tmp, partPath(config.DOSYA_DIZINI, s.id, g.index, g.sha256));
  try {
    await prisma.yuklemeParcasi.create({ data: { oturumId: s.id, sira: g.index, bayt: expected, sha256: g.sha256 } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const won = await prisma.yuklemeParcasi.findUnique({ where: { oturumId_sira: { oturumId: s.id, sira: g.index } } });
    if (won?.sha256 !== g.sha256) throw new VendorError(422, "PARCA_BUTUNLUGU", "Bu sıradaki parça farklı içerikle alınmış");
    return { sira: g.index, tekrar: true };
  }
  await prisma.yuklemeOturumu.updateMany({ where: { id: s.id, durum: "ACIK" }, data: { sonEtkinlik: new Date(g.nowMs) } });
  return { sira: g.index, tekrar: false };
}

/** Tamamlama: bütün parçalar → birleşik gövde → özet beyanla aynı mı → dosya satırı + defter (tek tx). */
export async function completeSession(config: VendorConfig, g: { owner: SessionOwner; sessionId: string; nowMs: number }): Promise<DagitimDosyasi> {
  const s = await findOwnedSession(g.owner, g.sessionId);
  // Sonucu belirsiz kalan tamamlamanın tekrarı: cevap oturumdan (aynı dosya), iş kuralından değil.
  if (s.durum === "TAMAMLANDI" && s.dosyaId) return prisma.dagitimDosyasi.findUniqueOrThrow({ where: { id: s.dosyaId } });
  requireOpen(s);
  if (g.owner.kind === "ISTEK" && (g.owner.request.durum !== "AKTIF" || g.owner.request.bitis.getTime() <= g.nowMs)) throw requestExpired();
  const parts = await prisma.yuklemeParcasi.findMany({ where: { oturumId: s.id }, select: { sira: true, sha256: true } });
  if (parts.length !== s.parcaSayisi) {
    const have = new Set(parts.map((p) => p.sira));
    const missing = Array.from({ length: s.parcaSayisi }, (_, i) => i).filter((i) => !have.has(i));
    throw new VendorError(409, "DURUM_CAKISMASI", `Eksik parça var: ${missing.slice(0, 20).join(", ")}`, { eksik: missing });
  }
  const whole = await assembleParts(config.DOSYA_DIZINI, s.id, parts);
  if (whole.bytes !== Number(s.toplamBayt) || whole.sha256 !== s.sha256) {
    await removeQuietly(whole.tmp);
    await abandonSession(config, s, g.owner.actor, "BUTUNLUK");
    throw new VendorError(422, "PARCA_BUTUNLUGU", "Birleşik dosyanın özeti beyanla tutmadı; yükleme yeniden başlatılmalı");
  }
  const key = newBodyKey();
  await moveInto(whole.tmp, bodyPath(config.DOSYA_DIZINI, key));
  try {
    const file = await prisma.$transaction(async (tx) => {
      await lockUploadScope(tx, s.istekId, [s.id]);
      const f = await tx.dagitimDosyasi.create({
        data: {
          musteriId: s.musteriId,
          yon: s.yon,
          ad: s.dosyaAdi,
          mime: s.mime,
          boyut: s.toplamBayt,
          sha256: s.sha256,
          depoAnahtari: key,
          saklamaBitis: new Date(g.nowMs + config.DOSYA_SAKLAMA_GUN * DAY_MS),
          yuklemeIstegiId: s.istekId,
          yukleyen: g.owner.actor,
        },
      });
      const claimed = await tx.yuklemeOturumu.updateMany({ where: { id: s.id, durum: "ACIK" }, data: { durum: "TAMAMLANDI", dosyaId: f.id, sonEtkinlik: new Date(g.nowMs) } });
      if (claimed.count === 0) throw stateConflict("Yükleme oturumu başka bir işlemle kapandı");
      await appendLedger(tx, {
        event: "DOSYA_YUKLENDI",
        customerId: s.musteriId,
        actor: g.owner.actor,
        fileId: f.id,
        sessionId: s.id,
        ...(s.istekId ? { requestId: s.istekId } : {}),
        detail: { yon: s.yon, ad: s.dosyaAdi, boyut: Number(s.toplamBayt), sha256: s.sha256 },
      });
      return f;
    });
    await removeQuietly(partDir(config.DOSYA_DIZINI, s.id));
    return file;
  } catch (err) {
    await removeQuietly(bodyPath(config.DOSYA_DIZINI, key));
    throw err;
  }
}

/** ACIK → TERK; GELEN oturum kotasını iade eder; parçalar silinir. Zaten kapanmışsa false. */
export async function abandonSession(
  config: VendorConfig,
  s: Pick<YuklemeOturumu, "id" | "istekId" | "musteriId" | "toplamBayt">,
  actor: string,
  reason: string,
  staleBefore?: Date,
): Promise<boolean> {
  const done = await prisma.$transaction(async (tx) => {
    await lockUploadScope(tx, s.istekId, [s.id]);
    // Süre aşımı terki etkinliği claim anında yeniden ölçer: arada parça geldiyse oturum terk EDİLMEZ.
    const claimed = await tx.yuklemeOturumu.updateMany({ where: { id: s.id, durum: "ACIK", ...(staleBefore ? { sonEtkinlik: { lt: staleBefore } } : {}) }, data: { durum: "TERK" } });
    if (claimed.count === 0) return false;
    if (s.istekId) {
      await tx.$executeRaw`
        UPDATE "yukleme_istegi" SET "kullanilanBayt" = "kullanilanBayt" - ${s.toplamBayt}, "updatedAt" = now()
        WHERE "id" = ${s.istekId}::uuid AND "kullanilanBayt" >= ${s.toplamBayt}`;
    }
    await appendLedger(tx, { event: "YUKLEME_TERK", customerId: s.musteriId, actor, sessionId: s.id, ...(s.istekId ? { requestId: s.istekId } : {}), detail: { sebep: reason, boyut: Number(s.toplamBayt) } });
    return true;
  });
  if (done) await removeQuietly(partDir(config.DOSYA_DIZINI, s.id));
  return done;
}
