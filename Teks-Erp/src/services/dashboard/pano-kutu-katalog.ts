// =============================================================================
// AÇILIŞ PANOSU — KUTU KATALOĞU (tek kaynak)
// =============================================================================
// Panel kutuları buradan öğrenir (`GET /pano/kutular`); veri ucu yalnız buradaki anahtarları kabul
// eder (tanınmayan 400). Kapı sunucuda: izinsiz/kapalı modül kutusu katalogda HİÇ yoktur, veri
// ucunda istenirse `null` döner. Kutu yalnız istenince hesaplanır (bellekli kaynak paylaşılır).
// =============================================================================
import type { PanoGates, PanoKullanici } from "./pano-kaynak";
import type { AgendaParams } from "./pano-kutu-ajanda";
import { agendaBox } from "./pano-kutu-ajanda";
import { cashFlowBox, stockFlowBox } from "./pano-kutu-akis";
import {
  consignedBox, distributionBox, loomBox, orderKpiBox, outsideBox, pendingBox, productionKpiBox, receivablesBox,
  shipmentKpiBox, stockKpiBox, stockSummaryBox, subcontractKpiBox, topItemsBox, trendBox, type BoxInput,
} from "./pano-kutu-mevcut";
import { collectionBox, revenueBox, topCustomersBox } from "./pano-kutu-satis";
import { openWorkOrdersBox, qualityBox, stationOutputBox } from "./pano-kutu-uretim";
import { getPanoHareketler } from "./pano-hareketler.service";

export type PanoBoxSize = "kpi" | "kucuk" | "orta" | "genis";
export type PanoBoxGroup = "uretim" | "satis" | "stok" | "fason" | "finans" | "genel";

export interface PanoBoxRun extends BoxInput {
  user: PanoKullanici;
  agenda: AgendaParams;
}

interface PanoBoxDef {
  key: string;
  title: string;
  description: string;
  group: PanoBoxGroup;
  periodic: boolean;
  byDefault: boolean;
  size: PanoBoxSize;
  visible: (can: PanoGates) => boolean;
  compute: (run: PanoBoxRun) => Promise<unknown>;
}

const anyOf = (...keys: Array<keyof PanoGates>) => (can: PanoGates): boolean => keys.some((k) => can[k]);

/** Sıra = panelin varsayılan yerleşim sırası. Anahtar wire sözleşmesidir; değiştirilmez, yalnız eklenir. */
export const PANO_BOXES: readonly PanoBoxDef[] = [
  { key: "uretim", title: "Üretim", description: "Dönemde biten kumaş (metre, top) ve önceki döneme göre değişim.", group: "uretim", periodic: true, byDefault: true, size: "kpi", visible: anyOf("uretim"), compute: productionKpiBox },
  { key: "sevk", title: "Sevk", description: "Dönemde sevk edilen metre (brüt) ve irsaliye sayısı.", group: "satis", periodic: true, byDefault: true, size: "kpi", visible: anyOf("sevk"), compute: shipmentKpiBox },
  { key: "siparis", title: "Yeni sipariş", description: "Dönemde açılan sipariş adedi ve istenen metre.", group: "satis", periodic: true, byDefault: true, size: "kpi", visible: anyOf("siparis"), compute: orderKpiBox },
  { key: "fason", title: "Fason", description: "Dönemde fasona giden ve dönen metre.", group: "fason", periodic: true, byDefault: true, size: "kpi", visible: anyOf("fason"), compute: subcontractKpiBox },
  { key: "stok", title: "Stok", description: "Şu an depodaki mamul ve ham metre, iplik kg.", group: "stok", periodic: false, byDefault: true, size: "kpi", visible: anyOf("stok"), compute: stockKpiBox },
  { key: "ciro", title: "Ciro", description: "Dönemde sevk edilen malın tutarı; para birimleri ayrı.", group: "satis", periodic: true, byDefault: false, size: "kpi", visible: anyOf("sevkTutar"), compute: revenueBox },
  { key: "tahsilat", title: "Tahsilat", description: "Dönemde kasaya/bankaya giren carili tahsilat (iptaller düşülmüş).", group: "finans", periodic: true, byDefault: false, size: "kpi", visible: anyOf("nakit"), compute: collectionBox },
  { key: "egilim", title: "Üretim ve sevk eğilimi", description: "Dönem içinde saat/gün/ay bazında üretim ve sevk metresi.", group: "uretim", periodic: true, byDefault: true, size: "genis", visible: anyOf("uretim", "sevk"), compute: trendBox },
  { key: "dagilim", title: "Kumaş dağılımı", description: "Dönemde biten kumaşın ilk 5 kumaşa dağılımı.", group: "uretim", periodic: true, byDefault: true, size: "orta", visible: anyOf("uretim"), compute: distributionBox },
  { key: "enCok", title: "En çok üretilen / sevk edilen", description: "Dönemde en çok üretilen ve sevk edilen 5 kumaş.", group: "uretim", periodic: true, byDefault: true, size: "orta", visible: anyOf("uretim", "sevk"), compute: topItemsBox },
  { key: "enCokMusteri", title: "En çok müşteri", description: "Dönemde en çok sipariş veren ve en çok sevk edilen 5 müşteri.", group: "satis", periodic: true, byDefault: false, size: "orta", visible: anyOf("siparis", "sevk"), compute: topCustomersBox },
  { key: "uretimIstasyon", title: "İstasyon bazında üretim", description: "Dönemde her istasyondan geçen metre ve top.", group: "uretim", periodic: true, byDefault: false, size: "orta", visible: anyOf("istasyon"), compute: stationOutputBox },
  { key: "isEmriDurum", title: "Açık iş emirleri", description: "Planlı ve üretimdeki iş emri sayısı.", group: "uretim", periodic: false, byDefault: false, size: "kucuk", visible: anyOf("isEmri"), compute: openWorkOrdersBox },
  { key: "kalite", title: "Kalite özeti", description: "Dönemde biten kumaşın kalite payları ve hurda oranı.", group: "uretim", periodic: true, byDefault: false, size: "orta", visible: anyOf("uretim"), compute: qualityBox },
  { key: "tezgah", title: "Tezgahlar", description: "Şu an çalışan, duran ve işsiz tezgah sayısı.", group: "uretim", periodic: false, byDefault: true, size: "kucuk", visible: anyOf("tezgah"), compute: loomBox },
  { key: "stokOzeti", title: "Stok özeti", description: "Şu an depodaki mamul, ham, yarı mamul ve iplik.", group: "stok", periodic: false, byDefault: true, size: "orta", visible: anyOf("stok"), compute: stockSummaryBox },
  { key: "stokHareket", title: "Stok giriş–çıkış", description: "Dönem içinde depoya giren ve çıkan metre; iplik kg.", group: "stok", periodic: true, byDefault: false, size: "genis", visible: anyOf("stok"), compute: stockFlowBox },
  { key: "fasonOzeti", title: "Fasondaki mal", description: "Şu an fasoncuda bekleyen metre ve top.", group: "fason", periodic: false, byDefault: true, size: "kucuk", visible: anyOf("fasonOzeti"), compute: outsideBox },
  { key: "emanet", title: "Emanet mal", description: "Şu an depodaki müşteri malı (emanet).", group: "stok", periodic: false, byDefault: true, size: "kucuk", visible: anyOf("emanet"), compute: consignedBox },
  { key: "bekleyen", title: "Bekleyen işler", description: "Onay bekleyen belge, sevke hazır sevkiyat, üretime gönderilmemiş sipariş.", group: "genel", periodic: false, byDefault: true, size: "orta", visible: anyOf("gelenBelge", "sevkeHazir", "uretimeBekleyen"), compute: pendingBox },
  { key: "ajanda", title: "Ajanda", description: "Seçilen günün planlı işleri ve ay görünümü.", group: "genel", periodic: false, byDefault: false, size: "genis", visible: anyOf("alis", "isEmri", "dokumaIsi", "sevkeHazir"), compute: (r) => agendaBox(r.can, r.agenda) },
  { key: "finans", title: "Alacaklar", description: "Para birimi başına açık ve vadesi geçmiş alacak.", group: "finans", periodic: false, byDefault: true, size: "orta", visible: anyOf("finans"), compute: receivablesBox },
  { key: "nakitAkisi", title: "Nakit giriş–çıkış", description: "Dönem içinde kasa ve bankaya giren/çıkan para; para birimleri ayrı.", group: "finans", periodic: true, byDefault: false, size: "genis", visible: anyOf("nakit"), compute: cashFlowBox },
  { key: "sonHareketler", title: "Son hareketler", description: "Son 8 sipariş, sevk, fason, mal kabul ve gelen belge hareketi.", group: "genel", periodic: false, byDefault: true, size: "orta", visible: anyOf("hareket"), compute: (r) => getPanoHareketler(r.user, r.src.now) },
];

export const PANO_BOX_KEYS: readonly string[] = PANO_BOXES.map((b) => b.key);

export function findPanoBox(key: string): PanoBoxDef | undefined {
  return PANO_BOXES.find((b) => b.key === key);
}

export interface PanoKutuTanimi {
  anahtar: string;
  baslik: string;
  aciklama: string;
  grup: PanoBoxGroup;
  donemli: boolean;
  varsayilan: boolean;
  boyut: PanoBoxSize;
}

export function visibleBoxCatalog(can: PanoGates): PanoKutuTanimi[] {
  return PANO_BOXES.filter((b) => b.visible(can)).map((b) => ({
    anahtar: b.key, baslik: b.title, aciklama: b.description, grup: b.group, donemli: b.periodic, varsayilan: b.byDefault, boyut: b.size,
  }));
}
