// =============================================================================
// Öznitelik değeri varlık çözücüsü — adres (href/src) ve style değerleri tarayıcının
// GÖRECEĞİ biçimde denetlensin diye (`&#106;avascript:` · `javascript&colon;`).
// Tanınmayan `&ad;` referansı FAIL-CLOSED: çözücü null döner, değer kesilir — tarayıcının
// çözüp bizim çözemediğimiz bir referans şemayı gizleyemesin.
// =============================================================================

/** ASCII'ye çözülen bütün adlı referanslar + sık kullanılan tipografi/Türkçe harfler. */
const NAMED: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", Tab: "\t", NewLine: "\n",
  excl: "!", num: "#", dollar: "$", percnt: "%", lpar: "(", rpar: ")", ast: "*", midast: "*",
  plus: "+", comma: ",", period: ".", sol: "/", colon: ":", semi: ";", equals: "=", quest: "?",
  commat: "@", lsqb: "[", lbrack: "[", bsol: "\\", rsqb: "]", rbrack: "]", Hat: "^", lowbar: "_",
  UnderBar: "_", grave: "`", DiacriticalGrave: "`", lcub: "{", lbrace: "{", verbar: "|", vert: "|",
  VerticalLine: "|", rcub: "}", rbrace: "}", AMP: "&", LT: "<", GT: ">", QUOT: '"',
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  bull: "•", middot: "·", deg: "°", plusmn: "±", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³", micro: "µ",
  shy: "­", ensp: " ", emsp: " ", thinsp: " ", zwnj: "‌", zwj: "‍",
  Ccedil: "Ç", ccedil: "ç", Ouml: "Ö", ouml: "ö", Uuml: "Ü", uuml: "ü",
  Scedil: "Ş", scedil: "ş", Gbreve: "Ğ", gbreve: "ğ", Idot: "İ", imath: "ı",
  inodot: "ı",
};

/** Noktalı virgülsüz de çözülen eski adlar (yalnız ASCII olanlar şema gizleyebilir). */
const LEGACY_NO_SEMICOLON = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg", "AMP", "LT", "GT", "QUOT"]);

function fromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
  return String.fromCodePoint(cp);
}

const REFERENCE = /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z][A-Za-z0-9]*)(;?))/g;

/** Tek referansın karşılığı; tanınmayan `&ad;` için null. */
function decodeOne(m: RegExpExecArray, value: string): string | null {
  const [whole, hex, dec, name = "", semi] = m;
  if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
  if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
  if (semi === ";") return NAMED[name] ?? null;
  // Noktalı virgülsüz: tarayıcı ancak ardından '=' ya da harf/rakam gelmiyorsa çözer.
  const after = value[m.index + whole.length] ?? "";
  return LEGACY_NO_SEMICOLON.has(name) && !/[=A-Za-z0-9]/.test(after) ? (NAMED[name] ?? whole) : whole;
}

/** Öznitelik değerindeki referansları çözer; tanınmayan `&ad;` varsa null. */
export function decodeAttrEntities(value: string): string | null {
  let out = "";
  let last = 0;
  REFERENCE.lastIndex = 0;
  for (let m = REFERENCE.exec(value); m !== null; m = REFERENCE.exec(value)) {
    const ch = decodeOne(m, value);
    if (ch === null) return null;
    out += value.slice(last, m.index) + ch;
    last = m.index + m[0].length;
  }
  return out + value.slice(last);
}

/** Çözülmüş değeri çift tırnaklı özniteliğe geri yazar (tarayıcı AYNI değeri okur). */
export function encodeAttrValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
