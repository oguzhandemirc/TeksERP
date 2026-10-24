// =============================================================================
// SHIPMENT_DISPATCH (Sevk İrsaliyesi) — Sistem renderer'ının Liquid eşleniği
// =============================================================================
// KOD KİPİ: kolon sırası/başlığı ayardan dinamik gelir, toplam etiketi "toplamsız ilk
// kolona" oturur ve başlık satırları ayraçla birleşir — bunlar `assign`/`case` ister,
// data-* dilbilgisi (yalnız sabit yol, durum yok) taşıyamaz. Eşitlik: test_belge_sistem_esdegeri.
// =============================================================================

import {
  DOC_LOGO_CSS,
  DOC_STAMPS_CSS,
  docBlankGridCss,
  docTableCss,
  resolveDocStyle,
  scaleDocCss,
  type BlankGridConfig,
  type DocFieldStyle,
  type DocStyleConfig,
} from "../../document-render/doc-style";
import { DOC_DENSITY, docChromeCss, scaleF, scaleW } from "../../document-render/doc-density";
import { DOC_FIELD_CATALOGS, docFieldCss } from "../../document-render/doc-fields";
import type { EquivalenceVariant, SystemEquivalent } from "./tipler";

/** Dondurulmuş ayarın CSS'e giren parçası (`ayarNormalize` çıktısı; eksik alan varsayılana düşer). */
interface StyleSettings {
  style?: DocStyleConfig;
  blankGrid?: BlankGridConfig | null;
  fields?: Record<string, DocFieldStyle>;
}

const styleOf = (settings: Readonly<Record<string, unknown>>) =>
  resolveDocStyle((settings as StyleSettings).style, { marginMm: 9 });

/** Sistem CSS'i (`@page` hariç — o `pageSettings`ten gelir); yazı ölçeği bitmiş CSS'e uygulanır. */
function css(settings: Readonly<Record<string, unknown>>): string {
  const s = settings as StyleSettings;
  const style = styleOf(settings);
  const d = DOC_DENSITY[style.pageSize];
  return scaleDocCss(
    `
  * { box-sizing: border-box; }
  ${docChromeCss(d)}
  .hr .ln.sub { font-size: ${d.sub}px; color: #444; white-space: normal; max-width: ${scaleW(d, 240)}px; }
  .sec { margin-bottom: ${scaleW(d, 12)}px; }
  .sec th.caption { background: #e2e8f0; text-align: center; font-size: ${d.secCaption}px;
                    font-weight: 800; letter-spacing: 1px; padding: ${scaleW(d, 5)}px; }
  .sec thead th:not(.caption) { background: #f1f5f9; font-weight: 700; font-size: ${d.secHead}px; }
  .sec thead th.ident { background: #fff; font-weight: 400; font-size: ${d.sub}px;
                        text-transform: none; letter-spacing: 0; white-space: nowrap; }
  .sec thead th.ident b { font-weight: 700; }
  .sec td.wrap { white-space: pre-wrap; word-break: break-word; font-size: ${scaleF(d, 10)}px; }
  ${DOC_LOGO_CSS}
  ${DOC_STAMPS_CSS}
  ${docBlankGridCss({ blankGrid: s.blankGrid ?? undefined })}
  .pgb { break-before: page; page-break-before: always; }
  @media screen {
    table.pgb { margin-top: 26px; border-top: 3px double #b6bcc6; }
    table.pgb thead th.caption::before {
      content: "— yeni sayfa —"; display: block; margin-bottom: 5px;
      font-size: 9px; font-weight: 400; letter-spacing: .08em; color: #94a3b8;
    }
  }
  ${docTableCss(style, [".sec"])}
  ${docFieldCss(s.fields, DOC_FIELD_CATALOGS["shipmentDispatch"], d)}
`,
    style,
  );
}

function pageSettings(settings: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { pageSize, margins: m } = styleOf(settings);
  return { kagit: pageSize, kenar: { ust: m.top, sag: m.right, alt: m.bottom, sol: m.left } };
}

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Bekçi varyantları (plan §3.4): kolon düzeni · bölüm/imza/dipnot · stil · iç kolon · damga/blok/grid. */
const variants: EquivalenceVariant[] = [
  {
    name: "kolon_gizle_sira_baslik",
    config: {
      columns: {
        urun: { order: ["totalMeters", "rollCount", "name"], labels: { name: "ÜRÜN <&>" } },
        cuval: { hidden: ["totalKg"], order: ["packageCount", "code"], blankLabels: ["code"] },
        ceki: { hidden: ["batchNumber", "width"], order: ["meters", "kg"], labels: { barcode: "Barkod 'no'" } },
      },
    },
  },
  {
    name: "bolum_imza_dipnot_ust",
    config: {
      sections: { urun: false, taxNo: false, direction: false, orders: false, vehicleInfo: false, docNo: false, listHeader: true },
      signatureLabels: ["Hazırlayan", "Kontrol", "Teslim Alan"],
      footerNote: "Malı eksiksiz teslim aldım.",
      footerNotePlacement: "top",
      showLetterhead: false,
      titleOverride: "sevk fişi",
    },
  },
  {
    name: "a5_olcek_zebra",
    config: {
      style: { pageSize: "A5", fontScale: 0.85, tableStyle: "zebra", tableDensity: "compact", fontWeight: "bold", margins: { top: 5, left: 12 } },
      fields: { secCaption: { size: 14, weight: "black" }, wrapCell: { size: 9 } },
      showSignatures: false,
      blankWidths: true,
    },
  },
  {
    name: "ic_kolon_acik",
    config: {
      columns: { cuval: { shown: ["packingGroupCode", "note", "tag"] }, ceki: { shown: ["packingGroupCode"] } },
      style: { tableStyle: "plain", tableDensity: "relaxed", fontWeight: "light" },
    },
  },
  {
    name: "damga_blok_grid_logo",
    config: {
      qr: true,
      showLogo: true,
      logoPosition: "right",
      stamps: { printedAt: true, printedBy: true, copyLabel: "  ASIL  " },
      blocks: [
        { position: "afterHeader", text: "Üst blok\nikinci satır" },
        { position: "beforeSignatures", text: "Alt blok <b>" },
        { position: "beforeSignatures", text: "   " },
      ],
      blankGrid: { enabled: true, title: "KURŞUN KAYDI", rows: 3, columns: 4, columnWidths: [40, 20, 20, 20], headers: ["Top", "Kurşun"], position: "afterHeader" },
      sections: { listHeader: true },
    },
    print: { logo: TINY_PNG, qr: TINY_PNG, zaman: "2026-09-25T09:00:00.000Z", basan: "operatör", not: "Tek seferlik not" },
  },
];

const html = String.raw`<div class="sheet">
<header>
<div class="hl">
{%- assign logo_var = false -%}
{%- if ayar.showLogo and firma.logo != nil and firma.logo != "" -%}{%- assign logo_var = true -%}{%- endif -%}
{%- if logo_var and ayar.logoPosition != "right" -%}<img class="doc-logo" src="{{ firma.logo }}" alt="">{%- endif -%}
<div class="company">{{ firma.ad }}</div>
{%- if ayar.showLetterhead -%}
{%- if firma.adres != blank -%}<div class="lh-line">{{ firma.adres }}</div>{%- endif -%}
{%- if firma.telefon != blank -%}<div class="lh-line">{{ firma.telefon }}</div>{%- endif -%}
{%- if firma.vergi_bilgisi != nil and firma.vergi_bilgisi != "" -%}<div class="lh-line">V.D./No: {{ firma.vergi_bilgisi }}</div>{%- endif -%}
{%- for ek in tablolar.antet_ek -%}{%- if ek.metin != blank -%}<div class="lh-line">{{ ek.metin }}</div>{%- endif -%}{%- endfor -%}
{%- endif -%}
<div class="sayin">SAYIN: <b>{{ karsi_taraf.ad }}</b></div>
{%- assign dolu = false -%}
{%- capture musteri_alt -%}
{%- if ayar.sections.taxNo and karsi_taraf.vergi_no != nil and karsi_taraf.vergi_no != "" -%}V.No: {{ karsi_taraf.vergi_no }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.sections.branchName and karsi_taraf.sube != nil and karsi_taraf.sube != "" -%}{%- if dolu %} · {% endif -%}Şube: {{ karsi_taraf.sube }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.sections.exportCode and belge.ihracat_kodu != nil and belge.ihracat_kodu != "" -%}{%- if dolu %} · {% endif -%}İhracat Kodu: {{ belge.ihracat_kodu }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.sections.customerCode and karsi_taraf.kod != nil and karsi_taraf.kod != "" -%}{%- if dolu %} · {% endif -%}Kod: {{ karsi_taraf.kod }}{%- endif -%}
{%- endcapture -%}
{%- if musteri_alt != "" -%}<div class="sub">{{ musteri_alt }}</div>{%- endif -%}
</div>
<div class="hr">
{%- if logo_var and ayar.logoPosition == "right" -%}<img class="doc-logo" src="{{ firma.logo }}" alt="">{%- endif -%}
<div class="title">{{ belge.baslik }}</div>
{%- assign nusha = ayar.stamps.copyLabel | strip -%}
{%- if nusha != "" -%}<div class="copy-badge">{{ nusha }}</div>{%- endif -%}
{%- if ayar.sections.docNo -%}<div class="ln">İrsaliye No: <b>{{ belge.no }}</b></div>{%- endif -%}
{%- if ayar.sections.date -%}<div class="ln">Tarih: <b>{{ belge.tarih | tarih }}</b></div>{%- endif -%}
{%- if ayar.sections.direction -%}<div class="ln">Yön: <b>{% if belge.yurtdisi %}Yurtdışı{% else %}Yurtiçi{% endif %}</b></div>{%- endif -%}
{%- if ayar.sections.procedureCode and belge.gumruk_no != nil -%}<div class="ln">Gümrük/İhracat No: <b>{{ belge.gumruk_no }}</b></div>{%- endif -%}
{%- if ayar.sections.orders and belge.siparisler != nil and belge.siparisler != "" -%}<div class="ln sub">Sipariş: {{ belge.siparisler }}</div>{%- endif -%}
{%- if toplamlar.cuval_beyan_adedi != nil -%}<div class="ln">Çuval Adedi: <b>{{ toplamlar.cuval_beyan_adedi }}</b> <span class="sub">({{ toplamlar.cuval_adedi }} sistemde)</span></div>{%- endif -%}
</div>
</header>
{%- if ayar.sections.vehicleInfo -%}
{%- assign dolu = false -%}
{%- capture arac -%}
{%- if belge.plaka != nil and belge.plaka != "" -%}Plaka: <b>{{ belge.plaka }}</b>{%- assign dolu = true -%}{%- endif -%}
{%- if belge.sofor != nil and belge.sofor != "" -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}Şoför: <b>{{ belge.sofor }}</b>{%- assign dolu = true -%}{%- endif -%}
{%- if belge.tasiyici != nil and belge.tasiyici != "" -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}Taşıyıcı: <b>{{ belge.tasiyici }}</b>{%- endif -%}
{%- endcapture -%}
{%- if arac != "" -%}<div class="meta-row">{{ arac }}</div>{%- endif -%}
{%- endif -%}
{%- comment -%} Boş grid: isteğe bağlı alanlar (title/columnWidths/headers) nesne üzerinde gezilerek okunur. {%- endcomment -%}
{%- assign grid_konum = "" -%}
{%- if ayar.blankGrid != nil and ayar.blankGrid.enabled -%}
{%- assign grid_konum = ayar.blankGrid.position -%}
{%- assign grid_baslik = "" -%}{%- assign grid_genislik = "" -%}{%- assign grid_basliklar = "" -%}
{%- for alan in ayar.blankGrid -%}
{%- if alan[0] == "title" -%}{%- assign grid_baslik = alan[1] -%}{%- elsif alan[0] == "columnWidths" -%}{%- assign grid_genislik = alan[1] -%}{%- elsif alan[0] == "headers" -%}{%- assign grid_basliklar = alan[1] -%}{%- endif -%}
{%- endfor -%}
{%- assign baslik_sayisi = grid_basliklar | size -%}
{%- assign grid_baslik_kirpik = grid_baslik | strip -%}
{%- capture bos_grid -%}
<div class="bgrid-wrap">{%- if grid_baslik_kirpik != "" -%}<div class="bgrid-title">{{ grid_baslik }}</div>{%- endif -%}<table class="bgrid"><colgroup>
{%- for i in (1..ayar.blankGrid.columns) -%}{%- if grid_genislik != "" -%}<col style="width:{{ grid_genislik[forloop.index0] }}%">{%- else -%}<col>{%- endif -%}{%- endfor -%}
</colgroup>
{%- if baslik_sayisi > 0 -%}<thead><tr>{%- for i in (1..ayar.blankGrid.columns) -%}{%- if forloop.index <= baslik_sayisi -%}<th>{{ grid_basliklar[forloop.index0] }}</th>{%- else -%}<th></th>{%- endif -%}{%- endfor -%}</tr></thead>{%- endif -%}
<tbody>{%- for r in (1..ayar.blankGrid.rows) -%}<tr>{%- for c in (1..ayar.blankGrid.columns) -%}<td></td>{%- endfor -%}</tr>{%- endfor -%}</tbody></table></div>
{%- endcapture -%}
{%- endif -%}
{%- for blok in ayar.blocks -%}{%- if blok.position == "afterHeader" and blok.text != blank -%}<div class="doc-block">{{ blok.text }}</div>{%- endif -%}{%- endfor -%}
{%- if grid_konum == "afterHeader" -%}{{ bos_grid }}{%- endif -%}
{%- assign baski_notu = baski.not | strip -%}
{%- if ayar.footerNotePlacement == "top" -%}
{%- if ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}
{%- if baski_notu != "" -%}<div class="doc-block">{{ baski.not }}</div>{%- endif -%}
{%- endif -%}
{%- comment -%} Üç liste aynı kalıptan; açık listelerin ilki hariç her biri yeni sayfadan başlar. {%- endcomment -%}
{%- assign ilk_basildi = false -%}
{%- assign tablo_sirasi = "urun,cuval,ceki" | split: "," -%}
{%- for tb in tablo_sirasi -%}
{%- if ayar.sections[tb] -%}
{%- assign kolonlar = ayar.kolonlar[tb] -%}
{%- assign kolon_sayisi = kolonlar | size -%}
{%- if kolon_sayisi > 0 -%}
<table class="sec{% if ilk_basildi %} pgb{% endif %}"><thead>
<tr><th class="caption" colspan="{{ kolon_sayisi }}">{% case tb %}{% when "urun" %}ÜRÜN LİSTESİ{% when "cuval" %}ÇUVAL LİSTESİ{% else %}ÇEKİ LİSTESİ{% endcase %}</th></tr>
{%- if ayar.sections.listHeader and ilk_basildi -%}
{%- capture kimlik_sol -%}Sevk Edilen Firma: <b>{{ karsi_taraf.ad }}</b>{% if ayar.sections.docNo %} &nbsp;·&nbsp; İrsaliye No: <b>{{ belge.no }}</b>{% endif %}{%- endcapture -%}
{%- capture kimlik_sag -%}{%- if ayar.sections.date -%}{{ belge.tarih | tarih }}{%- endif -%}{%- endcapture -%}
{%- if kolon_sayisi > 1 -%}
{%- for k in kolonlar offset: 1 -%}{%- if forloop.first -%}{%- assign kimlik_genislik = forloop.length -%}{%- endif -%}{%- endfor -%}
<tr class="ident"><th class="ident l" colspan="{{ kimlik_genislik }}">{{ kimlik_sol }}</th><th class="ident r">{{ kimlik_sag }}</th></tr>
{%- else -%}
<tr class="ident"><th class="ident l">{{ kimlik_sol }}{% if kimlik_sag != "" %} &nbsp;·&nbsp; {{ kimlik_sag }}{% endif %}</th></tr>
{%- endif -%}
{%- endif -%}
<tr>{%- for kolon in kolonlar -%}<th class="{{ kolon.hiza }}"{% if kolon.anahtar == "aciklama" %} style="width:32%"{% elsif kolon.anahtar == "iz" %} style="width:22%"{% endif %}>{{ kolon.etiket }}</th>{%- endfor -%}</tr>
</thead><tbody>
{%- for satir in tablolar[tb] -%}
<tr>{%- for kolon in kolonlar -%}
{%- assign deger = satir[kolon.anahtar] -%}
<td class="{{ kolon.hiza }}{% if kolon.anahtar == "aciklama" or kolon.anahtar == "iz" %} wrap{% endif %}">
{%- case kolon.anahtar -%}
{%- when "metre" -%}{{ deger | sayi: 2 }}
{%- when "kg" -%}{%- if tb != "ceki" -%}{{ deger | sayi: 2 }}{%- elsif deger != nil and deger > 0 -%}{{ deger | sayi: 2 }}{%- endif -%}
{%- when "top_adedi" -%}{{ deger | sayi: 0 }}
{%- when "en" -%}{%- if ayar.blankWidths -%}{%- elsif deger == nil -%}—{%- else -%}{{ deger | sayi: 0 }} cm{%- endif -%}
{%- when "parti_kodu" -%}{%- assign ic_kodu = tb | append: "_parti_kodu" -%}{%- if ic_acik[ic_kodu] -%}{{ deger }}{%- endif -%}
{%- when "aciklama" -%}{%- if ic_acik.cuval_aciklama -%}{{ deger }}{%- endif -%}
{%- when "iz" -%}{%- if ic_acik.cuval_iz -%}{{ deger }}{%- endif -%}
{%- when "barkod", "parti_no" -%}{%- if deger == nil -%}—{%- else -%}{{ deger }}{%- endif -%}
{%- else -%}{{ deger }}
{%- endcase -%}
</td>
{%- endfor -%}</tr>
{%- endfor -%}
{%- assign toplamli = false -%}
{%- for kolon in kolonlar -%}{%- if kolon.toplam != nil -%}{%- assign toplamli = true -%}{%- endif -%}{%- endfor -%}
{%- if toplamli -%}
<tr class="tot">
{%- assign etiket_kondu = false -%}
{%- for kolon in kolonlar -%}
<td class="{{ kolon.hiza }}">
{%- assign toplam = nil -%}
{%- if kolon.toplam != nil -%}{%- assign toplam = toplamlar[kolon.toplam] -%}{%- endif -%}
{%- if toplam != nil -%}
{%- if kolon.toplam == "top_adedi" -%}{{ toplam | sayi: 0 }}{%- else -%}{{ toplam | sayi: 2 }}{%- endif -%}
{%- elsif etiket_kondu == false -%}TOPLAM{%- assign etiket_kondu = true -%}
{%- endif -%}
</td>
{%- endfor -%}
</tr>
{%- endif -%}
</tbody></table>
{%- endif -%}
{%- assign ilk_basildi = true -%}
{%- endif -%}
{%- endfor -%}
{%- if ayar.footerNotePlacement != "top" -%}
{%- if ayar.footerNote != "" -%}<div class="note">{{ ayar.footerNote }}</div>{%- endif -%}
{%- if baski_notu != "" -%}<div class="doc-block">{{ baski.not }}</div>{%- endif -%}
{%- endif -%}
{%- for blok in ayar.blocks -%}{%- if blok.position == "beforeSignatures" and blok.text != blank -%}<div class="doc-block">{{ blok.text }}</div>{%- endif -%}{%- endfor -%}
{%- if grid_konum == "beforeSignatures" -%}{{ bos_grid }}{%- endif -%}
{%- if ayar.showSignatures -%}
<div class="sign">{%- for etiket in ayar.signatureLabels -%}<div class="sign-box"><div class="sign-line"></div><div class="sign-lbl">{{ etiket }}</div></div>{%- endfor -%}</div>
{%- endif -%}
{%- assign dolu = false -%}
{%- capture damga -%}
{%- if ayar.stamps.printedAt and baski.zaman != nil and baski.zaman != "" -%}Basım: {{ baski.zaman | tarih_saat }}{%- assign dolu = true -%}{%- endif -%}
{%- if ayar.stamps.printedBy and baski.basan != nil and baski.basan != "" -%}{%- if dolu %} &nbsp;·&nbsp; {% endif -%}Basan: {{ baski.basan }}{%- endif -%}
{%- endcapture -%}
{%- assign qr_var = false -%}
{%- if ayar.qr and baski.qr != nil and baski.qr != "" -%}{%- assign qr_var = true -%}{%- endif -%}
{%- if damga != "" or qr_var -%}<div class="stamps"><div class="stamps-l">{{ damga }}</div>{%- if qr_var -%}<img src="{{ baski.qr }}" alt="">{%- endif -%}</div>{%- endif -%}
</div>`;

export const shipmentDispatchSystem: SystemEquivalent = {
  docType: "SHIPMENT_DISPATCH",
  editMode: "CODE",
  html,
  css,
  pageSettings,
  tableBindings: {},
  variants,
};
