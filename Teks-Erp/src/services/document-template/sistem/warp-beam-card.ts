// =============================================================================
// WARP_BEAM_CARD (Levent Kartı, A6) — Sistem renderer'ının Liquid eşleniği (devere S5)
// =============================================================================
// KOD KİPİ. CSS renderer'ın `warpBeamCardCss`inden (aynı fonksiyon), kâğıt A6 sabit `pageSettings`ten;
// karekod `| qr` filtresiyle renderer'ın `renderQrSvg`iyle aynı SVG. Bilgi satırları sözleşmeden hazır.
// =============================================================================

import { resolveDocStyle, type DocStyleConfig } from "../../document-render/doc-style";
import { WARP_BEAM_CARD_HAND_HTML, WARP_BEAM_CARD_MARGIN_MM, warpBeamCardCss } from "../../document-render/warp-beam-card.html";
import { dynamicTable, filled } from "./_ortak/musteri";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

type Settings = Readonly<Record<string, unknown>>;

const styleOf = (settings: Settings) => resolveDocStyle((settings as { style?: DocStyleConfig }).style, { marginMm: WARP_BEAM_CARD_MARGIN_MM });

const variants: EquivalenceVariant[] = [
  { name: "fason_lot_kapali", config: { sections: { fason: false, lots: false } } },
  { name: "iplik_el_yazisi_kapali", config: { sections: { yarnTable: false, handwriting: false }, footerNote: "Kılıfa takınız <&>." } },
  {
    name: "kolon_gizle_sira_baslik",
    config: { columns: { iplikler: { hidden: ["denier"], order: ["kg", "yarn", "seq"], labels: { kg: "Kg <&>" }, blankLabels: ["lots"] } }, titleOverride: "levent bileti" },
  },
  { name: "toplamsiz_kolonlar", config: { columns: { iplikler: { hidden: ["ends", "kg"] } } } },
  { name: "olcek_kenar", config: { style: { fontScale: 0.85, fontWeight: "bold", margins: { top: 3, left: 8 } } } },
  { name: "ince_yazi", config: { style: { fontScale: 1.2, fontWeight: "light", pageSize: "A5" } } },
];

const YARN_CELLS = String.raw`{%- when "seq" -%}{{ satir.sira }}
{%- when "yarn" -%}{{ satir.iplik_kodu }}
{%- when "ends" -%}{{ satir.tel }}
{%- when "denier" -%}{{ satir.denye | sayi: 0 }}
{%- when "kg" -%}{{ satir.kg | sayi: 1 }}
{%- when "lots" -%}{%- if satir.lotlar == nil -%}—{%- else -%}{{ satir.lotlar }}{%- endif -%}`;

const YARN_FOOT = String.raw`{%- when "ends" -%}{{ toplamlar.tel }}
{%- when "kg" -%}{{ toplamlar.kg | sayi: 1 }}`;

const html = String.raw`<div class="sheet">
<header class="top">
<div class="tl">
<div class="company">{{ firma.ad }}</div>
<div class="title">{{ belge.baslik }}</div>
<div class="beamno">{{ belge.levent_no }}</div>
</div>
<div class="qr">{{ belge.levent_no | qr }}</div>
</header>
{%- if ${filled("belge.govde_no")} -%}<div class="body-no"><span>GÖVDE</span><b>{{ belge.govde_no }}</b></div>{%- endif -%}
<table class="info"><tbody>{%- for b in tablolar.bilgi -%}<tr><th>{{ b.etiket }}</th><td>{{ b.deger }}</td></tr>{%- endfor -%}</tbody></table>
{%- assign iplik_sayisi = tablolar.iplikler | size -%}
{%- if ayar.sections.yarnTable and iplik_sayisi > 0 -%}<div class="tbl-cap">İplik kırılımı</div>
${dynamicTable({
  rows: "tablolar.iplikler",
  cols: "iplikler",
  widths: [["seq", "14px"], ["ends", "34px"], ["denier", "30px"], ["kg", "38px"]],
  cells: YARN_CELLS,
  foot: { label: "Σ", cells: YARN_FOOT },
})}
{%- endif -%}
{%- if ayar.sections.handwriting -%}${WARP_BEAM_CARD_HAND_HTML}{%- endif -%}
{%- if ayar.footerNote != "" -%}<div class="decl">{{ ayar.footerNote }}</div>{%- endif -%}
</div>`;

export const warpBeamCardSystem: SystemEquivalent = {
  docType: "WARP_BEAM_CARD",
  editMode: "CODE",
  html,
  css: (settings) => warpBeamCardCss(styleOf(settings)),
  // A6 sabit: belge ayarındaki A4/A5 seçimi bu türde yoktur (renderer `@page size: A6`).
  pageSettings: (settings) => {
    const m = styleOf(settings).margins;
    return { kagit: "A6", kenar: { ust: m.top, sag: m.right, alt: m.bottom, sol: m.left } };
  },
  tableBindings: {},
  variants,
};
