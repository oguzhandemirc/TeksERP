// =============================================================================
// SUBCONTRACTOR_DIRECT_SHIP (Fasondan Doğrudan Sevk) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ (T6 kalıbı, D8): iki tablonun kolon sırası/başlığı ayardan dinamik, toplam
// etiketi "toplamsız ilk kolona" oturur, kutu satırları koşullu birleşir — `assign`/`capture`
// ister. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import { TERIM } from "../../../constants/terim";
import {
  BLANK_GRID_CAPTURE,
  COPY_BADGE,
  LOGO_ASSIGN,
  LOGO_LEFT,
  LOGO_RIGHT,
  PRINT_NOTE,
  SIGNATURES,
  STAMPS,
  TINY_PNG,
  blocksAt,
  chromeDocCss,
  letterhead,
  pageSettingsFor,
} from "./subcontractor-fragments";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        rollTable: { hidden: ["kg"], order: ["meters", "itemColor", "seq"], labels: { barcode: "Barkod 'no' <&>" }, blankLabels: ["width"] },
        allocations: { hidden: ["seq"], order: ["qty"], labels: { orderNumber: "Sipariş" } },
      },
    },
  },
  {
    name: "bolum_kapali_imza_dipnot",
    config: {
      sections: { branchName: false, exportCode: false, taxNo: false, subcontractorInfo: false, directShipInfo: false, fasonDispatchNo: false, batchInfo: false },
      signatureLabels: ["Fasoncu", "Şoför", "Müşteri"],
      footerNote: "Malı eksiksiz teslim aldım.",
      titleOverride: "doğrudan sevk",
    },
  },
  {
    name: "a5_olcek_alan",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { tblCap: { size: 13, weight: "black" }, boxTitle: { size: 8 } },
      showSignatures: false,
      showLetterhead: false,
    },
  },
  {
    name: "listeler_ve_kutular_kapali",
    config: {
      sections: { allocations: false, vehicleInfo: false, notes: false, subcontractorInfo: false, directShipInfo: false },
      columns: { rollTable: { hidden: ["meters", "kg"] } },
      footerNote: "Basılmaz (bölüm kapalı)",
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "tum_kolon_gizli_damga_blok_grid_logo",
    config: {
      columns: {
        rollTable: { hidden: ["seq", "barcode", "itemColor", "width", "meters", "kg"] },
        allocations: { hidden: ["seq", "orderNumber", "itemColor", "qty"] },
      },
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  MÜŞTERİ NÜSHASI  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
      ],
      blankGrid: { enabled: true, title: "TESLİM KONTROL", rows: 2, columns: 4, columnWidths: [40, 20, 20, 20], headers: ["Top"], position: "afterHeader" },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

/** Dolu metin mi (JS doğruluk anlamı: null ve "" boş, boşluk dolu). */
const filled = (path: string) => `${path} != nil and ${path} != ""`;
/** Kutu satırı; değer boşsa "—" (renderer `x || "—"`). */
const dashRow = (label: string, path: string) =>
  `<div class="row"><span>${label}:</span><b>{%- if ${filled(path)} -%}{{ ${path} }}{%- else -%}—{%- endif -%}</b></div>`;

/** Bir listenin tablosu; `cell` kolon kaynağına göre hücre içeriği. */
interface TableSpec {
  ctxKey: string;
  widths: Record<string, string>;
  mono: string;
  cells: string;
  withFoot: boolean;
}

function table({ ctxKey, widths, mono, cells, withFoot }: TableSpec): string {
  const widthCase = Object.entries(widths)
    .map(([k, w]) => `{% when "${k}" %} style="width:${w}"`)
    .join("");
  const foot = withFoot
    ? String.raw`
{%- assign toplamli = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplamli = true -%}{%- endif -%}{%- endfor -%}
{%- if toplamli -%}
<tr class="tot">
{%- assign etiket_kondu = false -%}
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}">
{%- if kolon.toplam == "metre" -%}{{ toplamlar.metre | sayi: 1 }} m
{%- elsif kolon.toplam == "kg" -%}{%- if toplamlar.kg != nil and toplamlar.kg > 0 -%}{{ toplamlar.kg | sayi: 1 }} kg{%- else -%}—{%- endif -%}
{%- elsif etiket_kondu == false -%}TOPLAM{%- assign etiket_kondu = true -%}
{%- endif -%}</td>{%- endfor -%}
</tr>
{%- endif -%}`
    : "";
  return String.raw`{%- assign kolonlar = ayar.kolonlar.${ctxKey} -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="sec"><thead><tr>
{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% case kolon.kaynak %}${widthCase}{% endcase %}>{{ kolon.etiket }}</th>{%- endfor -%}
</tr></thead><tbody>
{%- for satir in tablolar.${ctxKey} -%}<tr>
{%- for kolon in kolonlar -%}<td class="{{ kolon.hiza }}{% if kolon.kaynak == "${mono}" %} mono{% endif %}">
{%- case kolon.kaynak -%}
${cells}
{%- endcase -%}
</td>{%- endfor -%}
</tr>{%- endfor -%}${foot}
</tbody></table>
{%- endif -%}`;
}

const ITEM_COLOR = String.raw`{%- when "itemColor" -%}{{ satir.urun }}{%- if satir.renk != nil and satir.renk != "" %} · {{ satir.renk }}{% endif -%}`;

const allocationCells = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "orderNumber" -%}{{ satir.siparis_no }}
${ITEM_COLOR}
{%- when "qty" -%}{%- if satir.metre != nil -%}{{ satir.metre | sayi: 1 }} m{%- endif -%}`;

const rollCells = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "barcode" -%}{%- if satir.barkod == nil -%}—{%- else -%}{{ satir.barkod }}{%- endif -%}
${ITEM_COLOR}
{%- when "width" -%}{%- if satir.en == nil -%}—{%- else -%}{{ satir.en | sayi: 0 }} cm{%- endif -%}
{%- when "meters" -%}{{ satir.metre | sayi: 1 }}
{%- when "kg" -%}{%- if satir.kg == nil -%}—{%- else -%}{{ satir.kg | sayi: 1 }}{%- endif -%}`;

const html = String.raw`<div class="sheet">
<header>
<div class="hl">
${LOGO_ASSIGN}
${LOGO_LEFT}
<div class="company">{{ firma.ad }}</div>
${letterhead()}
</div>
<div class="hr">
${LOGO_RIGHT}
<div class="title">{{ belge.baslik }}</div>
${COPY_BADGE}
<div class="ln">İrsaliye No: <b>{{ belge.no }}</b></div>
{%- if ayar.sections.fasonDispatchNo and belge.fason_sevk_no != nil -%}<div class="ln">Fason Sevk No: <b>{{ belge.fason_sevk_no }}</b></div>{%- endif -%}
<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>
{%- if ayar.sections.batchInfo and ${filled("belge.parti_no")} -%}<div class="ln">Parti No: <b>{{ belge.parti_no }}</b></div>{%- endif -%}
</div>
</header>
{%- capture kutular -%}
{%- if belge.musteri_var -%}<div class="box"><div class="box-t">MÜŞTERİ (Malın Gittiği)</div>
<div class="row"><span>Adı:</span><b>{{ belge.musteri_ad }}</b></div>
{%- if ayar.sections.branchName and ${filled("belge.musteri_sube")} -%}<div class="row"><span>Şube:</span><b>{{ belge.musteri_sube }}</b></div>{%- endif -%}
{%- if ayar.sections.exportCode and ${filled("belge.musteri_ihracat_kodu")} -%}<div class="row"><span>İhracat Kodu:</span><b>{{ belge.musteri_ihracat_kodu }}</b></div>{%- endif -%}
{%- if ayar.sections.taxNo and ${filled("belge.musteri_vergi_no")} -%}<div class="row"><span>V.No:</span><b>{{ belge.musteri_vergi_no }}</b></div>{%- endif -%}
</div>{%- endif -%}
{%- if ayar.sections.subcontractorInfo -%}<div class="box"><div class="box-t">FASON FİRMA (Malın Geldiği)</div>
<div class="row"><span>Adı:</span><b>{{ karsi_taraf.ad }}</b></div>
{%- if ${filled("karsi_taraf.kod")} -%}<div class="row"><span>Kod:</span><b>{{ karsi_taraf.kod }}</b></div>{%- endif -%}
<div class="row"><span>${TERIM.terbiyeIsEmri.tekil}:</span><b>{{ belge.is_emri_no }}</b></div>
<div class="row"><span>Adım:</span><b>{{ belge.adim }}</b></div>
</div>{%- endif -%}
{%- if ayar.sections.directShipInfo -%}<div class="box"><div class="box-t">FASONDAN SEVK</div>
${dashRow("Sevk Eden", "belge.sevk_eden")}
${dashRow("Sebep", "belge.sebep")}
</div>{%- endif -%}
{%- if ayar.sections.vehicleInfo -%}<div class="box"><div class="box-t">ARAÇ / SEVKİYAT</div>
${dashRow("Plaka", "belge.plaka")}
${dashRow("Şoför", "belge.sofor")}
{%- if ${filled("belge.notlar")} -%}<div class="row"><span>Not:</span><b>{{ belge.notlar }}</b></div>{%- endif -%}
</div>{%- endif -%}
{%- endcapture -%}
{%- if kutular != "" -%}<div class="info">{{ kutular }}</div>{%- endif -%}
${BLANK_GRID_CAPTURE}
${blocksAt("afterHeader")}
{%- assign siparis_sayisi = tablolar.siparisler | size -%}
{%- if ayar.sections.allocations and siparis_sayisi > 0 -%}
<div class="tbl-cap">Karşılanan Siparişler ({{ siparis_sayisi }})</div>
${table({ ctxKey: "siparisler", widths: { seq: "34px", qty: "90px" }, mono: "orderNumber", cells: allocationCells, withFoot: false })}
{%- endif -%}
{%- if ayar.sections.rollTable -%}
<div class="tbl-cap">Sevk Edilen Toplar ({{ toplamlar.top_adedi }})</div>
${table({ ctxKey: "toplar", widths: { seq: "34px", width: "60px", meters: "80px", kg: "70px" }, mono: "barcode", cells: rollCells, withFoot: true })}
{%- endif -%}
{%- if ayar.sections.notes and ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}
${blocksAt("beforeSignatures")}
${PRINT_NOTE}
${SIGNATURES}
${STAMPS}
</div>`;

export const subcontractorDirectShipSystem: SystemEquivalent = {
  docType: "SUBCONTRACTOR_DIRECT_SHIP",
  editMode: "CODE",
  html,
  css: (settings) => chromeDocCss(settings, 72, "fasonDirectShip"),
  pageSettings: (settings) => pageSettingsFor(settings, 9),
  tableBindings: {},
  variants,
};
