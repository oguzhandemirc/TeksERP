// KURŞUN METRESİ — belgedeki metre adaylarından tek değer (Gülkesim, 2026-11-02; saf, DB yok). Öncelik SABİTTİR, ayar
// değildir: ÇIKIŞ → TOPLAM → Σ satır; giriş yalnız bilgi. Taslak doldurma, detay ve okuma özeti AYNI fonksiyondan türetir.
import { sumCanonical, TABLE_TOTAL_SOURCE, type DocumentTemplate } from "./motor";
import { positive } from "./taslak-belge-beyan";

export type KursunMetersSource = "OUTPUT" | "TOTAL" | "LINE_SUM" | "MANUAL";
/** Çıkış/toplam ile Σ satır arasındaki hoşgörü — onay toplam kapısıyla aynı oran (%0,5, `TOTAL_TOLERANCE`). */
export const KURSUN_REVIEW_TOLERANCE = 0.005;

export interface KursunMeterCandidates {
  output: string | null;
  total: string | null;
  input: string | null;
  lineSum: string | null;
}

export interface KursunMeterResult {
  meters: string | null;
  source: Exclude<KursunMetersSource, "MANUAL"> | null;
  /** El yazısı (ızgaralı) şablon ya da çıkış/toplam Σ satırla çelişiyor → panelde doğrulanır. */
  review: boolean;
  candidates: KursunMeterCandidates;
}

export interface KursunMeterInput {
  template: DocumentTemplate | undefined;
  fields: Record<string, string | null | undefined>;
  /** `CustomerDeliveryNote.totalsDeclared` (bloklar `m` beyanı `$tableTotal` kaynağıdır). */
  totalsDeclared: unknown;
  /** Canlı satır metreleri (SKIPPED/INFO hariç tutmak çağıranın işi). */
  lineMeters: ReadonlyArray<string | number | { toString(): string }>;
}

function tableTotal(totalsDeclared: unknown): string | null {
  const blocks = (totalsDeclared as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(blocks)) return null;
  const ms = blocks.map((b) => positive((b as { m?: string | null } | null)?.m ?? null)).filter((m): m is string => m !== null);
  return ms.length ? positive(sumCanonical(ms)) : null;
}

function roleValue(keys: readonly string[] | undefined, input: KursunMeterInput): string | null {
  for (const k of keys ?? []) {
    const v = k === TABLE_TOTAL_SOURCE ? tableTotal(input.totalsDeclared) : positive(input.fields[k] ?? null);
    if (v) return v;
  }
  return null;
}

const near = (a: string, b: string) => Math.abs(Number(a) - Number(b)) <= Math.max(0.001, Math.abs(Number(b)) * KURSUN_REVIEW_TOLERANCE);

/** Adaylar + seçilen değer. Hiçbir kaynak yoksa `meters` null (kaynak da null). */
export function resolveKursunMeters(input: KursunMeterInput): KursunMeterResult {
  const src = input.template?.meterSources;
  const lineSum = positive(sumCanonical(input.lineMeters.map((m) => String(m))));
  const candidates: KursunMeterCandidates = { output: roleValue(src?.output, input), total: roleValue(src?.total, input), input: roleValue(src?.input, input), lineSum };
  return pickKursunMeters(candidates, !!input.template?.grid);
}

/** Öncelik TEK yerde (belge ve parti aynı kuralla): ÇIKIŞ → TOPLAM → Σ satır; `handwritten` (ızgara) her zaman doğrulatır. */
export function pickKursunMeters(candidates: KursunMeterCandidates, handwritten = false): KursunMeterResult {
  const pick: Array<[KursunMeterResult["source"], string | null]> = [["OUTPUT", candidates.output], ["TOTAL", candidates.total], ["LINE_SUM", candidates.lineSum]];
  const hit = pick.find(([, v]) => v !== null);
  if (!hit) return { meters: null, source: null, review: false, candidates };
  const [source, meters] = hit as [KursunMeterResult["source"], string];
  return { meters, source, review: handwritten || contradictsLineSum({ meters, source, candidates }), candidates };
}

/**
 * Çok partili belgede PARTİNİN metresi (Gülkesim 214279, 2026-11-06): bölümün beyan ara toplamı ("T.Adet 5 141,70 586,00")
 * TOPLAM adayıdır, satırlar Σ satır — OCR satır kaçırsa da beyan kazanır (belge düzeyindeki kuralın aynısı).
 */
export function resolvePartyMeters(declaredMeters: string | number | null, lineMeters: ReadonlyArray<string | number | { toString(): string }>): KursunMeterResult {
  const total = declaredMeters === null ? null : positive(String(declaredMeters));
  const lineSum = positive(sumCanonical(lineMeters.map((m) => String(m))));
  return pickKursunMeters({ output: null, total, input: null, lineSum });
}

/** Çıkış/toplam metresi Σ satırla hoşgörü dışında çelişiyor mu — `review`in el yazısından bağımsız bileşeni (K30-B TRUSTED korur). */
export function contradictsLineSum(r: Pick<KursunMeterResult, "meters" | "source" | "candidates">): boolean {
  const lineSum = r.candidates.lineSum;
  return r.meters !== null && r.source !== null && r.source !== "LINE_SUM" && lineSum !== null && !near(r.meters, lineSum);
}
