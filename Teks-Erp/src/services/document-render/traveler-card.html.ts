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
  } | null;
}

/** Donmuş refakat kartı içeriği — traveler-card.service buildSnapshot ile aynı şekil. */
export interface TravelerCardSnapshot {
  config?: TravelerCardConfig;
  batchNumber: string;
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

  // Sayfa boyutu + kenar payları (eski snapshot'larda alan yok → A4 / 8mm default).
  const pageSize = cfg.pageSize === "A5" ? "A5" : "A4";
  const mg = cfg.margins ?? { top: 8, right: 8, bottom: 8, left: 8 };
  // Ekran önizlemesi için fiziksel sayfa ölçüsü (mm). @page yalnız BASKI'da geçerli →
  // iframe önizlemesinde boyut/pay görünmez; @media screen'de sheet'e uygulanır.
  const pageDim = pageSize === "A5" ? { w: 148, h: 210 } : { w: 210, h: 297 };
  // Yazı boyutu ölçeği (tüm font-size'lar çarpılır) + kalınlık kaydırması (tüm font-weight'ler).
  const fontScale =
    typeof cfg.fontScale === "number" && cfg.fontScale > 0
      ? Math.min(1.4, Math.max(0.7, cfg.fontScale))
      : 1;
  const weightDelta = cfg.fontWeight === "light" ? -100 : cfg.fontWeight === "bold" ? 100 : 0;
  // Spec grid alan görünürlükleri (eski snapshot → hepsi açık).
  const sf = cfg.specFields ?? ({} as Partial<NonNullable<TravelerCardConfig["specFields"]>>);

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

  // Spec grid (3 sütun) — yalnız AÇIK alanlar basılır (config specFields).
  const cell = (label: string, value: string, hi = false) =>
    `<div class="cell${hi ? " hi" : ""}"><div class="c-lbl">${esc(label)}</div><div class="c-val">${value}</div></div>`;
  const gridCells: string[] = [];
  if (sf.color !== false) gridCells.push(cell("Renk", esc(snapshot.targetColor?.name ?? "—")));
  if (sf.width !== false)
    gridCells.push(cell("En", snapshot.width != null ? `${esc(snapshot.width)} cm` : "—"));
  if (sf.targetQuantity !== false)
    gridCells.push(cell("Hedef Metraj", `${esc(fmtNum(snapshot.targetQuantity))} m`, true));
  if (sf.targetWeight !== false)
    gridCells.push(
      cell("Hedef Ağırlık", snapshot.targetWeight != null ? `${esc(fmtNum(snapshot.targetWeight))} kg` : "—"),
    );
  if (sf.foldType !== false) gridCells.push(cell("Kat Tipi", esc(snapshot.foldType ?? "—")));
  if (sf.startDate !== false) gridCells.push(cell("Başlangıç", esc(fmtDate(snapshot.plannedStartDate))));
  if (sf.endDate !== false) gridCells.push(cell("Bitiş", esc(fmtDate(snapshot.plannedEndDate))));
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

  const ordersBlock = showOrders
    ? orderLinks.length
      ? `<div class="sec-t">BAĞLI SİPARİŞLER (${esc(orderLinks.length)})</div>
         <table class="ord">
          <thead>
            <tr><th class="o-num">Sipariş No</th><th class="o-cus">Müşteri</th><th class="o-item">Ürün</th><th class="o-qty">Miktar</th></tr>
          </thead>
          <tbody>
            ${orderLinks
              .map((l) => {
                const ol = l.orderLine;
                return `<tr>
                  <td class="o-num">${esc(ol?.order?.orderNumber ?? "—")}</td>
                  <td class="o-cus">${esc(ol?.order?.customer?.name ?? "—")}</td>
                  <td class="o-item">${esc(ol?.item?.name ?? "—")}</td>
                  <td class="o-qty">${esc(fmtNum(ol?.quantity))} m</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>`
      : `<div class="empty">Stoğa üretim — bağlı sipariş yok</div>`
    : "";

  const footerBlock = footerNote
    ? `<div class="foot-note">${esc(footerNote)}</div>`
    : "";

  const doc = `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  @page { size: ${pageSize}; margin: ${mg.top}mm ${mg.right}mm ${mg.bottom}mm ${mg.left}mm; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #000; font-size: 9.5px; font-weight: 400; }
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
        font-size: 70px; font-weight: 800; color: rgba(220,38,38,0.16);
        transform: rotate(-22deg); letter-spacing: 8px; z-index: 0; }
  .wm-old { color: rgba(100,116,139,0.18); }
  .wm-draft { color: rgba(100,116,139,0.16); }

  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 1.2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .company { font-size: 15px; font-weight: 800; letter-spacing: -0.2px; }
  .company-meta { font-size: 8px; color: #555; margin-top: 1px; }
  .doc-title { font-size: 9px; font-weight: 800; color: #555; letter-spacing: 1.5px; margin-top: 2px; }
  .top-right { text-align: right; }
  .lbl { font-size: 7px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .card-no { font-size: 14px; font-weight: 800; margin-top: 1px; }
  .card-meta { font-size: 8px; color: #555; margin-top: 1px; }

  .id-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; gap: 10px; }
  .id-left { flex: 1; min-width: 0; }
  .batch { font-size: 24px; font-weight: 800; letter-spacing: -0.3px; }
  .type-text { font-size: 9px; color: #333; margin-top: 2px; }
  .product-line { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
  .product-code { font-size: 9.5px; font-weight: 800; background: #000; color: #fff;
                  padding: 2px 5px; border-radius: 2px; }
  .product-name { font-size: 13px; font-weight: 800; }
  .qr-block { width: 124px; text-align: center; border: 0.8px solid #000; padding: 6px 4px; }
  .qr-img { width: 102px; height: 102px; margin: 0 auto; }
  .qr-img svg { width: 100%; height: 100%; }
  .qr-fallback { border: 1px dashed #bbb; }
  .barcode { margin-top: 4px; font-size: 9px; font-weight: 800; letter-spacing: 0.2px; }
  .qr-hint { font-size: 7px; color: #555; margin-top: 1px; }

  /* Değişken hücre sayısı (alanlar tek tek kapatılabilir) → container tam çerçeve +
     her hücre sağ/alt iç çizgi. nth-child border-kaldırma YOK (7 hücre varsayımı bozulurdu). */
  .grid { display: flex; flex-wrap: wrap; border: 0.8px solid #000; margin-bottom: 6px; }
  .cell { width: 33.333%; padding: 4px 6px; border-right: 0.5px solid #999; border-bottom: 0.5px solid #999; }
  .cell.hi { background: #eee; }
  .c-lbl { font-size: 6.5px; font-weight: 700; color: #555; letter-spacing: 0.4px; text-transform: uppercase; }
  .c-val { font-size: 11px; font-weight: 600; margin-top: 1.5px; }

  .props { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 8px; }
  .p-lbl { font-size: 7px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .chip { font-size: 8px; border: 0.5px solid #000; padding: 1.5px 4px; border-radius: 2px; font-weight: 600; }

  .sec-t { font-size: 8px; font-weight: 700; color: #555; letter-spacing: 0.8px; text-transform: uppercase; margin: 4px 0 3px; }
  table { border-collapse: collapse; width: 100%; }
  .op { border: 0.8px solid #000; margin-bottom: 8px; }
  .op th { background: #eee; border-bottom: 0.8px solid #000; border-right: 0.5px solid #999;
           font-size: 8px; font-weight: 700; padding: 4px 5px; text-align: left; }
  .op td { border-right: 0.5px solid #999; border-bottom: 0.5px solid #999; padding: 4px 5px; height: 24px; vertical-align: middle; }
  .op th:last-child, .op td:last-child { border-right: none; }
  .op-seq { width: 22px; text-align: center !important; font-weight: 700; }
  .op-st { width: 132px; }
  .op-st-n { font-size: 9.5px; font-weight: 600; }
  .op-sub { font-size: 7.5px; color: #555; margin-top: 1px; }
  .op-dt { width: 58px; }
  .op-q { width: 40px; }
  .op-sg { width: 60px; }

  .notes { border: 0.8px solid #b91c1c; background: #fef2f2; border-radius: 3px; padding: 6px; margin-bottom: 8px; }
  .notes-t { font-size: 10px; margin-top: 2px; }

  .ord th { border-bottom: 0.8px solid #000; font-size: 8.5px; text-align: left; padding: 2px 0; }
  .ord td { border-bottom: 0.3px solid #bbb; font-size: 8.5px; padding: 2.5px 0; }
  .o-num { width: 90px; font-weight: 700; }
  .o-cus { width: 170px; font-weight: 600; }
  .o-item { color: #333; }
  .o-qty { width: 60px; text-align: right; font-weight: 700; }
  .ord td.o-qty { text-align: right; }

  .empty { border: 0.5px dashed #bbb; text-align: center; padding: 10px; font-size: 10px; color: #555; }
  .foot-note { border: 0.5px solid #999; border-radius: 3px; padding: 6px; margin-top: 8px; font-size: 9px; color: #555; }
</style></head>
<body>
  ${watermark}
  <div class="sheet">
    <div class="topbar">
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
    </div>

    <div class="id-row">
      <div class="id-left">
        <div class="batch">${esc(snapshot.batchNumber)}</div>
        <div class="type-text">${esc(typeText)}</div>
        ${productLine}
      </div>
      <div class="qr-block">
        ${qrInner}
        <div class="barcode">${esc(meta.barcode)}</div>
        <div class="qr-hint">Tablet ile okut</div>
      </div>
    </div>

    ${grid}
    ${propsBlock}
    ${opGrid}
    ${notesBlock}
    ${ordersBlock}
    ${footerBlock}
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
