// =============================================================================
// İPLİK İHTİYAÇ PLANI — v2 sunum zarfı (ekran = PDF = Excel; MAL-7)
// =============================================================================
// Hesap `yarn-need.report.service.ts`te (Decimal, dize çıktı); burası yalnız biçimler. Bilinmeyen
// değer (kapalı modül) hücreye "bilinmiyor" metniyle yazılır — 0 YAZILMAZ, Excel/PDF de aynı metni basar.
// =============================================================================
import type { AnlatiCumlesi, ParametreBeyani, RaporSunumu, TabloBlok, TabloKolonu } from "./sunum/sunum.types";
import { anaSayiKur } from "./sunum/sunum-kur";
import type { YarnNeedOptions, YarnNeedReport } from "./yarn-need.report.service";

export const YARN_NEED_KEY = "maliyet/iplik-ihtiyaci";
export const BILINMIYOR = "bilinmiyor";
const TITLE = "İplik İhtiyaç Planı";
const SORU = "Açık siparişleri dokumak için hangi iplikten kaç kg lazım, ne kadarı stokta ya da yolda, eksik ne?";
const EVET_HAYIR = [{ deger: "1", etiket: "Evet" }, { deger: "0", etiket: "Hayır" }];

/** Tel dizesi → sunum sayısı (yalnız gösterim katmanı; hesap Decimal'de bitti). */
const sayi = (v: string): number => Number(v);
const ya = (v: string | null): number | string => (v === null ? BILINMIYOR : sayi(v));

export function yarnNeedColumns(r: YarnNeedReport): TabloKolonu[] {
  return [
    { anahtar: "iplik", baslik: "İplik" },
    { anahtar: "cozguKg", baslik: "Çözgü", birim: "kg", hiza: "sag" },
    { anahtar: "atkiKg", baslik: "Atkı", birim: "kg", hiza: "sag" },
    { anahtar: "ihtiyacKg", baslik: "İhtiyaç", birim: "kg", hiza: "sag" },
    { anahtar: "serbestStokKg", baslik: "Serbest stok", birim: "kg", hiza: "sag" },
    ...(r.meta.kaynaklar.emanet ? [{ anahtar: "emanetKg", baslik: "Emanet (müşterinin)", birim: "kg" as const, hiza: "sag" as const }] : []),
    { anahtar: "acikAlisKg", baslik: "Açık alış", birim: "kg", hiza: "sag" },
    { anahtar: "eksikKg", baslik: "Eksik", birim: "kg", hiza: "sag" },
  ];
}

export function yarnNeedTable(r: YarnNeedReport): TabloBlok {
  return {
    kolonlar: yarnNeedColumns(r),
    satirlar: r.satirlar.map((s) => ({
      iplik: s.iplikKodu ? `${s.iplikKodu} · ${s.iplik}` : s.iplik,
      cozguKg: sayi(s.cozguKg),
      atkiKg: sayi(s.atkiKg),
      ihtiyacKg: sayi(s.ihtiyacKg),
      serbestStokKg: ya(s.serbestStokKg),
      ...(r.meta.kaynaklar.emanet ? { emanetKg: ya(s.emanetKg) } : {}),
      acikAlisKg: ya(s.acikAlisKg),
      eksikKg: sayi(s.eksikKg),
    })),
    toplam: { iplik: "Toplam", cozguKg: sayi(r.ozet.cozguKg), atkiKg: sayi(r.ozet.atkiKg), ihtiyacKg: sayi(r.ozet.ihtiyacKg), eksikKg: sayi(r.ozet.eksikKg) },
  };
}

function parametreler(r: YarnNeedReport, o: YarnNeedOptions): ParametreBeyani[] {
  return [
    { ad: "netle", etiket: "Depo ve üretimi düş", tur: "secim", deger: r.meta.netle ? "1" : "0", secenekler: EVET_HAYIR },
    { ad: "leventDus", etiket: "Hazır leventleri düş", tur: "secim", deger: r.meta.leventDus ? "1" : "0", secenekler: EVET_HAYIR },
    { ad: "musteriId", etiket: "Müşteri", tur: "secim", deger: o.musteriId ?? null, secenekler: r.meta.secenekler.musteriler.map((m) => ({ deger: m.id, etiket: m.ad })) },
    { ad: "urunId", etiket: "Ürün", tur: "secim", deger: o.urunId ?? null, secenekler: r.meta.secenekler.urunler.map((m) => ({ deger: m.id, etiket: m.ad })) },
  ];
}

/** Kaynak beyanı ve eksik listeleri — ekranın alt şeridi ile PDF/Excel uyarıları AYNI metin. */
export function yarnNeedWarnings(r: YarnNeedReport): string[] {
  const w: string[] = [];
  if (!r.meta.kaynaklar.stok) w.push("İplik modülü kapalı: stok bilinmiyor; eksik, stok sıfır sayılarak hesaplandı.");
  if (!r.meta.kaynaklar.acikAlis) w.push("Ticaret modülü kapalı: açık alış siparişleri bilinmiyor ve düşülmedi.");
  if (r.meta.leventDus && !r.meta.kaynaklar.leventDusumu) w.push("Devere modülü kapalı: hazır leventler düşülmedi.");
  if (r.meta.yapisiEksik.length) w.push(`${r.meta.yapisiEksik.length} ürünün yapısı eksik; ihtiyaca katılmadı.`);
  if (r.meta.olculemeyen.length) w.push(`${r.meta.olculemeyen.reduce((a, x) => a + x.kalemSayisi, 0)} sipariş kalemi kg ya da adet birimli; metreye çevrilmedi.`);
  return w;
}

export function buildYarnNeedSunumu(r: YarnNeedReport, o: YarnNeedOptions): RaporSunumu {
  const now = new Date().toISOString();
  const anlati: AnlatiCumlesi[] = [];
  const shortRows = r.satirlar.filter((s) => sayi(s.eksikKg) > 0);
  if (shortRows.length > 0) {
    anlati.push({ kural: "iplik.eksik", onem: 1, metin: `${shortRows.length} iplikte eksik var; en büyüğü ${shortRows[0].iplik}.`, kanit: { iplikSayisi: shortRows.length } });
  }
  return {
    anahtar: YARN_NEED_KEY,
    baslik: TITLE,
    soru: SORU,
    donem: { from: now, to: now, etiket: `Bugün itibarıyla (${r.meta.hesapZamani})` },
    anaSayi: anaSayiKur({ olcu: "iplik.eksikKg", ad: "Eksik iplik", deger: sayi(r.ozet.eksikKg), birim: "kg", iyiYon: "asagi" }),
    yanSayilar: [
      anaSayiKur({ olcu: "iplik.ihtiyacKg", ad: "İplik ihtiyacı", deger: sayi(r.ozet.ihtiyacKg), birim: "kg", iyiYon: "notr" }),
      anaSayiKur({ olcu: "iplik.kumasMetre", ad: "Dokunacak kumaş", deger: sayi(r.ozet.kumasMetre), birim: "m", iyiYon: "notr" }),
    ],
    anlati,
    grafik: null,
    tablo: yarnNeedTable(r),
    tanimlar: [
      { ad: "İplik ihtiyacı", aciklama: "Açık siparişlerin dokunacak metresi için ürün yapısından çıkan çözgü ve atkı ipliği; iptal edilen kalemler sayılmaz." },
      { ad: "Serbest stok", aciklama: "Depodaki iplik; müşterinin bize bıraktığı emanet iplik bu sayıya girmez." },
      { ad: "Eksik", aciklama: "İhtiyaçtan serbest stok ve yoldaki alış siparişi çıkınca kalan; sıfırın altına inmez." },
      { ad: BILINMIYOR, aciklama: "İlgili modül kapalı olduğu için değer okunamadı; sıfır demek değildir." },
    ],
    parametreler: parametreler(r, o),
    uyarilar: yarnNeedWarnings(r),
  };
}
