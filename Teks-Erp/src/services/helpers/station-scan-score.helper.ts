// =============================================================================
// İSTASYONDA BELGE OKUT — DOĞRULAMA PUANI (saf; Gülkesim 2026-11-06, kullanıcı onaylı karar)
// =============================================================================
// Anahtar (fiş no, yoksa parti no) aday İE'yi bulur; AYNI fotoğrafın öteki alanları adayın kayıtlarıyla karşılaştırılır.
// Puan = Σ ağırlık·oran / Σ ağırlık — yalnız İKİ tarafta da kanıtı olan bileşen paydaya girer. Top listesi (top no ya
// da top metresi) karşılaştırılamadıysa doğrulama ZAYIF sayılır ve eşik geçilemez (görevli onayı — bilinçli güvenli taraf).
// Tek parça (2026-11-10): iki taraf da top listesizse (kayıt yalnız ARABA, okuma top dökümsüz) top listesi uygulanamaz;
// güçlü kanıt TOPLAM METRE olur (aynı tolerans). Top'lu belgede bileşen hiç doğmaz — puan/eşik davranışı aynıdır.
// "Otomatik açılabilir mi" sorusunun TEK cevabı `isScanVerified`; tablet yalnız sunucunun `passed` alanını okur.
// =============================================================================
import { codeMatchTier, tolerantCodeKey } from "./doc-code-match.helper";
import { foldNameForCompare } from "./name-normalize.helper";

export type VerifyComponentKey = "ROLL_NOS" | "ROLL_METERS" | "ROLL_COUNT" | "TOTAL_METERS" | "BATCH_NO" | "ORDER_NO" | "OWNER" | "SENDER" | "DOC_DATE";

/** Ağırlıklar (kullanıcı kararı): top no çok yüksek · top metresi yüksek · parti/sipariş no + top sayısı orta · müşteri/gönderen/tarih düşük. */
export const VERIFY_WEIGHTS: Readonly<Record<VerifyComponentKey, number>> = {
  ROLL_NOS: 40, ROLL_METERS: 25, ROLL_COUNT: 10, TOTAL_METERS: 25, BATCH_NO: 10, ORDER_NO: 10, OWNER: 5, SENDER: 5, DOC_DATE: 5,
};

const LABELS: Readonly<Record<VerifyComponentKey, string>> = {
  ROLL_NOS: "Top no", ROLL_METERS: "Top metresi", ROLL_COUNT: "Top sayısı", TOTAL_METERS: "Toplam metre", BATCH_NO: "Parti no", ORDER_NO: "Müşteri İE / sipariş no",
  OWNER: "Müşteri", SENDER: "Gönderen", DOC_DATE: "Belge tarihi",
};

/** Fotoğraftan okunanlar (anahtar alan hariç değil — hariç tutma `exclude` ile). */
export interface ScanEvidence {
  rollNos: string[];
  meters: number[];
  rollCount: number | null;
  batchNos: string[];
  orderNo: string | null;
  ownerText: string | null;
  senderText: string | null;
  /** YYYY-AA-GG (belgenin yazdığı takvim günü; dilim dönüşümü yok). */
  docDay: string | null;
  /** Okumada top dökümü yok (top no'suz, en çok tek başlık satırı) — tek parça belge adayı. */
  singlePiece?: boolean;
  /** Belgenin okunan toplam (kurşun) metresi. */
  totalMeters?: number | null;
}

/** Adayın kayıtları: İE'ye top vermiş belgelerin TÜM satırları + başlıkları + İE parti no'ları. */
export interface TargetRecord {
  rollNos: string[];
  meters: number[];
  batchNos: string[];
  orderNos: string[];
  ownerNames: string[];
  senderNames: string[];
  docDays: string[];
  /** Kayıtlı satırların HEPSİ ARABA (`isSinglePieceLines`) — tek parça geldi. */
  singlePiece?: boolean;
  /** ARABA satırlarının metre toplamı. */
  pieceMeters?: number | null;
}

export interface VerifyComponent {
  key: VerifyComponentKey;
  label: string;
  weight: number;
  /** 0–1 */
  ratio: number;
  matched: boolean;
  /** "3/16" gibi kısa ayrıntı. */
  detail: string;
}

export interface ScanScore {
  /** 0–100; karşılaştırılabilen bileşen yoksa null. */
  score: number | null;
  /** Top listesi (top no ya da metre; tek parçada toplam metre) karşılaştırıldı mı — değilse eşik geçilemez. */
  strongEvidence: boolean;
  components: VerifyComponent[];
}

/** Metre eşleşme toleransı: 0,5 m ya da %1 (büyüğü) — okuma yuvarlaması ile yazım farkı. */
const METER_ABS_TOL = 0.5;
const METER_REL_TOL = 0.01;

const rollKey = (v: string): string => tolerantCodeKey(v).replace(/^0+(?=.)/, "");

function comp(key: VerifyComponentKey, ratio: number, detail: string): VerifyComponent {
  return { key, label: LABELS[key], weight: VERIFY_WEIGHTS[key], ratio, matched: ratio >= 0.999, detail };
}

/** Top no: iki listenin ortak elemanı / büyük listenin boyu (eksik ya da fazla top da puan düşürür). */
function rollNosComponent(read: string[], stored: string[]): VerifyComponent | null {
  const a = new Set(read.map(rollKey).filter(Boolean));
  const b = new Set(stored.map(rollKey).filter(Boolean));
  if (a.size === 0 || b.size === 0) return null;
  const common = [...a].filter((k) => b.has(k)).length;
  const of = Math.max(a.size, b.size);
  return comp("ROLL_NOS", common / of, `${common}/${of}`);
}

/** Top metresi: toleranslı çoklu-küme eşleşmesi (her kayıtlı metre bir kez kullanılır) / büyük listenin boyu. */
function metersComponent(read: number[], stored: number[]): VerifyComponent | null {
  const a = read.filter((m) => m > 0);
  const pool = stored.filter((m) => m > 0);
  if (a.length === 0 || pool.length === 0) return null;
  let hit = 0;
  for (const m of a) {
    const i = pool.findIndex((s) => meterNear(m, s));
    if (i >= 0) { hit++; pool.splice(i, 1); }
  }
  const of = Math.max(a.length, stored.filter((m) => m > 0).length);
  return comp("ROLL_METERS", hit / of, `${hit}/${of}`);
}

const meterNear = (m: number, s: number): boolean => Math.abs(s - m) <= Math.max(METER_ABS_TOL, METER_REL_TOL * s);

/** Tek parça: yalnız İKİ taraf da top listesizken; okunan toplam metre ↔ ARABA metresi (top metresiyle aynı tolerans). */
function totalMetersComponent(ev: ScanEvidence, t: TargetRecord): VerifyComponent | null {
  const read = ev.totalMeters ?? 0;
  const stored = t.pieceMeters ?? 0;
  if (!ev.singlePiece || !t.singlePiece || !(read > 0) || !(stored > 0)) return null;
  const ok = meterNear(read, stored);
  return comp("TOTAL_METERS", ok ? 1 : 0, ok ? `${stored} m` : `okunan ${read} · kayıt ${stored}`);
}

/** Kod alanı (parti / sipariş no): tam 1 · OCR-toleranslı 0,75 · yok 0. */
function codeComponent(key: "BATCH_NO" | "ORDER_NO", read: string[], stored: string[]): VerifyComponent | null {
  const r = read.filter((v) => v.trim());
  const s = stored.filter((v) => v.trim());
  if (r.length === 0 || s.length === 0) return null;
  let best = 0;
  for (const x of r) for (const y of s) {
    const t = codeMatchTier(x, y);
    best = Math.max(best, t === "EXACT" ? 1 : t === "TOLERANT" ? 0.75 : 0);
  }
  return comp(key, best, best === 1 ? "tuttu" : best > 0 ? "benzer" : `okunan ${r[0]}`);
}

/** Ad alanı (müşteri / gönderen): katlanmış ad eşit ya da biri ötekini içeriyorsa tuttu. */
function nameComponent(key: "OWNER" | "SENDER", read: string | null, stored: string[]): VerifyComponent | null {
  const r = read ? foldNameForCompare(read) : "";
  const s = stored.map((n) => foldNameForCompare(n)).filter((n) => n.length >= 3);
  if (r.length < 3 || s.length === 0) return null;
  const ok = s.some((n) => n === r || n.includes(r) || r.includes(n));
  return comp(key, ok ? 1 : 0, ok ? "tuttu" : `okunan ${read}`);
}

function scalarComponent(key: "ROLL_COUNT" | "DOC_DATE", read: string | null, stored: string[]): VerifyComponent | null {
  if (!read || stored.length === 0) return null;
  const ok = stored.includes(read);
  return comp(key, ok ? 1 : 0, ok ? read : `okunan ${read} · kayıt ${[...new Set(stored)].join(", ")}`);
}

/**
 * Fotoğraf ↔ aday puanı. `exclude`: adayı BULDURAN anahtar alan (parti no ile bulunduysa parti no kendini doğrulamaz).
 */
export function scoreScan(ev: ScanEvidence, t: TargetRecord, exclude: readonly VerifyComponentKey[] = []): ScanScore {
  const candidates = [
    rollNosComponent(ev.rollNos, t.rollNos),
    metersComponent(ev.meters, t.meters),
    scalarComponent("ROLL_COUNT", ev.rollCount !== null && ev.rollCount > 0 ? String(ev.rollCount) : null, t.meters.length > 0 ? [String(t.meters.length)] : []),
    totalMetersComponent(ev, t),
    codeComponent("BATCH_NO", ev.batchNos, t.batchNos),
    codeComponent("ORDER_NO", ev.orderNo ? [ev.orderNo] : [], t.orderNos),
    nameComponent("OWNER", ev.ownerText, t.ownerNames),
    nameComponent("SENDER", ev.senderText, t.senderNames),
    scalarComponent("DOC_DATE", ev.docDay, t.docDays),
  ];
  const components = candidates.filter((c): c is VerifyComponent => c !== null && !exclude.includes(c.key));
  const total = components.reduce((s, c) => s + c.weight, 0);
  const score = total > 0 ? Math.round((100 * components.reduce((s, c) => s + c.weight * c.ratio, 0)) / total) : null;
  const strongEvidence = components.some((c) => c.key === "ROLL_NOS" || c.key === "ROLL_METERS" || c.key === "TOTAL_METERS");
  return { score, strongEvidence, components };
}

/** Eşik 0 = doğrulama kapalı (bugünkü davranış). Aksi: puan var ∧ top listesi (tek parçada toplam metre) kanıtı var ∧ puan ≥ eşik. */
export function isScanVerified(s: Pick<ScanScore, "score" | "strongEvidence">, threshold: number): boolean {
  if (threshold <= 0) return true;
  return s.score !== null && s.strongEvidence && s.score >= threshold;
}

/** İE satırına eklenen doğrulama (tablet "ne tuttu / ne tutmadı" çizer); `targetKey` aynı belge kümesini gruplar. */
export interface WorkOrderVerification {
  score: number | null;
  passed: boolean;
  strongEvidence: boolean;
  threshold: number;
  components: VerifyComponent[];
  /** Karşılaştırılan belge kümesi (aynı belgenin partileri aynı anahtarı taşır; farklı anahtar = farklı aday belge). */
  targetKey: string;
}
