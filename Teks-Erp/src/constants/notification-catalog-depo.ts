// =============================================================================
// BİLDİRİM KATALOĞU — Depo · Sevkiyat · Fason · Mal kabul / Gelen belge · Satınalma parça dosyası (S3, 2026-11-14)
// =============================================================================
// `NOTIFICATION_CATALOG`a yayılır (tek katalog; ayrı dosya yalnız boyut içindir). Kaynaklar (tek yayma noktaları)
// `services/notification-sources/depo.ts`; özet türleri `depo-ozet.ts` → `jobs/notification-digest.job.ts`. OLAY
// birleştirme anahtarı = tür + kayıt, pencere 10 dk (K3). Sevk metresi BRÜT (sevk anı); yük tutar taşımaz.
// =============================================================================
import {
  NOTIFICATION_DEFAULT_CHANNELS as KANAL_VARSAYILAN,
  NOTIFICATION_DEFAULT_RETENTION as SAKLAMA,
  NOTIFICATION_DESKTOP_CHANNELS as KANAL_MASAUSTU,
  type NotificationCatalogEntry,
} from "./notification-catalog.types";

const ORTAK = {
  sinif: "BILDIRIM", altTur: "OLAY", varsayilan: "HERKES", kilit: "YOK", pencereSn: 600,
  kanallar: KANAL_MASAUSTU, varsayilanKanallar: KANAL_VARSAYILAN, saklama: SAKLAMA,
} as const;

const SEVK = {
  ...ORTAK, grup: "Sevkiyat", izinler: [["shipping:read"]], modul: "cekirdek:sevkiyat-depo",
  tekilKalibi: "{sevkiyatId}", panelEkran: "operations/shipments", panelYol: "/operations/shipments/{sevkiyatId}",
} as const;
const DEPO = { ...ORTAK, grup: "Depo" } as const;
const FASON = {
  ...ORTAK, grup: "Fason", izinler: [["subcontractor:read"]], modul: "planlanan:fason",
  panelEkran: "operations/fason-kokpiti", panelYol: "/operations/fason-kokpiti",
} as const;
const INCOMING_DOC = {
  ...ORTAK, grup: "Mal Kabul", izinler: [["gelen-belge:read"]], modul: "gelenBelgeEnabled",
  tekilKalibi: "{belgeId}", panelEkran: "operations/gelen-belgeler", panelYol: "/operations/gelen-belgeler/{belgeId}",
} as const;
const DAILY_DIGEST = { tekilKalibi: "{gun}", pencereSn: 0, ozet: "GUN_SONU" } as const;

export const DEPO_NOTIFICATION_ENTRIES = {
  // ── Sevkiyat ──────────────────────────────────────────────────────────────
  "sevkiyat.yola-cikti": {
    ...SEVK, kod: "sevkiyat.yola-cikti", ad: "Sevkiyat yola çıktı", onemli: true,
    baslik: "Sevk edildi: {sevkiyatNo}",
    govde: "{musteriAd} için {topSayisi} top, {metre} m sevk edildi · {kullanici}",
    payloadAlanlari: ["sevkiyatId", "sevkiyatNo", "musteriAd", "topSayisi", "metre", "kullanici"],
    tahminiHaftalik: 20,
  },
  "sevkiyat.geri-alindi": {
    ...SEVK, kod: "sevkiyat.geri-alindi", ad: "Sevk geri alındı", onemli: true,
    baslik: "Sevk geri alındı: {sevkiyatNo}",
    govde: "{kullanici} {sevkiyatNo} ({musteriAd}) sevkini geri aldı: {sebep}",
    payloadAlanlari: ["sevkiyatId", "sevkiyatNo", "musteriAd", "sebep", "kullanici"],
    tahminiHaftalik: 1,
  },
  "sevkiyat.faturalandi": {
    ...SEVK, kod: "sevkiyat.faturalandi", ad: "Sevkiyat faturalandı",
    baslik: "Faturalandı: {sevkiyatNo}",
    govde: "{sevkiyatNo} ({musteriAd}) fatura {faturaNo} ile işaretlendi · {kullanici}",
    payloadAlanlari: ["sevkiyatId", "sevkiyatNo", "musteriAd", "faturaNo", "kullanici"],
    tahminiHaftalik: 15,
  },
  "sevkiyat.iade": {
    ...ORTAK, grup: "Sevkiyat", izinler: [["return:read"]], modul: "cekirdek:sevkiyat-depo",
    tekilKalibi: "{iadeId}", panelEkran: "operations/returns", panelYol: "/operations/returns",
    kod: "sevkiyat.iade", ad: "Müşteri iadesi alındı", onemli: true,
    baslik: "İade alındı: {iadeNo}",
    govde: "{musteriAd}: {sevkiyatNo} sevkiyatından {topSayisi} top, {metre} m iade · {kullanici}",
    payloadAlanlari: ["iadeId", "iadeNo", "musteriAd", "sevkiyatNo", "topSayisi", "metre", "kullanici"],
    tahminiHaftalik: 2,
  },
  "sevkiyat.gunluk-ozet": {
    ...SEVK, ...DAILY_DIGEST, kod: "sevkiyat.gunluk-ozet", ad: "Günlük sevkiyat özeti", panelYol: "/operations/shipments",
    baslik: "Günlük sevkiyat özeti · {gun}",
    govde: "{sevkiyat} sevkiyat · {top} top, {metre} m sevk edildi · {geriAlinan} geri alındı",
    payloadAlanlari: ["gun", "sevkiyat", "top", "metre", "geriAlinan"],
    tahminiHaftalik: 7,
  },

  // ── Depo / Stok ───────────────────────────────────────────────────────────
  "stok.elle-duzeltme": {
    ...DEPO, izinler: [["roll:read"]], modul: "cekirdek:stok-giris",
    tekilKalibi: "{topId}", panelEkran: "operations/rolls", panelYol: "/operations/rolls",
    kod: "stok.elle-duzeltme", ad: "Top metrajı elle düzeltildi", onemli: true,
    baslik: "Elle metraj düzeltmesi: {barkod}",
    govde: "{kullanici} {barkod} topunu {eskiMetre} m → {yeniMetre} m düzeltti: {sebep}",
    payloadAlanlari: ["topId", "barkod", "eskiMetre", "yeniMetre", "sebep", "kullanici"],
    tahminiHaftalik: 3,
  },
  "stok.sayim-farki": {
    ...DEPO, izinler: [["warehouse:read"]], modul: "ticaretEnabled",
    tekilKalibi: "{sayimId}", panelEkran: "operations/stock-counts", panelYol: "/operations/stock-counts/{sayimId}",
    kod: "stok.sayim-farki", ad: "Sayımda fark çıktı", onemli: true,
    baslik: "Sayım farkı: {sayimNo}",
    govde: "{sayimNo} tamamlandı: {dusulenTop} top ({dusulenMetre} m) kayıttan düşüldü, {iplikDuzeltme} iplik düzeltmesi · {kullanici}",
    payloadAlanlari: ["sayimId", "sayimNo", "dusulenTop", "dusulenMetre", "iplikDuzeltme", "kullanici"],
    tahminiHaftalik: 0.5,
  },
  "stok.transfer": {
    ...DEPO, izinler: [["warehouse:transfer"]], modul: "depoMultiEnabled",
    tekilKalibi: "{transferId}", panelEkran: "operations/warehouse-transfers", panelYol: "/operations/warehouse-transfers",
    kod: "stok.transfer", ad: "Depo transferi yapıldı",
    baslik: "Depo transferi: {transferNo}",
    govde: "{kullanici} {topSayisi} topu {kaynakDepo} → {hedefDepo} taşıdı",
    payloadAlanlari: ["transferId", "transferNo", "kaynakDepo", "hedefDepo", "topSayisi", "kullanici"],
    tahminiHaftalik: 5,
  },
  "stok.gunluk-ozet": {
    ...DEPO, ...DAILY_DIGEST, izinler: [["roll:read"]], modul: "cekirdek:stok-giris",
    panelEkran: "operations/rolls", panelYol: "/operations/rolls",
    kod: "stok.gunluk-ozet", ad: "Günlük depo özeti",
    baslik: "Günlük depo özeti · {gun}",
    govde: "Depoya {giris} top ({girisMetre} m) girdi · {iade} iade · {transfer} transfer · {duzeltme} miktar düzeltmesi",
    payloadAlanlari: ["gun", "giris", "girisMetre", "iade", "transfer", "duzeltme"],
    tahminiHaftalik: 7,
  },

  // ── Fason ─────────────────────────────────────────────────────────────────
  "fason.cikis": {
    ...FASON, tekilKalibi: "{sevkId}", kod: "fason.cikis", ad: "Fasona mal çıktı",
    baslik: "Fason çıkışı: {sevkNo}",
    govde: "{firmaAd} firmasına {topSayisi} top, {metre} m gönderildi · {kullanici}",
    payloadAlanlari: ["sevkId", "sevkNo", "firmaAd", "topSayisi", "metre", "kullanici"],
    tahminiHaftalik: 15,
  },
  "fason.donus": {
    ...FASON, tekilKalibi: "{kabulId}", kod: "fason.donus", ad: "Fasondan mal döndü",
    baslik: "Fason dönüşü: {kabulNo}",
    govde: "{firmaAd} firmasından {topSayisi} top geldi · {kullanici}",
    payloadAlanlari: ["kabulId", "kabulNo", "firmaAd", "topSayisi", "kullanici"],
    tahminiHaftalik: 15,
  },
  "fason.gunluk-ozet": {
    ...FASON, ...DAILY_DIGEST, kod: "fason.gunluk-ozet", ad: "Günlük fason özeti",
    baslik: "Günlük fason özeti · {gun}",
    govde: "{cikis} fason çıkışı ({cikisMetre} m) · {donus} fason dönüşü",
    payloadAlanlari: ["gun", "cikis", "cikisMetre", "donus"],
    tahminiHaftalik: 7,
  },

  // ── Mal kabul / Gelen belge ───────────────────────────────────────────────
  "gelenbelge.geldi": {
    ...INCOMING_DOC, kod: "gelenbelge.geldi", ad: "Gelen belge kaydedildi",
    baslik: "Gelen belge: {belgeNo}",
    govde: "{gonderen} belgesi kaydedildi: {belgeNo} · {kullanici}",
    payloadAlanlari: ["belgeId", "belgeNo", "gonderen", "kullanici"],
    tahminiHaftalik: 30,
  },
  "gelenbelge.onaylandi": {
    ...INCOMING_DOC, kod: "gelenbelge.onaylandi", ad: "Gelen belge onaylandı",
    baslik: "Gelen belge onaylandı: {belgeNo}",
    govde: "{belgeNo} ({gonderen}) onaylandı, {topSayisi} top girdi · {kullanici}",
    payloadAlanlari: ["belgeId", "belgeNo", "gonderen", "topSayisi", "kullanici"],
    tahminiHaftalik: 30,
  },
  "gelenbelge.iptal": {
    ...INCOMING_DOC, kod: "gelenbelge.iptal", ad: "Gelen belge iptal edildi", onemli: true,
    baslik: "Gelen belge iptal: {belgeNo}",
    govde: "{kullanici} {belgeNo} ({gonderen}) belgesini iptal etti: {sebep}",
    payloadAlanlari: ["belgeId", "belgeNo", "gonderen", "sebep", "kullanici"],
    tahminiHaftalik: 1,
  },
  "gelenbelge.mukerrer": {
    ...INCOMING_DOC, kod: "gelenbelge.mukerrer", ad: "Mükerrer şüpheli gelen belge onaylandı", onemli: true,
    baslik: "Mükerrer şüphesi: {belgeNo}",
    govde: "{kullanici} {belgeNo} belgesini aynı numaralı {esler} varken onayladı",
    payloadAlanlari: ["belgeId", "belgeNo", "esler", "kullanici"],
    tahminiHaftalik: 0.5,
  },
  "gelenbelge.metre-farki": {
    ...INCOMING_DOC, kod: "gelenbelge.metre-farki", ad: "Gelen belge toplam farkıyla onaylandı", onemli: true,
    baslik: "Toplam farkı: {belgeNo}",
    govde: "{belgeNo} ({gonderen}) belge toplamıyla uyuşmadan onaya alındı: {sebep} · {kullanici}",
    payloadAlanlari: ["belgeId", "belgeNo", "gonderen", "sebep", "kullanici"],
    tahminiHaftalik: 1,
  },
  "malkabul.yapildi": {
    ...ORTAK, grup: "Mal Kabul", izinler: [["goods-receipt:read"]], modul: "ticaretEnabled",
    tekilKalibi: "{fisId}", panelEkran: "operations/goods-receipts", panelYol: "/operations/goods-receipts?focus={fisId}",
    kod: "malkabul.yapildi", ad: "Mal kabul fişi açıldı",
    baslik: "Mal kabul: {fisNo}",
    govde: "{kullanici} {tedarikci} için mal kabul fişi açtı: {fisNo}",
    payloadAlanlari: ["fisId", "fisNo", "tedarikci", "kullanici"],
    tahminiHaftalik: 5,
  },

  // ── Satınalma ─────────────────────────────────────────────────────────────
  "satinalma.siparis": {
    ...ORTAK, grup: "Satınalma", izinler: [["purchase-order:read"]], modul: "ticaretEnabled",
    tekilKalibi: "{alisId}", panelEkran: "operations/purchase-orders", panelYol: "/operations/purchase-orders",
    kod: "satinalma.siparis", ad: "Alış siparişi verildi",
    baslik: "Alış siparişi: {alisNo}",
    govde: "{kullanici} {tedarikci} firmasına alış siparişi verdi: {alisNo} · {kalemSayisi} kalem",
    payloadAlanlari: ["alisId", "alisNo", "tedarikci", "kalemSayisi", "kullanici"],
    tahminiHaftalik: 3,
  },
} as const satisfies Record<string, NotificationCatalogEntry>;
