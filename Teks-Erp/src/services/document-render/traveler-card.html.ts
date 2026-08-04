// =============================================================================
// Refakat Kartı (Traveler Card) — HTML renderer (TEK KAYNAK)
// =============================================================================
// İş emriyle birlikte fiziksel olarak gezen, istasyonlarda elle doldurulan +
// okutulan barkodlu kart. Eskiden Electron (@react-pdf) ve mobil (expo-print)
// kartı AYRI AYRI üretiyordu (farklı düzen). Artık tüm cihazlar bu backend
// HTML'ini basar → format her yerde aynı. Kart bir DONMUŞ belgedir: içerik
// basım anında `TravelerCard.snapshot`'a (render config dahil) dondurulur; bu
// renderer yalnız o snapshot'tan + kartın kimlik alanlarından (cardMeta) üretir.
// Kanonik düzen = eski Electron PDF (config-güdümlü, elle-doldurulan operasyon
// imza grid'i). QR sunucuda (bwip-js SVG) gömülür → çıktı self-contained.
// =============================================================================

import type { TravelerCardStatus } from "@prisma/client";
import type { TravelerCardConfig } from "../system-setting.service";
import {
  DENSITY,
  PAGE_DIM,
  resolveFrozenPageSize,
  type TravelerDensity,
} from "./traveler-card.density";
import { resolveSectionOrder, type TravelerSectionKey } from "./traveler-card.sections";
import { renderRawTemplate, buildRawContext, wrapRawDocument } from "./traveler-card-raw";

interface SnapStep {
  id: string;
  stepSequence: number;
  isUrgent: boolean;
  notes: string | null;
  station: { name: string; type: string } | null;
  plannedSubcontractor: { id: string; name: string } | null;
}

interface SnapOrderLink {
  orderLineId: string;
  orderLine: {
    quantity: number | null;
    order: { orderNumber: string; customer: { name: string } | null } | null;
    item: { name: string } | null;
    color: { name: string } | null;
  } | null;
}

/**
 * Karta DONDURULMUŞ şablon (Faz 2). Yoksa yerleşik kart basılır — eski
 * snapshot'lar ve şablonsuz kurulumlar bu daldan geçer.
 */
export interface FrozenTravelerTemplate {
  id: string | null;
  name: string;
  mode: "BUILTIN" | "SECTIONS" | "RAW_HTML";
  html: string | null;
}

/** Donmuş refakat kartı içeriği — traveler-card.service buildSnapshot ile aynı şekil. */
export interface TravelerCardSnapshot {
  config?: TravelerCardConfig;
  /** Basım anında çözülen şablon — sonradan düzenlense de bu kart aynı basılır. */
  template?: FrozenTravelerTemplate;
  /** İş Emri no (İE + GGAAYY + NNNN) — kartın iri kimliği (= barkod/karekod, tek kod).
   *  Çok eski snapshot'larda olmayabilir → opsiyonel/güvenli render. */
  workOrderNumber?: string;
  type: string;
  width: number | null;
  targetQuantity: number | null;
  targetWeight: number | null;
  foldType: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  routeTemplate: { name: string } | null;
  targetItem: { code: string; name: string } | null;
  targetColor: { name: string; hex: string | null } | null;
  targetProperties: { propertyId: string; property: { name: string } }[];
  steps: SnapStep[];
  orderLinks: SnapOrderLink[];
}

/**
 * Kartın PARTİ satırı — **snapshot'ta DEĞİL, baskı anında CANLI çözülür** (meta).
 *
 * Sebep zamanlama: kart iş emri AÇILIŞINDA donar, parti ise `attachRolls`'ta
 * doğar (Hızlı İş Emri'nde sıra create → attach → dispatch). Donmuş alana
 * yazılsaydı parti kartta HER ZAMAN boş çıkardı. Ayrıca parti bölünüp
 * birleşebilir; kart malla gezen operasyon kâğıdıdır, muhasebe belgesi değil —
 * "sevk rakamı brüttür" kuralı buraya UZANMAZ (o kural para/irsaliye yüzeyine
 * aittir). Çözüm noktası: `traveler-card.service.resolveLiveBatches`.
 */
export interface TravelerBatchLine {
  batchNumber: string;
  /** Partideki CANLI top adedi (K18 ölü statüler hariç). */
  rollCount: number;
  /** Canlı topların toplam güncel metrajı — hiç canlı top yoksa null. */
  quantity: number | null;
  /** En yeni iptal-edilmemiş fason sevki; `moreCount` = ondan önceki açık sevk sayısı. */
  dispatch: { dispatchNo: string; subcontractorName: string; moreCount: number } | null;
}

/** Kart kimliği — TravelerCard satırından (snapshot'ta YOK) + sunucu-üretimi QR. */
export interface TravelerCardMeta {
  cardNumber: string;
  barcode: string;
  version: number;
  printedAt: string;
  status?: TravelerCardStatus;
  voidReason?: string | null;
  /** bwip-js ile sunucuda üretilmiş QR SVG (gömülü). Yoksa barkod metni gösterilir. */
  qrSvg?: string | null;
  /** Kaynak henüz donmamış (canlı önizleme — Belge Şablonu) → TASLAK filigranı. */
  draft?: boolean;
  /** Baskı anında canlı çözülen partiler (bkz. TravelerBatchLine). Yoksa blok basılmaz. */
  batches?: TravelerBatchLine[];
}

const TYPE_LABELS: Record<string, string> = {
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stok",
};

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Tam-sayı Türkçe biçim (metraj/ağırlık kartta ondalıksız). */
function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function fmtDate(iso: string | null | undefined, fallback = "—"): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Boyut/kalınlık YALNIZ default'tan (md/normal) farklıysa inline override edilir —
// md/normal = CSS default'a dokunulmaz (eski kartların/sütunların karışık stili korunur).
// Global fontScale/fontWeight hem CSS default'u hem override'ı regex ile ölçekler/kaydırır.
// sm/lg px değerleri SAYFA BOYUTUNA bağlıdır (yoğunluk profili) → render içinde kurulur:
// A5'te taban 8px iken "lg" hücrenin A4'ün 14px'i olması kartı taşırırdı.
const OVR_WEIGHT: Record<string, number> = { light: 400, bold: 800 }; // normal → CSS default

/** Alanın (boyut/kalınlık) inline override stilini üret — default'ta boş string. */
function ovrStyle(f: { size: string; weight: string }, sizeMap: Record<string, number>): string {
  const p: string[] = [];
  if (sizeMap[f.size] != null) p.push(`font-size:${sizeMap[f.size]}px`);
  if (OVR_WEIGHT[f.weight] != null) p.push(`font-weight:${OVR_WEIGHT[f.weight]}`);
  return p.length ? ` style="${p.join(";")}"` : "";
}

// Toplam satırı tek + tam denetimli → HER ZAMAN inline (md dahil). sm/md/lg + ince/normal/kalın.
// (Boyut haritası yoğunluk profilinden kurulur — bkz. OVR_WEIGHT notu.)
const FULL_WEIGHT: Record<string, number> = { light: 400, normal: 600, bold: 800 };
function fullStyle(f: { size: string; weight: string }, sizeMap: Record<string, number>): string {
  return ` style="font-size:${sizeMap[f.size] ?? sizeMap.md}px;font-weight:${FULL_WEIGHT[f.weight] ?? 600}"`;
}

/** Ham spec alan değerini (boolean eski şekil | nesne | undefined) çöz. */
function coerceSpecCell(v: unknown): { show: boolean; size: string; weight: string } {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Record<string, unknown>;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? (f.size as string) : "md",
    weight: f.weight === "light" || f.weight === "bold" ? (f.weight as string) : "normal",
  };
}

/**
 * TEK GİRİŞ NOKTASI — kartın hangi kademede basılacağını burası seçer.
 *
 *   RAW_HTML (+ gövde dolu) → uzman şablonu; yerleşik CSS YÜKLENMEZ.
 *   diğer her şey           → yerleşik renderer (bölüm sırası config'ten).
 *
 * `mode = RAW_HTML` ama gövde boşsa yerleşiğe düşer. Bu, fail-closed kuralının
 * İSTİSNASI DEĞİL: fail-closed olan şey ŞABLONUN ÇÖZÜLMESİDİR (silinmiş/pasif
 * şablon → 400, `resolveForPrint`). Buraya gelindiğinde şablon çözülmüştür;
 * gövdesi boş bir uzman şablonu ise ancak elle DB düzenlemesiyle oluşur ve
 * karşılığı "boş kâğıt basmak" olurdu — sahada en kötü sonuç budur.
 */
export function renderTravelerCard(
  snapshot: TravelerCardSnapshot,
  meta: TravelerCardMeta,
): string {
  const tpl = snapshot.template;
  if (tpl?.mode === "RAW_HTML" && tpl.html?.trim()) {
    const cfg = snapshot.config ?? ({} as Partial<TravelerCardConfig>);
    return wrapRawDocument(renderRawTemplate(tpl.html, buildRawContext(snapshot, meta)), {
      pageSize: resolveFrozenPageSize(cfg.pageSize),
      margins: cfg.margins ?? { top: 8, right: 8, bottom: 8, left: 8 },
    });
  }
  return renderTravelerCardHtml(snapshot, meta);
}

export function renderTravelerCardHtml(
  snapshot: TravelerCardSnapshot,
  meta: TravelerCardMeta,
): string {
  const cfg = snapshot.config ?? ({} as Partial<TravelerCardConfig>);
  const companyName = cfg.companyName?.trim() || "Adnan Şahin Tekstil";
  const addressLine = cfg.addressLine?.trim() ?? "";
  const phone = cfg.phone?.trim() ?? "";
  const showOperationGrid = cfg.showOperationGrid !== false;
  const showNotes = cfg.showNotes !== false;
  const showOrders = cfg.showOrders !== false;
  const showProperties = cfg.showProperties !== false;
  const footerNote = cfg.footerNote?.trim() ?? "";

  // Sayfa boyutu + kenar payları (eski snapshot'larda alan yok → A4 / 8mm default;
  // varsayılanın neden AYAR katmanından farklı olduğu: traveler-card.density.ts).
  const pageSize = resolveFrozenPageSize(cfg.pageSize);
  const mg = cfg.margins ?? { top: 8, right: 8, bottom: 8, left: 8 };
  // Ekran önizlemesi için fiziksel sayfa ölçüsü (mm). @page yalnız BASKI'da geçerli →
  // iframe önizlemesinde boyut/pay görünmez; @media screen'de sheet'e uygulanır.
  const pageDim = PAGE_DIM[pageSize];
  // Yoğunluk profili — CSS'teki HER sabit ölçü buradan gelir (A4 sütunu bugünkü
  // değerlerin birebir aynısı; A5 sıkı profil). Hücre-başına sm/lg override
  // haritaları da profile bağlı.
  const d: TravelerDensity = DENSITY[pageSize];
  const specOvrSize: Record<string, number> = { sm: d.specSm, lg: d.specLg };
  const orderOvrSize: Record<string, number> = { sm: d.ordSm, lg: d.ordLg };
  const batchOvrSize: Record<string, number> = { sm: d.batSm, lg: d.batLg };
  const orderFullSize: Record<string, number> = { sm: d.ordSm, md: d.ord, lg: d.ordLg };
  const batchFullSize: Record<string, number> = { sm: d.batSm, md: d.bat, lg: d.batLg };
  // Yazı boyutu ölçeği (tüm font-size'lar çarpılır) + kalınlık kaydırması (tüm font-weight'ler).
  const fontScale =
    typeof cfg.fontScale === "number" && cfg.fontScale > 0
      ? Math.min(1.4, Math.max(0.7, cfg.fontScale))
      : 1;
  const weightDelta = cfg.fontWeight === "light" ? -100 : cfg.fontWeight === "bold" ? 100 : 0;
  // Spec grid alanları (eski snapshot → boolean; coerceSpecCell hepsini {show,size,weight}'e çözer).
  const sf = (cfg.specFields ?? {}) as Record<string, unknown>;
  const of = (cfg.orderFields ?? {}) as Record<string, unknown>;
  // Spec grid satır başına sütun (1–4, default 3) → hücre genişliği %.
  const specCols = Math.min(4, Math.max(1, Math.round(Number(cfg.specColumns)) || 3));
  const cellWidthPct = (100 / specCols).toFixed(4);

  const steps = [...(snapshot.steps ?? [])].sort((a, b) => a.stepSequence - b.stepSequence);
  const orderLinks = snapshot.orderLinks ?? [];
  const props = snapshot.targetProperties ?? [];

  const watermark = meta.draft
    ? `<div class="wm wm-draft">TASLAK</div>`
    : meta.status === "VOIDED"
      ? `<div class="wm">İPTAL</div>`
      : meta.status === "REPRINTED"
        ? `<div class="wm wm-old">ESKİ KOPYA</div>`
        : "";

  const companyMeta =
    addressLine || phone
      ? `<div class="company-meta">${esc([addressLine, phone].filter(Boolean).join("  ·  "))}</div>`
      : "";

  // QR bloğu: sunucu-üretimi SVG (gömülü) — yoksa sadece barkod metni.
  const qrInner = meta.qrSvg
    ? `<div class="qr-img">${meta.qrSvg}</div>`
    : `<div class="qr-img qr-fallback"></div>`;

  const typeText =
    (TYPE_LABELS[snapshot.type] ?? snapshot.type) +
    (snapshot.routeTemplate ? ` · Rota: ${snapshot.routeTemplate.name}` : "");

  const productLine = snapshot.targetItem
    ? `<div class="product-line">
        <span class="product-code">${esc(snapshot.targetItem.code)}</span>
        <span class="product-name">${esc(snapshot.targetItem.name)}</span>
      </div>`
    : "";

  // Spec grid — yalnız AÇIK alanlar; boyut/kalınlık default'tan farklıysa inline override.
  const cell = (label: string, value: string, f: { size: string; weight: string }, hi = false) =>
    `<div class="cell${hi ? " hi" : ""}"><div class="c-lbl">${esc(label)}</div>` +
    `<div class="c-val"${ovrStyle(f, specOvrSize)}>${value}</div></div>`;
  const gridCells: string[] = [];
  const add = (v: unknown, label: string, value: string, hi = false) => {
    const f = coerceSpecCell(v);
    if (f.show) gridCells.push(cell(label, value, f, hi));
  };
  add(sf.color, "Renk", esc(snapshot.targetColor?.name ?? "—"));
  add(sf.width, "En", snapshot.width != null ? `${esc(snapshot.width)} cm` : "—");
  add(sf.targetQuantity, "Hedef Metraj", `${esc(fmtNum(snapshot.targetQuantity))} m`, true);
  add(sf.targetWeight, "Hedef Ağırlık", snapshot.targetWeight != null ? `${esc(fmtNum(snapshot.targetWeight))} kg` : "—");
  add(sf.foldType, "Kat Tipi", esc(snapshot.foldType ?? "—"));
  add(sf.startDate, "Başlangıç", esc(fmtDate(snapshot.plannedStartDate)));
  add(sf.endDate, "Bitiş", esc(fmtDate(snapshot.plannedEndDate)));
  const grid = gridCells.length ? `<div class="grid">${gridCells.join("")}</div>` : "";

  const propsBlock =
    showProperties && props.length
      ? `<div class="props"><span class="p-lbl">ÖZELLİKLER:</span>${props
          .map((p) => `<span class="chip">${esc(p.property.name)}</span>`)
          .join("")}</div>`
      : "";

  // Operasyon kaydı — rota + boş imza grid'i (elle doldurulur).
  const opGrid = showOperationGrid
    ? `<div class="sec-t">OPERASYON KAYDI</div>
       <table class="op">
        <thead>
          <tr>
            <th class="op-seq">#</th>
            <th class="op-st">İstasyon</th>
            <th class="op-op">Operatör</th>
            <th class="op-dt">Tarih</th>
            <th class="op-q">Mt</th>
            <th class="op-q">Fire</th>
            <th class="op-sg">İmza</th>
          </tr>
        </thead>
        <tbody>
          ${steps
            .map((st) => {
              const isFason = st.station?.type === "EXTERNAL";
              const sub =
                isFason && st.plannedSubcontractor
                  ? `<div class="op-sub">→ ${esc(st.plannedSubcontractor.name)}</div>`
                  : "";
              return `<tr>
                <td class="op-seq">${esc(st.stepSequence)}</td>
                <td class="op-st"><div class="op-st-n">${esc(st.station?.name ?? "—")}</div>${sub}</td>
                <td></td><td></td><td></td><td></td><td></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
    : "";

  const notesBlock =
    showNotes && steps.some((st) => st.notes?.trim())
      ? `<div class="notes"><span class="p-lbl">TALİMATLAR</span>${steps
          .filter((st) => st.notes?.trim())
          .map(
            (st) =>
              `<div class="notes-t">Adım ${esc(st.stepSequence)} — ${esc(st.station?.name ?? "—")}: ${esc(st.notes)}</div>`,
          )
          .join("")}</div>`
      : "";

  // ── PARTİLER ──────────────────────────────────────────────────────────────
  // İçerik snapshot'tan DEĞİL meta'dan gelir (canlı çözüm — TravelerBatchLine
  // notuna bak). Blok kapalıysa ya da hiç parti yoksa TEK BAYT basılmaz: kartın
  // A4 çıktısı bu özellik eklenmeden önceki hâliyle bayt-bayt aynı kalsın diye
  // CSS'i bile koşullu (batchCss). "Parti yok" satırı da BASILMAZ — iş emri
  // henüz topsuzken (kart WO açılışında doğar) her karta ölü bir kutu koyardı.
  const batches = meta.batches ?? [];
  const bf = (cfg.batchFields ?? {}) as Record<string, unknown>;
  const batchCols: {
    c: { show: boolean; size: string; weight: string };
    cls: string;
    head: string;
    val: (b: TravelerBatchLine) => string;
  }[] = [
    { c: coerceSpecCell(bf.batchNumber), cls: "b-no", head: "Parti No", val: (b) => esc(b.batchNumber) },
    { c: coerceSpecCell(bf.rollCount), cls: "b-cnt", head: "Top", val: (b) => esc(b.rollCount) },
    { c: coerceSpecCell(bf.quantity), cls: "b-qty", head: "Metraj", val: (b) => `${esc(fmtNum(b.quantity))} m` },
    {
      c: coerceSpecCell(bf.dispatch),
      cls: "b-disp",
      head: "Sevk",
      val: (b) =>
        b.dispatch
          ? `${esc(b.dispatch.subcontractorName)} · ${esc(b.dispatch.dispatchNo)}` +
            (b.dispatch.moreCount > 0 ? `<span class="b-more"> (+${esc(b.dispatch.moreCount)})</span>` : "")
          : "—",
    },
  ];
  const shownBatchCols = batchCols.filter((col) => col.c.show);
  const showBatches = cfg.showBatches !== false && batches.length > 0 && shownBatchCols.length > 0;
  // Toplam satırı: adet ve/veya metraj sütunu açıksa anlamlı. Sahada operatör 6
  // partiyi elle toplamasın diye default AÇIK (sipariş toplamıyla aynı gerekçe).
  const batchTotalF = coerceSpecCell(cfg.batchTotal ?? { show: true, size: "md", weight: "bold" });
  const batCntShown = shownBatchCols.some((col) => col.cls === "b-cnt");
  const batQtyShown = shownBatchCols.some((col) => col.cls === "b-qty");
  const showBatchTotal = batchTotalF.show && (batCntShown || batQtyShown);
  const batchTotalStyle = fullStyle(batchTotalF, batchFullSize);
  const batchRollTotal = batches.reduce((s, b) => s + b.rollCount, 0);
  const batchQtyTotal = batches.reduce((s, b) => s + (b.quantity ?? 0), 0);
  // Toplam satırı gövdenin sütun DÜZENİNİ izler: ["#", ...açık sütunlar]. Sipariş
  // toplamından farkı, burada İKİ sayı olması (adet + metraj) ve bitişik olmak
  // zorunda olmamaları (arada "Sevk" bulunabilir) → tek colspan yetmez: etiket
  // ilk sayı sütununa kadar olan hücreleri colspan'ler, sonrası hücre hücre basılır.
  const totalLayout = ["b-seq", ...shownBatchCols.map((c) => c.cls)];
  const firstNumIdx = totalLayout.findIndex((cls) => cls === "b-cnt" || cls === "b-qty");
  const batchTotalRow = showBatchTotal
    ? `<tfoot><tr class="bat-total">` +
      (firstNumIdx > 0
        ? `<td class="bat-total-lbl"${batchTotalStyle} colspan="${firstNumIdx}">TOPLAM</td>`
        : "") +
      totalLayout
        .slice(firstNumIdx)
        .map((cls) =>
          cls === "b-cnt"
            ? `<td class="b-cnt"${batchTotalStyle}>${esc(batchRollTotal)}</td>`
            : cls === "b-qty"
              ? `<td class="b-qty"${batchTotalStyle}>${esc(fmtNum(batchQtyTotal))} m</td>`
              : `<td></td>`,
        )
        .join("") +
      `</tr></tfoot>`
    : "";
  const batchesBlock = !showBatches
    ? ""
    : `<div class="sec-t">PARTİLER (${esc(batches.length)})</div>
       <table class="bat">
        <thead><tr><th class="b-seq">#</th>${shownBatchCols
          .map((col) => `<th class="${col.cls}">${esc(col.head)}</th>`)
          .join("")}</tr></thead>
        <tbody>
          ${batches
            .map(
              (b, i) =>
                `<tr><td class="b-seq">${esc(i + 1)}</td>${shownBatchCols
                  .map((col) => `<td class="${col.cls}"${ovrStyle(col.c, batchOvrSize)}>${col.val(b)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>${batchTotalRow}
      </table>`;
  const batchCss = !showBatches
    ? ""
    : `
  /* Partiler — sipariş tablosuyla aynı iskelet (yalnız blok basılırken emit edilir). */
  .bat { margin-bottom: ${d.opMarB}px; }
  .bat th { border-bottom: 0.8px solid #000; font-size: ${d.bat}px; text-align: left; padding: 2px 0; }
  .bat td { border-bottom: 0.3px solid #bbb; font-size: ${d.bat}px; padding: 2.5px 0; }
  .b-seq { width: ${d.bSeqW}px; text-align: center !important; font-weight: 700; }
  .b-no { width: ${d.bNoW}px; font-weight: 700; }
  .b-cnt { width: ${d.bCountW}px; }
  .bat th.b-cnt, .bat td.b-cnt { text-align: right; }
  .b-qty { width: ${d.bQtyW}px; font-weight: 700; }
  .bat th.b-qty, .bat td.b-qty { text-align: right; }
  /* Sevk sütunu SAĞA YASLI bir sayının (metraj) hemen ardından gelir; payı
     olmazsa "800 mYıldız Boyahane" diye yapışır (baskıda görüldü). Sipariş
     tablosunda bu sorun yok, çünkü orada sağa yaslı sütun en sondadır.
     UYARI: seçici "th.x, td.x" OLMAK ZORUNDA. Yalın .b-disp (0,1,0) yukarıdaki
     .bat td kuralını (0,1,1) yenemez; onun padding kısayolu payı sessizce
     ezer. Aynı tuzak .b-cnt / .b-qty hizalamalarında da var. */
  .bat th.b-disp, .bat td.b-disp { padding-left: 8px; }
  .b-disp { color: #333; }
  .b-more { color: #555; }
  .bat tfoot td { border-top: 0.8px solid #000; border-bottom: none; padding-top: 3px; }
  .bat-total-lbl { text-align: right; padding-right: 8px; letter-spacing: 0.5px; }
`;
  // Bağlı siparişler — sütun başına göster/boyut/kalınlık (yalnız AÇIK sütunlar).
  type OL = SnapOrderLink["orderLine"];
  const orderCols: { c: { show: boolean; size: string; weight: string }; cls: string; head: string; val: (ol: OL) => string }[] = [
    { c: coerceSpecCell(of.orderNumber), cls: "o-num", head: "Sipariş No", val: (ol) => esc(ol?.order?.orderNumber ?? "—") },
    { c: coerceSpecCell(of.customer), cls: "o-cus", head: "Müşteri", val: (ol) => esc(ol?.order?.customer?.name ?? "—") },
    { c: coerceSpecCell(of.item), cls: "o-item", head: "Ürün", val: (ol) => esc(ol?.item?.name ?? "—") },
    { c: coerceSpecCell(of.color), cls: "o-color", head: "Renk", val: (ol) => esc(ol?.color?.name ?? "—") },
    { c: coerceSpecCell(of.quantity), cls: "o-qty", head: "Miktar", val: (ol) => `${esc(fmtNum(ol?.quantity))} m` },
  ];
  const shownOrderCols = orderCols.filter((col) => col.c.show);
  const qtyShown = shownOrderCols.some((col) => col.cls === "o-qty");
  // Miktar toplamı satırı — orderTotal (yeni) > showOrderTotal (eski boolean); default KALIN.
  const totalF = coerceSpecCell(
    cfg.orderTotal ?? { show: (cfg as Record<string, unknown>).showOrderTotal !== false, size: "md", weight: "bold" },
  );
  const showTotal = totalF.show && qtyShown;
  const orderTotal = orderLinks.reduce((s, l) => s + (l.orderLine?.quantity ?? 0), 0);
  const totalStyle = fullStyle(totalF, orderFullSize);
  // Miktar en sağdaki görünür sütun (orderCols sırası) → etiket öncekileri colspan'ler.
  const totalRow =
    showTotal && shownOrderCols.length > 0
      ? `<tfoot><tr class="ord-total">${
          shownOrderCols.length > 1
            ? `<td class="ord-total-lbl"${totalStyle} colspan="${shownOrderCols.length - 1}">TOPLAM</td>`
            : ""
        }<td class="o-qty"${totalStyle}>${esc(fmtNum(orderTotal))} m</td></tr></tfoot>`
      : "";
  const ordersBlock = !showOrders
    ? ""
    : orderLinks.length === 0
      ? `<div class="empty">Stoğa üretim — bağlı sipariş yok</div>`
      : shownOrderCols.length === 0
        ? ""
        : `<div class="sec-t">BAĞLI SİPARİŞLER (${esc(orderLinks.length)})</div>
         <table class="ord">
          <thead><tr>${shownOrderCols.map((col) => `<th class="${col.cls}">${esc(col.head)}</th>`).join("")}</tr></thead>
          <tbody>
            ${orderLinks
              .map(
                (l) =>
                  `<tr>${shownOrderCols
                    .map((col) => `<td class="${col.cls}"${ovrStyle(col.c, orderOvrSize)}>${col.val(l.orderLine)}</td>`)
                    .join("")}</tr>`,
              )
              .join("")}
          </tbody>${totalRow}
        </table>`;

  const footerBlock = footerNote
    ? `<div class="foot-note">${esc(footerNote)}</div>`
    : "";

  // ── BÖLÜM KAYDI ───────────────────────────────────────────────────────────
  // Kartın gövdesi artık sabit sıralı bir şablon değil, ADLANDIRILMIŞ bölümlerin
  // listesi. Stüdyo (Faz 2) sırayı değiştirebilsin diye; yerleşik kullanımda
  // sıra `DEFAULT_SECTION_ORDER`dır ve çıktı eskisiyle aynı yerleşimi verir.
  //
  // GÖRÜNÜRLÜK İKİ KAPIDAN geçer ve ikisi de gerekli:
  //   • bölümün `enabled`ı (stüdyo sırası/anahtarı),
  //   • bölümün ESKİ bayrağı (showOrders/showNotes/…) — ayar panelinde zaten var
  //     ve DONMUŞ snapshot'larda yaşıyor.
  // Bu yüzden eski bir kart `sections` taşımasa da bugünkü gibi basılır. Stüdyo
  // bir bölümü kapatırken ESKİ BAYRAĞI yazar (bayrağı olan bölümlerde) — böylece
  // "iki ayrı yerden kapatılabilen tek bölüm" tuhaflığı doğmaz.
  const sectionBody: Record<TravelerSectionKey, string> = {
    header: `<div class="topbar">
      <div>
        <div class="company">${esc(companyName)}</div>
        ${companyMeta}
        <div class="doc-title">REFAKAT KARTI</div>
      </div>
      <div class="top-right">
        <div class="lbl">KART NO</div>
        <div class="card-no">${esc(meta.cardNumber)}</div>
        <div class="card-meta">v${esc(meta.version)} · ${esc(fmtDateTime(meta.printedAt))}</div>
      </div>
    </div>`,
    identity: `<div class="id-row">
      <div class="id-left">
        <div class="batch">${esc(snapshot.workOrderNumber ?? "")}</div>
        <div class="type-text">${esc(typeText)}</div>
        ${productLine}
      </div>
      <div class="qr-block">
        ${qrInner}
        <div class="barcode">${esc(meta.barcode)}</div>
        <div class="qr-hint">Tablet ile okut</div>
      </div>
    </div>`,
    spec: grid,
    properties: propsBlock,
    batches: batchesBlock,
    operations: opGrid,
    instructions: notesBlock,
    orders: ordersBlock,
    footer: footerBlock,
  };
  const sectionsHtml = resolveSectionOrder(cfg.sections)
    .filter((s) => s.enabled !== false && sectionBody[s.key])
    .map((s) => `    ${sectionBody[s.key]}`)
    .join("\n");

  const doc = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  @page { size: ${pageSize}; margin: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #000; font-size: ${d.base}px; font-weight: 400; }
  .sheet { position: relative; width: 100%; }
  /* Ekran önizlemesi: @page (yalnız baskı) ekranda boyut/pay göstermez → sayfayı
     fiziksel ölçüsünde çiz + payları padding yap. Baskıda bu blok yok sayılır (@page geçerli). */
  @media screen {
    body { background: #94a3b8; padding: 14px 0; }
    .sheet { width: ${pageDim.w}mm; min-height: ${pageDim.h}mm; margin: 0 auto;
             padding: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm;
             background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.28); }
  }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center;
        font-size: ${d.watermark}px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }

  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 1.2px solid #000; padding-bottom: ${d.topbarPadB}px; margin-bottom: ${d.topbarMarB}px; }
  .company { font-size: ${d.company}px; font-weight: 800; letter-spacing: -0.2px; }
  .company-meta { font-size: ${d.companyMeta}px; color: #555; margin-top: 1px; }
  .doc-title { font-size: ${d.docTitle}px; font-weight: 800; color: #555; letter-spacing: 1.5px; margin-top: 2px; }
  .top-right { text-align: right; }
  .lbl { font-size: ${d.lbl}px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .card-no { font-size: ${d.cardNo}px; font-weight: 800; margin-top: 1px; }
  .card-meta { font-size: ${d.cardMeta}px; color: #555; margin-top: 1px; }

  .id-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: ${d.idRowMarB}px; gap: ${d.idRowGap}px; }
  .id-left { flex: 1; min-width: 0; }
  .batch { font-size: ${d.woNo}px; font-weight: 800; letter-spacing: -0.3px; }
  .type-text { font-size: ${d.typeText}px; color: #333; margin-top: 2px; }
  .product-line { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
  .product-code { font-size: ${d.productCode}px; font-weight: 800; background: #000; color: #fff;
                  padding: ${d.productCodePad}; border-radius: 2px; }
  .product-name { font-size: ${d.productName}px; font-weight: 800; }
  .qr-block { width: ${d.qrBox}px; text-align: center; border: 0.8px solid #000; padding: ${d.qrBoxPad}; }
  .qr-img { width: ${d.qrImg}px; height: ${d.qrImg}px; margin: 0 auto; }
  .qr-img svg { width: 100%; height: 100%; }
  .qr-fallback { border: 1px dashed #bbb; }
  .barcode { margin-top: 4px; font-size: ${d.barcode}px; font-weight: 800; letter-spacing: 0.2px; }
  .qr-hint { font-size: ${d.qrHint}px; color: #555; margin-top: 1px; }

  /* Değişken hücre sayısı (alanlar tek tek kapatılabilir) → container tam çerçeve +
     her hücre sağ/alt iç çizgi. nth-child border-kaldırma YOK (7 hücre varsayımı bozulurdu). */
  .grid { display: flex; flex-wrap: wrap; border: 0.8px solid #000; margin-bottom: ${d.gridMarB}px; }
  .cell { width: ${cellWidthPct}%; padding: ${d.cellPad}; border-right: 0.5px solid #999; border-bottom: 0.5px solid #999; }
  .cell.hi { background: #eee; }
  .c-lbl { font-size: ${d.cLbl}px; font-weight: 700; color: #555; letter-spacing: 0.4px; text-transform: uppercase; }
  .c-val { font-size: ${d.cVal}px; font-weight: 600; margin-top: 1.5px; }  /* md/normal default; sm/lg + ince/kalın hücre-başına inline */

  .props { display: flex; flex-wrap: wrap; align-items: center; gap: ${d.propsGap}px; margin-bottom: ${d.propsMarB}px; }
  .p-lbl { font-size: ${d.lbl}px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .chip { font-size: ${d.chip}px; border: 0.5px solid #000; padding: ${d.chipPad}; border-radius: 2px; font-weight: 600; }

  .sec-t { font-size: ${d.secT}px; font-weight: 700; color: #555; letter-spacing: 0.8px; text-transform: uppercase; margin: ${d.secTMar}; }
  table { border-collapse: collapse; width: 100%; }
  .op { border: 0.8px solid #000; margin-bottom: ${d.opMarB}px; }
  .op th { background: #eee; border-bottom: 0.8px solid #000; border-right: 0.5px solid #999;
           font-size: ${d.opHead}px; font-weight: 700; padding: ${d.opPad}; text-align: left; }
  .op td { border-right: 0.5px solid #999; border-bottom: 0.5px solid #999; padding: ${d.opPad}; height: ${d.opRow}px; vertical-align: middle; }
  .op th:last-child, .op td:last-child { border-right: none; }
  .op-seq { width: ${d.opSeqW}px; text-align: center !important; font-weight: 700; }
  .op-st { width: ${d.opStW}px; }
  .op-st-n { font-size: ${d.opStN}px; font-weight: 600; }
  .op-sub { font-size: ${d.opSub}px; color: #555; margin-top: 1px; }
  .op-dt { width: ${d.opDtW}px; }
  .op-q { width: ${d.opQW}px; }
  .op-sg { width: ${d.opSgW}px; }

  .notes { border: 0.8px solid #b91c1c; background: #fef2f2; border-radius: 3px; padding: ${d.notesPad}px; margin-bottom: ${d.notesMarB}px; }
  .notes-t { font-size: ${d.notes}px; margin-top: 2px; }

  .ord th { border-bottom: 0.8px solid #000; font-size: ${d.ord}px; text-align: left; padding: 2px 0; }
  .ord td { border-bottom: 0.3px solid #bbb; font-size: ${d.ord}px; padding: 2.5px 0; }
  .o-num { width: ${d.oNumW}px; font-weight: 700; }
  .o-cus { width: ${d.oCusW}px; font-weight: 600; }
  .o-item { color: #333; }
  .o-color { width: ${d.oColorW}px; }
  .o-qty { width: ${d.oQtyW}px; text-align: right; font-weight: 700; }
  .ord td.o-qty { text-align: right; }
  .ord tfoot td { border-top: 0.8px solid #000; border-bottom: none; padding-top: 3px; }  /* boyut/kalınlık inline (config orderTotal) */
  .ord-total-lbl { text-align: right; padding-right: 8px; letter-spacing: 0.5px; }
${batchCss}
  .empty { border: 0.5px dashed #bbb; text-align: center; padding: ${d.emptyPad}px; font-size: ${d.empty}px; color: #555; }
  .foot-note { border: 0.5px solid #999; border-radius: 3px; padding: ${d.footNotePad}px; margin-top: ${d.footNoteMarT}px; font-size: ${d.footNote}px; color: #555; }
</style></head>
<body>
  ${watermark}
  <div class="sheet">
${sectionsHtml}
  </div>
</body></html>`;

  // Global yazı ölçeği + kalınlık: yalnız font-size (px) çarpılır, font-weight kaydırılır.
  // Layout (padding/margin/genişlik mm/px) DOKUNULMAZ → oran korunur, sadece yazı değişir.
  let out = doc;
  if (fontScale !== 1) {
    out = out.replace(
      /font-size:\s*([\d.]+)px/g,
      (_m, n: string) => `font-size: ${Number((Number(n) * fontScale).toFixed(2))}px`,
    );
  }
  if (weightDelta !== 0) {
    out = out.replace(
      /font-weight:\s*(\d{3})/g,
      (_m, w: string) => `font-weight: ${Math.min(900, Math.max(200, Number(w) + weightDelta))}`,
    );
  }
  return out;
}
