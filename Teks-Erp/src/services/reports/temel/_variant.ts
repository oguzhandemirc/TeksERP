// =============================================================================
// Temel raporlar — VARYANT (küçük çoklular) + ÇOK DÖNEMLİ KIYAS sarmalı (R1-VARYANT; plan §3.2, §4.4)
// =============================================================================
// Sarmal SAYI ÜRETMEZ: her hücre/dönem, aynı temel servisin SÜZGEÇLİ ya da DÖNEMİ DARALTILMIŞ koşusudur
// (bekçi `test_temel_rapor_esitlik` §V). Alt koşular SIRALIDIR (`Promise.all` yok; havuz bağlantısı
// ve rapor eşzamanlılık sınırı tek isteğe kilitlenmesin). Tavanlar: varyant ≤ 6 değer, dönem ≤ 12.

import { z } from "zod";
import { factoryDayEndOfKey, factoryDayStartOfKey, factoryYmd } from "../../../constants/time";
import type { ReportVaryantBoyutu } from "../../../constants/report-catalog";
import { donemEtiketi } from "../sunum/sunum-kur";
import type { AnaSayi, DonemBlok, ParametreBeyani, ParametreSecenegi, RaporSunumu, VaryantHucresi } from "../sunum/sunum.types";
import type { DateRange } from "../_shared";
import type { CoreReportResult } from "./_common";

export const VARIANT_LIMIT = 6;
export const PERIOD_LIMIT = 12;
/** Sırası hesaplanmamış havuzda (ör. vardiya listesi) en çok bu kadar alt koşu yapılır, sonra büyükten küçüğe kesilir. */
export const VARIANT_POOL_LIMIT = 12;

/** Kişi adı taşıyan boyutlar — hücre adı bir insandır; sunum `kisiAdi:true` olur ve buluta gitmez (K-KISI). */
export const PERSON_DIMENSIONS: readonly ReportVaryantBoyutu[] = ["operator"];

const DIMENSION_LABELS: Readonly<Record<ReportVaryantBoyutu, string>> = {
  musteri: "Müşteriye göre", urun: "Kumaşa göre", renk: "Renge göre", yon: "Yöne göre", istasyon: "İstasyona göre",
  operator: "Operatöre göre", vardiya: "Vardiyaya göre", tezgah: "Tezgâha göre", levent: "Levente göre",
  cozguKarti: "Çözgü kartına göre", fasoncu: "Fasoncuya göre", kaynak: "Kaynağa göre", sebep: "Sebebe göre",
  depo: "Depoya göre", cari: "Cariye göre", paraBirimi: "Para birimine göre", makine: "Makineye göre",
};

/** Bir temel ucun desteklediği varyant boyutu: hangi süzgeç anahtarıyla süzülür, aday değerler nereden gelir. */
export interface VariantDimension {
  boyut: ReportVaryantBoyutu;
  /** Hücreye tıklanınca panelin yazacağı sorgu anahtarı (ucun kendi süzgeci). */
  suzgec: string;
  /**
   * Aday değerler. `ranked:true` → ana koşunun kırılımından büyükten küçüğe (ilk N alınır);
   * `false` → sırasız küçük küme (≤ havuz tavanı), alt koşu sonucuyla sıralanır.
   */
  pool: (main: CoreReportResult) => Promise<{ ranked: boolean; values: ParametreSecenegi[] }>;
}

/** Ana koşunun kırılımından sıralı havuz (`CoreReportResult.kirilimlar`). */
export function rankedDimension(boyut: ReportVaryantBoyutu, suzgec: string): VariantDimension {
  return { boyut, suzgec, pool: async (main) => ({ ranked: true, values: main.kirilimlar?.[boyut] ?? [] }) };
}

/** Sırasız küçük küme: ucun kendi çip seçenekleri (ör. vardiya tanımları); alt koşu sonucuyla sıralanır. */
export function declaredOptionsDimension(boyut: ReportVaryantBoyutu, suzgec: string): VariantDimension {
  return { boyut, suzgec, pool: async (main) => ({ ranked: false, values: main.sunum.parametreler.find((p) => p.ad === suzgec)?.secenekler ?? [] }) };
}

/** Yön: iki sabit değer (enum) — havuz veri istemez. */
export const DESTINATION_DIMENSION: VariantDimension = {
  boyut: "yon",
  suzgec: "destination",
  pool: async () => ({ ranked: false, values: [{ deger: "DOMESTIC", etiket: "Yurtiçi" }, { deger: "EXPORT", etiket: "Yurtdışı" }] }),
};

export const periodSpecSchema = z
  .string()
  .regex(/^(ay|hafta|gun):\d{1,2}$/, "Dönem kıyası 'ay:6', 'hafta:8' ya da 'gun:7' biçiminde olmalı")
  .transform((s) => {
    const [birim, adet] = s.split(":");
    return { birim: birim as PeriodUnit, adet: Number(adet) };
  })
  .refine((p) => p.adet >= 2 && p.adet <= PERIOD_LIMIT, `Dönem sayısı 2 ile ${PERIOD_LIMIT} arasında olmalı`);
export type PeriodUnit = "ay" | "hafta" | "gun";
export type PeriodSpec = z.output<typeof periodSpecSchema>;

/** Uç şemasına eklenecek iki anahtar: `varyant` yalnız ucun BEYANLI boyutlarından (dışı ve boyutsuz uçta her değer 400), `donemler`. */
export function variantQueryKeys(dims: readonly VariantDimension[]) {
  const ids = dims.map((d) => d.boyut);
  const varyant: z.ZodType<ReportVaryantBoyutu> =
    ids.length > 0
      ? z.enum(ids as [ReportVaryantBoyutu, ...ReportVaryantBoyutu[]], { message: "Bu raporda olmayan kırılım" })
      : z.never({ message: "Bu raporda kırılım yok" });
  return { varyant: varyant.optional(), donemler: periodSpecSchema.optional() };
}

const PERIOD_OPTIONS: ParametreSecenegi[] = [
  { deger: "ay:3", etiket: "Son 3 ay" },
  { deger: "ay:6", etiket: "Son 6 ay" },
  { deger: "ay:12", etiket: "Son 12 ay" },
  { deger: "hafta:4", etiket: "Son 4 hafta" },
  { deger: "hafta:8", etiket: "Son 8 hafta" },
  { deger: "gun:7", etiket: "Son 7 gün" },
];

const specText = (p: PeriodSpec | undefined): string | null => (p ? `${p.birim}:${p.adet}` : null);

/** Panelin çip kaynağı: kırılım (yalnız desteklenen boyutlar) + dönem kıyası beyanı. İstemci varsayılan yazmaz. */
export function variantParameters(dims: readonly VariantDimension[], selected: string | undefined, periods: PeriodSpec | undefined): ParametreBeyani[] {
  const out: ParametreBeyani[] = [];
  if (dims.length > 0) {
    out.push({ ad: "varyant", etiket: "Kırılım", tur: "secim", deger: selected ?? null, secenekler: dims.map((d) => ({ deger: d.boyut, etiket: DIMENSION_LABELS[d.boyut] })) });
  }
  out.push({ ad: "donemler", etiket: "Dönem kıyası", tur: "secim", deger: specText(periods), secenekler: PERIOD_OPTIONS });
  return out;
}

// ── Dönem dizisi (fabrika takvim günüyle; saf takvim aritmetiği — dilim yok, günler zaten fabrika günü) ──

const ymdOf = (t: number): string => new Date(t).toISOString().slice(0, 10);
const utcOf = (ymd: string): number => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const DAY = 86_400_000;

/** Ana aralığın SON gününde biten `adet` takvim dönemi (ay = takvim ayı, hafta = Pazartesi başlar). Son dönem `end` anında biter. */
export function periodRanges(end: Date, spec: PeriodSpec): DateRange[] {
  const endYmd = factoryYmd(end);
  const endUtc = utcOf(endYmd);
  const windows: Array<{ from: string; to: string }> = [];
  for (let i = spec.adet - 1; i >= 0; i--) {
    if (spec.birim === "gun") {
      const d = ymdOf(endUtc - i * DAY);
      windows.push({ from: d, to: d });
    } else if (spec.birim === "hafta") {
      const weekday = new Date(endUtc).getUTCDay();
      const monday = endUtc - ((weekday + 6) % 7) * DAY - i * 7 * DAY;
      windows.push({ from: ymdOf(monday), to: ymdOf(monday + 6 * DAY) });
    } else {
      const base = new Date(endUtc);
      const first = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1);
      const last = Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i + 1, 0);
      windows.push({ from: ymdOf(first), to: ymdOf(last) });
    }
  }
  return windows.map((w, idx) => ({
    from: factoryDayStartOfKey(w.from),
    to: idx === windows.length - 1 ? end : factoryDayEndOfKey(w.to),
  }));
}

/** Ana koşuyu `range`/`compareRange` ile, varyant hücresini `cell` süzgeciyle koşan kapanış (ucun kendi servisi). */
export type CoreRunner = (range: DateRange, compareRange: DateRange | null, cell: { boyut: ReportVaryantBoyutu; deger: string } | null) => Promise<CoreReportResult>;

export interface ExtrasInput {
  range: DateRange;
  compareRange: DateRange | null;
  run: CoreRunner;
  dims: readonly VariantDimension[];
  varyant?: ReportVaryantBoyutu;
  donemler?: PeriodSpec;
  /** Kesit raporu (stok/açık sipariş): geçmiş kesit görüntüsü yokken dönem değerleri ölçülemez (sayı UYDURULMAZ). */
  snapshotOnly?: boolean;
}

const SNAPSHOT_WARNING = "Geçmiş için aylık kesit görüntüsü gerekiyor; bu rapor yalnız bugünün kesitini ölçer.";

function unmeasured(a: AnaSayi): AnaSayi {
  return { ...a, deger: null, olculemedi: "Geçmiş kesit görüntüsü yok", kiyas: undefined };
}

async function variantCells(main: CoreReportResult, input: ExtrasInput, dim: VariantDimension, warnings: string[]): Promise<VaryantHucresi[]> {
  const pool = await dim.pool(main);
  const candidates = pool.values.slice(0, pool.ranked ? VARIANT_LIMIT : VARIANT_POOL_LIMIT);
  if (!pool.ranked && pool.values.length > VARIANT_POOL_LIMIT) warnings.push(`Kırılım ilk ${VARIANT_POOL_LIMIT} değer arasından seçildi (${pool.values.length} değer var).`);
  const cells: VaryantHucresi[] = [];
  for (const c of candidates) {
    const sub = await input.run(input.range, input.compareRange, { boyut: dim.boyut, deger: c.deger });
    cells.push({ deger: c.deger, ad: c.etiket, anaSayi: sub.sunum.anaSayi });
  }
  if (pool.ranked) return cells;
  return cells.sort((a, b) => (b.anaSayi.deger ?? -Infinity) - (a.anaSayi.deger ?? -Infinity)).slice(0, VARIANT_LIMIT);
}

async function periodBlocks(main: RaporSunumu, input: ExtrasInput, spec: PeriodSpec): Promise<DonemBlok[]> {
  const ranges = periodRanges(input.range.to, spec);
  const out: DonemBlok[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    const head = { from: r.from.toISOString(), to: r.to.toISOString(), etiket: donemEtiketi(r) };
    if (input.snapshotOnly) {
      out.push({ ...head, anaSayi: unmeasured(main.anaSayi) });
      continue;
    }
    // Yalnız son dönem bir öncekiyle kıyaslanır (tablo "son dönem ne oldu?" sorusunu cevaplar).
    const sub = await input.run(r, i === ranges.length - 1 && i > 0 ? ranges[i - 1]! : null, null);
    out.push({ ...head, anaSayi: sub.sunum.anaSayi });
  }
  return out;
}

/**
 * Ana koşu + istenirse varyant hücreleri + dönem sütunları. Parametre beyanı her durumda eklenir
 * (çip sunucu beyanından çizilir). Kişi adı taşıyan boyut seçilirse sunum `kisiAdi:true` olur.
 */
export async function runCoreWithExtras(input: ExtrasInput): Promise<CoreReportResult> {
  const main = await input.run(input.range, input.compareRange, null);
  const sunum: RaporSunumu = { ...main.sunum, parametreler: [...main.sunum.parametreler, ...variantParameters(input.dims, input.varyant, input.donemler)], uyarilar: [...main.sunum.uyarilar] };
  if (input.varyant) {
    const dim = input.dims.find((d) => d.boyut === input.varyant);
    // Şema zaten kapalı kümeden süzer; buraya ulaşan bilinmeyen boyut programlama hatasıdır (fail-closed).
    if (!dim) throw new Error(`Varyant boyutu ucun beyanında yok: ${input.varyant}`);
    const hucreler = await variantCells(main, input, dim, sunum.uyarilar);
    sunum.varyant = { boyut: dim.boyut, boyutEtiketi: DIMENSION_LABELS[dim.boyut], secili: null, digerleri: hucreler.map((h) => ({ deger: h.deger, etiket: h.ad })), suzgecAnahtari: dim.suzgec, hucreler };
    if (PERSON_DIMENSIONS.includes(dim.boyut)) sunum.kisiAdi = true;
  }
  if (input.donemler) {
    sunum.donemler = await periodBlocks(main.sunum, input, input.donemler);
    if (input.snapshotOnly) sunum.uyarilar.push(SNAPSHOT_WARNING);
  }
  return { ...main, sunum };
}
