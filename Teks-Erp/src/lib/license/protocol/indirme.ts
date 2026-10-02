// İNDİRME belirteci: kanal-öneki + kurulum + kısa ömür. Doğrulayıcı kenarda (CF Worker)
// yeniden yazılır; bu dosya onun kâhinidir — iki taraf aynı sınırları uygular.
import type { KeyObject } from "node:crypto";
import { z } from "zod";
import { publicKeyFromX, verifyJws } from "./jws";
import { ChannelCodeSchema, IsoTimeSchema, PROTOCOL_VERSION, TYP, UuidSchema, decodeDocument, signDocument } from "./belgeler";
import { CLOCK_SKEW_MS, success, failure, forwardFailure, isoToMs, type Result } from "./ortak";

/** Güncelleme sunucusunda kanal başına ürün dizinleri (`/<kanal>/<ürün>/`) — indirme belirtecinin önek kümesi. */
export const DOWNLOAD_PRODUCTS = ["electron", "mobil", "backend"] as const;
export type DownloadProduct = (typeof DOWNLOAD_PRODUCTS)[number];

export const DownloadSchema = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    kanal: ChannelCodeSchema,
    yolOneki: z.string().max(80),
    kurulumId: UuidSchema,
    exp: IsoTimeSchema,
  })
  .refine((i) => DOWNLOAD_PRODUCTS.some((urun) => i.yolOneki === `/${i.kanal}/${urun}/`), {
    message: "Yol öneki kanalın electron/, mobil/ ya da backend/ dizini olmalı",
  });
export type DownloadDoc = z.infer<typeof DownloadSchema>;

export const DOWNLOAD_MAX_TTL_MS = 70 * 60 * 1000;
const DOWNLOAD_KID_PATTERN = /^ind-[a-z0-9-]{1,60}$/;

/**
 * Worker İNDİRME listesinin satırı. `kanallar` ve pencere (`baslangic` + `bitis`, sertifikanınki) yoksa
 * satır KISITSIZDIR — L2-8 öncesi `{kid, x}` biçimi; varsa belirteç yalnız kanal kümede ve şimdi pencerede iken geçer.
 */
export interface DownloadPublicKey {
  readonly kid: string;
  readonly x: string;
  readonly kanallar?: readonly string[];
  readonly baslangic?: string;
  readonly bitis?: string;
}

export function signDownloadToken(g: {
  readonly payload: DownloadDoc;
  readonly key: { readonly kid: string; readonly privateKey: KeyObject };
  readonly nowMs: number;
}): string {
  if (!DOWNLOAD_KID_PATTERN.test(g.key.kid)) throw new Error("signDownloadToken: kid ind- ile başlamalı");
  if (isoToMs(g.payload.exp) - g.nowMs > DOWNLOAD_MAX_TTL_MS) {
    throw new Error("signDownloadToken: ömür 70 dakikayı aşamaz");
  }
  return signDocument({ typ: TYP.INDIRME, schema: DownloadSchema, payload: g.payload, key: g.key });
}

/** Satırın penceresi şimdi açık mı (±tolerans)? Yarım ya da biçimsiz pencere KAPALI sayılır. */
export function downloadKeyWindowOpen(key: DownloadPublicKey, nowMs: number): boolean {
  if (key.baslangic === undefined && key.bitis === undefined) return true;
  const start = IsoTimeSchema.safeParse(key.baslangic);
  const end = IsoTimeSchema.safeParse(key.bitis);
  if (!start.success || !end.success) return false;
  return nowMs >= isoToMs(start.data) - CLOCK_SKEW_MS && nowMs <= isoToMs(end.data) + CLOCK_SKEW_MS;
}

/** Satır bu kanala izin veriyor mu? Küme dizi değilse izin YOK. */
export function downloadKeyAllowsChannel(key: DownloadPublicKey, channel: string): boolean {
  if (key.kanallar === undefined) return true;
  return Array.isArray(key.kanallar) && key.kanallar.includes(channel);
}

export function verifyDownloadToken(
  token: unknown,
  g: { readonly keys: readonly DownloadPublicKey[]; readonly nowMs: number },
): Result<DownloadDoc> {
  // Aynı kid iki satırda: İLK satır kazanır (Worker `find` ile aynı); açık anahtarı bozuksa kid bilinmez sayılır.
  const lookup = new Map<string, { readonly keyObj: KeyObject | null; readonly entry: DownloadPublicKey }>();
  for (const a of g.keys) {
    if (!DOWNLOAD_KID_PATTERN.test(a.kid) || lookup.has(a.kid)) continue;
    lookup.set(a.kid, { keyObj: publicKeyFromX(a.x), entry: a });
  }
  const j = verifyJws(token, { typ: TYP.INDIRME, findKey: (kid) => lookup.get(kid)?.keyObj ?? undefined });
  if (!j.ok) return forwardFailure(j);
  const b = decodeDocument(DownloadSchema, j.value.payload);
  if (!b.ok) return forwardFailure(b);
  const exp = isoToMs(b.value.exp);
  if (g.nowMs > exp + CLOCK_SKEW_MS) return failure("BELGE_SURESI_DOLDU", "İndirme belirtecinin süresi doldu");
  if (exp - g.nowMs > DOWNLOAD_MAX_TTL_MS + CLOCK_SKEW_MS) {
    return failure("INDIRME_OMUR", "İndirme belirtecinin ömrü izin verilenden uzun");
  }
  const entry = lookup.get(j.value.header.kid)?.entry;
  if (!entry) return failure("JWS_KID", `Bilinmeyen anahtar kimliği: ${j.value.header.kid}`);
  if (!downloadKeyWindowOpen(entry, g.nowMs)) {
    return failure("INDIRME_PENCERE", "İndirme anahtarı bu an için listede geçerli değil (pencere dışı)");
  }
  if (!downloadKeyAllowsChannel(entry, b.value.kanal)) {
    return failure("INDIRME_KANAL", "İndirme anahtarı bu kanal için yetkili değil");
  }
  return success(b.value);
}

const FORBIDDEN_PATH_PART = /(\.\.|\\|\/\/|%2e|%2f|%5c|%00)/i;

/** İstenen yol belirtecin önekinin altında mı? Kaçış dizileri ve `..` RED. */
export function isDownloadPathAllowed(doc: DownloadDoc, path: string): boolean {
  if (FORBIDDEN_PATH_PART.test(path)) return false;
  return path.startsWith(doc.yolOneki) && path.length > doc.yolOneki.length;
}
