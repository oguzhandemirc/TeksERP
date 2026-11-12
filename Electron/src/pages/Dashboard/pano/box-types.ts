// Kutu (widget) tel tipleri — backend `services/dashboard/pano-kutu-katalog.ts` (katalog) ve
// `pano-kutu-{satis,uretim,akis,ajanda}.ts` aynası. Mevcut kutuların biçimi `PanoSummary` alanlarıyla aynıdır.
import type { PanoDonem, PanoHareketler, PanoKova, PanoSummary } from "./types";

export type PanoBoxSize = "kpi" | "kucuk" | "orta" | "genis";
export type PanoBoxGroup = "uretim" | "satis" | "stok" | "fason" | "finans" | "genel";

/** `GET /api/dashboard/pano/kutular` satırı — yalnız kullanıcının görebileceği kutular; sıra = varsayılan yerleşim. */
export interface PanoBoxDef {
  anahtar: string;
  baslik: string;
  aciklama: string;
  grup: PanoBoxGroup;
  donemli: boolean;
  varsayilan: boolean;
  boyut: PanoBoxSize;
}

/** `GET /api/dashboard/pano?kutular=` yanıtı — bilinen ama izinsiz/kapalı kutu `null`. */
export interface PanoBoxResponse {
  donem: PanoDonem;
  aralik: { from: string; to: string };
  oncekiAralik: { from: string; to: string };
  olusturuldu: string;
  kutular: Record<string, unknown>;
}

export interface PanoMoneyKpi { paraBirimi: string; deger: number; onceki: number; degisimYuzde: number | null }

export interface RevenueBox { tutarlar: PanoMoneyKpi[]; fiyatsizSatir: number }
export interface CollectionBox { tutarlar: PanoMoneyKpi[] }

export interface TopCustomersBox {
  siparis: Array<{ musteriId: string; ad: string; siparisAdet: number; metre: number }> | null;
  sevk: Array<{ musteriId: string; ad: string; metre: number }> | null;
}

export interface StationOutputBox {
  istasyonlar: Array<{ istasyonId: string; ad: string; tur: string; metre: number; top: number }>;
  toplam: { metre: number; top: number };
}

export interface OpenWorkOrdersBox { toplam: number; durumlar: Array<{ durum: "PLANNED" | "IN_PROGRESS"; adet: number }> }

export interface QualityBox {
  bitenMetre: number;
  bitenTop: number;
  kalitesizMetre: number;
  birinciKalite: { kod: string; ad: string; metre: number; yuzde: number } | null;
  kaliteler: Array<{ kaliteId: string; kod: string; ad: string; metre: number; yuzde: number }>;
  fire: { hurdaMetre: number; hurdaYuzde: number | null; tespitEdilenHata: number; binMetredeHata: number | null };
}

export interface StockFlowBox {
  kova: PanoKova;
  noktalar: Array<{ anahtar: string; girisMetre: number; cikisMetre: number; iplikGirisKg: number | null; iplikCikisKg: number | null }>;
  toplam: { girisMetre: number; cikisMetre: number };
  turler: Array<{ tur: string; girisMetre: number; cikisMetre: number }>;
  iplik: { girisKg: number; cikisKg: number } | null;
}

export interface CashFlowBox {
  kova: PanoKova;
  paraBirimleri: Array<{ paraBirimi: string; noktalar: Array<{ anahtar: string; giris: number; cikis: number }>; toplamGiris: number; toplamCikis: number }>;
}

interface AgendaList<T> { toplam: number; kalemler: T[] }

export interface AgendaBox {
  gun: string;
  ay: string;
  isler: {
    alisTeslim: AgendaList<{ id: string; no: string; durum: string; taraf: string | null; zaman: string | null }> | null;
    isEmriBaslangic: AgendaList<{ id: string; no: string; durum: string; hedefMetre: number | null; zaman: string | null }> | null;
    dokumaBaslangic: AgendaList<{ id: string; no: string; durum: string; kumas: string; planlananMetre: number | null; zaman: string | null }> | null;
    /** Planlanan sevk günü bu gün olan PLANNED sevkiyatlar; eski sunucuda alan yok. */
    sevkiyat?: AgendaList<{ id: string; no: string; musteri: string; gun: string | null }> | null;
  };
  planliSevkiyat: AgendaList<{ id: string; no: string; musteri: string; olusturuldu: string }> | null;
  ayGunleri: Array<{ gun: string; alis: number; isEmri: number; dokuma: number; sevk?: number; toplam: number }>;
  kesildi: boolean;
}

/** Kutu anahtarı → veri biçimi (çizim tarafı daraltır; tanımsız anahtar `unknown`). */
export interface PanoBoxData {
  uretim: NonNullable<PanoSummary["kpi"]["uretim"]>;
  sevk: NonNullable<PanoSummary["kpi"]["sevk"]>;
  siparis: NonNullable<PanoSummary["kpi"]["siparis"]>;
  fason: NonNullable<PanoSummary["kpi"]["fason"]>;
  stok: NonNullable<PanoSummary["kpi"]["stok"]>;
  ciro: RevenueBox;
  tahsilat: CollectionBox;
  egilim: PanoSummary["egilim"];
  dagilim: NonNullable<PanoSummary["dagilim"]>;
  enCok: PanoSummary["enCok"];
  enCokMusteri: TopCustomersBox;
  uretimIstasyon: StationOutputBox;
  isEmriDurum: OpenWorkOrdersBox;
  kalite: QualityBox;
  tezgah: NonNullable<PanoSummary["tezgah"]>;
  stokOzeti: NonNullable<PanoSummary["stokOzeti"]>;
  stokHareket: StockFlowBox;
  fasonOzeti: NonNullable<PanoSummary["fasonOzeti"]>;
  emanet: NonNullable<PanoSummary["emanet"]>;
  bekleyen: PanoSummary["bekleyen"];
  ajanda: AgendaBox;
  finans: NonNullable<PanoSummary["finans"]>;
  nakitAkisi: CashFlowBox;
  sonHareketler: PanoHareketler;
}

export type PanoBoxKey = keyof PanoBoxData;
