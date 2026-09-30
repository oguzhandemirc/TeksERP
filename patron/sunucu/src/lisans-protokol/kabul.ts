// İLK KURULUM KABULÜ (Ek-7): kabul belgesi KURULUM anahtarıyla imzalı ayrı bir belgedir — etkinleştirme
// gövdesinin ham baytı kodu taşıdığı için saklanamaz; kanıtın kendisi imzalı olmalı. Tanınan metinler
// `kabul-katalogu.ts`te (üretilir, elle düzenlenmez).
import { createHash, type KeyObject } from "node:crypto";
import { z } from "zod";
import { IsoTimeSchema, PROTOCOL_VERSION, TYP, UuidSchema, VersionTextSchema, decodeDocument, signDocument } from "./belgeler";
import { installationKeyId, publicKeyFromX, publicKeyX, verifyJws } from "./jws";
import { ACCEPTANCE_TEXTS } from "./kabul-katalogu";

/** Metin kimliği (`KM-<yıl>.<n>`, taslakta `-taslak` son eki) — hukuk belgesinin "Metin kimliği" satırı. */
export const AcceptanceTextIdSchema = z.string().regex(/^KM-\d{4}\.\d{1,3}(-taslak)?$/);
/** Gösterilen tam metnin sha256'sı (küçük harf onaltılık). */
export const AcceptanceTextDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const AcceptanceBoxIdSchema = z.string().regex(/^[1-9]\d?$/);
export const ACCEPTANCE_NAME_MAX = 120;

export interface AcceptanceTextEntry {
  readonly kimlik: string;
  readonly ozet: string;
  /** Metindeki onay kutuları, metindeki sırasıyla; kabul HEPSİNİ taşımalı. */
  readonly kutular: readonly string[];
}

/** Kanonik metnin özeti: NFC + UTF-8 baytlarının sha256'sı (fabrika gösterdiği metni, üretici belgeyi özetler). */
export function acceptanceTextDigest(text: string): string {
  return createHash("sha256").update(text.normalize("NFC"), "utf8").digest("hex");
}

const PersonTextSchema = z.string().trim().min(2).max(ACCEPTANCE_NAME_MAX);

/**
 * Kabul belgesinin yükü. Belge şeması GEVŞEK (v:1 içinde yeni bilgi alanı eklenebilir, eski satıcı atar);
 * `kabulEden` Ek-3 A.5'te beyan edilen alanlardır: kullanıcı kimliği, ad-soyad, unvan.
 */
export const AcceptanceDocSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  kabulId: UuidSchema,
  metin: z.object({ kimlik: AcceptanceTextIdSchema, ozet: AcceptanceTextDigestSchema }),
  kutular: z
    .array(AcceptanceBoxIdSchema)
    .min(1)
    .max(12)
    .refine((list) => new Set(list).size === list.length, "Kutu listesinde tekrar var"),
  kabulEden: z.object({ kullaniciId: UuidSchema, ad: PersonTextSchema, unvan: PersonTextSchema }),
  zaman: IsoTimeSchema,
  istemci: z.object({ tur: z.literal("panel"), surum: VersionTextSchema.nullable() }),
  sunucuSurum: VersionTextSchema,
});
export type AcceptanceDoc = z.infer<typeof AcceptanceDocSchema>;

export function signAcceptance(g: { readonly payload: AcceptanceDoc; readonly privateKey: KeyObject }): string {
  const kid = installationKeyId(publicKeyX(g.privateKey));
  return signDocument({ typ: TYP.KABUL, schema: AcceptanceDocSchema, payload: g.payload, key: { kid, privateKey: g.privateKey } });
}

/** Satıcının ret nedenleri (`details.neden`): yok · imza · şema · tanınmayan metin · eksik/fazla kutu. */
export const ACCEPTANCE_REJECTIONS = ["YOK", "IMZA", "SEMA", "METIN", "KUTU"] as const;
export type AcceptanceRejection = (typeof ACCEPTANCE_REJECTIONS)[number];
export type AcceptanceCheck =
  | { readonly ok: true; readonly doc: AcceptanceDoc; readonly text: AcceptanceTextEntry }
  | { readonly ok: false; readonly neden: AcceptanceRejection; readonly message: string };

const reject = (neden: AcceptanceRejection, message: string): AcceptanceCheck => ({ ok: false, neden, message });

/**
 * Etkinleştirme gövdesindeki kabul belgesi: gövdenin açık anahtarıyla (isteği imzalayan kurulum) imzalı,
 * şemaya uygun, tanınan bir metnin (kimlik + özet) kabulü ve o metnin kutularının TAMAMI — fazlası da RED.
 */
export function verifyAcceptance(
  token: string | undefined,
  g: { readonly publicKeyX: string; readonly texts?: readonly AcceptanceTextEntry[] },
): AcceptanceCheck {
  if (!token) return reject("YOK", "Kabul belgesi yok");
  const key = publicKeyFromX(g.publicKeyX);
  const kid = installationKeyId(g.publicKeyX);
  const j = verifyJws(token, { typ: TYP.KABUL, findKey: (k) => (key && k === kid ? key : undefined) });
  if (!j.ok) return reject("IMZA", `Kabul belgesi bu kurulumun anahtarıyla doğrulanamadı (${j.code})`);
  const d = decodeDocument(AcceptanceDocSchema, j.value.payload);
  if (!d.ok) return reject("SEMA", d.message);
  const doc = d.value;
  const text = (g.texts ?? ACCEPTANCE_TEXTS).find((t) => t.kimlik === doc.metin.kimlik && t.ozet === doc.metin.ozet);
  if (!text) return reject("METIN", `Tanınmayan kabul metni: ${doc.metin.kimlik}`);
  const required = new Set(text.kutular);
  if (doc.kutular.length !== required.size || !doc.kutular.every((k) => required.has(k))) {
    return reject("KUTU", "Kabul belgesi metnin bütün kutularını taşımıyor");
  }
  return { ok: true, doc, text };
}
