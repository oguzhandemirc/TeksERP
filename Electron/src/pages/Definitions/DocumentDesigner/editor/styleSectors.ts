/**
 * Stil paneli (GrapesJS Style Manager) sektörleri — plan §4 "Stil paneli".
 * Her özellik AÇIKÇA tanımlanır: GrapesJS'in yerleşik tanımları İngilizce
 * etiket ve vh/vw birimleri taşır, ayrıca baskıda anlamsız özellikleri
 * (transform, animasyon, position:fixed) açar.
 */

export const STYLE_UNITS = ["mm", "pt", "px", "%"] as const;
export const COLOR_PROPERTY_TYPE = "tekserp-color";

/** Panelde HİÇ görünmeyecek özellikler ve birimler (bekçi: styleSectors.test.ts). */
export const HIDDEN_PROPERTIES = ["transform", "animation", "transition", "perspective", "filter", "z-index"] as const;
export const HIDDEN_UNITS = ["vh", "vw", "vmin", "vmax"] as const;
export const HIDDEN_POSITIONS = ["fixed", "sticky"] as const;

/** Yalnız yerel/genel aileler — dış yazı tipi yüklenmez (plan §3.9). */
export const FONT_FAMILIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "Arial, Helvetica, sans-serif", label: "Arial (sans-serif)" },
  { id: "Helvetica, Arial, sans-serif", label: "Helvetica (sans-serif)" },
  { id: "Tahoma, Verdana, sans-serif", label: "Tahoma (sans-serif)" },
  { id: "Verdana, Geneva, sans-serif", label: "Verdana (sans-serif)" },
  { id: "'Times New Roman', Times, serif", label: "Times New Roman (serif)" },
  { id: "Georgia, serif", label: "Georgia (serif)" },
  { id: "'Courier New', Courier, monospace", label: "Courier New (eş aralıklı)" },
  { id: "sans-serif", label: "Genel sans-serif" },
  { id: "serif", label: "Genel serif" },
  { id: "monospace", label: "Genel eş aralıklı" },
];

type Option = { id: string; label: string };
export interface PropertyDef {
  property: string;
  label: string;
  type: string;
  default?: string;
  units?: string[];
  min?: number;
  options?: Option[];
  properties?: PropertyDef[];
}
export interface SectorDef {
  id: string;
  name: string;
  open: boolean;
  properties: PropertyDef[];
}

const num = (property: string, label: string, units: readonly string[] = STYLE_UNITS): PropertyDef => ({
  property, label, type: "number", units: [...units], default: "", min: 0,
});
const sel = (property: string, label: string, options: Array<[string, string]>): PropertyDef => ({
  property, label, type: "select", default: options[0]![0], options: options.map(([id, l]) => ({ id, label: l })),
});
const color = (property: string, label: string): PropertyDef => ({ property, label, type: COLOR_PROPERTY_TYPE, default: "" });
const sides = (prefix: string, label: string): PropertyDef => ({
  property: prefix, label, type: "composite",
  properties: [["top", "Üst"], ["right", "Sağ"], ["bottom", "Alt"], ["left", "Sol"]].map(([s, l]) => num(`${prefix}-${s}`, l!)),
});
const BREAK: Array<[string, string]> = [["auto", "Otomatik"], ["page", "Sayfa kes"], ["avoid", "Bölme"], ["avoid-page", "Sayfada bölme"]];

export const STYLE_SECTORS: SectorDef[] = [
  {
    id: "layout", name: "Yerleşim", open: true,
    properties: [
      sel("display", "Görünüm", [["block", "Blok"], ["inline-block", "Satır içi blok"], ["inline", "Satır içi"], ["flex", "Esnek"], ["table", "Tablo"], ["none", "Gizli"]]),
      sel("position", "Konum", [["static", "Akışta"], ["relative", "Göreli"], ["absolute", "Mutlak"]]),
      num("top", "Üst"), num("left", "Sol"), num("width", "Genişlik"), num("height", "Yükseklik"),
      num("min-width", "En az genişlik"), num("max-width", "En çok genişlik"),
      num("min-height", "En az yükseklik"), num("max-height", "En çok yükseklik"),
      sides("margin", "Dış boşluk"), sides("padding", "İç boşluk"),
      sel("float", "Yasla", [["none", "Yok"], ["left", "Sola"], ["right", "Sağa"]]),
      sel("overflow", "Taşma", [["visible", "Görünür"], ["hidden", "Kırp"]]),
      sel("flex-direction", "Esnek yön", [["row", "Yatay"], ["column", "Dikey"]]),
      sel("justify-content", "Yatay hiza", [["flex-start", "Başa"], ["center", "Ortaya"], ["flex-end", "Sona"], ["space-between", "Aralı"]]),
      sel("align-items", "Dikey hiza", [["stretch", "Uzat"], ["flex-start", "Üste"], ["center", "Ortaya"], ["flex-end", "Alta"]]),
      num("gap", "Aralık"),
    ],
  },
  {
    id: "typography", name: "Tipografi", open: false,
    properties: [
      { property: "font-family", label: "Yazı tipi", type: "select", default: FONT_FAMILIES[0]!.id, options: [...FONT_FAMILIES] },
      num("font-size", "Yazı boyutu"),
      sel("font-weight", "Kalınlık", [["400", "Normal"], ["300", "İnce"], ["500", "Orta"], ["600", "Yarı kalın"], ["700", "Kalın"], ["900", "Çok kalın"]]),
      sel("font-style", "Biçim", [["normal", "Düz"], ["italic", "Eğik"]]),
      num("line-height", "Satır yüksekliği"), num("letter-spacing", "Harf aralığı"),
      color("color", "Yazı rengi"),
      sel("text-align", "Hizalama", [["left", "Sola"], ["center", "Ortaya"], ["right", "Sağa"], ["justify", "İki yana"]]),
      sel("text-decoration", "Çizgi", [["none", "Yok"], ["underline", "Altı çizili"], ["line-through", "Üstü çizili"]]),
      sel("text-transform", "Harf dönüşümü", [["none", "Yok"], ["uppercase", "BÜYÜK HARF"], ["lowercase", "küçük harf"], ["capitalize", "Baş Harfler"]]),
      sel("white-space", "Satır kırma", [["normal", "Kır"], ["nowrap", "Kırma"], ["pre-wrap", "Boşlukları koru"]]),
    ],
  },
  {
    id: "border", name: "Kenarlık", open: false,
    properties: [
      {
        property: "border", label: "Kenarlık", type: "composite",
        properties: [
          num("border-width", "Kalınlık", ["mm", "pt", "px"]),
          sel("border-style", "Çizgi", [["none", "Yok"], ["solid", "Düz"], ["dashed", "Kesikli"], ["dotted", "Noktalı"], ["double", "Çift"]]),
          color("border-color", "Renk"),
        ],
      },
      num("border-radius", "Köşe yuvarlama"),
    ],
  },
  {
    id: "background", name: "Arka plan", open: false,
    properties: [
      color("background-color", "Arka plan rengi"),
      { property: "background-image", label: "Arka plan görseli", type: "file", default: "none" },
      sel("background-repeat", "Tekrar", [["no-repeat", "Tekrarlama"], ["repeat", "Döşe"], ["repeat-x", "Yatay döşe"], ["repeat-y", "Dikey döşe"]]),
      sel("background-size", "Boyut", [["auto", "Özgün"], ["contain", "Sığdır"], ["cover", "Kapla"]]),
      sel("background-position", "Konum", [["left top", "Sol üst"], ["center center", "Orta"], ["right top", "Sağ üst"], ["left bottom", "Sol alt"], ["right bottom", "Sağ alt"]]),
    ],
  },
  {
    id: "table", name: "Tablo", open: false,
    properties: [
      sel("border-collapse", "Kenarlık birleşimi", [["collapse", "Birleşik"], ["separate", "Ayrık"]]),
      num("border-spacing", "Hücre aralığı", ["mm", "pt", "px"]),
      sel("table-layout", "Kolon genişliği", [["auto", "İçeriğe göre"], ["fixed", "Sabit"]]),
      sel("vertical-align", "Dikey hiza", [["top", "Üst"], ["middle", "Orta"], ["bottom", "Alt"], ["baseline", "Taban çizgisi"]]),
    ],
  },
  {
    id: "print", name: "Baskı", open: false,
    properties: [
      sel("break-before", "Öncesinde sayfa", BREAK),
      sel("break-after", "Sonrasında sayfa", BREAK),
      sel("break-inside", "İçinde bölünme", BREAK.filter(([id]) => id !== "page")),
      num("orphans", "Sayfa sonu en az satır", []),
      num("widows", "Sayfa başı en az satır", []),
    ],
  },
];

/** Sektör ağacındaki bütün özellikler (composite alt özellikleri dahil) — test ve denetim için. */
export function flattenProperties(sectors: SectorDef[] = STYLE_SECTORS): PropertyDef[] {
  const walk = (p: PropertyDef): PropertyDef[] => [p, ...(p.properties ?? []).flatMap(walk)];
  return sectors.flatMap((s) => s.properties.flatMap(walk));
}
