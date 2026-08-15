// =============================================================================
// Fason sevk çeki listesi — "KUMAŞ İRSALİYESİ" HTML renderer (TEK KAYNAK)
// =============================================================================
// Tüm cihazlar (mobil expo-print + Electron printHtmlString) bu backend HTML'ini
// basar → format her yerde birebir aynı. Donmuş PrintedDocument snapshot'ından
// (envelope + doc) üretilir; fiziksel KUMAŞ İRSALİYESİ formuna uyar:
//   üst: SAYIN (fason firma) + gönderen antet + İrsaliye No + Tarih [+ Parti No]
//   orta: Top/Metre/Cm gridi — sayfa başına top adedi AYARLANIR (grup × satır;
//         varsayılan 5 × 10 = 50; fiziksel form 5 × 20 = 100 idi)
//   alt:  CİNSİ | TOP | METRE | FİYATI | TUTARI + TOPLAM  (fason'da fiyat YOK → boş)
//
// ── 2026-08-05: KİŞİSELLEŞTİRME KATMANI ─────────────────────────────────────
// Sahadan gelen istek "bu belgede her şey ayrı ayrı ayarlanabilsin"di. Üç ayrı
// katman eklendi; üçü de `DocumentConfig` üzerinden gelir, yani freeze anında
// snapshot'a DONAR (eski belge her zaman kendi görünümüyle basılır):
//   1. YOĞUNLUK PROFİLİ (`fason-ceki.density.ts`) — A4/A5 taban ölçüleri. A5'te
//      belge tek sayfaya SIĞMIYORDU (ölçüldü: %105, imza bloğu 2. sayfaya
//      düşüyordu); profil onu ~%84'e çeker.
//   2. ALAN BAZLI PUNTO/KALINLIK (`fason-ceki.fields.ts`) — "metre ve cm ayrı
//      ayarlanamıyor" isteğinin karşılığı. Override yoksa tek bayt CSS basılmaz.
//   3. YERLEŞİM ANAHTARLARI — `sections.fabricHeader` (kumaş+renk üst bloğu),
//      `sections.accountNo` (hesap no satırı), `placements.batchInfo` (parti no
//      sol/sağ), `gridGroups` (satır başına grup sayısı).
//
// ── 2026-08-15: TALİMAT KUTUSU (`.cmd`) ─────────────────────────────────────
// Saha: "boyanacak renk daha belirgin ve birkaç yerde yazsın … 'BOYANACAK RENK :
// MAVİ' bunun gibi net" + "o özellikler de 'YAPILACAK İŞLEMLER : APRE' örnekteki
// gibi". Başlık bandının altına, grid'in ÜSTÜNE, 2px çerçeveli tek kutu; içinde
// hizalı-iki-nokta düzeninde en fazla iki satır. TAMAMEN yeni ve OPSİYONEL bir
// payload nesnesine (`doc.commands`) bağlıdır → 2026-08-15 öncesi 113 donmuş
// çekinin çıktısı BAYT-BAYT korunur (koruma config'ten değil VERİDEN gelir).
// Yeni bölüm anahtarları: `sections.dyeColorLine`, `sections.instructionWarning`
// (ikisi de blocklist = varsayılan AÇIK; işlem satırı mevcut `productionProps`e
// bağlıdır). Alan bazlı punto: `fields.cmdLabel` / `fields.cmdValue`.
// =============================================================================

import type { PrintedDocStatus } from "@prisma/client";
import type { PrintedDocSnapshot } from "../printed-document.service";
import {
  resolveDocStyle,
  docPageCss,
  docTableCss,
  scaleDocCss,
  docLogoHtml,
  DOC_LOGO_CSS,
  DOC_PAGINATION_CSS,
  DOC_STAMPS_CSS,
  docCopyBadge,
  docBlocksHtml,
  docBlankGridCss,
  docBlankGridHtml,
  docPrintNoteHtml,
  docStampsBar,
} from "./doc-style";
import {
  FASON_DENSITY,
  gridColWidths,
  resolveFasonPageSize,
  resolveGridGroups,
  resolveGridRows,
  type GridGroups,
} from "./fason-ceki.density";
import { fasonFieldCss } from "./fason-ceki.fields";
import { buildDocTable } from "./doc-table";

interface FasonCekiRoll {
  sequence: number;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  qualityGrade: string;
  /** ⚠️ 2026-08-06'dan beri BASILMAZ. Payload'da duruyor (donmuş belgelerin şekli
   *  değişmesin + izlenebilirlik), ama belgedeki EN artık İŞ EMRİNDEN gelir —
   *  bkz. `renderFasonCekiHtml` içindeki `docWidth`. Buraya geri bağlama. */
  width: number | null;
}

interface FasonCekiDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  /** `width` = belgedeki TEK "EN" değerinin kaynağı. ⚠️ 2026-08-05 öncesi donmuş
   *  snapshot'larda YOKTUR → o belgeler basılırken EN yine boş çıkar (donmuş belge
   *  kuralı; geriye dönük doldurma yapılmaz, `reissue` tazeler). */
  workOrder: { id: string; workOrderNumber: string; type: string; width?: number | null };
  subcontractor: { id: string; name: string; code: string | null };
  /** Boyamanın hedef rengi — sevkte toplar ham gider, çeki "şu renge boya" der. */
  requestedColor?: string | null;
  /** Fason talimatı (instruction) — fasoncuya "ne yapılacak" notu. Sevkte donar;
   *  `documents.config sections.dyehouseNote` ile aç/kapa (default açık). */
  instruction?: string | null;
  /** WO hedef üretim özellikleri (FabricProperty adları) — "bu apreleri uygula".
   *  Eski donmuş snapshot'larda yok → blok basılmaz. `sections.productionProps` ile aç/kapa.
   *  ⚠️ 2026-08-15'ten sonra doğan belgelerde bu alanın YERİNE `commands.works`
   *  basılır (aşağı). Alan payload'da DURUR ve ESKİ donmuş belgeleri beslemeye
   *  devam eder — o 94 belgenin çıktısı bayt-bayt korunur. */
  targetProperties?: string[];
  /** BOYAHANEYE GİDEN İKİ TALİMAT — saha isteği (2026-08-15): "boyanacak renk daha
   *  belirgin ve birkaç yerde yazsın … 'BOYANACAK RENK : MAVİ' bunun gibi net
   *  şekilde" + "o özellikler de 'YAPILACAK İŞLEMLER : APRE' örnekteki gibi".
   *
   *  ⚠️ ALANIN VARLIĞI SÜRÜM İŞARETİDİR ve donmuş belge korumasının TAMAMI budur:
   *  2026-08-15 öncesi 113 snapshot'ın HİÇBİRİNDE yoktur → talimat kutusu ve
   *  `.cmd` CSS'i TEK BAYT basılmaz, eski "İSTENEN ÖZELLİKLER" kutusu aynen çıkar.
   *  Koruma CONFIG'ten GELMEZ: `sections` bir blocklist'tir ("anahtar yoksa AÇIK")
   *  ve `docConfigOverride` da donmuştur; ayrıca `?currentTemplate=1` yalnız zarfı
   *  tazeler, `snapshot.doc` donuk kalır — yani veri kapılaması o yolda da yaşar,
   *  config kapılaması yaşamazdı. Alanı mevcut `requestedColor`a BAĞLAMA.
   *
   *  ⚠️ `color` YALNIZ `WorkOrder.targetColor.name`'dir — topların MEVCUT rengine
   *  DÜŞMEZ. `requestedColor` (aşağıdaki `renk` değişkeni) bilinçli olarak
   *  "hedef yoksa topun rengi" semantiği taşır; o CİNSİ hücresinde ve
   *  `fabricHeader`da MEŞRUDUR (envanter beyanı), ama "BOYANACAK RENK" etiketinin
   *  altında YALAN olur: hedefi olmayan ham topa, kendi mevcut rengi boya
   *  talimatı olarak giderdi. İki ayrı alan, etiketi yapısal olarak dürüst tutar.
   *  ⚠️ GARANTİNİN SINIRI: engellenen şey FALLBACK'tir. Fabrika `targetColor`ı
   *  bilerek EKRU'ya SET edebilir (ölçüm: 98 sevkin 16'sı) ve o zaman kâğıtta
   *  "BOYANACAK RENK : EKRU" yazar — bu bir ÜRÜN kararıdır, `colors` tablosunda
   *  "ham/doğal renk" diye bir işaret yoktur ve kod bunu ayırt EDEMEZ.
   *  ⚠️ `color` AYRICA ADIMA SÜZÜLÜR (`resolveStepDyeColor`): sevkin gittiği
   *  adımın kategorisi renk vermiyorsa (`appliesColor=false`, örn. Zımpara)
   *  alan `null` gelir — zımparacıya "BOYANACAK RENK" talimatı gitmez.
   *
   *  ⚠️ İKİ SKALER DEĞİL TEK NESNE: %11,7 vaka (94 sevkin 11'i) ne renk ne işlem
   *  taşıyor ve o belgelerde "TALİMAT: GİRİLMEMİŞ" uyarısı basılır. İki opsiyonel
   *  skaler kullanılsaydı "eski snapshot" ile "yeni belge, gerçekten boş" AYIRT
   *  EDİLEMEZDİ ve uyarı ya 113 eski belgeye de basılırdı ya hiç basılamazdı. */
  commands?: {
    color: string | null;
    works: Array<{ name: string; value?: string | null }>;
  };
  /** Sevkin parti no'su (K10: bir sevk = bir parti). Boyahane parti bazında boyar ve
   *  dönüş parti bazında eşleşir — fason belgesinin kimlik alanıdır.
   *  ⚠️ OPSİYONEL: alan 2026-08-05'ten önce donmuş snapshot'larda YOKTUR → o belgeler
   *  basılırken satır çıkmaz. Geriye dönük doldurma YAPILMAZ (donmuş belge kuralı).
   *  `sections.batchInfo` ile aç/kapa (varsayılan AÇIK — fasoncunun ihtiyacı),
   *  `placements.batchInfo` ile sol/sağ. */
  batchNumber?: string | null;
  step: { stepSequence: number; station: { name: string; code: string } };
  rolls: FasonCekiRoll[];
  totals: { rollCount: number; totalQty: number; totalWeight: number };
}

interface RenderMeta {
  status?: PrintedDocStatus;
  voidReason?: string | null;
  /** Donmamış canlı önizleme (sevk öncesi) → TASLAK filigranı. */
  draft?: boolean;
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
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 1 ondalık; tam sayıysa ondalıksız (115.0→"115", 100.5→"100.5"). Boş/0 → "". */
function fmtMetre(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function fmtCm(n: number | null | undefined): string {
  if (n == null) return "";
  return String(Math.round(n));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Boş/yinelenen değerleri atıp sırayı koruyan liste (kumaş adları, renkler). */
function uniqNonEmpty(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Tek bir grid sayfası (rolls[startIdx .. startIdx+slots-1]).
 *
 *  ⚠️ "Cm" SÜTUNU HER ZAMAN BOŞ BASILIR — top başına EN **değeri** yazmaz
 *  (2026-08-06 kullanıcı kararı: "sayfadaki bütün kumaşlara en değeri vermeyi
 *  kaldır, bir tane en değeri koy"). Sütun bir VERİ sütunu değil, fiziksel
 *  KUMAŞ İRSALİYESİ formundaki gibi **elle doldurulan kutu**dur: fason firma
 *  kendi ölçüp yazar. Belgenin bildiği tek EN alt toplam tablosundadır ve iş
 *  emrinden gelir.
 *
 *  Buraya `roll.width` (ya da iş emri eni) bağlamak iki hatadan birini yapar:
 *  topun eni sahada NULL olduğu için sütun yine boş kalır, ya da tek bir nominal
 *  ölçü 40 satıra damgalanıp ölçülmemiş rakam ölçülmüş gibi görünür.
 *
 *  `showWidth`: sütun basılsın mı (`sections.gridWidth`, varsayılan AÇIK). */
function renderGridPage(
  rolls: FasonCekiRoll[],
  startIdx: number,
  showWidth: boolean,
  groups: GridGroups,
  rows: number,
): string {
  const head =
    "<tr>" +
    Array.from({ length: groups })
      .map(
        () =>
          `<th class="c-top">Top</th><th class="c-met">Metre</th>${showWidth ? `<th class="c-cm">Cm</th>` : ""}`,
      )
      .join("") +
    "</tr>";

  let body = "";
  for (let r = 0; r < rows; r++) {
    body += "<tr>";
    for (let g = 0; g < groups; g++) {
      const topNo = startIdx + g * rows + r + 1; // 1-bazlı sıra no
      const roll = rolls[topNo - 1];
      body +=
        `<td class="c-top">${topNo}</td>` +
        `<td class="c-met">${roll ? esc(fmtMetre(roll.dispatchedQty)) : ""}</td>` +
        (showWidth ? `<td class="c-cm"></td>` : "");
    }
    body += "</tr>";
  }
  return `<table class="grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderFasonCekiHtml(
  snapshot: PrintedDocSnapshot,
  meta: RenderMeta = {},
): string {
  const doc = snapshot.doc as unknown as FasonCekiDoc;
  const cfg = snapshot.docConfigOverride ?? {};
  // Yoğunluk profili sayfa boyutundan çözülür; belgenin varsayılan kenar boşluğu
  // da oradan gelir (kullanıcı `style.margins` ile kenar kenar ezebilir).
  const pageSize = resolveFasonPageSize(cfg.style?.pageSize);
  const d = FASON_DENSITY[pageSize];
  // Yoğunluk/çizgi stili yalnız alt toplam tablosuna — 100 hücreli grid fiziksel
  // KUMAŞ İRSALİYESİ formunun birebir kopyası, ona dokunulmaz.
  const style = resolveDocStyle(cfg.style, { marginMm: d.marginMm });
  const logo = docLogoHtml(meta.logoDataUrl, cfg);
  const company = snapshot.company;
  const lh = company?.letterhead ?? { addressLine: "", phone: "", taxInfo: "" };

  const title = (cfg.titleOverride?.trim() || "KUMAŞ İRSALİYESİ").toUpperCase();
  const showLetterhead = cfg.showLetterhead !== false;
  const showSignatures = cfg.showSignatures !== false;
  const sigLabels =
    cfg.signatureLabels && cfg.signatureLabels.length
      ? cfg.signatureLabels
      : ["Teslim Eden", "Teslim Alan"];

  const cins = doc.rolls[0]?.itemName ?? "";
  // Renk bilgisinin ENVANTER yüzeyleri tek anahtarla yönetilir
  // (`sections.requestedColor`): hem alt tablodaki CİNSİ hücresinin renk eki hem
  // üst bloğun RENK parçası ona bakar.
  // ⚠️ Bu anahtar 2026-08-05'e kadar panelde VARDI ama renderer onu HİÇ OKUMUYORDU
  // — kullanıcı kapatıyor, hiçbir şey olmuyordu ("ölü toggle").
  // ⚠️ KAPSAM 2026-08-15'te DARALDI: talimat kutusundaki "BOYANACAK RENK" satırı
  // BU ANAHTARA BAĞLI DEĞİLDİR, kendi anahtarını taşır (`sections.dyeColorLine`).
  // Bilinçli: ikisi farklı şeyler söyler — burası "sevkte ne var" (envanter
  // beyanı), orası "ne yapılacak" (talimat) ve fabrika birini basıp diğerini
  // kapatmak isteyebilir. Panel etiketleri de kapsamı ayrı ayrı yazar.
  const showColor = cfg.sections?.requestedColor !== false;
  // İstenen (hedef) renk öncelikli; yoksa topların mevcut rengi (boyanmış dönüşte).
  const renk = showColor ? (doc.requestedColor ?? doc.rolls[0]?.colorName ?? "") : "";

  // ── BELGENİN TEK "EN" DEĞERİ ───────────────────────────────────────────────
  // Kaynak İŞ EMRİDİR, topların eni DEĞİL (2026-08-06 kullanıcı kararı). Eskiden
  // "tüm topların eni aynıysa o değeri yaz" kuralı vardı ve sahada pratikte HİÇ
  // yazmıyordu: `Roll.width` KK1'de opsiyonel ve doldurulmuyor (ölçüm: 8 fason
  // sevkinin 7'sinde giden topların hepsi NULL), iş emrinin eni ise hep dolu.
  // ⚠️ Alan taşımayan ESKİ donmuş snapshot'ta `width` undefined → EN yine boş
  // basılır ve o belgeler bugünküyle birebir aynı kalır (donmuş belge kuralı).
  // blankWidths → "elle yazılacak": değer BİLİNSE DE basılmaz.
  const blankWidths = cfg.blankWidths === true;
  const woWidth = doc.workOrder.width;
  const docWidth = blankWidths || woWidth == null ? null : fmtCm(woWidth);

  // Grid'in elle doldurulan "Cm" kutusu — aç/kapa (varsayılan AÇIK, `sections`
  // blocklist'i). ⚠️ Bu ayar belgenin BİLDİĞİ EN'i (alt tablo) etkilemez; o
  // ayrı bir kolondur ve `columns.totals` ile yönetilir. İkisini tek anahtara
  // bağlamak, "kutuları kaldır" isteyen kullanıcının belgedeki rakamı da
  // sessizce silmesi olurdu.
  const showGridWidth = cfg.sections?.gridWidth !== false;

  // Grid grup sayısı (varsayılan 5 = fiziksel form). 3/4, A5'te punto büyütmek
  // isteyen kullanıcıya yer açar — 15 kolon 132mm'ye sığmıyor.
  const groups = resolveGridGroups(cfg.gridGroups);
  const rows = resolveGridRows(cfg.gridRows);
  const slotsPerPage = groups * rows;
  const col = gridColWidths(groups, showGridWidth);

  // Çok sayfa: slotsPerPage'lik gridler (çoğu sevk tek sayfa).
  const pageCount = Math.max(1, Math.ceil(doc.rolls.length / slotsPerPage));
  let grids = "";
  for (let p = 0; p < pageCount; p++) {
    grids += renderGridPage(doc.rolls, p * slotsPerPage, showGridWidth, groups, rows);
  }

  // Antet (gönderen) satırları — sadece dolu olanlar.
  const lhLines = showLetterhead
    ? [lh.addressLine, lh.phone, lh.taxInfo ? `V.D./No: ${lh.taxInfo}` : "", ...(lh.extraLines ?? [])]
        .filter((s) => s && s.trim())
        .map((s) => `<div class="lh-line">${esc(s)}</div>`)
        .join("")
    : "";

  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">İPTAL</div>`
      : meta.status === "SUPERSEDED"
        ? `<div class="wm wm-old">ESKİ KOPYA</div>`
        : "";

  // Araç satırı (Plaka + Şoför) — sections.vehicleInfo !== false ise (default açık).
  const showVehicleInfo = cfg.sections?.vehicleInfo !== false;
  const vehicleRow =
    showVehicleInfo && (doc.plateNumber || doc.driverName)
      ? `<div class="meta-row">${doc.plateNumber ? `Plaka: <b>${esc(doc.plateNumber)}</b>` : ""}${
          doc.plateNumber && doc.driverName ? " &nbsp;·&nbsp; " : ""
        }${doc.driverName ? `Şoför: <b>${esc(doc.driverName)}</b>` : ""}</div>`
      : "";

  // Parti no satırı — sections.batchInfo !== false ise (default AÇIK: boyahane parti
  // bazında boyar, dönüş parti bazında eşleşir). Alan taşımayan ESKİ donmuş belgede
  // `doc.batchNumber` undefined → satır hiç doğmaz.
  // ⚠️ SAĞ varyant, "Tarih" satırının SONUNA eklenir (kendi satırında `${...}`
  // bırakmak, blok kapalıyken çıktıya boş satır sokup eski belgelerin parmak izini
  // bozardı). SOL varyant `.hl` bloğunda subLine'ın altına iner (saha isteği:
  // "parti no yu sola alalım — sağ sol seçeneği olsun").
  const showBatchInfo = cfg.sections?.batchInfo !== false;
  const batchOnLeft = cfg.placements?.batchInfo === "left";
  const batchHtml =
    showBatchInfo && doc.batchNumber
      ? `<div class="ln ln-batch">Parti No: <b>${esc(doc.batchNumber)}</b></div>`
      : "";
  const batchRowRight = batchHtml && !batchOnLeft ? `\n        ${batchHtml}` : "";
  const batchRowLeft = batchHtml && batchOnLeft ? `\n        ${batchHtml}` : "";

  // Fason firma satırı (SAYIN) — sections.subcontractorInfo !== false ise.
  // ⚠️ `requestedColor` ile birlikte 2026-08-05'e kadar okunmayan ikinci "ölü
  // toggle" buydu; panel kapatıyor, belge basmaya devam ediyordu.
  const showSubcontractorInfo = cfg.sections?.subcontractorInfo !== false;
  const sayinRow = showSubcontractorInfo
    ? `\n        <div class="sayin">SAYIN: <b>${esc(doc.subcontractor.name)}</b></div>`
    : "";

  // Alt bilgi satırı (İstasyon · İş Emri [· Hesap]) — sections.workOrderInfo !== false ise.
  // ⚠️ HESAP NO artık OPT-IN (`sections.accountNo === true`, varsayılan KAPALI).
  // Saha "hesap no kaldır" dedi. Anahtar taşımayan ESKİ donmuş belgeler de bu
  // satırı artık BASMAZ — bilinçli: resmi bir rakam değil iç bir firma kodudur
  // (`Subcontractor.code`), ve isteğin karşılığı "her yerden kalksın"dı.
  const showWorkOrderInfo = cfg.sections?.workOrderInfo !== false;
  const showAccountNo = cfg.sections?.accountNo === true;
  const subLine = showWorkOrderInfo
    ? `<div class="sub">${esc(doc.step.station.name)} · İş Emri ${esc(doc.workOrder.workOrderNumber)}${
        showAccountNo && doc.subcontractor.code ? ` · Hesap: ${esc(doc.subcontractor.code)}` : ""
      }</div>`
    : "";

  // Kumaş adı + renkler — ÜST blok (saha isteği: "kumaş adı ve renkler yukarda
  // olsun altta da olsun"). OPT-IN (`=== true`): yeni bir blok `sections`
  // blocklist'inde varsayılan AÇIK doğsaydı, sahadaki HER eski çeki yeniden
  // basıldığında sormadan yeni bir satır kazanırdı.
  // Sevkteki TÜM kumaşları ve TÜM renkleri listeler (kullanıcı kararı) — tek
  // kumaş/tek renk varsayımı karışık içerikli sevkte sessizce eksik bilgi verir.
  // Payload DEĞİŞMEDİ: alanlar donmuş snapshot'ta zaten var, eski belge de basar.
  const showFabricHeader = cfg.sections?.fabricHeader === true;
  const fabrics = uniqNonEmpty(doc.rolls.map((r) => r.itemName));
  // EN, alt toplam tablosuyla AYNI TEK DEĞERDİR (`docWidth`). Eskiden burada
  // topların enleri listeleniyordu ("140, 150 cm") — o da kaldırıldı: belgede
  // tek bir en vardır ve iş emrinden gelir. `blankWidths` ikisini birden
  // susturur, yoksa belge bir yerde "boş bırak" derken öbür yerde değeri söylerdi.
  const fabColors = showColor
    ? uniqNonEmpty([doc.requestedColor, ...doc.rolls.map((r) => r.colorName)])
    : [];
  // Satırlar PARTİ NO'NUN ALTINA, onunla AYNI blokta durur (saha isteği) — yani
  // `placements.batchInfo` sol ise bunlar da sola gider. Parti no kapalı olsa
  // bile blok tarafı o ayardan okunur; "altına" demek "aynı sütunda" demektir.
  // ⚠️ Her satır kendi satır başını TAŞIR: kapalıyken çıktıya boş satır sokmasın
  // (A4 parmak izi — `batchRow`'daki aynı disiplin).
  // ⚠️ ETİKETSİZ, TEK SATIR (2026-08-06 kullanıcı kararı: "hepsi yan yana olsun,
  // hiç key-value gibi yapma, direkt yazsın içeriği"). Yani "Cinsi: X / En: Y"
  // değil, doğrudan "X · Y cm · Z". Ayırıcı belgenin geri kalanıyla aynı
  // (`Plaka: … · Şoför: …`). "cm" ETİKET DEĞİL BİRİMDİR — etiketsiz bir sayının
  // ne olduğu okunmaz, o yüzden kalır.
  const fabricBits = [
    fabrics.length ? esc(fabrics.join(", ")) : "",
    docWidth ? `${esc(docWidth)} cm` : "",
    fabColors.length ? esc(fabColors.join(", ")) : "",
  ].filter(Boolean);
  const fabricRows = showFabricHeader && fabricBits.length
    ? `\n        <div class="ln ln-fabric"><b>${fabricBits.join(" &nbsp;·&nbsp; ")}</b></div>`
    : "";
  // Satırlar parti no ile AYNI blokta durur — taraf `placements.batchInfo`'dan
  // okunur, parti no kapalı olsa bile ("altına" = "aynı sütunda").
  const headerFabLeft = batchOnLeft ? fabricRows : "";
  const headerFabRight = batchOnLeft ? "" : fabricRows;

  // Serbest not bloğu (doc.notes + cfg.footerNote) — sections.notes !== false ise.
  const showNotes = cfg.sections?.notes !== false;
  const noteBlock =
    showNotes && (doc.notes || cfg.footerNote)
      ? `<div class="note">${esc(doc.notes || "")}${
          doc.notes && cfg.footerNote ? " — " : ""
        }${esc(cfg.footerNote || "")}</div>`
      : "";

  // Üretim özellikleri bloğu — WO hedef özellikleri (apre vb.) fasoncuya talimattır;
  // talimat kutusuyla aynı stil. sections.productionProps !== false ise (default açık).
  const showProps = cfg.sections?.productionProps !== false;

  // ── TALİMAT KUTUSU (2026-08-15) ────────────────────────────────────────────
  // Saha iki cümle yazdı ve ikisi de ETİKETLİ + BELİRGİN istiyordu:
  //   "BOYANACAK RENK : MAVİ"  ·  "YAPILACAK İŞLEMLER : APRE"
  // Kutu başlık bandının hemen ALTINDA, elle doldurulan grid'in ÜSTÜNDEDİR —
  // altta kalsaydı okuma akışı "kutuları doldur → sonra ne yapacağını öğren"
  // olurdu. İki nokta AYRI bir grid hücresidir (`.cmd-sep`) ki iki satırın iki
  // noktası HİZALANSIN (kullanıcının çizdiği düzen birebir bu).
  const cmd = doc.commands;
  // İki satır BAĞIMSIZ kapatılabilir: kullanıcının açık kararı "renk olmayabilir
  // ama işlem vardır" — tek anahtar bunu yapısal olarak imkânsız kılardı.
  // İkisi de BLOCKLIST (`!== false`, varsayılan AÇIK): bu belge FASONA gider ve
  // fasona giden belgelerde varsayılan AÇIKtır (kök CLAUDE.md). Geçmişi koruyan
  // şey config değil, `doc.commands`ın eski snapshot'larda YOKLUĞUdur.
  const showDyeColorLine = cfg.sections?.dyeColorLine !== false;
  const showWarning = cfg.sections?.instructionWarning !== false;
  // ⚠️ `renk` DEĞİŞKENİ BURAYA GİRMEZ (fallback'li). Yalnız `cmd.color`.
  const cmdColor = cmd && showDyeColorLine ? (cmd.color ?? "") : "";
  // Değer-hazır şekil: bugün `value` her zaman undefined (hedef özelliklerde
  // değer kolonu YOK ve SEÇİM tipli özellik hedef olamaz) → düz ad listesi basılır.
  // Sıra JS'te deterministik: aynı içerik her baskıda aynı HTML üretmeli.
  // ⚠️ Boş/boşluklu AD önce elenir, SONRA biçimlenir: ters sıra `{name:"",
  // value:"50 gr"}` girdisini ": 50 gr" olarak basardı (`filter` map'ten sonra
  // koştuğu için elenmezdi de).
  const cmdWorks = (cmd && showProps ? [...(cmd.works ?? [])] : [])
    .filter((w) => w.name.trim())
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .map((w) => (w.value ? `${w.name}: ${w.value}` : w.name));
  // ── UYARI SATIRININ YÜKLEMİ ────────────────────────────────────────────────
  // ⚠️ UYARI **VERİ** BOŞLUĞUNA BAKAR, RENDER BOŞLUĞUNA DEĞİL: kullanıcı
  // `productionProps`/`dyeColorLine`'ı bilerek kapattıysa ve talimat ASLINDA
  // varsa uyarı basılmaz — ayarını kullanan kişiye "talimat girilmemiş" yalanı
  // basılırdı. Bu yüzden aşağıdaki dört sinyal de HAM veriden okunur (`cfg` yok).
  //
  // ⚠️ DÖRT SİNYAL, ÜÇÜ SONRADAN EKLENDİ (2026-08-15 doğrulama turu) — ilk hâli
  // yalnız `color` + `works`e bakıyordu ve belge KENDİ KENDİSİYLE ÇELİŞEBİLİYORDU:
  //   • `instruction` = `dispatch.instruction ?? step.notes`, yani boyahaneye
  //     yazılan SERBEST TALİMATIN ta kendisi ve aynı kâğıtta "FASON TALİMATI"
  //     kutusu olarak BASILIYOR. Üstte "GİRİLMEMİŞ — SEVK EDENE SORUNUZ",
  //     altta talimatın kendisi → boyahane hangisinin geçerli olduğunu bilemez.
  //     (Ölçüm: 94 sevkin 11'i talimatsız, 3'ü serbest talimat taşıyor; kesişim
  //     bugün 0 — yani bomba kurulu, patlamamış.)
  //   • `targetProperties` = iş emrinin SÜZÜLMEMİŞ hedefleri. Adım süzgeci
  //     (`resolveStepWorkInstructions`) hepsini elediyse talimat GİRİLMİŞTİR,
  //     sadece BU adıma ait değildir — "girilmemiş" demek planlamacıyı olmadığı
  //     bir ihmalle suçlar. (Gerçek şekil: IE2207260001 → yalnız KURŞUNLU.)
  //   • `trim()`: boş string / yalnız-boşluk değer "render boşluğu" üretip
  //     "veri boşluğu" sayılmıyordu → kutu HİÇ doğmuyor, uyarı da basılmıyordu;
  //     yani belge talimatsız olduğunu HİÇBİR ŞEKİLDE söylemiyordu.
  const hasColorData = (cmd?.color ?? "").trim() !== "";
  const hasWorksData = (cmd?.works ?? []).some((w) => w.name.trim() !== "");
  const hasWrittenInstruction = (doc.instruction ?? "").trim() !== "";
  const hasAnyTarget = (doc.targetProperties ?? []).some((p) => p.trim() !== "");
  const cmdEmptyData =
    !!cmd && !hasColorData && !hasWorksData && !hasWrittenInstruction && !hasAnyTarget;
  const cmdRow = (l: string, v: string): string =>
    `<div class="cmd-lbl">${l}</div><div class="cmd-sep">:</div><div class="cmd-val">${v}</div>`;
  const cmdRows = [
    cmdColor.trim() ? cmdRow("BOYANACAK RENK", esc(cmdColor)) : "",
    cmdWorks.length ? cmdRow("YAPILACAK İŞLEMLER", cmdWorks.map(esc).join(" &nbsp;·&nbsp; ")) : "",
    // Ölçüldü: 94 iptal edilmemiş sevkin 11'inde (%11,7) ne hedef renk, ne bu
    // adımda uygulanacak özellik, ne fason talimatı, ne adım notu var — ve küme
    // BÜYÜYOR (08-03 haftası 5/33 → 08-10 haftası 6/59). Sessiz boşluk yerine
    // boyahanenin telefon açmasını sağlayan görünür bir işaret basılır.
    cmdEmptyData && showWarning ? cmdRow("TALİMAT", "GİRİLMEMİŞ — SEVK EDENE SORUNUZ") : "",
  ]
    .filter(Boolean)
    .join("");
  // ⚠️ Kendi satır başını TAŞIR — gövdede kendi satırında `${...}` olarak DURMAZ
  // (kapalıyken çıktıya boş satır sokup eski belgelerin parmak izini bozardı;
  // `batchRow`/`fabricRows` ile aynı disiplin).
  const cmdBlock = cmdRows ? `\n    <div class="cmd">${cmdRows}</div>` : "";

  // ⚠️ `!cmd` GUARD'I LOAD-BEARING: yeni kutu doğduğunda eski "İSTENEN
  // ÖZELLİKLER" kutusu SUSAR. Yoksa AYNI liste, aynı belgede, İKİ FARKLI
  // etiketle iki kez basılır — bir talimat belgesinde bu, hiç basmamaktan
  // kötüdür (boyahane hangisinin geçerli olduğunu soramaz).
  //
  // ⚠️ BİLİNEN BEDEL (kabul edildi, 2026-08-15): adım süzgeci TÜM hedefleri
  // elerse yeni kutu boş kalır ve eski kutu da susturulmuş olduğu için kâğıtta
  // hedeflerle ilgili tek kelime kalmaz. Bu SESSİZ ama YANLIŞ DEĞİLDİR — elenen
  // hedefler tanım gereği BAŞKA adımın işidir ve onları bu firmaya basmak, tam
  // olarak önlenmek istenen yanlış talimattır. Sessizliğin suçlayıcıya dönmesi
  // ayrıca engellendi: `hasAnyTarget` uyarı satırını bastırır (yukarı).
  // Riskli olan tek yol `StationProperty` bağlarının panelden REPLACE edilmesi
  // (`setCapabilities` / `fabric-property.update`) — canlı bir iş emrinin hedefi
  // listeden düşerse liste sessizce kısalır. Çözüm burada değil, o yazma
  // yolunda bir guard'dadır (ayrı iş).
  const propsBlock =
    showProps && !cmd && doc.targetProperties && doc.targetProperties.length
      ? `<div class="instr"><div class="instr-lbl">İSTENEN ÖZELLİKLER</div><div class="instr-txt">${doc.targetProperties
          .map(esc)
          .join(", ")}</div></div>`
      : "";

  // Fason talimatı bloğu — sections.dyehouseNote !== false ise (default açık) basılır.
  const showInstruction = cfg.sections?.dyehouseNote !== false;
  const instrBlock =
    showInstruction && doc.instruction && doc.instruction.trim()
      ? `<div class="instr"><div class="instr-lbl">FASON TALİMATI</div><div class="instr-txt">${esc(
          doc.instruction,
        )}</div></div>`
      : "";

  const signatures = showSignatures
    ? `<div class="sign">${sigLabels
        .map((l) => `<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">${esc(l)}</div></div>`)
        .join("")}</div>`
    : "";

  // Alt toplam tablosu — kolonlar cfg.columns.totals ile aç/kapa (boş FİYATI/TUTARI
  // kolonları gizlenebilir). TOPLAM satırı foot mekanizmasıyla (tr.tot) basılır.
  // EN hücresi = belgenin TEK en'i (iş emrinden); blankWidths → boş.
  const enCell = docWidth ? `${docWidth} cm` : "";
  const totalsTable = buildDocTable<{ cins: string }>({
    className: "totals",
    colCfg: cfg.columns?.totals,
    footLabel: "TOPLAM",
    rows: [{ cins: `${esc(cins)}${renk ? ` · ${esc(renk)}` : ""}` }],
    cols: [
      { key: "cins", label: "CİNSİ", align: "l", width: "38%", cellClass: "cins", cell: (r) => r.cins },
      { key: "en", label: "EN", align: "l", cell: () => esc(enCell) },
      { key: "top", label: "TOP", align: "l", cell: () => esc(doc.totals.rollCount), foot: esc(doc.totals.rollCount) },
      { key: "metre", label: "METRE", align: "l", cell: () => esc(fmtMetre(doc.totals.totalQty)), foot: esc(fmtMetre(doc.totals.totalQty)) },
      { key: "fiyat", label: "FİYATI", align: "l", cell: () => "" },
      { key: "tutar", label: "TUTARI", align: "l", cell: () => "" },
    ],
  });

  // Alan bazlı punto/kalınlık — override yoksa BOŞ string (tek bayt basılmaz).
  const fieldCss = fasonFieldCss(cfg.fields, d);

  const css = scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docPageCss(style)}
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #111; font-size: ${d.base}px; }
  .sheet { position: relative; width: 100%; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: ${d.watermark}px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); } /* F196: taslak filigranı ESKİ KOPYA'dan ayrı sınıf */
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #000; padding-bottom: ${d.headerPadB}px; margin-bottom: ${d.headerMarB}px; gap: ${d.headerGap}px; }
  .hl { flex: 1; min-width: 0; }
  .company { font-size: ${d.company}px; font-weight: 800; text-transform: uppercase; overflow-wrap: anywhere; }
  .lh-line { font-size: ${d.lhLine}px; color: #333; }
  .sayin { margin-top: ${d.sayinMarT}px; font-size: ${d.sayin}px; }
  .sayin b { font-size: ${d.sayinB}px; text-transform: uppercase; }
  .sub { font-size: ${d.sub}px; color: #444; margin-top: 1px; }
  /* ⚠️ nowrap SATIR bazındadır, blok bazında DEĞİL: eskiden .hr'nin kendisi
     nowrap + min-width:auto idi → yazı ölçeği büyütülünce sağ blok küçülemiyor,
     .hl sıfıra iniyor ve firma adı sayfadan TAŞIYORDU (saha: "yazılar büyüyünce
     ekrana sığmıyor"). Artık etiket sarabilir, numaranın kendisi bölünmez. */
  .hr { text-align: right; min-width: 0; }
  .hr .title { overflow-wrap: anywhere; }
  .title { font-size: ${d.title}px; font-weight: 800; letter-spacing: 1px; }
  .ln { margin-top: ${d.lnMarT}px; font-size: ${d.ln}px; overflow-wrap: anywhere; }
  .ln b { font-size: ${d.lnB}px; white-space: nowrap; }
  table { border-collapse: collapse; width: 100%; }
  .grid { margin-bottom: ${d.gridMarB}px; table-layout: fixed; }
  .grid th, .grid td { border: 1px solid #000; height: ${d.gridRowH}px; text-align: center;
                       font-size: ${d.gridCell}px; padding: 0 ${d.gridPadX}px; overflow: hidden; }
  .grid th { background: #f1f5f9; font-weight: 700; }
  .grid .c-top { width: ${col.top}; background: #f8fafc; }
  .grid .c-met { width: ${col.met}; }${showGridWidth ? `
  .grid .c-cm  { width: ${col.cm}; }` : ""}
  .grid tbody .c-top { font-weight: 700; }
  .meta-row { margin: ${d.metaRowMarY}px 0; font-size: ${d.metaRow}px; }
  .totals { margin-top: ${d.totalsMarT}px; }
  .totals th, .totals td { border: 1px solid #000; padding: ${d.totalsPad}; font-size: ${d.totalsCell}px; }
  .totals th { background: #f1f5f9; text-align: left; font-size: ${d.totalsHead}px; text-transform: uppercase; }
  .totals .cins { font-weight: 700; }
  .totals .tot td { font-weight: 800; background: #f8fafc; }
  .note { margin-top: ${d.noteMarT}px; font-size: ${d.note}px; white-space: pre-wrap; border: 1px solid #cbd5e1; padding: ${d.notePad}; border-radius: 4px; }
  .instr { margin-top: ${d.instrMarT}px; border: 2px solid #000; padding: ${d.instrPad}; border-radius: 4px; }
  .instr-lbl { font-size: ${d.instrLbl}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #333; }
  .instr-txt { margin-top: ${d.instrTxtMarT}px; font-size: ${d.instrTxt}px; font-weight: 600; white-space: pre-wrap; }${cmdBlock ? `
  .cmd { margin-top: ${d.cmdMarT}px; border: 2px solid #000; border-radius: 4px; padding: ${d.cmdPad}; display: grid; grid-template-columns: max-content max-content 1fr; column-gap: ${d.cmdColGap}px; row-gap: ${d.cmdRowGap}px; align-items: baseline; }
  .cmd-lbl { font-size: ${d.cmdLbl}px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #333; white-space: nowrap; }
  .cmd-sep { font-size: ${d.cmdLbl}px; font-weight: 700; color: #333; }
  .cmd-val { font-size: ${d.cmdVal}px; font-weight: 800; min-width: 0; overflow-wrap: anywhere; }` : ""}
  .sign { display: flex; gap: ${d.signGap}px; margin-top: ${d.signMarT}px; }
  .sign-box { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #000; margin-bottom: ${d.signLineMarB}px; }
  .sign-lbl { font-size: ${d.signLbl}px; color: #333; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss(cfg)}
  ${DOC_PAGINATION_CSS}
  ${docTableCss(style, [".totals"])}
  ${fieldCss}
`,
    style,
  );

  // Nüsha rozeti + konumlu bloklar + tek seferlik baskı notu + damga/QR çubuğu.
  const copyBadge = docCopyBadge(cfg, esc);
  const blocksTop = docBlocksHtml(cfg, "afterHeader", esc) + docBlankGridHtml(cfg, "afterHeader", esc);
  const blocksBottom = docBlocksHtml(cfg, "beforeSignatures", esc) + docBlankGridHtml(cfg, "beforeSignatures", esc);
  const printNote = docPrintNoteHtml(meta.printNote, esc);
  const stampsBar = docStampsBar(cfg, meta, esc, { printedAt: "Basım", printedBy: "Basan" });

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>${css}</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <header>
      <div class="hl">
        ${logo.left}
        <div class="company">${esc(company?.name ?? "")}</div>
        ${lhLines}${sayinRow}
        ${subLine}${batchRowLeft}${headerFabLeft}
      </div>
      <div class="hr">
        ${logo.right}
        <div class="title">${esc(title)}</div>
        ${copyBadge}
        <div class="ln ln-docno">İrsaliye No: <b>${esc(doc.dispatchNo)}</b></div>
        <div class="ln ln-date">Tarih: <b>${esc(fmtDate(doc.dispatchedAt))}</b></div>${batchRowRight}${headerFabRight}
      </div>
    </header>
    ${vehicleRow}${cmdBlock}
    ${blocksTop}
    ${grids}

    ${totalsTable}

    ${propsBlock}
    ${instrBlock}
    ${noteBlock}
    ${blocksBottom}
    ${printNote}
    ${signatures}
    ${stampsBar}
  </div>
</body></html>`;
}
