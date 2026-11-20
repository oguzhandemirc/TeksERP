// Ekran başına tablo sütunları (D7). Anahtar = kayıttaki tel alanı = sıralama anahtarı (`LIST_SORT`); metin yalnız
// biçimlenir (fabrikanın sayısı), hesap yok.
import type { ProjectionRecord } from "../../api/wire";
import { formatDate, formatNumber } from "../../lib/format";
import { customerText, fabricText, orderCell, workOrderNo } from "../../lib/is-emri";
import { orderStatus } from "../../lib/labels/siparis";
import { TERIM } from "../../lib/terim";
import { asObj, str } from "../siparis/OrderRow";
import type { TabloSutunu } from "./model";

const k = (r: ProjectionRecord) => asObj(r.kayit);
const num = (v: unknown, digits = 0) => (v === null || v === undefined || v === "" ? "" : formatNumber(v, digits));
const date = (v: unknown) => (str(v) ? formatDate(v) : "");

export const SIPARIS_SUTUNLARI: readonly TabloSutunu<ProjectionRecord>[] = [
  { anahtar: "siparisNo", etiket: "Sipariş no", tur: "metin", sabit: true, deger: (r) => str(k(r).siparisNo) ?? "" },
  { anahtar: "musteriAdi", etiket: "Müşteri", tur: "metin", genislik: 2, deger: (r) => str(k(r).musteriAdi) ?? "" },
  { anahtar: "durum", etiket: "Durum", tur: "metin", genislik: 1.5, deger: (r) => orderStatus(k(r).durum).label },
  { anahtar: "siparisTarihi", etiket: "Sipariş tarihi", tur: "tarih", deger: (r) => date(k(r).siparisTarihi) },
  { anahtar: "termin", etiket: "Termin", tur: "tarih", deger: (r) => date(k(r).termin) },
  { anahtar: "acikMiktar", etiket: "Açık (m)", tur: "sayi", deger: (r) => num(k(r).acikMiktar) },
  { anahtar: "sevkMiktari", etiket: "Sevk (m)", tur: "sayi", deger: (r) => num(k(r).sevkMiktari) },
];

/** İşlev: `TERIM` rejimi okuma anında çözülür (modül yüklenirken dondurulmaz). */
export const isEmriSutunlari = (): readonly TabloSutunu<ProjectionRecord>[] => [
  { anahtar: "isEmriNo", etiket: `${TERIM.terbiyeIsEmri.tekil} no`, tur: "metin", sabit: true, deger: (r) => workOrderNo(k(r)) },
  { anahtar: "musteriAdi", etiket: "Müşteri", tur: "metin", genislik: 2, deger: (r) => customerText(k(r)) },
  { anahtar: "urunAdi", etiket: "Kumaş", tur: "metin", genislik: 2, deger: (r) => fabricText(k(r)) },
  { anahtar: "siparisNolari", etiket: "Sipariş", tur: "metin", genislik: 1.5, deger: (r) => orderCell(k(r)) },
  { anahtar: "topSayisi", etiket: "Top", tur: "sayi", deger: (r) => num(k(r).topSayisi) },
  { anahtar: "metre", etiket: "Metre", tur: "sayi", deger: (r) => num(k(r).metre) },
  { anahtar: "planBitis", etiket: "Plan bitiş", tur: "tarih", deger: (r) => date(k(r).planBitis) },
  { anahtar: "olusturulma", etiket: "Açılış", tur: "tarih", deger: (r) => date(k(r).olusturulma) },
];
