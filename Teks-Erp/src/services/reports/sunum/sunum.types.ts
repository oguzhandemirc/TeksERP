// =============================================================================
// Rapor sunum zarfı (Raporlar v2) — ekran, PDF, Excel ve patron uygulaması AYNI zarfı basar
// =============================================================================
// ayna: Electron/src/pages/Reports/_v2/sunum.ts — gövde birebir (R0-SABLON bekçisi bayt-eşit ölçer).
// Bu yüzden dosyada import YOKTUR; yalnız tip ve sabit yaşar. Tarihler tel biçimi (ISO dize).
// "Ölçülemedi" sayıya çökertilmez: değer `null` + `olculemedi` nedeni taşır, 0 YAZILMAZ.

/** Ölçü birimi — kapalı küme; görünen metni `BIRIM_METNI`nden okunur. */
export type Birim =
  | "m"
  | "kg"
  | "top"
  | "adet"
  | "siparis"
  | "levent"
  | "parti"
  | "yuzde"
  | "puan"
  | "gun"
  | "dakika"
  | "saat"
  | "TRY"
  | "USD"
  | "EUR";

/** Birimin cümlede ve kartta görünen metni. `yuzde` sayının ÖNÜNE yazılır ("%12"). */
export const BIRIM_METNI: Readonly<Record<Birim, string>> = {
  m: "m",
  kg: "kg",
  top: "top",
  adet: "adet",
  siparis: "sipariş",
  levent: "levent",
  parti: "parti",
  yuzde: "%",
  puan: "puan",
  gun: "gün",
  dakika: "dk",
  saat: "saat",
  TRY: "TL",
  USD: "USD",
  EUR: "EUR",
};

/** Para birimleri 0 ondalıkla basılır; diğerleri en çok 1 ondalık. */
export const PARA_BIRIMLERI: readonly Birim[] = ["TRY", "USD", "EUR"];

/** Ölçünün hangi yöne gitmesi iyi — kıyas okunun rengi buradan. */
export type IyiYon = "yukari" | "asagi" | "notr";

export type KiyasYonu = "artti" | "azaldi" | "degismedi";

/** Kıyasın renk yorumu (iyiYon × yön). Ölçülemeyen kıyas "notr"dur. */
export type ComparisonTone = "iyi" | "kotu" | "notr";

export interface AnaSayiKiyas {
  /** Kıyas döneminin değeri; ölçülemediyse `null` (0 DEĞİL). */
  deger: number | null;
  /** simdi − once; iki taraftan biri ölçülemediyse `null`. */
  fark: number | null;
  /** Göreli değişim %; önceki değer 0 ya da ölçülemediyse `null`. */
  yuzde: number | null;
  /** Eşik altı değişim "degismedi"; fark ölçülemediyse `null`. */
  yon: KiyasYonu | null;
  durum: ComparisonTone;
}

export interface AnaSayi {
  /** Ölçü kimliği (semantik sözlük anahtarı). */
  olcu: string;
  /** Günlük dilde ad ("Zamanında teslim"). */
  ad: string;
  deger: number | null;
  birim: Birim;
  /** `deger` null ise NEDEN (Türkçe, kullanıcıya gösterilir). */
  olculemedi?: string;
  kiyas?: AnaSayiKiyas;
}

/** Anlatı motorunun ürettiği tek cümle; `kanit` cümlenin dayandığı sayılardır (JSON-güvenli). */
export interface AnlatiCumlesi {
  kural: string;
  /** 0–1; mutlak etki × güven. Sıralama bu puanla, eşitlikte kural sırasıyla. */
  onem: number;
  metin: string;
  kanit: Record<string, unknown>;
  /** Cümle para birimli bir ölçüden doğdu (fabrika işaretler) — fiyat izni olmayan patron hesabında bulut atlar. */
  paraIcerir?: true;
}

export const GRAFIK_TURLERI = [
  "cizgi",
  "cubuk",
  "yiginCubuk",
  "pasta",
  "isiHaritasi",
  "sacilim",
  "kutu",
  "kucukCoklu",
] as const;
export type GrafikTuru = (typeof GRAFIK_TURLERI)[number];

export interface GrafikSerisi {
  ad: string;
  veri: (number | null)[];
  /** Önceki dönem serisi soluk çizilir. */
  soluk?: boolean;
}

export interface GrafikBlok {
  tur: GrafikTuru;
  eksen: {
    x: { ad: string; tur: "zaman" | "kategori" | "sayi" };
    y: { ad: string; birim: Birim };
  };
  seriler: GrafikSerisi[];
  kategoriler: string[];
}

export interface TabloKolonu {
  anahtar: string;
  baslik: string;
  birim?: Birim;
  hiza?: "sol" | "sag" | "orta";
}

export type TabloHucresi = string | number | null;

export interface TabloBlok {
  kolonlar: TabloKolonu[];
  satirlar: Record<string, TabloHucresi>[];
  toplam?: Record<string, TabloHucresi>;
  /** Satır tavanı kestiyse kaç satır gösterildi / kaç vardı. */
  kesildi?: { gosterilen: number; toplam: number };
}

export interface ParametreSecenegi {
  deger: string;
  etiket: string;
}

export interface ParametreBeyani {
  ad: string;
  etiket: string;
  tur: "tarih" | "secim" | "cokluSecim" | "sayi" | "metin" | "bayrak";
  /** Seçim yokluğu ("Tümü") `null`dır; boş dizi YAZILMAZ. */
  deger: string | number | boolean | string[] | null;
  secenekler?: ParametreSecenegi[];
}

/** Varyant görünümü: hangi boyutun hangi değerine bakılıyor, tek tıkla diğerleri. */
export interface VaryantBlok {
  boyut: string;
  boyutEtiketi: string;
  secili: ParametreSecenegi | null;
  digerleri: ParametreSecenegi[];
}

export interface DonemAraligi {
  from: string;
  to: string;
  etiket: string;
}

/** Çok dönemli kıyasın tek sütunu. */
export interface DonemBlok extends DonemAraligi {
  anaSayi: AnaSayi;
}

export interface RaporTanimi {
  ad: string;
  aciklama: string;
}

export interface RaporSunumu {
  anahtar: string;
  baslik: string;
  /** Raporun cevapladığı soru ("Sözümüzü tuttuk mu?"). */
  soru: string;
  donem: DonemAraligi;
  kiyasDonemi?: DonemAraligi;
  anaSayi: AnaSayi;
  /** En çok 3. */
  yanSayilar: AnaSayi[];
  /** Önem sırasıyla; ekran ilk 3'ü, PDF ilk 5'i basar (çağıran keser). */
  anlati: AnlatiCumlesi[];
  grafik: GrafikBlok | null;
  tablo: TabloBlok | null;
  tanimlar: RaporTanimi[];
  parametreler: ParametreBeyani[];
  varyant?: VaryantBlok;
  donemler?: DonemBlok[];
  uyarilar: string[];
  /** Kişi adı taşır (ör. operatör kırılımı) — patron bulutu sunumu okuyup bu raporu dışlar (K-KISI). */
  kisiAdi?: true;
}

export const SIDE_FIGURE_LIMIT = 3;
export const ANLATI_EKRAN_SAYISI = 3;
export const ANLATI_PDF_SAYISI = 5;
