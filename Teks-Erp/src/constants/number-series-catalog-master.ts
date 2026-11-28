// =============================================================================
// NUMARA SERİSİ KATALOĞU — master veri kodları
// =============================================================================
// `number-series-catalog.ts` 300 satır tavanını aştığı için master veri kodları buraya
// ayrıldı (davranış ve sıra aynı: katalog bu diziyi aynı yerde yayar). Okutulan seri
// (`kind:`) buraya KONMAZ — panelin `barcode-kind.test.ts` aynası ana dosyayı okur.
// =============================================================================
import type { NumberSeries } from "@prisma/client";
import type { NumberSeriesCatalogEntry } from "./number-series-catalog.types";

type NumberSeriesDateSegment = NumberSeries["dateSegment"];
const D = "DDMMYY" as NumberSeriesDateSegment;
const NONE = "NONE" as NumberSeriesDateSegment;

export const MASTER_DATA_NUMBER_SERIES: readonly NumberSeriesCatalogEntry[] = [
  // ── Master data kodları ────────────────────────────────────────────────────
  { key: "customer", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "customer", field: "code", birim: "kayıt" }, label: "Cari kodu", seedPrefix: "MUS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  // ⚠️ `FSN` ile okutulan `FS` (fason sevk belgesi) ön ek olarak çakışmaz:
  // çakışma kapısı yalnız TARAMA uzayında küreseldir ve bu ikisi okutulmaz;
  // ayrıca istemci çapası ön ekten sonra RAKAM ister, `FSN…` `FS`ye uymaz.
  { key: "subcontractor", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/subcontractor-management.service.ts" }, panelGroup: "master-veri", countTable: { model: "subcontractor", field: "code", birim: "kayıt" }, label: "Fason firma kodu", seedPrefix: "FSN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "subcontractorCategory", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/subcontractor-management.service.ts" }, panelGroup: "master-veri", countTable: { model: "subcontractorCategory", field: "code", birim: "kayıt" }, label: "Fason kategori kodu", seedPrefix: "KAT", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "fabricProperty", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "fabricProperty", field: "code", birim: "kayıt" }, label: "Kumaş özelliği kodu", seedPrefix: "OZL", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "drawingInPlan", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor; tarihsiz (plan kalıcı ana veri), istemci kod gönderirse aynen kullanılır (T1 tahar planı, 2026-11-28).", uretec: "services/drawing-in-plan.service.ts" }, panelGroup: "master-veri", countTable: { model: "drawingInPlan", field: "code", birim: "kayıt" }, label: "Tahar planı kodu", seedPrefix: "THR", seedDateSegment: NONE, seedDigits: 4, seedSeparator: "-" },
  { key: "item", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23)." }, panelGroup: "master-veri", countTable: { model: "item", field: "code", birim: "kayıt" }, label: "Stok kodu", seedPrefix: "STK", seedDateSegment: NONE, seedDigits: 6, seedSeparator: "-" },
  // Hizmet kartı kodu (D1b, 2026-11-08 K1): taşınan kartlar eski STK- kodunu KORUR (doğuşta materyalize); yalnız yeni kart HZM.
  { key: "serviceItem", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor; yükleyici ürün + hizmet kartı kodlarını birlikte görür (iki yönlü kod tekilliği, D1b 2026-11-08).", uretec: "services/service-item.service.ts" }, panelGroup: "master-veri", countTable: { model: "serviceItem", field: "code", birim: "kayıt" }, label: "Hizmet kartı kodu", seedPrefix: "HZM", seedDateSegment: NONE, seedDigits: 6, seedSeparator: "-" },
  { key: "color", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "color", field: "code", birim: "kayıt" }, label: "Renk kodu", seedPrefix: "RNK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "station", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "station", field: "code", birim: "kayıt" }, label: "İstasyon kodu", seedPrefix: "IST", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "machine", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "machine", field: "code", birim: "kayıt" }, label: "Makine kodu", seedPrefix: "MAK", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "cashAccount", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "cashBox", field: "code", birim: "kayıt" }, label: "Kasa kodu", seedPrefix: "KS", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "bankAccount", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "bankAccount", field: "code", birim: "kayıt" }, label: "Banka hesap kodu", seedPrefix: "BN", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "returnReason", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "returnReason", field: "code", birim: "kayıt" }, label: "İade sebebi kodu", seedPrefix: "IADE", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "productRecipe", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "productRecipe", field: "code", birim: "kayıt" }, label: "Ürün reçetesi kodu", seedPrefix: "REC", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "defectType", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "defectType", field: "code", birim: "kayıt" }, label: "Hata tipi kodu", seedPrefix: "HATA", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  { key: "warehouse", scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" }, panelGroup: "master-veri", countTable: { model: "warehouse", field: "code", birim: "kayıt" }, label: "Depo kodu", seedPrefix: "DP", seedDateSegment: D, seedDigits: 4, seedSeparator: "" },
  {
    key: "routeTemplate",
    scopedCounter: { durum: "hazir", not: "Üreteç `nextSeriesNo` yolundan geçiyor ve yükleyici doğuş anını taşıyor: kapsam damgası + çakışma atlaması tek yerde (E2 master veri dilimi, 2026-09-23).", uretec: "services/base.service.ts" },
    panelGroup: "master-veri",
    // ⚠️ `Route.code` NULLABLE ve ELLE de yazılabiliyor ("BKT-STD" — desen kodu
    // saha dilidir). Kapsam null'ları ve seri-dışı kodları eler; §4'ün "zorunlu
    // kolon YA DA kapsam" sözleşmesinin ikinci ayağı. BEYAN: ön ek kapsamı,
    // tesadüfen aynı ön ekle başlayan elle yazılmış bir kodu (`ROTA-1`) DA
    // sayar — etki cümlesi için kabul edilebilir bir AŞIRI sayım, çünkü o kayıt
    // da biçim değişiminden etkilenmez; eksik sayım olsaydı kabul edilmezdi.
    countTable: { model: "route", field: "code", birim: "kayıt", kapsam: "seri-onekli" },
    label: "Rota kodu",
    seedPrefix: "ROT",
    seedDateSegment: D,
    seedDigits: 4, seedSeparator: "",
  },
];
