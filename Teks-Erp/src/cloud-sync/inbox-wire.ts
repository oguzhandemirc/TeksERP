// Patron bulutu GELEN KUTUSU — fabrika tarafı EŞLEME (`PATRON-BULUTU-ESITLEME.md` §8). Tel şemaları burada DEĞİL,
// ortak sözleşmededir (`./wire` → `esitleme.ts` aynası). Alan kümesi fabrikanın yaratma yolunun ALT kümesidir — tel →
// fabrika anahtar eşlemesi aşağıda TEK yerdedir ve hedefleri yazılabilir kümelerin içinde kalır (bekçi
// `test_bulut_gelen_kutusu` §1). İş kuralları burada DEĞİL, fabrikanın servisinde koşar.
import { createHash } from "node:crypto";
import { resolveRangeStart } from "../constants/time";
import type { CustomerMessage, InboxKind, OrderMessage } from "./wire";

/** Bir `al` turunda en çok çekilen kayıt (bulut claim'i `claimBitis = now()+10dk`; tavan `INBOX_CLAIM_MAX`). */
export const INBOX_PULL_MAX = 20;

/** Tel → fabrika anahtarı (sipariş başlığı). Hedefler `ORDER_HEADER_WRITABLE` içinde olmalı. */
export const ORDER_HEADER_WIRE_MAP = {
  cariKartId: "customerId",
  subeId: "branchId",
  termin: "deadline",
  doviz: "currency",
} as const satisfies Record<Exclude<keyof OrderMessage, "kalemler">, string>;

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
} as const satisfies Record<keyof OrderMessage["kalemler"][number], string>;

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
} as const satisfies Record<Exclude<keyof CustomerMessage, "roller">, string>;
export const CARD_ROLE_WIRE_MAP = { musteri: "isCustomerRole", tedarikci: "isSupplierRole" } as const;

function mapKeys(src: Record<string, unknown>, map: Readonly<Record<string, string>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [wire, factory] of Object.entries(map)) if (src[wire] !== undefined) out[factory] = src[wire];
  return out;
}

/** Tel ondalık DİZİsi → sayı (tel sınırı `Decimal(12,3)`/`(12,2)` hanesini aşmaz; çift duyarlıkta kayıpsız). */
const DECIMAL_WIRE_KEYS = new Set(["miktar", "birimFiyat", "en"]);

/** Sipariş tel gövdesi → fabrikanın `create` gövdesi (clientToken = mesajId). Termin takvim günü → fabrika günü başı. */
export function orderWireToFactory(w: OrderMessage, messageId: string): Record<string, unknown> {
  const { kalemler, termin, ...header } = w;
  return {
    ...mapKeys(header, ORDER_HEADER_WIRE_MAP),
    ...(termin !== undefined ? { deadline: resolveRangeStart(termin).toISOString() } : {}),
    lines: kalemler.map((k) => {
      const numeric = Object.fromEntries(Object.entries(k).map(([key, v]) => [key, DECIMAL_WIRE_KEYS.has(key) && typeof v === "string" ? Number(v) : v]));
      return mapKeys(numeric, ORDER_LINE_WIRE_MAP);
    }),
    clientToken: messageId,
  };
}

/** Cari tel gövdesi → fabrikanın kart `create` gövdesi. */
export function cardWireToFactory(w: CustomerMessage): Record<string, unknown> {
  const { roller, ...rest } = w;
  return { ...mapKeys(rest, CARD_WIRE_MAP), ...mapKeys(roller, CARD_ROLE_WIRE_MAP) };
}

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
