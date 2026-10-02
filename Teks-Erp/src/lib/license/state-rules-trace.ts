// Lisans durumunun G12 kuralları (tasarım docs/design/LISANS-V2-CEVRIMDISI-KIRA.md §3): lisans İZLERİ (kira · durum
// kaydı · DB izi), süren ölçülemedinin çalışma süresi birikimi ve parmak izi uyuşmazlık merdiveni. Her biri saf
// değerlendirici; birleştirme `state.ts`te. Birikimin kendisi (hrtime) motorun işidir, burada yalnız eşikler.
import { DAY_MS, type FingerprintRuleApplied, type MatchResult, type VerifiedLease } from "./protocol";
import type { TraceKind } from "./saat";
import {
  DEFAULT_GRACE_DAYS,
  UNMEASURED_BANNER,
  UNVERIFIED_BANNER,
  dangerBanner,
  remainingDays,
  warnBanner,
  type Finding,
  type LicenseStateInput,
  type ReasonCode,
} from "./state-rules";

/** Süren ölçülemedi ve parmak izi uyuşmazlığı bu kadar çalışma süresi UYARI'da kalır, sonra ek süre başlar. */
export const LADDER_WARNING_DAYS = 14;
export const LADDER_WARNING_MS = LADDER_WARNING_DAYS * DAY_MS;
/** Merdivenin sonu: uyarı + ek süre (14 + 30 gün çalışma süresi); sonrası iki anahtarlı KISITLI. */
export const LADDER_END_MS = (LADDER_WARNING_DAYS + DEFAULT_GRACE_DAYS) * DAY_MS;

/**
 * Lisans izlerinin hâli (motor doldurur). Verilmezse iz kuralı işlemez (eski çağıran: bugünkü davranış).
 * Kayıp ancak bir izin VAR OLMASI GEREKTİĞİ biliniyorsa sayılır: kira son kabulü kayıtta olan, DB izi kayıtta kurulmuş
 * olan kurulumda — ilk açılış, eski kayıt ve DB'si okunamayan süreç kayıp üretmez.
 */
export interface TraceInput {
  /** Lisans kimliği + HAK belgesi var (etkinleşmiş kurulum). */
  readonly etkin: boolean;
  /** Bu kuruluma ait, imzası doğrulanan durum kaydı DOSYASI var. */
  readonly durumDosyasi: boolean;
  /** DB izi: GECERLI · YOK (okundu: yok, bozuk ya da başka kuruluma ait) · BILINMIYOR (okunmadı/okunamadı). */
  readonly dbIzi: "GECERLI" | "YOK" | "BILINMIYOR";
  /** Durum kaydı DB izinin en az bir kez yazıldığını biliyor. */
  readonly dbIziKurulu: boolean;
  /** Kayıttaki kalıcı iz kaybı (son kiradan beri); yeni kira kabulüne dek düşmez. */
  readonly kayip: readonly TraceKind[];
}

export interface TraceResult {
  /** Bu değerlendirmedeki iz kaybı (kalıcı bayrak ∪ şimdi görülen). */
  readonly izKaybi: readonly TraceKind[];
  /** Kira + durum kaydı + DB izi üçü birden yok (K7): 14 günlük uyarı atlanır. */
  readonly ucIzYok: boolean;
}

/** Kiranın kayıp sayılan hâlleri: yok · imzası/şeması bozuk · bu kuruluma bağlı değil (okunamayan ve geri alınan değil). */
function leaseLost(g: LicenseStateInput, lease: VerifiedLease | null, findings: readonly Finding[]): boolean {
  if (lease !== null || g.kira.status === "OKUNAMADI") return false;
  if (findings.some((f) => f.code === "KIRA_GERI_ALINDI")) return false;
  return g.kira.status === "YOK" || g.kira.status === "GECERSIZ" || findings.some((f) => f.code === "KIRA_BAG_UYUSMAZ");
}

const TRACE_ORDER: readonly TraceKind[] = ["KIRA", "DURUM", "IZ"];

/**
 * İz kaybı (§3.1-4): kira, durum kaydı ve DB izinden biri yoksa LISANS_IZI_KAYIP (ÖLÇÜLEMEDİ, merdivene girer) — tek
 * iz kaybı da sayılır ve bayrak yeni kiraya dek kalıcıdır (dosyayı geri koymak merdiveni durdurmaz). Üçü birden yoksa
 * (K7) uyarı atlanır. Kalan izlerin çapası `timeAnchor`da geçerlidir (silmek süreyi uzatmaz).
 */
export function evaluateTraces(g: LicenseStateInput, lease: VerifiedLease | null, out: Finding[]): TraceResult {
  const t = g.izler;
  if (!t || !t.etkin) return { izKaybi: [], ucIzYok: false };
  const leaseGone = leaseLost(g, lease, out);
  // Etkin kurulumda durum kaydı kira ve HAK'tan ÖNCE yazılır: kira ya da DB kopyası varken dosyanın yokluğu kayıptır.
  const recordLost = !t.durumDosyasi && (lease !== null || leaseGone || t.dbIzi === "GECERLI");
  const ucIzYok = leaseGone && !t.durumDosyasi && t.dbIzi === "YOK";
  const seen = new Set<TraceKind>(t.kayip);
  if (leaseGone && (g.sonKira != null || recordLost)) seen.add("KIRA");
  if (recordLost) seen.add("DURUM");
  if (t.dbIzi === "YOK" && (t.dbIziKurulu || ucIzYok)) seen.add("IZ");
  const izKaybi = TRACE_ORDER.filter((k) => seen.has(k));
  if (izKaybi.length > 0) out.push({ code: "LISANS_IZI_KAYIP", detail: izKaybi.join(","), tier: "UYARI", banner: UNMEASURED_BANNER });
  return { izKaybi, ucIzYok };
}

/** Süren ölçülemedi birikimine giren bulgular (§3.1-3); parmak izi ölçülemedisi yalnız v2 kuralında (zayıf kural boş küme). */
const ACCUMULATING: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "DEPO_OKUNAMADI",
  "DURUM_DOSYASI",
  "KIRA_GERI_ALINDI",
  "SAAT_ILERI",
  "SAAT_GERI",
  "LISANS_IZI_KAYIP",
  "LISANS_IZI_CELISKI",
  "IPTAL_BELGESI_KAYIP",
]);

export function isAccumulating(findings: readonly Finding[], rule: FingerprintRuleApplied | null): boolean {
  const v2 = rule === "standart" || rule === "zayif";
  return findings.some((f) => ACCUMULATING.has(f.code) || (v2 && f.code === "PARMAK_IZI_OLCULEMEDI"));
}

export interface UncertaintyResult {
  /** Süren ölçülemedi VAR: motor birikimi bu süreçte ilerletir. */
  readonly suruyor: boolean;
  /** Geçerli birikim (K7'de en az 14 gün). */
  readonly birikenMs: number;
}

/** Merdivenin kademesi: [0, 14 g) UYARI · [14, 44 g) EK_SURE · sonrası internet yoksa KISITLI, varsa EK_SURE (0). */
function ladderFinding(code: ReasonCode, accumulatedMs: number, internetVar: boolean, text: string): Finding {
  const days = Math.floor(accumulatedMs / DAY_MS);
  if (accumulatedMs < LADDER_WARNING_MS) {
    const left = remainingDays(LADDER_WARNING_MS, accumulatedMs);
    return { code, detail: String(days), tier: "UYARI", banner: warnBanner(`${text} (${days} gündür) — ${left} gün içinde düzelmezse ek süre başlar.`) };
  }
  if (accumulatedMs < LADDER_END_MS) {
    const left = remainingDays(LADDER_END_MS, accumulatedMs);
    return { code, detail: String(days), tier: "EK_SURE", daysLeft: left, banner: warnBanner(`${text} — ${left} gün içinde düzelmezse program kısıtlı kipe geçecek.`) };
  }
  if (!internetVar) return { code, detail: String(days), tier: "KISITLI", banner: dangerBanner(`${text}: program kısıtlı kipte (okuma, rapor, yedek açık).`) };
  return { code, detail: String(days), tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${text}; lisans sunucusuyla bağlantı sürdükçe kısıtlama uygulanmaz.`) };
}

/**
 * Belirsizlik merdiveni (§3.1-3): süren ölçülemedi ÇALIŞMA SÜRESİYLE birikir; birikim yalnız yeni kira kabulünde
 * sıfırlanır, bu yüzden ölçülemedi düzelse de kademe birikimden okunur (bulgu ile birikim ayrı eksen). 14 gün dolunca
 * EK_SURE, 44 günde iki anahtarlı KISITLI. Üç iz birden yoksa (K7) birikim en az 14 gündür: EK_SURE hemen başlar.
 */
export function evaluateUncertainty(
  g: LicenseStateInput,
  x: { readonly suruyor: boolean; readonly ucIzYok: boolean; readonly internetVar: boolean },
  out: Finding[],
): UncertaintyResult {
  const etkin = g.izler ? g.izler.etkin : g.kurulumId !== null;
  const birikenMs = Math.max(0, g.belirsizlikMs ?? 0, x.ucIzYok ? LADDER_WARNING_MS : 0);
  const suruyor = etkin && x.suruyor;
  if (birikenMs >= LADDER_WARNING_MS || (suruyor && birikenMs > 0)) {
    out.push(ladderFinding("BELIRSIZLIK_SURUYOR", birikenMs, x.internetVar, "Lisans durumu ölçülemiyor"));
  }
  return { suruyor, birikenMs };
}

export interface FingerprintLadderResult {
  /** Kiranın parmak izi kuralı (`null` = ölçülmedi ya da kira yok). */
  readonly kural: FingerprintRuleApplied | null;
  /** Eşiğin altında: motor uyuşmazlık birikimini ilerletir. */
  readonly uyusmaz: boolean;
  /** Eşik tuttu: merdiven KAPANIR (birikim sıfırlanır). */
  readonly eslesti: boolean;
  readonly birikenMs: number;
}

/**
 * Parmak izi (§3.1-6). v1 kira (kural yok): eski karar — uyuşmazlık UYARI, ölçülemedi UYARI. v2 kural: eşiğin altı
 * merdivendir (14 gün UYARI → 30 gün EK_SURE → KISITLI, internet varken EK_SURE 0); eşik yeniden tutunca kapanır.
 */
export function evaluateFingerprint(
  g: LicenseStateInput,
  lease: VerifiedLease | null,
  internetVar: boolean,
  out: Finding[],
): FingerprintLadderResult {
  const kural = lease ? (g.parmakIziKurali ?? null) : null;
  const result: MatchResult = g.parmakIziEslesme;
  const v2 = kural === "standart" || kural === "zayif";
  const birikenMs = Math.max(0, g.parmakIziUyusmazMs ?? 0);
  if (!lease) return { kural: null, uyusmaz: false, eslesti: false, birikenMs };
  if (result === "OLCULEMEDI") out.push({ code: "PARMAK_IZI_OLCULEMEDI", tier: "UYARI", banner: UNMEASURED_BANNER });
  if (result !== "ESLESMEDI") return { kural, uyusmaz: false, eslesti: v2 && result === "ESLESTI", birikenMs: result === "ESLESTI" && v2 ? 0 : birikenMs };
  if (!v2) {
    out.push({ code: "PARMAK_IZI_UYUSMAZ", tier: "UYARI", banner: UNVERIFIED_BANNER });
    return { kural, uyusmaz: false, eslesti: false, birikenMs };
  }
  out.push(ladderFinding("PARMAK_IZI_UYUSMAZ", birikenMs, internetVar, "Makine parmak izi lisanstakiyle uyuşmuyor"));
  return { kural, uyusmaz: true, eslesti: false, birikenMs };
}
