// Fason çeki (SUBCONTRACTOR_DISPATCH) sözleşmesinin alan ve tablo beyanları; kurgu `subcontractor-dispatch.ts`te.
import { TERIM } from "../../../constants/terim";
import { COMPANY_FIELDS, DOC_STATUS_FIELDS, LETTERHEAD_EXTRA_TABLE, PRINT_FIELDS } from "./ortak";
import { sampleSeriesCode } from "./senaryolar";
import type { FieldDef, TableDef } from "./tipler";

export const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "İrsaliye no", tur: "metin", sinif: "musteri", ornek: "FSN-2026-0231" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "SUBCONTRACTOR_DISPATCH" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: "KUMAŞ İRSALİYESİ" },
  { yol: "belge.tarih", etiket: "Sevk tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.plaka", etiket: "Plaka", tur: "metin", sinif: "musteri", ornek: "16 XYZ 789" },
  { yol: "belge.sofor", etiket: "Şoför", tur: "metin", sinif: "musteri", ornek: "Ali Demir" },
  { yol: "belge.notlar", etiket: "Sevk notu", tur: "metin", sinif: "musteri", ornek: "Acele" },
  { yol: "belge.is_emri_no", etiket: `${TERIM.terbiyeIsEmri.tekil} no`, tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("workOrder", 1) },
  { yol: "belge.istasyon", etiket: "Fason adımı (istasyon)", tur: "metin", sinif: "musteri", ornek: "Boyahane (Fason)" },
  { yol: "belge.en", etiket: `Belgenin eni (${TERIM.terbiyeIsEmri.cekim.ayrilma})`, tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150 },
  { yol: "belge.parti_no", etiket: "Parti no", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("batchDaily", 1) },
  { yol: "belge.cins", etiket: "Cinsi (ilk topun kumaşı)", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar" },
  { yol: "belge.istenen_renk", etiket: "İstenen (hedef) renk", tur: "metin", sinif: "musteri", ornek: "Bej" },
  { yol: "belge.renk", etiket: "Renk (hedef, yoksa ilk topun rengi)", tur: "metin", sinif: "musteri", ornek: "Bej" },
  { yol: "belge.talimat", etiket: "Fason talimatı", tur: "metin", sinif: "musteri", ornek: "Yıkama yapma" },
  { yol: "belge.komut_var", etiket: "Talimat kutusu verisi var mı", tur: "mantiksal", sinif: "musteri", ornek: true },
  { yol: "belge.boyanacak_renk", etiket: "Boyanacak renk (talimat)", tur: "metin", sinif: "musteri", ornek: "Bej" },
  { yol: "belge.talimat_girilmemis", etiket: "Talimat hiç girilmemiş", tur: "mantiksal", sinif: "musteri", ornek: false },
  ...COMPANY_FIELDS,
  { yol: "karsi_taraf.ad", etiket: "Fasoncu adı", tur: "metin", sinif: "musteri", ornek: "Yıldız Boyahane" },
  { yol: "karsi_taraf.kod", etiket: "Fasoncu kodu (hesap)", tur: "metin", sinif: "musteri", ornek: "FB-03" },
  { yol: "toplamlar.top_adedi", etiket: "Toplam top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt gönderilen)", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 500 },
  { yol: "toplamlar.kg", etiket: "Toplam kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 79 },
  ...PRINT_FIELDS,
];

const m = ([yol, etiket, tur, ornek]: [string, string, FieldDef["tur"], FieldDef["ornek"]], ek: Partial<TableDef["kolonlar"][number]> = {}) => ({
  yol, etiket, tur, sinif: "musteri" as const, ornek, hiza: "l" as const, ...ek,
});

export const SUMMARY_TABLE: TableDef = {
  anahtar: "ozet",
  etiket: "Alt özet satırı (CİNSİ/EN/TOP/METRE)",
  kolonlar: [
    m(["cins", "Cinsi", "metin", "Pamuklu Astar"], { kaynakKolon: "cins" }),
    m(["en", "En", "sayi", 150], { ondalik: 0, birim: "cm", kaynakKolon: "en" }),
    m(["top_adedi", "Top", "sayi", 2], { ondalik: 0, kaynakKolon: "top", toplam: "top_adedi" }),
    m(["metre", "Metre", "sayi", 500], { ondalik: 1, birim: "m", kaynakKolon: "metre", toplam: "metre" }),
    m(["fiyat", "Fiyatı (fasonda boş)", "para", null], { kaynakKolon: "fiyat" }),
    m(["tutar", "Tutarı (fasonda boş)", "para", null], { kaynakKolon: "tutar" }),
  ],
};

export const TABLE_DEFS: TableDef[] = [
  LETTERHEAD_EXTRA_TABLE,
  {
    anahtar: "izgara",
    etiket: "Top/Metre ızgarası (sayfalara bölünmüş hücreler, satır satır)",
    kolonlar: [
      m(["top_no", "Top sıra no", "sayi", 1], { ondalik: 0 }),
      m(["metre", "Metre (boş kutuda boş)", "sayi", 240], { ondalik: 1, birim: "m" }),
      m(["sayfa_basi", "Sayfanın ilk hücresi", "mantiksal", true]),
      m(["sayfa_sonu", "Sayfanın son hücresi", "mantiksal", false]),
      m(["satir_basi", "Satırın ilk hücresi", "mantiksal", true]),
      m(["satir_sonu", "Satırın son hücresi", "mantiksal", false]),
    ],
  },
  SUMMARY_TABLE,
  {
    anahtar: "toplar",
    etiket: "Gönderilen toplar",
    kolonlar: [
      m(["sira", "Sıra", "sayi", 1], { ondalik: 0 }),
      m(["barkod", "Barkod", "metin", "TR-260607-R0123"]),
      m(["urun", "Ürün", "metin", "Pamuklu Astar"]),
      m(["renk", "Renk", "metin", null]),
      m(["metre", "Metre", "sayi", 240], { ondalik: 1, birim: "m" }),
      m(["kg", "Kg", "sayi", 38], { ondalik: 1, birim: "kg" }),
      m(["kalite", "Kalite", "metin", "A"]),
    ],
  },
  { anahtar: "kumaslar", etiket: "Sevkteki kumaşlar (tekil)", kolonlar: [m(["ad", "Kumaş", "metin", "Pamuklu Astar"])] },
  { anahtar: "renkler", etiket: "Sevkteki renkler (hedef + top renkleri, tekil)", kolonlar: [m(["ad", "Renk", "metin", "Bej"])] },
  {
    anahtar: "islemler",
    etiket: "Yapılacak işlemler (talimat; ada göre sıralı)",
    kolonlar: [m(["ad", "İşlem", "metin", "Su İtici"]), m(["deger", "Değer", "metin", null])],
  },
  { anahtar: "hedef_ozellikler", etiket: "İstenen özellikler (eski belgeler)", kolonlar: [m(["ad", "Özellik", "metin", "Su İtici"])] },
];
