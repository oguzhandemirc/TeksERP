// =============================================================================
// Analiz bölümü — sunucu sonucunu karta çevirir (R3-ANALIZ; plan §4.7)
// =============================================================================
// İstemci HESAP YAPMAZ: olasılık, oran, pay, eğilim çizgisi ve sonuç cümlesi sunucudan gelir
// (`POST /api/rapor-semantik/analiz` / tanımın `analiz` bloğu). Burada yalnız seçim ve biçim var:
// hangi cümle sonuç, hangisi uyarı; karıştırıcı düğmesinin açacağı önizleme gövdesi.
// =============================================================================
import type { RaporSunumu } from "../sunum";
import type { CatalogCube } from "../custom/custom-api";
import type { DefinitionBlock, DefinitionBody } from "../custom/layout/layout-model";

/** Kartta her zaman duran not — sunucu cümlesinden bağımsız (kart cümleyi değiştirmez). */
export const CAUSALITY_TEXT = "İlişki, nedeni göstermez.";

/** R3-ISTAT kapalı kümesi; etiketler günlük dil (yöntem adı ekranda geçmez). */
export const ANALYSIS_METHOD_OPTIONS = [
  { value: "kiKare", label: "Gruplar arasında fark var mı?", hint: "Bir kırılımın gruplarını (vardiya, tezgah…) oranla kıyaslar" },
  { value: "pearson", label: "İki ölçü birlikte değişiyor mu?", hint: "Her nokta bir gün ya da grup; doğrusal ilişki" },
  { value: "spearman", label: "Sıralamaları birlikte mi değişiyor?", hint: "Uç değerlerden az etkilenir" },
] as const;
export type AnalysisMethod = (typeof ANALYSIS_METHOD_OPTIONS)[number]["value"];

export interface AnalysisGroupLite {
  anahtar: string | null;
  ad: string;
  sayi: number;
  maruziyet: number | null;
  oran: number | null;
}

/** Sunucunun `AnalysisStats` alanlarından kartın okuduğu kısım. */
export interface AnalysisStatsLite {
  yontem: AnalysisMethod;
  istatistik: number;
  n: number;
  kanitP: number | null;
  uyarilar: string[];
  gruplar?: AnalysisGroupLite[];
  egilim?: [[number, number], [number, number]] | null;
}

export interface AnalysisOutcome {
  sunum: RaporSunumu;
  istatistik: AnalysisStatsLite | null;
}

export type AnalysisVerdict =
  | { kind: "result"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "empty"; text: string };

/**
 * Sonuç satırı: örneklem uyarısı varsa SARI uyarı (kanıt cümlesi çizilmez), yoksa sunucunun kanıt
 * cümlesi AYNEN; veri yoksa sunucunun "kayıt yok" cümlesi. Eşik motorun kararıdır (`uyarilar`).
 */
/** Sunucu cümlesinin sonundaki sabit not: kart/dışa aktarım notu ayrıca bastığı için tek kez kalsın. */
function withoutCausality(text: string | undefined): string | undefined {
  const t = text?.trimEnd();
  return t?.endsWith(CAUSALITY_TEXT) ? t.slice(0, -CAUSALITY_TEXT.length).trimEnd() : t;
}

export function analysisVerdict(a: AnalysisOutcome): AnalysisVerdict {
  const sentences = a.sunum.anlati;
  const pick = (rule: string) => withoutCausality(sentences.find((s) => s.kural === rule)?.metin);
  const stats = a.istatistik;
  if (!stats || stats.n === 0) return { kind: "empty", text: pick("veriYok") ?? "Bu dönemde analiz edilecek kayıt yok." };
  if (stats.uyarilar.length > 0) return { kind: "warning", text: pick("orneklemUyarisi") ?? "Kayıt sayısı karar vermek için az." };
  const result = pick("korelasyon");
  return result ? { kind: "result", text: result } : { kind: "empty", text: withoutCausality(sentences[0]?.metin) ?? "Bu dönemde analiz edilecek kayıt yok." };
}

export interface Confounder {
  dimension: string;
  label: string;
  /** Küpte bu kırılım yoksa düğme devre dışı + gerekçe. */
  unavailable: string | null;
}

const CONFOUNDERS = [
  { dimension: "tezgah", label: "Tezgaha göre ayrı bak", missing: "Bu konuda tezgah kırılımı yok." },
  { dimension: "iplikPartisi", label: "İplik partisine göre ayrı bak", missing: "İplik partisi kırılımı henüz yok." },
] as const;

/** Analiz bloğunun küpü: gövdede yazılıysa o, değilse x ile y'yi birlikte taşıyan ilk küp (sunucu kuralı). */
export function analysisCube(block: DefinitionBlock, cubes: readonly CatalogCube[] | undefined): CatalogCube | undefined {
  if (!cubes) return undefined;
  if (typeof block.kup === "string") return cubes.find((c) => c.kimlik === block.kup);
  const has = (c: CatalogCube, id: unknown) => c.olculer.some((m) => m.kimlik === id) || c.boyutlar.some((d) => d.kimlik === id);
  return cubes.find((c) => has(c, block.x) && has(c, block.y));
}

/** Karıştırıcı önerileri; yalnız "kırılım × sayım" analizinde anlamlı (x boyut, y ölçü). */
export function confoundersFor(block: DefinitionBlock, cube: CatalogCube | undefined): Confounder[] {
  if (!cube || !cube.olculer.some((m) => m.kimlik === block.y) || !cube.boyutlar.some((d) => d.kimlik === block.x)) return [];
  return CONFOUNDERS.filter((c) => c.dimension !== block.x).map((c) => ({
    dimension: c.dimension,
    label: c.label,
    unavailable: cube.boyutlar.some((d) => d.kimlik === c.dimension) ? null : c.missing,
  }));
}

/**
 * "Ayrı bak" önizleme gövdesi: aynı ölçü + süzgeç + dönem, karıştırıcının ilk 6 değeri küçük çoklu
 * olarak ve karıştırıcı × analiz kırılımı tablosu. Sayılar sunucuda (`/onizle`).
 */
export function confounderBody(block: DefinitionBlock, body: DefinitionBody | undefined, dimension: string, cube: CatalogCube): DefinitionBody {
  const zaman = block.zaman as { param: string } | undefined;
  const params = zaman ? (body?.parametreler ?? []).filter((p) => p.ad === zaman.param) : [];
  const query = (dims: string[]) => ({
    kup: cube.kimlik,
    olculer: [String(block.y)],
    boyutlar: dims,
    ...(block.suzgec ? { suzgec: block.suzgec } : {}),
    ...(zaman && params.length ? { zaman: { param: zaman.param } } : {}),
  });
  return {
    surum: 1,
    baslik: `${block.baslik ?? "Analiz"} — ${dimension}`,
    parametreler: params,
    bloklar: [
      { id: "ayri1", tur: "varyant", ilkN: 6, sorgu: query([dimension]) },
      { id: "ayri2", tur: "tablo", sorgu: query([dimension, String(block.x)]) },
    ],
  };
}

/** Oluşturucu: sayım ölçüsünde maruziyet zorunlu — kaydet devre dışı + Türkçe neden (son söz sunucunun `dogrula`sı). */
export function analysisBlockIssue(block: DefinitionBlock, cubes: readonly CatalogCube[] | undefined): string | null {
  if (block.tur !== "analiz") return null;
  if (!block.x || !block.y) return "Analiz bölümünde iki alan seçin.";
  const cube = analysisCube(block, cubes);
  const isCount = (id: unknown) => cube?.olculer.find((m) => m.kimlik === id)?.birim === "adet";
  if ((isCount(block.x) || isCount(block.y)) && !block.maruziyet) {
    return "Sayım ölçüsü üretim miktarına bölünmeden kıyaslanamaz; analiz bölümünde \"Neye göre oranlansın?\" seçin.";
  }
  return null;
}
