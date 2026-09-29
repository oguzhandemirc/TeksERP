// Patron bulutu GELEN KUTUSU tel sözleşmesi (fabrika tarafı; `PATRON-BULUTU-ESITLEME.md` §8). Tel anahtarları Türkçe,
// sözleşmedir. Gövde şemaları KATI: tanınmayan anahtar ret (`GOVDE_GECERSIZ`). Alan kümesi fabrikanın yaratma yolunun
// ALT kümesidir — tel → fabrika anahtar eşlemesi aşağıda TEK yerdedir ve hedefleri yazılabilir kümelerin içinde kalır
// (bekçi `test_bulut_gelen_kutusu` §1). İş kuralları burada DEĞİL, fabrikanın servisinde koşar.
import { createHash } from "node:crypto";
import { z } from "zod";

export const INBOX_WIRE_VERSION = 1;
export const INBOX_ENDPOINTS = {
  PULL: "/v1/gelen-kutusu/al",
  RESULT: "/v1/gelen-kutusu/sonuc",
  ACCOUNTS: "/v1/hesaplar",
} as const;
/** Bir `al` turunda en çok çekilen kayıt (bulut claim'i `claimBitis = now()+10dk`). */
export const INBOX_PULL_MAX = 20;

export const INBOX_KINDS = ["SIPARIS", "CARI"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Ret kodları — bulut kullanıcıya TR mesajla gösterir. 5xx/ağ hatası ret DEĞİLDİR (makbuz doğmaz). */
export const INBOX_REJECT_CODES = [
  "GOVDE_GECERSIZ",
  "CARI_AD_MUKERRER",
  "CARI_BULUNAMADI",
  "URUN_BULUNAMADI",
  "RENK_BULUNAMADI",
  "MODUL_KAPALI",
  "MESAJ_CAKISMASI",
  "IS_KURALI",
] as const;
export type InboxRejectCode = (typeof INBOX_REJECT_CODES)[number];

const Uuid = z.uuid();
/** Decimal tel değeri: sayı ya da ondalık metin (`"12.5"`); fabrikaya sayı olarak geçer. */
const DecimalWire = z
  .union([z.number().finite(), z.string().trim().regex(/^-?\d{1,12}(\.\d{1,6})?$/)])
  .transform((v) => (typeof v === "number" ? v : Number(v)));
const Text = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const OrderLineWireSchema = z
  .object({
    urunId: Uuid,
    renkId: Uuid.nullable().optional(),
    miktar: DecimalWire,
    birim: z.string().trim().min(1).max(10).optional(),
    birimFiyat: DecimalWire.nullable().optional(),
    en: DecimalWire.nullable().optional(),
    musteriUrunAdi: OptionalText(200),
    musteriRenkAdi: OptionalText(200),
  })
  .strict();

export const OrderWireSchema = z
  .object({
    cariKartId: Uuid,
    subeId: Uuid.nullable().optional(),
    termin: z.iso.datetime({ offset: true }).optional(),
    doviz: z.string().trim().length(3),
    kalemler: z.array(OrderLineWireSchema).min(1).max(200),
  })
  .strict();
export type OrderWire = z.infer<typeof OrderWireSchema>;

export const CardWireSchema = z
  .object({
    ad: Text(100),
    roller: z.object({ musteri: z.boolean(), tedarikci: z.boolean() }).strict(),
    il: OptionalText(80),
    ilce: OptionalText(80),
    ulke: OptionalText(80),
    vergiNo: OptionalText(15),
    adres: OptionalText(500),
    yetkili: OptionalText(120),
    telefon: OptionalText(40),
    eposta: OptionalText(200),
  })
  .strict();
export type CardWire = z.infer<typeof CardWireSchema>;

/** Tel → fabrika anahtarı (sipariş başlığı). Hedefler `ORDER_HEADER_WRITABLE` içinde olmalı. */
export const ORDER_HEADER_WIRE_MAP = {
  cariKartId: "customerId",
  subeId: "branchId",
  termin: "deadline",
  doviz: "currency",
} as const satisfies Record<Exclude<keyof OrderWire, "kalemler">, string>;

/** Tel → fabrika anahtarı (sipariş kalemi). Hedefler `ORDER_LINE_WRITABLE` içinde olmalı. */
export const ORDER_LINE_WIRE_MAP = {
  urunId: "itemId",
  renkId: "colorId",
  miktar: "quantity",
  birim: "unit",
  birimFiyat: "unitPrice",
  en: "width",
  musteriUrunAdi: "customerItemName",
  musteriRenkAdi: "customerColorName",
} as const satisfies Record<keyof z.infer<typeof OrderLineWireSchema>, string>;

/** Tel → fabrika anahtarı (cari kart). Hedefler Customer skaler kolonları; kod ve fason rolü fabrikada doğar. */
export const CARD_WIRE_MAP = {
  ad: "name",
  il: "city",
  ilce: "district",
  ulke: "country",
  vergiNo: "taxNumber",
  adres: "address",
  yetkili: "contactName",
  telefon: "contactPhone",
  eposta: "email",
} as const satisfies Record<Exclude<keyof CardWire, "roller">, string>;
export const CARD_ROLE_WIRE_MAP = { musteri: "isCustomerRole", tedarikci: "isSupplierRole" } as const;

function mapKeys(src: Record<string, unknown>, map: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [wire, factory] of Object.entries(map)) if (src[wire] !== undefined) out[factory] = src[wire];
  return out;
}

/** Sipariş tel gövdesi → fabrikanın `create` gövdesi (clientToken = mesajId). */
export function orderWireToFactory(w: OrderWire, messageId: string): Record<string, unknown> {
  const { kalemler, ...header } = w;
  return {
    ...mapKeys(header, ORDER_HEADER_WIRE_MAP),
    lines: kalemler.map((k) => mapKeys(k, ORDER_LINE_WIRE_MAP)),
    clientToken: messageId,
  };
}

/** Cari tel gövdesi → fabrikanın kart `create` gövdesi. */
export function cardWireToFactory(w: CardWire): Record<string, unknown> {
  const { roller, ...rest } = w;
  return { ...mapKeys(rest, CARD_WIRE_MAP), ...mapKeys(roller, CARD_ROLE_WIRE_MAP) };
}

// ── Bulut yanıtları (GEVŞEK: bilinmeyen alan düşer, beklenen alan zorunlu) ─────────────────────────
export const InboxMessageSchema = z.object({
  mesajId: Uuid,
  tur: z.enum(INBOX_KINDS),
  govde: z.unknown(),
  hesapId: Uuid,
  hesapAdi: z.string().trim().min(1).max(200),
  olusturma: z.iso.datetime({ offset: true }),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

export const InboxPullResponseSchema = z.object({
  v: z.literal(INBOX_WIRE_VERSION),
  kayitlar: z.array(InboxMessageSchema).max(INBOX_PULL_MAX * 5),
});

export const InboxOutcomeSchema = z.object({
  mesajId: Uuid,
  durum: z.enum(["ISLENDI", "REDDEDILDI"]),
  varlikId: Uuid.nullable(),
  belgeNo: z.string().nullable(),
  kod: z.string().nullable(),
  mesaj: z.string().nullable(),
});
export type InboxOutcome = z.infer<typeof InboxOutcomeSchema>;

export const CloudAccountSchema = z.object({
  id: Uuid,
  ad: z.string().max(200),
  eposta: z.string().max(200).nullable().optional(),
  durum: z.enum(["AKTIF", "KILITLI", "PASIF"]),
  sonGiris: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type CloudAccount = z.infer<typeof CloudAccountSchema>;

export const CloudAccountsResponseSchema = z.object({
  v: z.literal(INBOX_WIRE_VERSION),
  hesaplar: z.array(CloudAccountSchema).max(1000),
});

/** Kanonik JSON (anahtarlar sıralı) — aynı içerik farklı anahtar sırasıyla gelse de aynı özet. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Mesajın kimlik özeti (tür + gövde) — makbuzdaki `payloadDigest`; aynı mesajId başka gövdeyle = çakışma. */
export function inboxPayloadDigest(kind: InboxKind, body: unknown): string {
  return createHash("sha256").update(canonical({ tur: kind, govde: body })).digest("hex");
}
