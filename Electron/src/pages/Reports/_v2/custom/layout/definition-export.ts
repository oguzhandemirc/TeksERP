// =============================================================================
// Özel rapor → dışa aktarım spec'i (R2-DUZEN): PDF ve Excel TEK spec'ten, ekranla aynı dönüşümle
// =============================================================================
// Blok sırası/genişliği/sayfa kesmesi düzenden; tablo metni ekrandaki `tableOf`/`periodTableOf`/`variantOf`
// dönüşümünden (tablo tanımı tek). Grafik SVG'si basım anında `grafikleriDoldur` ile üretilir.
// =============================================================================
import type { ExportBlok, ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { grafikVeriTablosu } from "../../grafik/veriTablosu";
import { formatFigure } from "../../figures";
import { tableToExport } from "../../table-model";
import { variantToExport } from "../../variant-model";
import type { BlockOutcome, RunResult } from "../custom-api";
import { chartOf, headlineOf, periodTableOf, tableOf, variantOf } from "../result-model";
import { orderedLayout, type DefinitionBody } from "./layout-model";

const NO_DATA = "Bu bölüm için veri yok.";

function blockBody(b: BlockOutcome, chartKind: string): ExportBlok {
  const name = b.baslik ?? undefined;
  if (b.durum !== "tamam") return { tur: "metin", baslik: name, metin: b.mesaj };
  if (b.metin) return { tur: "metin", baslik: name, metin: b.metin };
  const r = b.sonuclar[0];
  if (!r) return { tur: "metin", baslik: name, metin: NO_DATA };
  if (b.tur === "anaSayi") {
    const h = headlineOf(r);
    if (!h) return { tur: "metin", baslik: name, metin: NO_DATA };
    const kiyas = r.kiyas ? `Kıyas dönemi: ${formatFigure(h.previous, h.figure.birim)}` : undefined;
    return { tur: "anaSayi", kartlar: [{ ad: name ?? h.figure.ad, deger: formatFigure(h.figure.deger, h.figure.birim), ...(kiyas ? { kiyas } : {}), ana: true }] };
  }
  if (b.tur === "grafik") {
    const chart = chartOf(r, chartKind);
    if (!chart) return { tur: "metin", baslik: name, metin: "Grafik için kırılım yok." };
    const title = name ?? chart.eksen.y.ad;
    return { tur: "grafik", baslik: title, grafik: chart, veri: grafikVeriTablosu(chart, title) };
  }
  if (b.tur === "varyant") {
    const v = variantOf(r);
    const t = v ? variantToExport(v) : null;
    return t ? { tur: "tablo", tablo: name ? { ...t, name } : t } : { tur: "metin", baslik: name, metin: NO_DATA };
  }
  if (b.tur === "donem") {
    const t = periodTableOf(r);
    return t ? { tur: "tablo", tablo: tableToExport(t, name ?? "Dönem kıyası") } : { tur: "metin", baslik: name, metin: "Dönem sütunu çıkmadı." };
  }
  return { tur: "tablo", tablo: tableToExport(tableOf(r), name ?? "Tablo") };
}

/** Ekranda görünen uyarıların aynısı (blok sonuçlarının birleşik, tekrarsız listesi). */
export function resultWarnings(result: RunResult): string[] {
  return [...new Set(result.bloklar.flatMap((b) => (b.durum === "tamam" ? b.sonuclar.flatMap((s) => s.uyarilar) : [])))];
}

export function buildDefinitionExportSpec(result: RunResult, body: DefinitionBody, chartKindOf: (id: string) => string): ReportExportSpec {
  const byId = new Map(result.bloklar.map((b) => [b.id, b]));
  const bloklar: ExportBlok[] = orderedLayout(body).flatMap(({ item }) => {
    const b = byId.get(item.i);
    return b ? [{ ...blockBody(b, chartKindOf(b.id)), genislik: item.w, ...(item.sayfaKesmesi ? { sayfaKesmesi: true } : {}) }] : [];
  });
  const warnings = resultWarnings(result);
  return {
    title: result.baslik,
    meta: [`${result.itibariylaMetni} itibarıyla${result.tanim.surumNo ? ` · Sürüm ${result.tanim.surumNo}` : ""}`],
    tables: [],
    ...(warnings.length ? { uyarilar: warnings } : {}),
    bloklar,
  };
}
