// =============================================================================
// SİSTEM ŞABLONLARI — kodda duran, kopyalanabilir rapor tanımı gövdeleri (R3-ANALIZ; plan §3.2)
// =============================================================================
// Temel raporların gövdesi kod servisidir; şablonun gövdesi ise sıradan bir tanım JSON'udur: SISTEM
// satırı olarak boot'ta uzlaştırılır (sürüm satırı yok — gövde koddan okunur), görüntüleyicide çalışır
// ve "Kopyasını özel rapor yap" ile OZEL tanımın ilk sürümü olur. Doğrulama `test_rapor_tanimi` + bu
// dilimin uçtan uca bekçisinde.
// =============================================================================
import { WARP_DEFECT_GROUP } from "../../../constants/hata-gruplari";

/** Şablonun Rapor Merkezi kategorisi (`SYSTEM_CATEGORY_NAMES` kodu) ve görünürlük izni. */
export interface SystemTemplate {
  anahtar: string;
  ad: string;
  aciklama: string;
  kategori: "kalite" | "uretim" | "dokuma";
  izin: string;
  govde: Record<string, unknown>;
}

const COZGU_ONLY = { combinator: "and", rules: [{ field: "hataGrubu", operator: "=", value: WARP_DEFECT_GROUP }] };

export const SHIFT_WARP_TEMPLATE_KEY = "sablon/vardiya-cozgu-hatasi";

export const SYSTEM_TEMPLATES: readonly SystemTemplate[] = [
  {
    anahtar: SHIFT_WARP_TEMPLATE_KEY,
    ad: "Vardiyaya göre çözgü hatası",
    aciklama: "Çözgü hatası gece vardiyasında mı fazla? Üretilen metreye göre oranlanır.",
    kategori: "kalite",
    izin: "report:quality",
    govde: {
      surum: 1,
      baslik: "Vardiyaya göre çözgü hatası",
      parametreler: [
        { ad: "donem", tur: "tarihAraligi", etiket: "Dönem", varsayilan: "son30gun" },
        { ad: "kiyas", tur: "kiyas", etiket: "Kıyas", varsayilan: "prev" },
      ],
      bloklar: [
        { id: "a1", tur: "anaSayi", baslik: "Çözgü hatası", sorgu: { kup: "hata", olculer: ["kalite.hataAdedi"], suzgec: COZGU_ONLY, zaman: { param: "donem", kiyas: "$kiyas" } } },
        {
          id: "n1", tur: "analiz", baslik: "Vardiya × çözgü hatası", yontem: "kiKare", kup: "hata",
          x: "vardiya", y: "kalite.hataAdedi", maruziyet: "kalite.bitenMetre", suzgec: COZGU_ONLY, zaman: { param: "donem" },
        },
        { id: "g1", tur: "grafik", baslik: "Vardiya ve saate göre çözgü hatası", gorsel: "isiHaritasi", sorgu: { kup: "hata", olculer: ["kalite.hataAdedi"], boyutlar: ["vardiya", "saat"], suzgec: COZGU_ONLY, zaman: { param: "donem" } } },
        { id: "t1", tur: "tablo", baslik: "Vardiyaya göre hata grupları", sorgu: { kup: "hata", olculer: ["kalite.hataAdedi"], boyutlar: ["vardiya", "hataGrubu"], zaman: { param: "donem" } }, pivot: { satir: "vardiya", sutun: "hataGrubu" } },
        { id: "m1", tur: "metin", metin: "Hata, bulunduğu vardiyaya yazılır. Üretilen metre, kumaşın bittiği vardiyadan gelir. Bir vardiyada oran yüksekse önce tezgah ve iplik partisine ayrıca bakın." },
      ],
      duzen: [
        { i: "a1", x: 0, y: 0, w: 4, h: 2 },
        { i: "n1", x: 0, y: 2, w: 12, h: 8 },
        { i: "g1", x: 0, y: 10, w: 12, h: 6 },
        { i: "t1", x: 0, y: 16, w: 12, h: 4 },
        { i: "m1", x: 0, y: 20, w: 12, h: 2 },
      ],
    },
  },
];

export const SYSTEM_TEMPLATE_BY_KEY: ReadonlyMap<string, SystemTemplate> = new Map(SYSTEM_TEMPLATES.map((t) => [t.anahtar, t]));
