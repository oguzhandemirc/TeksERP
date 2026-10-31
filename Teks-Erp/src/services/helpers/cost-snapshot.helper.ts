// =============================================================================
// MALİYET GİRDİ FOTOĞRAFI — katı şema + kanonik hash (MAL-2; plan §3.2)
// =============================================================================
// Standart maliyet sürümü motorun TÜM girdisini `inputSnapshot`ta dondurur: "geri alma" eski
// fotoğraftan YENİ sürüm hesaplar, canlı kartı okumaz. Fotoğraf zod'dan geçmeden yazılmaz ve
// okunmaz (`schemaVersion: 1`). `inputHash` = anahtar sıralı JSON'un sha256'sı; bayatlık rozeti
// (`girdiDegisti`) bunu canlı girdinin hash'iyle kıyaslar. Kur ve türetilmiş uyarı bayrağı
// (`flag`, ör. PRICE_STALE zamanla kendiliğinden doğar) hash'e GİRMEZ — kur ayrı kolondur.
// =============================================================================
import { createHash } from "node:crypto";
import { Prisma, type Currency } from "@prisma/client";
import { z } from "zod";
import { COST_WARNING_CODES, type CostInput, type FxRates } from "./fabric-cost.helper";

const dec = z.string().regex(/^-?\d+(\.\d+)?$/, "Decimal metin bekleniyor");
const sourceEnum = z.enum(["KART", "YAPI", "PARAMETRE", "OLCULMUS", "ELLE"]);
const currencyEnum = z.enum(["TRY", "USD", "EUR", "GBP", "RUB"]);
const sourced = z.object({ value: dec.nullable(), source: sourceEnum, flag: z.enum(COST_WARNING_CODES).optional() }).strict();
const price = z.object({ amount: dec, currency: currencyEnum, source: sourceEnum, flag: z.enum(COST_WARNING_CODES).optional() }).strict();
const yarn = z.object({ yarnItemId: z.string().nullable(), name: z.string(), denier: sourced, price: price.nullable() }).strict();

const rate = z.object({ code: z.string(), name: z.string(), basis: z.enum(["RAW_M", "FINISHED_M"]), price: price.nullable() }).strict();

export const costInputSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    parameterSetId: z.string().nullable(),
    warp: z.object({ warpSpecId: z.string().nullable(), endsCount: z.number().int(), takeUpPct: sourced, wastePct: sourced, yarn }).strict().nullable(),
    weft: z
      .object({
        weftSpecId: z.string().nullable(),
        picksPerCm: sourced,
        lengthCm: sourced,
        wastePct: sourced,
        yarns: z.array(yarn.extend({ picksInRepeat: z.number().int() }).strict()),
      })
      .strict()
      .nullable(),
    loom: z
      .object({
        rpm: sourced, efficiencyPct: sourced, machineRateTry: sourced, laborRateTry: sourced,
        loomsPerOperator: sourced, energyKwhPerHour: sourced, energyPriceTry: sourced,
      })
      .strict(),
    beam: z.object({ prepCostTry: sourced, lengthM: sourced }).strict(),
    finishing: rate.nullable(),
    processes: z.array(rate).min(1).optional(),
    lengthShrinkPct: sourced,
    fabricWastePct: sourced,
    overheadPct: sourced,
    extra: z.object({ amountTry: dec, label: z.string().nullable() }).strict().nullable(),
  })
  .strict();
export type CostInputSnapshot = z.infer<typeof costInputSnapshotSchema>;

/** Kur fotoğrafı (plan §3.2 `fxRates`): hangi gün, hangi kaynak, hangi kurlar. */
export const fxRatesSnapshotSchema = z
  .object({
    tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kaynak: z.enum(["ELLE", "FINANS", "YOK"]),
    kurlar: z.object({ USD: dec.optional(), EUR: dec.optional(), GBP: dec.optional(), RUB: dec.optional() }).strict(),
  })
  .strict();
export type FxRatesSnapshot = z.infer<typeof fxRatesSnapshotSchema>;

/** Decimal → kanonik metin (DB'den gelen 6.00 ile elle girilen 6 aynı hash'i versin). */
function toJsonValue(v: unknown): unknown {
  if (v instanceof Prisma.Decimal) return v.toString();
  if (Array.isArray(v)) return v.map(toJsonValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = toJsonValue(x);
    return out;
  }
  return v;
}

/** Motor girdisi → katı şemadan geçmiş JSON (yazımdan önce DOĞRULANIR). */
export function serializeCostInput(input: CostInput): CostInputSnapshot {
  return costInputSnapshotSchema.parse(toJsonValue(input));
}

const DEC_KEYS = new Set(["value", "amount", "amountTry"]);
function toInputValue(v: unknown, key = ""): unknown {
  if (typeof v === "string" && DEC_KEYS.has(key)) return new Prisma.Decimal(v);
  if (Array.isArray(v)) return v.map((x) => toInputValue(x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toInputValue(x, k)]));
  return v;
}

/** Fotoğraf → motor girdisi; şemaya uymayan fotoğraf hata (sessiz kısmi geri alma yok). */
export function parseCostInputSnapshot(json: unknown): CostInput {
  return toInputValue(costInputSnapshotSchema.parse(json)) as CostInput;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => k !== "flag" && (v as Record<string, unknown>)[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Kanonik (anahtar sıralı, bayraksız) girdi JSON'unun sha256'sı — 64 hex. */
export function costInputHash(input: CostInput | CostInputSnapshot): string {
  return createHash("sha256").update(canonical(toJsonValue(input))).digest("hex");
}

export function fxSnapshotToRates(s: FxRatesSnapshot): FxRates {
  const out: FxRates = {};
  for (const [k, v] of Object.entries(s.kurlar)) if (v) out[k as Currency] = new Prisma.Decimal(v);
  return out;
}
