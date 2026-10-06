// YAYIN BİLDİRİMİ — yayın betikleri (electron-grup-yayinla.sh · mobil-grup-yayinla.mjs · backend-yayinla.mjs) yayın/terfi
// SONRASI imzalı bildirim gönderir; satıcı yayıncı anahtarıyla doğrular ve `yayin_bildirimi` defterine yazar.
// Bildirim kimliği İÇERİKTEN türer: aynı olayın tekrarı (yeniden deneme, paketle+yayınla) aynı satırı döndürür.
// Bildirim yalnız GÖRÜNÜM ve defterdir: `kanal.guncelSurumler`i (kiraya akan) OTOMATİK DEĞİŞTİRMEZ.
// Tel biçimi `scripts/lib/yayin-bildirim.mjs` ile aynı (bekçi: test_yayin_bildirimi — betiğin kendisiyle imzalar).
import { createHash, createPublicKey, verify } from "node:crypto";
import type { YayinBildirimi, YayinciAnahtari } from "@prisma/client";
import { z } from "zod";
import { VendorError, badRequest, notFoundError, stateConflict } from "../lib/errors";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { isUniqueViolation, uniqueViolationOn } from "../lib/prisma-errors";

export const NOTICE_TYPE = "tekserp-yayin-bildirimi";
/** İmzalanan bayt dizisinin alan öneki (başka bir imzalı belge bildirim yerine geçemez). */
export const NOTICE_SIGNING_PREFIX = "tekserp-yayin-bildirimi.v1\n";
export const NOTICE_SIGNATURE_HEADER = "x-yayin-imzasi";
export const NOTICE_WINDOW_MS = 15 * 60_000;
export const NOTICE_EVENTS = ["YAYIN", "TERFI", "TERFI_ATLANDI"] as const;
export const NOTICE_PRODUCTS = ["panel", "tablet", "backend"] as const;

const Kid = z.string().regex(/^[a-z0-9][a-z0-9.-]{2,79}$/);
const Version = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,20})?$/);

export const NoticeSchema = z.strictObject({
  v: z.literal(1),
  typ: z.literal(NOTICE_TYPE),
  kid: Kid,
  zaman: z.iso.datetime(),
  olay: z.enum(NOTICE_EVENTS),
  urun: z.enum(NOTICE_PRODUCTS),
  kanal: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  surum: Version,
  ayrinti: z
    .strictObject({
      tur: z.enum(["kurulum", "ota", "apk", "paket"]).optional(),
      sha16: z.string().regex(/^[0-9a-f]{16}$/).optional(),
      boyut: z.number().int().min(0).max(1e12).optional(),
      vc: z.number().int().min(1).max(1e9).optional(),
      makine: z.string().min(1).max(120).optional(),
      etiket: z.string().min(1).max(120).optional(),
      cumle: z.string().min(1).max(500).optional(),
    })
    .default({}),
});
export type Notice = z.infer<typeof NoticeSchema>;

export function noticeId(n: Pick<Notice, "olay" | "urun" | "kanal" | "surum" | "ayrinti">): string {
  return createHash("sha256").update(JSON.stringify([n.olay, n.urun, n.kanal, n.surum, n.ayrinti.tur ?? null, n.ayrinti.sha16 ?? null])).digest("hex");
}

const rejected = (message: string): VendorError => new VendorError(401, "YAYINCI_IMZASI_GECERSIZ", message);

/** Ham gövde + imza başlığı → doğrulanmış bildirim. Sıra: şema → yayıncı (aktif) → imza → zaman penceresi. */
export async function verifyNotice(raw: Buffer, signature: string | undefined, nowMs: number): Promise<{ notice: Notice; publisher: YayinciAnahtari }> {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch {
    throw badRequest("Bildirim gövdesi JSON değil");
  }
  const parsed = NoticeSchema.safeParse(value);
  if (!parsed.success) throw badRequest(`Bildirim sözleşmeye uymuyor (${parsed.error.issues[0]?.path.join(".") ?? "?"})`);
  const notice = parsed.data;
  const publisher = await prisma.yayinciAnahtari.findUnique({ where: { kid: notice.kid } });
  if (!publisher || !publisher.aktif) throw rejected("Yayıncı tanınmıyor ya da pasif");
  if (!signature || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw rejected("İmza başlığı yok ya da biçimsiz");
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publisher.acikAnahtar }, format: "jwk" });
  const ok = verify(null, Buffer.concat([Buffer.from(NOTICE_SIGNING_PREFIX, "utf8"), raw]), key, Buffer.from(signature, "base64url"));
  if (!ok) throw rejected("Bildirim imzası doğrulanamadı");
  if (Math.abs(Date.parse(notice.zaman) - nowMs) > NOTICE_WINDOW_MS) throw rejected("Bildirim zamanı kabul penceresinin dışında");
  return { notice, publisher };
}

/** Deftere yazar; aynı bildirim kimliği zaten varsa o satır döner (`tekrar: true`). Tek ekleme, tx yok. */
export async function recordNotice(notice: Notice): Promise<{ row: YayinBildirimi; tekrar: boolean }> {
  const id = noticeId(notice);
  const prior = await prisma.yayinBildirimi.findUnique({ where: { bildirimKimligi: id } });
  if (prior) return { row: prior, tekrar: true };
  try {
    const row = await prisma.yayinBildirimi.create({
      data: {
        bildirimKimligi: id,
        olay: notice.olay,
        urun: notice.urun,
        kanalKodu: notice.kanal,
        surum: notice.surum,
        yayinciKid: notice.kid,
        olayZamani: new Date(notice.zaman),
        ayrinti: notice.ayrinti,
      },
    });
    return { row, tekrar: false };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { row: await prisma.yayinBildirimi.findUniqueOrThrow({ where: { bildirimKimligi: id } }), tekrar: true };
  }
}

export const PublisherKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Açık anahtar base64url 32 bayt (43 karakter) olmalı");

/** Yayıncı anahtarı kaydı (yalnız açık yarı, 32 bayt). Sahipliği ilk imzalı bildirim kanıtlar. */
export async function createPublisherTx(tx: Tx, g: { kid: string; name: string; publicKey: string }): Promise<YayinciAnahtari> {
  if (!Kid.safeParse(g.kid).success) throw badRequest("Yayıncı kimliği küçük harf/rakam/nokta/tire, 3–80 karakter olmalı");
  try {
    createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: g.publicKey }, format: "jwk" });
  } catch {
    throw badRequest("Açık anahtar Ed25519 açık anahtarı olarak okunamadı");
  }
  const taken = await tx.yayinciAnahtari.findUnique({ where: { kid: g.kid }, select: { id: true } });
  if (taken) throw stateConflict(`Bu yayıncı kimliği kayıtlı: ${g.kid}`);
  return tx.yayinciAnahtari.create({ data: { kid: g.kid, ad: g.name, acikAnahtar: g.publicKey } }).catch((err: unknown) => {
    throw uniqueViolationOn(err, "kid") ? stateConflict(`Bu yayıncı kimliği kayıtlı: ${g.kid}`) : err;
  });
}

/** Pasife alma (atomik claim); pasif anahtarın bildirimi reddedilir, eski defter satırları kalır. */
export async function deactivatePublisherTx(tx: Tx, id: string): Promise<YayinciAnahtari> {
  const claimed = await tx.yayinciAnahtari.updateMany({ where: { id, aktif: true }, data: { aktif: false } });
  const row = await tx.yayinciAnahtari.findUnique({ where: { id } });
  if (!row) throw notFoundError("Yayıncı anahtarı");
  if (claimed.count === 0) throw stateConflict("Yayıncı anahtarı zaten pasif");
  return row;
}

export async function listPublishers(db: Db): Promise<YayinciAnahtari[]> {
  return db.yayinciAnahtari.findMany({ orderBy: [{ aktif: "desc" }, { kid: "asc" }] });
}

export async function listNotices(db: Db, f: { channel?: string; limit: number }): Promise<YayinBildirimi[]> {
  return db.yayinBildirimi.findMany({ where: f.channel ? { kanalKodu: f.channel } : {}, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: f.limit });
}
