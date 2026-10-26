// =============================================================================
// Özel rapor "Ne görüyoruz?" bloğu (R2-ANLATI) — cümle SUNUCUDA, anlatı motorundan
// =============================================================================
// Girdi yalnız aynı raporun `tamam` bloklarıdır (yetkisiz blok girdi vermez); motor sorgu koşmaz.
// İstemci cümle kurmaz, `anlati` alanını aynen basar.
// =============================================================================
import { lowerTr } from "../../../utils/tr-case";
import { anlatiUret, type NarrativeInput } from "../anlati/anlati";
import type { AnalysisInput, Kirilim } from "../anlati/gozlem";
import { anaSayiKur } from "../sunum/sunum-kur";
import type { AnlatiCumlesi, Birim } from "../sunum/sunum.types";
import { SEMANTIC_CUBES, measureDictionaryEntry } from "./katalog";
import type { SemanticResult } from "./sonuc";
import type { NarrativeBlock } from "./rapor-tanimi.schema";

const UNIT_OF: Record<string, Birim> = { metre: "m", yuzde: "yuzde", adet: "adet", gun: "gun", dakika: "dakika" };
const MONEY: ReadonlySet<string> = new Set(["TRY", "USD", "EUR"]);
const DIRECTION = { artis: "yukari", azalis: "asagi", notr: "notr" } as const;

interface DoneBlock { id: string; tur: string; durum: string; sonuclar?: SemanticResult[] }

const rangeOf = (a: { dateFrom: string; dateTo: string }) => ({ from: new Date(a.dateFrom), to: new Date(a.dateTo) });

/** İlk ana sayı bloğu → ölçünün dönem değeri (+kıyas). Para yalnız TEK para birimindeyse. */
function headlineOf(blocks: readonly DoneBlock[]): Pick<NarrativeInput, "anaSayi" | "anaSayiIfadesi" | "donem" | "kiyasDonemi"> {
  const r = blocks.find((b) => b.tur === "anaSayi" && b.durum === "tamam")?.sonuclar?.[0];
  const m = r?.olculer[0];
  if (!r || !m) return {};
  const entry = measureDictionaryEntry(m.kimlik);
  let birim: Birim | undefined = UNIT_OF[entry?.birim ?? ""];
  let value = r.toplam.degerler[m.kimlik] ?? null;
  let onceki = r.kiyas ? (r.kiyas.toplam.degerler[m.kimlik] ?? null) : undefined;
  if (entry?.birim === "para") {
    const now = r.toplam.paraBirimleri ?? [];
    if (now.length !== 1 || !MONEY.has(now[0].paraBirimi)) return {};
    birim = now[0].paraBirimi as Birim;
    value = now[0].deger;
    if (r.kiyas) onceki = r.kiyas.toplam.paraBirimleri?.find((p) => p.paraBirimi === now[0].paraBirimi)?.deger ?? null;
  }
  if (!birim) return {};
  const iyiYon = DIRECTION[(entry?.iyiYon ?? "notr") as keyof typeof DIRECTION] ?? "notr";
  return {
    anaSayi: anaSayiKur({ olcu: m.kimlik, ad: m.ad, deger: value, birim, iyiYon, ...(onceki !== undefined ? { onceki } : {}) }),
    anaSayiIfadesi: {},
    donem: rangeOf(r.aralik),
    kiyasDonemi: r.kiyas ? rangeOf(r.kiyas.aralik) : null,
  };
}

/** Tek kategori boyutlu, tek toplanır ölçülü ilk tablo/grafik; "Diğer" kovası varsa pay yanlış olur → yok. */
function breakdownOf(blocks: readonly DoneBlock[]): Kirilim | undefined {
  for (const b of blocks) {
    if ((b.tur !== "tablo" && b.tur !== "grafik") || b.durum !== "tamam") continue;
    const r = b.sonuclar?.[0];
    if (!r || r.olculer.length !== 1 || r.boyutlar.length !== 1 || r.donemler) continue;
    const cube = SEMANTIC_CUBES.find((c) => c.id === r.kup.kimlik);
    const dim = cube?.dimensions.find((d) => d.id === r.boyutlar[0].kimlik);
    const measure = cube?.measures.find((x) => x.id === r.olculer[0].kimlik);
    const birim = UNIT_OF[measureDictionaryEntry(r.olculer[0].kimlik)?.birim ?? ""];
    if (!dim || dim.kind !== "category" || measure?.kind !== "sum" || !birim) continue;
    if (r.satirlar.some((s) => s.anahtarlar[dim.id]?.diger)) return undefined;
    return {
      boyut: lowerTr(dim.name),
      birim,
      adTuru: dim.valueType === "uuid" ? "ozel" : "cins",
      satirlar: r.satirlar.map((s) => ({ ad: s.anahtarlar[dim.id]?.etiket ?? "Belirtilmemiş", deger: s.degerler[measure.id] ?? null })),
    };
  }
  return undefined;
}

/** Bloğun cümleleri: girdi rapordaki diğer bloklardan; kural seçimi + tavan bloğun kendisinden. */
export function narrativeOf(
  b: NarrativeBlock,
  blocks: readonly DoneBlock[],
  analysisInputs: ReadonlyMap<string, AnalysisInput>,
): AnlatiCumlesi[] {
  const firstAnalysis = blocks.find((x) => x.tur === "analiz" && x.durum === "tamam" && analysisInputs.has(x.id));
  const input: NarrativeInput = {
    ...headlineOf(blocks),
    ...(breakdownOf(blocks) ? { kirilim: breakdownOf(blocks) } : {}),
    ...(firstAnalysis ? { analiz: analysisInputs.get(firstAnalysis.id) } : {}),
  };
  return anlatiUret(input, { kurallar: b.kurallar, enFazla: b.enFazla });
}
