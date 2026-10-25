// =============================================================================
// TRAVELER_CARD (Refakat Kartı, yerleşik/SECTIONS) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8). Bölüm sırası `ayar.bolumler`, hücre/kolon stilleri ayardan türetilmiş
// listelerdir; CSS yoğunluk profilinden (A4/A5) ve global ölçek/kalınlıktan üretilir. Parti CSS'i
// Sistem'de yalnız parti basılırken çıkar; burada hep vardır (gövdeye değmeyen kural, T7 kabulü).
// RAW_HTML kademesi bu eşleniğin kapsamı DEĞİL (uzman şablonu kendi yolundan basılır).
// =============================================================================

import { docBlankGridCss } from "../../document-render/doc-style";
import { cssFixed } from "../../document-render/fmt-num";
import { DENSITY, PAGE_DIM, resolveFrozenPageSize } from "../../document-render/traveler-card.density";
import { travelerFieldCss } from "../../document-render/traveler-card.fields";
import type { TravelerCardTemplateConfig } from "../sozlesme/traveler-card.config";
import { BLANK_GRID_CAPTURE, TINY_PNG } from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

type Density = (typeof DENSITY)[keyof typeof DENSITY];
type Margins = { top: number; right: number; bottom: number; left: number };

/** Sistem `<style>`ının ilk yarısı: sayfa, üst bant, kimlik, QR, özet ızgarası. */
function cssHead(d: Density, pageDim: { w: number; h: number }, mg: Margins, cellWidthPct: string): string {
  return `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, "Helvetica Neue", sans-serif; color: #000; font-size: ${d.base}px; font-weight: 400; }
  .sheet { position: relative; width: 100%; }
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
  .grid { display: flex; flex-wrap: wrap; border: 0.8px solid #000; margin-bottom: ${d.gridMarB}px; }
  .cell { width: ${cellWidthPct}%; padding: ${d.cellPad}; border-right: 0.5px solid #999; border-bottom: 0.5px solid #999; }
  .cell.hi { background: #eee; }
  .c-lbl { font-size: ${d.cLbl}px; font-weight: 700; color: #555; letter-spacing: 0.4px; text-transform: uppercase; }
  .c-val { font-size: ${d.cVal}px; font-weight: 600; margin-top: 1.5px; }
`;
}

/** İkinci yarı: özellikler, operasyon, talimat, sipariş/parti tabloları, alt not. */
function cssBody(d: Density, blankGridCss: string, fieldCss: string): string {
  return `  .props { display: flex; flex-wrap: wrap; align-items: center; gap: ${d.propsGap}px; margin-bottom: ${d.propsMarB}px; }
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
  ${blankGridCss}
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
  .ord tfoot td { border-top: 0.8px solid #000; border-bottom: none; padding-top: 3px; }
  .ord-total-lbl { text-align: right; padding-right: 8px; letter-spacing: 0.5px; }
  .bat { margin-bottom: ${d.opMarB}px; }
  .bat th { border-bottom: 0.8px solid #000; font-size: ${d.bat}px; text-align: left; padding: 2px 0; }
  .bat td { border-bottom: 0.3px solid #bbb; font-size: ${d.bat}px; padding: 2.5px 0; }
  .b-seq { width: ${d.bSeqW}px; text-align: center !important; font-weight: 700; }
  .b-no { width: ${d.bNoW}px; font-weight: 700; }
  .b-cnt { width: ${d.bCountW}px; }
  .bat th.b-cnt, .bat td.b-cnt { text-align: right; }
  .b-qty { width: ${d.bQtyW}px; font-weight: 700; }
  .bat th.b-qty, .bat td.b-qty { text-align: right; }
  .bat th.b-disp, .bat td.b-disp { padding-left: 8px; }
  .b-disp { color: #333; }
  .b-more { color: #555; }
  .bat tfoot td { border-top: 0.8px solid #000; border-bottom: none; padding-top: 3px; }
  .bat-total-lbl { text-align: right; padding-right: 8px; letter-spacing: 0.5px; }
  .empty { border: 0.5px dashed #bbb; text-align: center; padding: ${d.emptyPad}px; font-size: ${d.empty}px; color: #555; }
  .foot-note { border: 0.5px solid #999; border-radius: 3px; padding: ${d.footNotePad}px; margin-top: ${d.footNoteMarT}px; font-size: ${d.footNote}px; color: #555; }${fieldCss ? `\n  ${fieldCss}` : ""}
`;
}

/** Sistem `<style>`ının eşi (`@page` hariç — `pageSettings`ten gelir). */
export function travelerCardCss(settings: Settings): string {
  const cfg = settings as unknown as TravelerCardTemplateConfig;
  const pageSize = resolveFrozenPageSize(cfg.pageSize);
  const mg = cfg.margins ?? { top: 8, right: 8, bottom: 8, left: 8 };
  const pageDim = PAGE_DIM[pageSize];
  const d = DENSITY[pageSize];
  const specCols = Math.min(4, Math.max(1, Math.round(Number(cfg.specColumns)) || 3));
  const cellWidthPct = cssFixed(100 / specCols, 4);
  const fieldCss = travelerFieldCss(Object.keys(cfg.fields ?? {}).length ? cfg.fields : undefined, d);
  const fontScale = typeof cfg.fontScale === "number" && cfg.fontScale > 0 ? Math.min(1.4, Math.max(0.7, cfg.fontScale)) : 1;
  const weightDelta = cfg.fontWeight === "light" ? -100 : cfg.fontWeight === "bold" ? 100 : 0;
  const css =
    cssHead(d, pageDim, mg, cellWidthPct) +
    cssBody(d, docBlankGridCss({ blankGrid: cfg.blankGrid ?? undefined }), fieldCss);
  // Sistem ölçek/kalınlığı belgenin tamamına uygular; CSS payı burada, satır içi stil sözleşmede.
  let out = css;
  if (fontScale !== 1) out = out.replace(/font-size:\s*([\d.]+)px/g, (_m, n: string) => `font-size: ${Number(cssFixed(Number(n) * fontScale, 2))}px`);
  if (weightDelta !== 0) out = out.replace(/font-weight:\s*(\d{3})/g, (_m, w: string) => `font-weight: ${Math.min(900, Math.max(200, Number(w) + weightDelta))}`);
  return out;
}

function travelerPageSettings(settings: Settings): Record<string, unknown> {
  const cfg = settings as unknown as TravelerCardTemplateConfig;
  const m = cfg.margins ?? { top: 8, right: 8, bottom: 8, left: 8 };
  return { kagit: resolveFrozenPageSize(cfg.pageSize), kenar: { ust: m.top, sag: m.right, alt: m.bottom, sol: m.left } };
}

// Açılış solu, kapanış sağı kırpmaz: "· 25.09" ve "4.850 m" boşlukları korunur.
const dash = (path: string, out = `{{ ${path} }}`) => String.raw`{% if ${path} == nil -%}—{%- else -%}${out}{%- endif %}`;
const intOrDash = (path: string) => dash(path, `{{ ${path} | sayi: 0 }}`);
const style = (path: string) => String.raw`{%- if ${path} != "" %} style="{{ ${path} }}"{% endif -%}`;

const HEADER = String.raw`<div class="topbar"><div><div class="company">{{ firma.ad }}</div>
{%- if firma.adres != "" or firma.telefon != "" -%}<div class="company-meta">{{ firma.adres }}{%- if firma.adres != "" and firma.telefon != "" %}  ·  {% endif -%}{{ firma.telefon }}</div>{%- endif -%}
<div class="doc-title">REFAKAT KARTI</div></div>
<div class="top-right"><div class="lbl">KART NO</div><div class="card-no">{{ belge.kart_no }}</div><div class="card-meta">v{{ belge.surum }} · ${dash("belge.basim_zamani", "{{ belge.basim_zamani | tarih_saat }}")}</div></div></div>`;

const IDENTITY = String.raw`<div class="id-row"><div class="id-left"><div class="batch">{{ belge.is_emri_no }}</div><div class="type-text">{{ belge.tur_metni }}</div>
{%- if belge.urun_kodu != nil -%}<div class="product-line"><span class="product-code">{{ belge.urun_kodu }}</span><span class="product-name">{{ belge.urun_adi }}</span></div>{%- endif -%}
</div><div class="qr-block">
{%- if belge.barkod != blank -%}<div class="qr-img">{{ belge.barkod | qr }}</div>{%- else -%}<div class="qr-img qr-fallback"></div>{%- endif -%}
<div class="barcode">{{ belge.barkod }}</div><div class="qr-hint">Tablet ile okut</div></div></div>`;

const SPEC = String.raw`{%- assign hucre_sayisi = ayar.ozet_hucreleri | size -%}
{%- if hucre_sayisi > 0 -%}<div class="grid">
{%- for h in ayar.ozet_hucreleri -%}<div class="cell{% if h.vurgu %} hi{% endif %}"><div class="c-lbl">{{ h.etiket }}</div><div class="c-val"${style("h.stil")}>
{%- case h.anahtar -%}
{%- when "color" -%}${dash("belge.renk")}
{%- when "width" -%}${dash("belge.en", "{{ belge.en }} cm")}
{%- when "targetQuantity" -%}${intOrDash("belge.hedef_metraj")} m
{%- when "targetWeight" -%}${dash("belge.hedef_agirlik", "{{ belge.hedef_agirlik | sayi: 0 }} kg")}
{%- when "foldType" -%}${dash("belge.kat_tipi")}
{%- when "startDate" -%}${dash("belge.baslangic", "{{ belge.baslangic | takvim }}")}
{%- when "endDate" -%}${dash("belge.bitis", "{{ belge.bitis | takvim }}")}
{%- endcase -%}</div></div>{%- endfor -%}</div>{%- endif -%}`;

const PROPERTIES = String.raw`{%- assign ozellik_sayisi = tablolar.ozellikler | size -%}
{%- if ayar.showProperties and ozellik_sayisi > 0 -%}<div class="props"><span class="p-lbl">ÖZELLİKLER:</span>{%- for p in tablolar.ozellikler -%}<span class="chip">{{ p.ad }}</span>{%- endfor -%}</div>{%- endif -%}`;

const BATCHES = String.raw`{%- assign parti_sayisi = tablolar.partiler | size -%}{%- assign parti_kolon_sayisi = ayar.parti_kolonlari | size -%}
{%- if ayar.showBatches and parti_sayisi > 0 and parti_kolon_sayisi > 0 -%}<div class="sec-t">PARTİLER ({{ parti_sayisi }})</div>
<table class="bat"><thead><tr><th class="b-seq">#</th>{%- for k in ayar.parti_kolonlari -%}<th class="{{ k.sinif }}">{{ k.baslik }}</th>{%- endfor -%}</tr></thead><tbody>
{%- for p in tablolar.partiler -%}<tr><td class="b-seq">{{ p.sira }}</td>
{%- for k in ayar.parti_kolonlari -%}<td class="{{ k.sinif }}"${style("k.stil")}>
{%- case k.sinif -%}
{%- when "b-no" -%}{{ p.parti_no }}
{%- when "b-cnt" -%}{{ p.top_adedi }}
{%- when "b-qty" -%}${intOrDash("p.metraj")} m
{%- when "b-disp" -%}{%- if p.sevk_no == nil -%}—{%- else -%}{{ p.sevk_firma }} · {{ p.sevk_no }}{%- if p.sevk_ek > 0 -%}<span class="b-more"> (+{{ p.sevk_ek }})</span>{%- endif -%}{%- endif -%}
{%- endcase -%}</td>{%- endfor -%}</tr>{%- endfor -%}</tbody>
{%- if ayar.parti_toplam.goster -%}<tfoot><tr class="bat-total">
{%- if ayar.parti_toplam.etiket_genislik > 0 -%}<td class="bat-total-lbl" style="{{ ayar.parti_toplam.stil }}" colspan="{{ ayar.parti_toplam.etiket_genislik }}">TOPLAM</td>{%- endif -%}
{%- for c in ayar.parti_toplam.duzen -%}
{%- case c -%}
{%- when "b-cnt" -%}<td class="b-cnt" style="{{ ayar.parti_toplam.stil }}">{{ toplamlar.parti_top }}</td>
{%- when "b-qty" -%}<td class="b-qty" style="{{ ayar.parti_toplam.stil }}">{{ toplamlar.parti_metraj | sayi: 0 }} m</td>
{%- else -%}<td></td>
{%- endcase -%}
{%- endfor -%}</tr></tfoot>{%- endif -%}</table>{%- endif -%}`;

const OPERATIONS = String.raw`{%- if ayar.showOperationGrid -%}<div class="sec-t">OPERASYON KAYDI</div>
<table class="op"><thead><tr><th class="op-seq">#</th><th class="op-st">İstasyon</th><th class="op-op">Operatör</th><th class="op-dt">Tarih</th><th class="op-q">Mt</th><th class="op-q">Fire</th><th class="op-sg">İmza</th></tr></thead><tbody>
{%- for a in tablolar.adimlar -%}<tr><td class="op-seq">{{ a.adim_no }}</td><td class="op-st"><div class="op-st-n">${dash("a.istasyon")}</div>
{%- if a.dis_istasyon and a.fason_firma != nil -%}<div class="op-sub">→ {{ a.fason_firma }}</div>{%- endif -%}</td><td></td><td></td><td></td><td></td><td></td></tr>
{%- endfor -%}</tbody></table>{%- endif -%}`;

const INSTRUCTIONS = String.raw`{%- assign talimat_var = false -%}
{%- for a in tablolar.adimlar -%}{%- if a.talimat != nil and a.talimat != blank -%}{%- assign talimat_var = true -%}{%- endif -%}{%- endfor -%}
{%- if ayar.showNotes and talimat_var -%}<div class="notes"><span class="p-lbl">TALİMATLAR</span>
{%- for a in tablolar.adimlar -%}{%- if a.talimat != nil and a.talimat != blank -%}<div class="notes-t">Adım {{ a.adim_no }} — ${dash("a.istasyon")}: {{ a.talimat }}</div>{%- endif -%}{%- endfor -%}</div>{%- endif -%}`;

const ORDERS = String.raw`{%- assign siparis_sayisi = tablolar.siparisler | size -%}{%- assign siparis_kolon_sayisi = ayar.siparis_kolonlari | size -%}
{%- if ayar.showOrders -%}
{%- if siparis_sayisi == 0 -%}<div class="empty">Stoğa üretim — bağlı sipariş yok</div>
{%- elsif siparis_kolon_sayisi > 0 -%}<div class="sec-t">BAĞLI SİPARİŞLER ({{ siparis_sayisi }})</div>
<table class="ord"><thead><tr>{%- for k in ayar.siparis_kolonlari -%}<th class="{{ k.sinif }}">{{ k.baslik }}</th>{%- endfor -%}</tr></thead><tbody>
{%- for s in tablolar.siparisler -%}<tr>{%- for k in ayar.siparis_kolonlari -%}<td class="{{ k.sinif }}"${style("k.stil")}>
{%- case k.sinif -%}
{%- when "o-num" -%}${dash("s.siparis_no")}
{%- when "o-cus" -%}${dash("s.musteri")}
{%- when "o-item" -%}${dash("s.urun")}
{%- when "o-color" -%}${dash("s.renk")}
{%- when "o-qty" -%}${intOrDash("s.miktar")} m
{%- endcase -%}</td>{%- endfor -%}</tr>{%- endfor -%}</tbody>
{%- if ayar.siparis_toplam.goster -%}<tfoot><tr class="ord-total">
{%- if ayar.siparis_toplam.etiket_genislik > 0 -%}<td class="ord-total-lbl" style="{{ ayar.siparis_toplam.stil }}" colspan="{{ ayar.siparis_toplam.etiket_genislik }}">TOPLAM</td>{%- endif -%}
<td class="o-qty" style="{{ ayar.siparis_toplam.stil }}">{{ toplamlar.siparis_miktar | sayi: 0 }} m</td></tr></tfoot>{%- endif -%}</table>
{%- endif -%}
{%- endif -%}`;

const FOOTER = String.raw`{%- if ayar.footerNote != "" -%}<div class="foot-note">{{ ayar.footerNote }}</div>{%- endif -%}`;

const html = String.raw`<div class="sheet">
${BLANK_GRID_CAPTURE}
{%- for bolum in ayar.bolumler -%}
{%- case bolum -%}
{%- when "header" -%}${HEADER}
{%- when "identity" -%}${IDENTITY}
{%- when "spec" -%}${SPEC}
{%- when "properties" -%}${PROPERTIES}
{%- when "batches" -%}${BATCHES}
{%- when "operations" -%}${OPERATIONS}
{%- when "blankGrid" -%}{%- if grid_konum != "" -%}{{ bos_grid }}{%- endif -%}
{%- when "instructions" -%}${INSTRUCTIONS}
{%- when "orders" -%}${ORDERS}
{%- when "footer" -%}${FOOTER}
{%- endcase -%}
{%- endfor -%}
</div>`;

const variants: EquivalenceVariant[] = [
  {
    // Stüdyo (SECTIONS) kademesi: sıra değişir, iki bölüm kapanır, boş tablo araya girer.
    name: "bolum_sirasi_kapali",
    config: {
      sections: [
        { key: "header" },
        { key: "orders" },
        { key: "identity" },
        { key: "blankGrid" },
        { key: "spec", enabled: false },
        { key: "operations" },
        { key: "properties", enabled: false },
      ],
      blankGrid: { enabled: true, title: "Kurşun kaydı", rows: 2, columns: 3, headers: ["Saat", "Gramaj"], columnWidths: [20, 30, 50], position: "afterHeader" },
      footerNote: "Bu kart mal ile hareket eder.",
      addressLine: "OSB 5. Cad. No:12 Bursa",
    } as never,
  },
  {
    name: "a4_olcek_kolon",
    config: {
      pageSize: "A4",
      fontScale: 0.85,
      fontWeight: "bold",
      margins: { top: 5, right: 6, bottom: 7, left: 9 },
      specColumns: 4,
      specFields: { color: { show: true, size: "lg", weight: "black" }, width: false, startDate: { show: true, px: 13 } },
      orderFields: { customer: { show: false }, quantity: { show: true, size: "sm", weight: "light" } },
      orderTotal: { show: true, size: "lg", weight: "medium" },
      batchFields: { rollCount: { show: false }, dispatch: { show: true, weight: "bold" } },
      batchTotal: { show: true, px: 11, weight: "black" },
      fields: { company: { size: 20, weight: "bold" }, cardNo: { hidden: true }, watermark: { size: 60 } },
      phone: "0224 000 00 00",
      companyName: "Kart Adı A.Ş.",
    } as never,
  },
  {
    name: "kapali_bayraklar_hafif",
    config: {
      showOperationGrid: false,
      showNotes: false,
      showOrders: true,
      showBatches: false,
      fontWeight: "light",
      fontScale: 1.2,
      orderFields: { orderNumber: false, customer: false, item: false, color: false },
      orderTotal: { show: false },
    } as never,
    print: { logo: TINY_PNG },
  },
  {
    name: "toplamsiz_tek_kolon",
    config: {
      specColumns: 1,
      orderFields: { quantity: false },
      batchFields: { batchNumber: false, quantity: false, rollCount: false },
      batchTotal: { show: true },
    } as never,
  },
];

export const travelerCardSystem: SystemEquivalent = {
  docType: "TRAVELER_CARD",
  editMode: "CODE",
  html,
  css: travelerCardCss,
  pageSettings: travelerPageSettings,
  tableBindings: {},
  variants,
};
