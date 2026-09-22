// =============================================================================
// Sevk İrsaliyesi / Sevk Fişi — "SEVK İRSALİYESİ" HTML renderer (TEK KAYNAK)
// =============================================================================
// Müşteri sevkiyatının resmi sevk belgesi. Tüm cihazlar (mobil expo-print +
// Electron printHtmlString + muhasebe ekranı) bu backend HTML'ini basar → format
// her yerde birebir aynı; "muhasebe sevk fişi" ile "sevk irsaliyesi" TEK kaynaktan
// aynı çıkar. Donmuş PrintedDocument snapshot'ından (envelope + doc) üretilir.
//
// Yapı (ornek-fis.pdf 3 bölümü + yasal irsaliye başlığı):
//   üst:   firma anteti + SAYIN müşteri (+vergi no/şube) · İrsaliye No · Tarih · Yön
//   araç:  Plaka / Şoför / Taşıyıcı (varsa)
//   1) ÜRÜN LİSTESİ : STOK ADI | TOP ADEDİ | TOPLAM METRE
//   2) ÇUVAL LİSTESİ: ÇUVAL NO | METRE TOPLAMI | KG TOPLAMI | TOP ADEDİ
//   3) ÇEKİ LİSTESİ : ÇUVAL NO | BARKOD | DESEN | VARYANT | METRE | KG
//   alt:   serbest not + imza kutuları + filigran (TASLAK/İPTAL/ESKİ KOPYA)
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import { resolveDocNameMode, customerNameOr } from "./shipment-name-mode";
import type { PrintedDocSnapshot } from "../printed-document.service";
import {
  resolveDocStyle,
  docPageCss,
  docTableCss,
  scaleDocCss,
  docLogoHtml,
  DOC_LOGO_CSS,
  DOC_STAMPS_CSS,
  docCopyBadge,
  docBlocksHtml,
  docBlankGridCss,
  docBlankGridHtml,
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import { buildDocTable } from "./doc-table";
import {
  DOC_DENSITY,
  docChromeCss,
  resolveDocPageSize,
  scaleF,
  scaleW,
} from "./doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "./doc-fields";
import { fmtDate } from "./fmt-date";
import { formatSackSeqLabel, type SackSeqFormat } from "../helpers/sack-seq.helper";
import { pickExportCode } from "../helpers/shipment-destination.helper";

/** Belge etiketleri — cfg.language: tr | en | auto (auto → EXPORT sevkiyatta EN). */
const LABELS = {
  tr: {
    title: "SEVK İRSALİYESİ",
    to: "SAYIN",
    taxNo: "V.No",
    branch: "Şube",
    exportCode: "İhracat Kodu",
    code: "Kod",
    docNo: "İrsaliye No",
    date: "Tarih",
    direction: "Yön",
    domestic: "Yurtiçi",
    sackTotal: "Çuval Adedi",
    sackSystem: "sistemde",
    export: "Yurtdışı",
    customsNo: "Gümrük/İhracat No",
    orders: "Sipariş",
    /** Kimlik şeridi (sections.listHeader) — sahanın eski sistemindeki adlandırma. */
    identTo: "Sevk Edilen Firma",
    plate: "Plaka",
    driver: "Şoför",
    carrier: "Taşıyıcı",
    urunCaption: "ÜRÜN LİSTESİ",
    stokAdi: "STOK ADI",
    musteriStokAdi: "MÜŞTERİ STOK ADI",
    topAdedi: "TOP ADEDİ",
    toplamMetre: "TOPLAM METRE",
    cuvalCaption: "ÇUVAL LİSTESİ",
    ambalajKodu: "ÇUVAL NO",
    sira: "SIRA",
    ambalajNo: "AMBALAJ NO",
    sevkPartisi: "SEVK PARTİSİ",
    metreToplami: "METRE TOPLAMI",
    kgToplami: "KG TOPLAMI",
    paketSayisi: "TOP ADEDİ",
    aciklama: "AÇIKLAMA",
    iz: "İZ",
    cekiCaption: "ÇEKİ LİSTESİ",
    cuvalNo: "ÇUVAL NO",
    barkodNo: "BARKOD NO",
    parti: "PARTİ NO",
    desen: "DESEN",
    varyant: "VARYANT",
    musteriDesen: "MÜŞTERİ DESEN",
    musteriVaryant: "MÜŞTERİ VARYANT",
    en: "EN",
    metre: "METRE",
    kg: "KG",
    toplam: "TOPLAM",
    sigDefaults: ["Teslim Eden", "Teslim Alan"],
    wmDraft: "TASLAK",
    wmVoid: "İPTAL",
    wmOld: "ESKİ KOPYA",
    printedAt: "Basım",
    printedBy: "Basan",
  },
  en: {
    title: "DELIVERY NOTE",
    to: "TO",
    taxNo: "Tax No",
    branch: "Branch",
    exportCode: "Export Code",
    code: "Code",
    docNo: "Delivery Note No",
    date: "Date",
    direction: "Destination",
    sackTotal: "Package Count",
    sackSystem: "in system",
    domestic: "Domestic",
    export: "Export",
    customsNo: "Customs/Export No",
    orders: "Orders",
    identTo: "Consignee",
    plate: "Plate",
    driver: "Driver",
    carrier: "Carrier",
    urunCaption: "PRODUCT LIST",
    stokAdi: "ITEM NAME",
    musteriStokAdi: "CUSTOMER ITEM NAME",
    topAdedi: "ROLL COUNT",
    toplamMetre: "TOTAL METERS",
    cuvalCaption: "PACKAGE LIST",
    ambalajKodu: "PACKAGE NO",
    sira: "SEQ",
    ambalajNo: "PKG #",
    sevkPartisi: "LOT",
    metreToplami: "TOTAL METERS",
    kgToplami: "TOTAL KG",
    paketSayisi: "ROLL COUNT",
    aciklama: "REMARKS",
    iz: "TAGS",
    cekiCaption: "PACKING LIST",
    cuvalNo: "PACKAGE NO",
    barkodNo: "BARCODE",
    parti: "LOT NO",
    desen: "PATTERN",
    varyant: "VARIANT",
    musteriDesen: "CUSTOMER PATTERN",
    musteriVaryant: "CUSTOMER VARIANT",
    en: "WIDTH",
    metre: "METERS",
    kg: "KG",
    toplam: "TOTAL",
    sigDefaults: ["Delivered By", "Received By"],
    wmDraft: "DRAFT",
    wmVoid: "VOID",
    wmOld: "SUPERSEDED",
    printedAt: "Printed",
    printedBy: "By",
  },
} as const;

interface ShipmentDocProduct {
  name: string;
  /**
   * MÜŞTERİDEKİ AD (2026-09-04) — "İsim Renk Encm." biçiminde, bizim `name` ile
   * AYNI kalıpta kurulur. Kaynak zinciri `shipment-customer-name.helper`:
   * `OrderLine.customerItemName` (bir-seferlik override) > `CustomerItemAlias`
   * (master) > yok.
   *
   * ⚠️ `null`/`undefined` AYNI ANLAMA GELMEZ ama AYNI DAVRANIR: `undefined` =
   * eski donmuş snapshot (alan hiç yoktu), `null` = bu müşteride bu ürünün
   * karşılığı yok. İkisinde de belgeye BİZİM adımız basılır — geriye dönük
   * doldurma YAPILMAZ (donmuş belge kuralı).
   */
  customerName?: string | null;
  /** Ayrıştırılmış ikizler — `shipping.docProductColorSplit` açıkken kullanılır. */
  customerItemOnly?: string | null;
  customerColorOnly?: string | null;
  rollCount: number;
  totalMeters: number;
}

interface ShipmentDocSack {
  code: string;
  seq: number;
  totalMeters: number;
  totalKg: number;
  packageCount: number;
  /** Sevk partisi (2026-09-21) — eski snapshot'ta YOK; yalnız `meta.packingLot` açıkken çizilir. */
  packageNo?: number | null;
  packingGroupName?: string | null;
}

interface ShipmentDocCeki {
  sackCode: string;
  /** Sevkiyat içi sıra (2026-09-22) — eski snapshot'ta YOK; `meta.sackSeq` ile çizilir. */
  seq?: number | null;
  packageNo?: number | null;
  packingGroupName?: string | null;
  barcode: string | null;
  desen: string;
  varyant: string;
  /** Müşterideki desen/varyant adı (2026-09-04) — ürün satırıyla AYNI zincir.
   *  Eski snapshot'larda YOK; yoksa bizim adımız basılır. */
  customerDesen?: string | null;
  customerVaryant?: string | null;
  /** En (cm) — eski donmuş snapshot'larda yok (opsiyonel); kolonu açık-kapatılabilir. */
  width?: number | null;
  meters: number;
  kg: number;
  /** Topun parti no'su. Parti ÇUVAL değil TOP başına taşınır — çuval karışık içerikli
   *  olabilir, çuval başına tek parti yazmak sessizce yanlış olurdu.
   *  Eski donmuş snapshot'larda alan YOK → kolon durur, hücre "—" basar
   *  (geriye dönük doldurma YAPILMAZ). */
  batchNumber?: string | null;
}

/** Donmuş sevk belgesi payload'ı — collectShipmentDocContent / getDispatchReport
 *  ile BİREBİR aynı şekil (tek kaynak: muhasebe fişi == sevk irsaliyesi). */
export interface ShipmentDispatchDoc {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string | null;
    customerTaxNumber: string | null;
    branchName: string | null;
    /** ŞUBE ihracat kodu (CustomerBranch.code) — tek "İhracat Kodu" satırının
     *  ÖNCELİKLİ kaynağı: dolu ise şirket exportCode'unun önüne geçer
     *  (branchCode ?? customerExportCode). Satır "exportCode" toggle'ına bağlı. */
    branchCode: string | null;
    /** ŞİRKET ihracat kodu (Customer.exportCode) — şube ihracat kodu boşsa aynı
     *  "İhracat Kodu" satırına yedek olarak basılır; "exportCode" toggle'ıyla
     *  açılıp kapanır. Eski donmuş snapshot'larda alan yoktur (opsiyonel). */
    customerExportCode?: string | null;
    /** Snapshot DOĞARKEN çözülmüş ihracat kodu (yalnız yurtdışında dolu). Alanı taşımayan
     *  eski snapshot yönden bağımsız eski çözüme düşer — donmuş belge bayt bayt aynı kalır. */
    exportCode?: string | null;
    procedureCode: string | null;
    destination: "DOMESTIC" | "EXPORT";
    status: string;
    date: string | null;
    plateNumber: string | null;
    driverName: string | null;
    carrier: string | null;
    orderNos: string;
  };
  products: ShipmentDocProduct[];
  sacks: ShipmentDocSack[];
  cekiRows: ShipmentDocCeki[];
  /** Sevk anında donan sıra ön eki (2026-09-22) — eski snapshot'ta YOK (= ön eksiz). */
  sackSeqPrefix?: string;
  totals: {
    totalRolls: number;
    totalMeters: number;
    totalKg: number;
    /** Sistemin saydığı çuval KAYDI adedi. */
    sackCount: number;
    /**
     * Operatörün beyan ettiği FİZİKSEL çuval adedi (araca yüklenen).
     * `null`/`undefined` = beyan yok → belgede yalnız `sackCount` çıkar.
     * İkisi biri diğerinin yerine GEÇMEZ: sahada 10 çuval tek çuval kaydına
     * yazıldığı için fark meşrudur ve o fark bilginin kendisidir.
     */
    manualSackCount?: number | null;
  };
}

interface RenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  /** Kaynak henüz donmamış (canlı önizleme) → TASLAK filigranı. */
  draft?: boolean;
  /**
   * ÜRÜN ADI REJİMİ (`shipping.docItemNameMode`, 2026-09-04) — HER baskıda canlı
   * okunur, donmuş snapshot'a GİRMEZ. Verilmezse `bizdeki`: eski çağrı yolları
   * ve örnek/taslak render'lar bugünkü çıktıyı bayt-bayt korur.
   */
  itemNameMode?: "bizdeki" | "musterideki" | "ikisi";
  /**
   * ÇEKİ BÖLÜMÜNÜN REJİMİ (`shipping.docCekiNameMode`, 2026-09-06) — yalnız çeki
   * listesini çevirir, ürün listesine dokunmaz. `devral` (varsayılan, ve alan hiç
   * verilmediğinde) `itemNameMode`u izler → bugünkü çıktı bayt-bayt korunur.
   */
  cekiNameMode?: "devral" | "bizdeki" | "musterideki" | "ikisi";
  /** `shipping.docProductColorSplit` — ürün listesinde müşteri rengi ayrı sütun. */
  productColorSplit?: boolean;
  /**
   * `shipping.docPackingLot` (2026-09-21) — çuval ve çeki listesine "Ambalaj No" +
   * "Sevk Partisi" kolonu. Kapalı (varsayılan) = bugünkü çıktı; içerik snapshot'ta,
   * kolon kararı baskı anında canlı (sunum canlı, içerik donuk). Partisiz çuvalda
   * hücre BOŞ — uydurulmaz.
   */
  packingLot?: boolean;
  /**
   * `shipping.sackSeqOnDoc` (2026-09-22) — çuval ve çeki listesine "SIRA" kolonu
   * (`shipping.sackSeqPrefix` + `Sack.seq`, isteğe bağlı "/toplam"). Kapalı (varsayılan)
   * = bugünkü çıktı. Sayı snapshot'ta, biçim baskı anında canlı.
   */
  sackSeq?: SackSeqFormat;
  /** Snapshot logoHash'inin çözülmüş görseli (servis katmanı çözer). */
  logoDataUrl?: string | null;
  /** cfg.qr açıksa belge doğrulama karekodu (servis üretir). */
  qrDataUrl?: string | null;
  /** Basım damgası (dd.MM.yyyy HH:mm) — cfg.stamps.printedAt açıksa. */
  printedAtText?: string;
  /** Basan kullanıcı — cfg.stamps.printedBy açıksa. */
  printedBy?: string | null;
  /** Tek seferlik baskı notu (?printNote= — persist edilmez). */
  printNote?: string | null;
  /**
   * Çuval yorumları (annotation) — `sackNo` → yorum. Donmuş snapshot'ta YOK,
   * her baskıda canlı çözülür (sevkten sonra yazılan yorum da çıkar).
   */
  rowNotes?: Record<string, string>;
  /**
   * Tek seferlik "yorumları bu baskıda göster" (?rowNotes=1) — kalıcı kolon
   * ayarını EZER (OR). Hiçbir yere yazılmaz.
   */
  forceRowNotes?: boolean;
  /**
   * Çuval İZLERİ (etiket, annotation) — `sackNo` → "Kontrol Et, Eksik". Donmuş
   * snapshot'ta YOK, her baskıda canlı çözülür. Yorumdan AYRI kanal.
   */
  rowTags?: Record<string, string>;
  /**
   * Tek seferlik "izleri bu baskıda göster" (?rowTags=1) — kalıcı kolon ayarını
   * EZER (OR). `forceRowNotes`e BİNDİRİLMEZ. Hiçbir yere yazılmaz.
   */
  forceRowTags?: boolean;
  /**
   * Tek seferlik LİSTE seçimi (?sections=urun,cuval,ceki) — "sadece çuval
   * listesi bas" gibi. Verilmezse kalıcı ayar geçerli. Hiçbir yere yazılmaz.
   */
  listSections?: string[];
  /**
   * Üç listeyi AYNI sayfada akıt (?merge=1). Varsayılan AYRI: her liste kendi
   * sayfasından başlar — çuval listesi 1,5 sayfa tuttuğunda çeki listesi kalan
   * yarım sayfaya sıkışmaz. Hiçbir yere yazılmaz.
   */
  mergeSections?: boolean;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Türkçe sayı: binlik "." ondalık "," (sunucu ICU'suna bağımlı değil). */
function fmtTr(n: number | null | undefined, dec: number): string {
  if (n == null || Number.isNaN(n)) return "";
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(dec);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + grouped + (dec > 0 && frac ? `,${frac}` : "");
}

/** Metre/kg: 2 ondalık (mevcut muhasebe fişiyle aynı görünüm). */
const fmtQty = (n: number | null | undefined): string => fmtTr(n, 2);
/** Adet (top/paket): tam sayı. */
const fmtCount = (n: number | null | undefined): string => fmtTr(n, 0);

/** Bir bölüm açık mı — yalnız açıkça false ise gizle (varsayılan: göster). */
function sectionOn(sections: Record<string, boolean> | undefined, key: string): boolean {
  return sections?.[key] !== false;
}

/** Belgenin üç veri listesi — baskı diyaloğunda tek tek seçilebilir. */
export const DISPATCH_LIST_SECTIONS = ["urun", "cuval", "ceki"] as const;
export type DispatchListSection = (typeof DISPATCH_LIST_SECTIONS)[number];

/**
 * Bir LİSTE bölümü basılacak mı.
 *
 * İki katman, öncelik sırasıyla:
 *  1. `meta.listSections` — TEK SEFERLİK seçim (baskı diyaloğundaki tikler,
 *     `?sections=cuval` gibi). Verilmişse KALICI ayarı tamamen EZER ve hiçbir
 *     yere yazılmaz — `?rowNotes=1` ile aynı sözleşme.
 *  2. `cfg.sections` — Belge Kişiselleştirme'deki kalıcı ayar.
 *
 * Boş dizi ile "hiçbiri" DEMEK MÜMKÜN DEĞİL: seçim boş gelirse (kullanıcı üç tiki
 * de kapatmış) 1. katman yok sayılır, yoksa belge gövdesiz basılırdı. Diyalog da
 * son tikin kapanmasına izin vermez — iki tarafta da aynı kural.
 */
function listSectionOn(
  cfg: { sections?: Record<string, boolean> },
  meta: RenderMeta,
  key: DispatchListSection,
): boolean {
  const picked = meta.listSections?.filter((s) =>
    (DISPATCH_LIST_SECTIONS as readonly string[]).includes(s),
  );
  if (picked && picked.length > 0) return picked.includes(key);
  return sectionOn(cfg.sections, key);
}

export function renderShipmentDispatchHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as ShipmentDispatchDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  // Yoğunluk profili sayfa boyutundan çözülür; ortak chrome CSS'i oradan beslenir.
  const pageSize = resolveDocPageSize(cfg.style?.pageSize);
  const d = DOC_DENSITY[pageSize];
  const style = resolveDocStyle(cfg.style, { marginMm: 9 });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const h = doc.header;
  const t = doc.totals;
  // Enler boş bırakılsın mı (kolon durur, değer gelmez — elle doldurma).
  const blankWidths = cfg.blankWidths === true;
  const lang =
    cfg.language === "en" || (cfg.language === "auto" && h?.destination === "EXPORT")
      ? "en"
      : "tr";
  const L = LABELS[lang];

  const title = (cfg.titleOverride?.trim() || L.title).toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : [...L.sigDefaults];
  const products = doc.products ?? [];
  const sacks = doc.sacks ?? [];
  const cekiRows = doc.cekiRows ?? [];

  // Antet (gönderen) satırları — sadece dolu olanlar.
  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = meta.draft
    ? `<div class="wm wm-draft">${L.wmDraft}</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">${L.wmVoid}</div>`
      : meta.status === "SUPERSEDED"
        ? `<div class="wm wm-old">${L.wmOld}</div>`
        : "";

  // İhracat Kodu — TEK satır: şube kodu doluysa onu, yoksa müşteri ihracat kodunu
  // bas (branchCode ?? customerExportCode). "exportCode" section toggle'ıyla açılıp
  // kapanabilir (varsayılan açık); ikisi de boşsa satır zaten basılmaz.
  // Alan aç/kapa toggle'ları (hepsi varsayılan AÇIK — kapanmadıkça mevcut davranış).
  const showDocNo = sectionOn(cfg.sections, "docNo");
  const showDate = sectionOn(cfg.sections, "date");
  const showExportCode = sectionOn(cfg.sections, "exportCode");
  const showTaxNo = sectionOn(cfg.sections, "taxNo");
  const showBranchName = sectionOn(cfg.sections, "branchName");
  const showCustomerCode = sectionOn(cfg.sections, "customerCode");
  const showDirection = sectionOn(cfg.sections, "direction");
  const showProcedure = sectionOn(cfg.sections, "procedureCode");
  const showOrders = sectionOn(cfg.sections, "orders");
  const shipCode =
    h.exportCode !== undefined ? h.exportCode : pickExportCode({ branchCode: h.branchCode, customerExportCode: h.customerExportCode });
  const customerSub = [
    showTaxNo && h.customerTaxNumber ? `${L.taxNo}: ${esc(h.customerTaxNumber)}` : "",
    showBranchName && h.branchName ? `${L.branch}: ${esc(h.branchName)}` : "",
    showExportCode && shipCode ? `${L.exportCode}: ${esc(shipCode)}` : "",
    showCustomerCode && h.customerCode ? `${L.code}: ${esc(h.customerCode)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const yon = h.destination === "EXPORT" ? L.export : L.domestic;
  const headRight = [
    showDocNo ? `<div class="ln">${L.docNo}: <b>${esc(h.shipmentNo)}</b></div>` : "",
    showDate ? `<div class="ln">${L.date}: <b>${esc(fmtDate(h.date))}</b></div>` : "",
    showDirection ? `<div class="ln">${L.direction}: <b>${esc(yon)}</b></div>` : "",
    showProcedure && h.procedureCode ? `<div class="ln">${L.customsNo}: <b>${esc(h.procedureCode)}</b></div>` : "",
    showOrders && h.orderNos ? `<div class="ln sub">${L.orders}: ${esc(h.orderNos)}</div>` : "",
    // ÇUVAL ADEDİ — yalnız operatör BEYAN ETTİYSE basılır.
    //
    // ⚠️ Beyan yokken tek bayt bile eklenmez: bugüne kadar basılmış her irsaliye
    // bayt-bayt aynı kalmalı (özellik bir bayrağın arkasında ve varsayılan
    // KAPALI). Bu yüzden `sackCount` tek başına burada GÖSTERİLMEZ.
    //
    // Beyan varsa İKİ rakam birlikte çıkar: fiziksel adet büyük, sistemin
    // saydığı kayıt adedi parantezde. Biri diğerinin yerine geçmez — sahada
    // 10 çuval tek çuval kaydına yazıldığı için fark meşrudur ve fark bilgidir.
    t.manualSackCount != null
      ? `<div class="ln">${L.sackTotal}: <b>${t.manualSackCount}</b> <span class="sub">(${t.sackCount} ${L.sackSystem})</span></div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const vehicleBits = sectionOn(cfg.sections, "vehicleInfo")
    ? [
        h.plateNumber ? `${L.plate}: <b>${esc(h.plateNumber)}</b>` : "",
        h.driverName ? `${L.driver}: <b>${esc(h.driverName)}</b>` : "",
        h.carrier ? `${L.carrier}: <b>${esc(h.carrier)}</b>` : "",
      ].filter(Boolean)
    : [];
  const vehicleRow = vehicleBits.length
    ? `<div class="meta-row">${vehicleBits.join(" &nbsp;·&nbsp; ")}</div>`
    : "";

  // Sayfa ayrımı: BASILAN listelerin ilki hariç hepsi yeni sayfadan başlar.
  // Sayaç yalnız gerçekten render edilen bölümde artar (kapalı bölüm sayfa
  // açmaz) — üç bölüm kaynak sırasıyla değerlendirildiği için sıra garantili.
  const splitPages = meta.mergeSections !== true;

  // ── KİMLİK ŞERİDİ (`sections.listHeader`, 2026-09-10) ─────────────────────
  // OPT-IN: `sectionOn` blocklist'i (anahtar yoksa AÇIK) burada YANLIŞ olurdu —
  // bugüne kadar donmuş her irsaliyenin yeniden baskısı sormadan değişirdi.
  // Bu yüzden açık `=== true`.
  //
  // Şerit İLK basılan listeye KONMAZ: o listenin sayfasında zaten tam antet var
  // ve aynı bilgiyi iki kez basmak sahanın istemediği tekrarı üretirdi. Sonraki
  // listeler kendi sayfalarında antetsiz kaldıkları için şeridi alırlar.
  //
  // `splitPages` koşulu da load-bearing: ?merge=1 ile listeler tek sayfada
  // aktığında hiçbiri antetten kopmuyor, şerit yalnız gürültü olurdu.
  const showListHeader = cfg.sections?.listHeader === true;
  const identityRow = {
    left: [
      `${L.identTo}: <b>${esc(h.customerName)}</b>`,
      showDocNo ? `${L.docNo}: <b>${esc(h.shipmentNo)}</b>` : "",
    ]
      .filter(Boolean)
      .join(" &nbsp;·&nbsp; "),
    right: showDate ? esc(fmtDate(h.date)) : "",
  };

  let renderedSections = 0;
  /** Bir liste tablosunun sayfa/şerit ayarları — `...secOpts()` ile yayılır. */
  const secOpts = (): { className: string; identityRow?: { left: string; right: string } } => {
    const first = renderedSections === 0;
    renderedSections++;
    return {
      className: splitPages && !first ? "sec pgb" : "sec",
      ...(showListHeader && splitPages && !first ? { identityRow } : {}),
    };
  };

  // ── ÜRÜN ADI REJİMİ (`shipping.docItemNameMode`, 2026-09-04) ───────────────
  // Varsayılan `bizdeki` → aşağıdaki üç dalın hiçbiri bugünkü çıktıya dokunmaz
  // (kolon kümesi ve etiketleri birebir eski hâlinde kalır).
  //
  // ⚠️ `musterideki` FAIL-OPEN: karşılığı olmayan üründe BİZİM adımız basılır.
  // Boş ürün adı taşıyan bir irsaliye hukuken sakattır; "ayar açık ama alias yok"
  // diye hücreyi boş bırakmak sahayı kâğıtsız bırakmaktan beterdi.
  //
  // ⚠️ Kolon ANAHTARLARI ayrı (`name` ↔ `customerName`): tek anahtarla iki farklı
  // içerik basılsaydı Belge Kişiselleştirme'de "Stok adı"nı gizleyen fabrika,
  // ayarı değiştirdiği an müşteri adını da gizlemiş olurdu.
  // ⚠️ KARAR BURADA VERİLMEZ — `resolveDocNameMode` tek karar yeridir (2026-09-10).
  // Muhasebe fişinin Excel'i AYNI helper'ı kullanır; rejim burada inline
  // hesaplandığı sürece iki yüzey sessizce ayrışıyordu (sahada ayrıştı da:
  // aynı sevkiyatın PDF'i müşteri adını, Excel'i bizim adımızı bastı).
  //
  // ÇEKİ BÖLÜMÜ AYRI REJİM (2026-09-06). Çeki listesi tek başına da basılabiliyor
  // (`DispatchPrintOptions`) ve ambar elemanının kontrol listesi olarak kullanılıyor;
  // orada "hem bizdeki hem müşterideki ad" anlamlı, müşteriye giden ÜRÜN LİSTESİNDE
  // değil. `devral` (varsayılan) → genel rejim; bayrak yazılmadıkça TEK BAYT değişmez.
  const nameMode = resolveDocNameMode(meta);
  const showOurName = nameMode.showOurName;
  const showCustName = nameMode.showCustomerName;
  const cekiShowOurName = nameMode.cekiShowOurName;
  const cekiShowCustName = nameMode.cekiShowCustomerName;
  // ÜRÜN LİSTESİNDE MÜŞTERİ RENGİ AYRI SÜTUN MU (`shipping.docProductColorSplit`).
  // Kapalı (varsayılan) = bugünkü birleşik dize; ölçüldü: sevk edilen 1.778 topun
  // 690'ında (%39) müşterinin renk karşılığı yok ve BİZİM renk adımız müşteri kumaş
  // adının yanına yapışıyor — `belge-etiket.md`'nin "yarı çevrilmiş ad basılmasın"
  // kuralının fiilî ihlali. Açıkken renk kendi sütununa çıkar ve hangi yarının kimin
  // olduğu görünür. Bayrak kullanıcı kararıyla eklendi (2026-09-06).
  const colorSplit = nameMode.productColorSplit;
  /** Müşteri adı yoksa bizimkine düş — tek kaynak (üç hücre de bunu çağırır). */
  const custOr = customerNameOr;

  // 1) ÜRÜN LİSTESİ — kolonlar cfg.columns.urun ile aç/kapa + sıralanır.
  const urunSection = listSectionOn(cfg, meta, "urun")
    ? buildDocTable<ShipmentDocProduct>({
        ...secOpts(),
        caption: L.urunCaption,
        colCfg: cfg.columns?.urun,
        footLabel: L.toplam,
        rows: products,
        cols: [
          ...(showOurName
            ? [{ key: "name", label: L.stokAdi, align: "l" as const, cell: (p: ShipmentDocProduct) => esc(p.name) }]
            : []),
          ...(showCustName
            ? colorSplit
              ? [
                  // AYRIK KİPTE iki kolon: yarı çevrilmiş ad basılmaz, okuyucu hangi
                  // yarının kimin olduğunu görür (çeki listesindeki düzenin aynısı).
                  { key: "customerName", label: L.musteriStokAdi, align: "l" as const, cell: (p: ShipmentDocProduct) => esc(custOr(p.customerItemOnly ?? p.customerName, p.name)) },
                  { key: "customerColor", label: L.musteriVaryant, align: "l" as const, cell: (p: ShipmentDocProduct) => esc(p.customerColorOnly ?? "") },
                ]
              : [{ key: "customerName", label: L.musteriStokAdi, align: "l" as const, cell: (p: ShipmentDocProduct) => esc(custOr(p.customerName, p.name)) }]
            : []),
          { key: "rollCount", label: L.topAdedi, align: "r", cell: (p) => esc(fmtCount(p.rollCount)), foot: esc(fmtCount(t.totalRolls)) },
          { key: "totalMeters", label: L.toplamMetre, align: "r", cell: (p) => esc(fmtQty(p.totalMeters)), foot: esc(fmtQty(t.totalMeters)) },
        ],
      })
    : "";

  // 2) ÇUVAL LİSTESİ
  //
  // "AÇIKLAMA" (çuval yorumu) kolonu OPT-IN'dir (`defaultHidden`): varsayılan
  // BASILMAZ — iç not müşteriye giden irsaliyeye kazayla sızmasın. İki yolla açılır
  // ve aralarında OR vardır:
  //   (a) kalıcı: Belge Kişiselleştirme → columns.cuval.shown içinde "note"
  //   (b) tek seferlik: ?rowNotes=1 → meta.forceRowNotes (hiçbir yere yazılmaz)
  // OR yalnız BURADA uygulanır (tek yer) — aşağıdaki efektif kolon ayarında.
  //
  // "İZ" (çuval etiketi) kolonu AYNI kalıptır ve AYNI gerekçeyle opt-in'dir; ama
  // yorumdan AYRI anahtar taşır ("tag") ve AYRI tek-seferlik bayrak okur
  // (?rowTags=1). Tek bayrak/tek anahtar olsaydı "notu bas" diyen operatöre
  // sessizce izler de basılırdı (ve tersi) — ikisi farklı hassasiyette veri.
  const rowNotes = meta.rowNotes ?? {};
  const hasAnyRowNote = sacks.some((s) => !!rowNotes[s.code]);
  const rowTags = meta.rowTags ?? {};
  const hasAnyRowTag = sacks.some((s) => !!rowTags[s.code]);
  // İki tek-seferlik ezme AYNI `shown` allowlist'ine yazar (kolon motorunun tek
  // sözleşmesi o) ama BAĞIMSIZ koşullardan geçer.
  const forcedShown = [
    ...(meta.forceRowNotes && hasAnyRowNote ? ["note"] : []),
    ...(meta.forceRowTags && hasAnyRowTag ? ["tag"] : []),
  ];
  const cuvalColCfg = forcedShown.length
    ? { ...cfg.columns?.cuval, shown: [...(cfg.columns?.cuval?.shown ?? []), ...forcedShown] }
    : cfg.columns?.cuval;

  const cuvalSection = listSectionOn(cfg, meta, "cuval")
    ? buildDocTable<ShipmentDocSack>({
        ...secOpts(),
        caption: L.cuvalCaption,
        colCfg: cuvalColCfg,
        footLabel: L.toplam,
        rows: sacks,
        cols: [
          { key: "code", label: L.ambalajKodu, align: "l", cell: (s) => esc(s.code) },
          ...(meta.sackSeq
            ? [{ key: "seq", label: L.sira, align: "r" as const, cell: (s: ShipmentDocSack) => esc(formatSackSeqLabel(s.seq, sacks.length, meta.sackSeq!)) }]
            : []),
          ...(meta.packingLot
            ? [
                { key: "packageNo", label: L.ambalajNo, align: "r" as const, cell: (s: ShipmentDocSack) => esc(s.packageNo != null ? String(s.packageNo) : "") },
                { key: "packingGroupName", label: L.sevkPartisi, align: "l" as const, cell: (s: ShipmentDocSack) => esc(s.packingGroupName ?? "") },
              ]
            : []),
          { key: "totalMeters", label: L.metreToplami, align: "r", cell: (s) => esc(fmtQty(s.totalMeters)), foot: esc(fmtQty(t.totalMeters)) },
          { key: "totalKg", label: L.kgToplami, align: "r", cell: (s) => esc(fmtQty(s.totalKg)), foot: esc(fmtQty(t.totalKg)) },
          { key: "packageCount", label: L.paketSayisi, align: "r", cell: (s) => esc(fmtCount(s.packageCount)), foot: esc(fmtCount(t.totalRolls)) },
          // Kolon açık AMA hiçbir çuvalda yorum yoksa boş sütun basmayalım:
          // `defaultHidden` + shown zinciri açsa da hasAnyRowNote false ise düşürülür.
          ...(hasAnyRowNote
            ? [
                {
                  key: "note",
                  label: L.aciklama,
                  align: "l" as const,
                  width: "32%",
                  cellClass: "wrap",
                  defaultHidden: true,
                  cell: (s: ShipmentDocSack) => esc(rowNotes[s.code] ?? ""),
                },
              ]
            : []),
          // İZ kolonu — aynı boş-sütun bastırması. ⚠️ `defaultHidden: true`
          // LOAD-BEARING: naif (blocklist) yazımda kolon VARSAYILAN GÖRÜNÜR doğar
          // ve iç iz müşteriye giden irsaliyeye sızar.
          ...(hasAnyRowTag
            ? [
                {
                  key: "tag",
                  label: L.iz,
                  align: "l" as const,
                  width: "22%",
                  cellClass: "wrap",
                  defaultHidden: true,
                  cell: (s: ShipmentDocSack) => esc(rowTags[s.code] ?? ""),
                },
              ]
            : []),
        ],
      })
    : "";

  // 3) ÇEKİ LİSTESİ
  const cekiSection = listSectionOn(cfg, meta, "ceki")
    ? buildDocTable<ShipmentDocCeki>({
        ...secOpts(),
        caption: L.cekiCaption,
        colCfg: cfg.columns?.ceki,
        footLabel: L.toplam,
        rows: cekiRows,
        cols: [
          { key: "sackCode", label: L.cuvalNo, align: "l", cell: (c) => esc(c.sackCode) },
          ...(meta.sackSeq
            ? [{ key: "seq", label: L.sira, align: "r" as const, cell: (c: ShipmentDocCeki) => esc(formatSackSeqLabel(c.seq, sacks.length, meta.sackSeq!)) }]
            : []),
          ...(meta.packingLot
            ? [
                { key: "packageNo", label: L.ambalajNo, align: "r" as const, cell: (c: ShipmentDocCeki) => esc(c.packageNo != null ? String(c.packageNo) : "") },
                { key: "packingGroupName", label: L.sevkPartisi, align: "l" as const, cell: (c: ShipmentDocCeki) => esc(c.packingGroupName ?? "") },
              ]
            : []),
          { key: "barcode", label: L.barkodNo, align: "l", cell: (c) => esc(c.barcode ?? "—") },
          // Varsayılan GÖRÜNÜR (2026-08-05 ürün kararı — lot no müşterinin de
          // sorduğu bilgi). Normal blocklist: `columns.ceki.hidden` ile kapatılır.
          { key: "batchNumber", label: L.parti, align: "l", cell: (c) => esc(c.batchNumber ?? "—") },
          ...(cekiShowOurName
            ? [
                { key: "desen", label: L.desen, align: "l" as const, cell: (c: ShipmentDocCeki) => esc(c.desen) },
                { key: "varyant", label: L.varyant, align: "l" as const, cell: (c: ShipmentDocCeki) => esc(c.varyant) },
              ]
            : []),
          ...(cekiShowCustName
            ? [
                { key: "customerDesen", label: L.musteriDesen, align: "l" as const, cell: (c: ShipmentDocCeki) => esc(custOr(c.customerDesen, c.desen)) },
                { key: "customerVaryant", label: L.musteriVaryant, align: "l" as const, cell: (c: ShipmentDocCeki) => esc(custOr(c.customerVaryant, c.varyant)) },
              ]
            : []),
          { key: "width", label: L.en, align: "c", cell: (c) => (blankWidths ? "" : c.width != null ? `${esc(Math.round(c.width))} cm` : "—") },
          { key: "meters", label: L.metre, align: "r", cell: (c) => esc(fmtQty(c.meters)), foot: esc(fmtQty(t.totalMeters)) },
          { key: "kg", label: L.kg, align: "r", cell: (c) => (c.kg > 0 ? esc(fmtQty(c.kg)) : ""), foot: esc(fmtQty(t.totalKg)) },
        ],
      })
    : "";

  const noteBlock = cfg.footerNote
    ? `<div class="note">${esc(cfg.footerNote)}</div>`
    : "";
  // Alt not konumu (şablon ayarı): "top" → tablolardan ÖNCE, aksi halde (default)
  // tablolardan sonra imza öncesinde. Tek seferlik baskı notu her zaman altta kalır.
  const noteAtTop = cfg.footerNotePlacement === "top";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map(
          (l) =>
            `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`,
        )
        .join("")}</div>`
    : "";

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, {
    printedAt: L.printedAt,
    printedBy: L.printedBy,
  });

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  ${docChromeCss(d)}
  /* ── Sevk irsaliyesine ÖZEL — ortak chrome'dan SONRA basılır ki kazansın ──
     Ölçüler A4 sayısı olarak yazılır, profil oranını scaleW/scaleF uygular;
     böylece A4 çıktısı birebir korunur, A5'te birlikte küçülürler.
     (Bu şablonun içinde BACKTICK kullanma — literal'i ortadan böler.) */
  .hr .ln.sub { font-size: ${d.sub}px; color: #444; white-space: normal; max-width: ${scaleW(d, 240)}px; }
  .sec { margin-bottom: ${scaleW(d, 12)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px;
                    font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  /* :not(.caption) — başlık hücresi bilerek DAHA BÜYÜK kalır; ortak kuraldan
     daha özgül olduğu için punto/arka planı o kazanır. */
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; }
  /* Kimlik şeridi — kolon başlığı DEĞİL, o yüzden zemini beyaz ve yazısı düz
     (ortak kural th'leri gri + BÜYÜK HARF yapıyor). Seçici eşit özgüllükte ve
     SONRA geldiği için kazanır; sırası bozulursa şerit kolon başlığına benzer. */
  .sec thead th.ident { background: #fff; font-weight: 400; font-size: ${d.sub}px;
                        text-transform: none; letter-spacing: 0; white-space: nowrap; }
  .sec thead th.ident b { font-weight: 700; }
  /* Serbest metin hücresi (çuval yorumu) — uzun/çok satırlı not tablo düzenini
     bozmasın: satır sonları korunur, uzun kelime kırılır. */
  .sec td.wrap { white-space: pre-wrap; word-break: break-word; font-size: ${scaleF(d, 10)}px; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  /* Sayfa ayrımı — .pgb taşıyan liste kendi sayfasından başlar. İlk liste bu
     sınıfı ALMAZ (belge boş bir sayfayla açılmasın). ?merge=1 ile sınıf hiç
     basılmaz, listeler eskisi gibi akar. */
  .pgb { break-before: page; page-break-before: always; }
  /* Önizleme iframe'i tek uzun akış çizer; @page/break yalnız BASKI'da görünür.
     Kural görünmezse kullanıcı "yine tek sayfa" sanır — bu yüzden EKRANDA sayfa
     sınırını çiziyoruz. Baskıda bu blok yok sayılır (media=screen). */
  @media screen {
    table.pgb { margin-top: 26px; border-top: 3px double #b6bcc6; }
    table.pgb thead th.caption::before {
      content: "— yeni sayfa —"; display: block; margin-bottom: 5px;
      font-size: 9px; font-weight: 400; letter-spacing: .08em; color: #94a3b8;
    }
  }
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(cfg.fields, DOC_FIELD_CATALOGS["shipmentDispatch"], d)}
`,
    style,
  );

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}
        <div class="sayin">${L.to}: <b>${esc(h.customerName)}</b></div>
        ${customerSub ? `<div class="sub">${customerSub}</div>` : ""}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        ${headRight}
      </div>
    </header>

    ${vehicleRow}
    ${blocksTop}
    ${noteAtTop ? noteBlock + printNote : ""}
    ${urunSection}
    ${cuvalSection}
    ${cekiSection}
    ${noteAtTop ? "" : noteBlock + printNote}
    ${blocksBottom}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
