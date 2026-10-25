/**
 * Gidiş-dönüş fikstürünün istemci yarısı: blokların, kalem tablolarının ve koşul
 * kurucusunun ürettiği HTML. Backend bekçisi (`test_belge_tasarimci_gidis_donus`) aynı
 * JSON'u T1A derleyicisinden + önizleme hattından geçirir.
 */
import { barcodeHtml, dataFieldHtml, DOCUMENT_BLOCK_CSS, logoHtml, pageBreakHtml, qrHtml, signatureHtml, totalBoxHtml } from "./blockHtml";
import type { ContractView, FieldType } from "./contract";
import { buildCondition, FILTER_NAMES, suggestFilters, type ConditionRow } from "./directives";
import { defaultColumns, itemTableHtml } from "./itemTable";
import { DEFAULT_PAGE_SETTINGS, type PageSettings } from "./pageSettings";

export interface RoundtripSample {
  ad: string;
  html: string;
  css: string;
  internalFields?: string[];
}

const row = (p: Partial<ConditionRow> & { path: string }): ConditionRow => ({ join: "and", op: "", valueKind: "metin", value: "", ...p });

export const CONDITION_CASES: ConditionRow[][] = [
  [row({ path: "belge.ihracat_kodu" })],
  [row({ path: "satir.metre", op: ">", valueKind: "sayi", value: "0" })],
  [row({ path: "karsi_taraf.ad", op: "==", value: "ACME A.Ş." }), row({ join: "or", path: "belge.yurtdisi", op: "==", valueKind: "sabit", value: "true" })],
  [row({ path: "belge.siparisler", op: "contains", value: "SP-" }), row({ path: "belge.plaka", op: "!=", valueKind: "sabit", value: "blank" }), row({ join: "or", path: "toplamlar.kg", op: ">=", valueKind: "sayi", value: "12.5" })],
];

/** Kurucunun REDDETTİĞİ ham girdiler — backend de reddetmeli. */
export const INVALID_CONDITIONS = ["", "(belge.no)", "belge.no ==", "belge.no and", "belge.no xor belge.tur", "belge.no == '{{x}}'", 'belge.no == "x{y"', "belge.no == 12,5"];

export function conditionStrings(): string[] {
  return CONDITION_CASES.map((rows) => {
    const r = buildCondition(rows);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  });
}

export function filterSuggestionStrings(): string[] {
  const types: Array<[FieldType, { ondalik?: number; birim?: string }]> = [
    ["tarih", {}], ["tarih_saat", {}], ["takvim", {}], ["para", {}], ["metin", {}], ["sayi", { birim: "m", ondalik: 2 }], ["sayi", { birim: "kg", ondalik: 1 }], ["sayi", {}],
  ];
  return [...new Set(types.flatMap(([t, o]) => suggestFilters(t, o).map((s) => s.value)).filter(Boolean))];
}

export const PAGE_SETTINGS_CASES: { valid: PageSettings[]; conflicting: PageSettings[] } = {
  valid: [
    DEFAULT_PAGE_SETTINGS,
    { ...DEFAULT_PAGE_SETTINGS, kagit: "A5", yon: "yatay", kenar: { ust: 0, sag: 50, alt: 22.5, sol: 10 }, ustBilgi: { sol: "Örnek A.Ş.", orta: "", sag: "Sevk" }, altBilgi: { orta: "", sag: "Gizli" }, sayfaNo: { konum: "alt-orta", bicim: "Sayfa {n} / {N}" }, ilkSayfaFarkli: true },
  ],
  conflicting: [
    { ...DEFAULT_PAGE_SETTINGS, altBilgi: { orta: "", sag: "x" }, sayfaNo: { konum: "alt-sag", bicim: "{n}" } },
    { ...DEFAULT_PAGE_SETTINGS, altBilgi: { orta: "x", sag: "" }, sayfaNo: { konum: "alt-orta", bicim: "{n}" } },
  ],
};

/** Sevk irsaliyesi pilotu: logo + başlık alanları + kalem tablosu + toplamlar + imza. */
export function pilotHtml(c: ContractView, settings: Readonly<Record<string, unknown>>): string {
  const f = (p: string) => dataFieldHtml(p, c.kokler.find((x) => x.yol === p));
  const urun = c.tablolar.find((t) => t.anahtar === "urun") ?? c.tablolar[0]!;
  return [
    `<header class="ust">${logoHtml()}<div><h1>${f("belge.baslik")}</h1><div>No: ${f("belge.no")}</div><div>Tarih: ${f("belge.tarih")}</div></div></header>`,
    `<section><b>Sayın:</b> ${f("karsi_taraf.ad")}<div data-if="belge.ihracat_kodu">İhracat kodu: ${f("belge.ihracat_kodu")}</div></section>`,
    itemTableHtml(urun, defaultColumns(urun, [])).replace("<tr data-each=", '<tr data-if="satir.metre > 0" data-each='),
    totalBoxHtml(c),
    signatureHtml(settings),
    `<footer>${barcodeHtml()} ${qrHtml()}</footer>`,
  ].join("");
}

export function buildRoundtripSamples(c: ContractView, settings: Readonly<Record<string, unknown>>): RoundtripSample[] {
  const css = DOCUMENT_BLOCK_CSS;
  const field = (p: string) => ({ ad: `veri-alani ${p}`, html: `<p>${dataFieldHtml(p, c.kokler.find((x) => x.yol === p))}</p>`, css });
  const out: RoundtripSample[] = ["belge.no", "belge.tarih", "baski.zaman", "toplamlar.metre"].map(field);
  for (const t of c.tablolar) out.push({ ad: `kalem-tablosu ${t.anahtar}`, html: itemTableHtml(t, defaultColumns(t, [])), css });
  const cuval = c.tablolar.find((t) => t.anahtar === "cuval");
  const ic = cuval?.kolonlar.find((k) => k.sinif === "ic" && k.icKod);
  if (cuval && ic?.icKod) {
    out.push({ ad: `ic-kolon-acik ${ic.icKod}`, html: itemTableHtml(cuval, [...defaultColumns(cuval, []), ic.yol]), css, internalFields: [ic.icKod] });
  }
  out.push(
    { ad: "toplam-kutusu", html: totalBoxHtml(c), css },
    { ad: "logo", html: logoHtml(), css },
    { ad: "barkod", html: barcodeHtml(), css },
    { ad: "qr", html: qrHtml(), css },
    { ad: "imza-alani", html: signatureHtml(settings), css },
    { ad: "sayfa-kesmesi", html: `<p>1</p>${pageBreakHtml()}<p>2</p>`, css },
    { ad: "kosul-kurucu", html: conditionStrings().filter((s) => !s.startsWith("satir.")).map((s, i) => `<div data-if="${s.replace(/"/g, "&quot;")}">k${i}</div>`).join(""), css },
    { ad: "pilot-sevk-irsaliyesi", html: pilotHtml(c, settings), css },
  );
  return out;
}

export function buildFixtureClientPart(c: ContractView, settings: Readonly<Record<string, unknown>>) {
  return {
    samples: buildRoundtripSamples(c, settings),
    conditions: { valid: conditionStrings(), invalid: INVALID_CONDITIONS },
    filters: { names: [...FILTER_NAMES], suggestions: filterSuggestionStrings() },
    pageSettings: PAGE_SETTINGS_CASES,
  };
}
