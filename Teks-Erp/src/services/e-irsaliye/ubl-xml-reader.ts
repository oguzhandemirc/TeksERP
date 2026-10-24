// =============================================================================
// Küçük XML okuyucusu — YALNIZ kendi yazıcımızın alt kümesi için (bildirim, öğe,
// öznitelik, metin, beş varlık + sayısal varlık). Yorum/CDATA/DOCTYPE desteklenmez
// ve hata verir. Amacı doğrulayıcıya ağaç vermek: paket yok (plan §3.4, V4).
// =============================================================================

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

class Cursor {
  constructor(
    readonly src: string,
    public pos = 0,
  ) {}
  fail(msg: string): never {
    throw new Error(`${msg} (konum ${this.pos})`);
  }
  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }
  skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }
  readName(): string {
    const m = NAME_RE.exec(this.src.slice(this.pos, this.pos + 200));
    if (!m) this.fail("ad bekleniyordu");
    this.pos += m[0].length;
    return m[0];
  }
}

function decode(raw: string, c: Cursor): string {
  return raw.replace(/&([^;&]*);?/g, (whole, body: string) => {
    if (!whole.endsWith(";")) c.fail("çıplak '&' (kaçışsız)");
    if (body in ENTITIES) return ENTITIES[body]!;
    const num = /^#x([0-9A-Fa-f]+)$/.exec(body) ?? /^#([0-9]+)$/.exec(body);
    if (num) return String.fromCodePoint(parseInt(num[1]!, body.startsWith("#x") ? 16 : 10));
    return c.fail(`tanınmayan varlık &${body};`);
  });
}

function readAttrs(c: Cursor): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (;;) {
    c.skipSpace();
    if (c.startsWith("/>") || c.startsWith(">")) return attrs;
    const key = c.readName();
    c.skipSpace();
    if (!c.startsWith("=")) c.fail(`'${key}' özniteliğinde '=' yok`);
    c.pos++;
    c.skipSpace();
    const q = c.src[c.pos];
    if (q !== '"' && q !== "'") c.fail(`'${key}' değeri tırnaksız`);
    const end = c.src.indexOf(q, c.pos + 1);
    if (end < 0) c.fail(`'${key}' değeri kapanmadı`);
    const raw = c.src.slice(c.pos + 1, end);
    if (raw.includes("<")) c.fail(`'${key}' değerinde kaçışsız '<'`);
    if (key in attrs) c.fail(`'${key}' özniteliği iki kez`);
    attrs[key] = decode(raw, c);
    c.pos = end + 1;
  }
}

function readElement(c: Cursor): XmlNode {
  if (!c.startsWith("<")) c.fail("öğe bekleniyordu");
  c.pos++;
  if (c.startsWith("!") || c.startsWith("?")) c.fail("yorum/CDATA/işlem talimatı desteklenmez");
  const node: XmlNode = { name: c.readName(), attrs: {}, children: [], text: "" };
  node.attrs = readAttrs(c);
  if (c.startsWith("/>")) {
    c.pos += 2;
    return node;
  }
  c.pos++; // '>'
  let text = "";
  for (;;) {
    if (c.pos >= c.src.length) c.fail(`'${node.name}' kapanmadı`);
    if (c.startsWith("</")) {
      c.pos += 2;
      const closing = c.readName();
      if (closing !== node.name) c.fail(`'${node.name}' beklenirken '${closing}' kapandı`);
      c.skipSpace();
      if (!c.startsWith(">")) c.fail("kapanış etiketi bozuk");
      c.pos++;
      node.text = decode(text, c);
      return node;
    }
    if (c.startsWith("<")) {
      node.children.push(readElement(c));
      continue;
    }
    const next = c.src.indexOf("<", c.pos);
    const end = next < 0 ? c.src.length : next;
    text += c.src.slice(c.pos, end);
    c.pos = end;
  }
}

/** Bildirimli tek kök öğeli belgeyi okur; iyi biçimli değilse Türkçe mesajla hata atar. */
export function parseXml(xml: string): XmlNode {
  const c = new Cursor(xml);
  if (c.startsWith("<?xml")) {
    const end = xml.indexOf("?>");
    if (end < 0) c.fail("XML bildirimi kapanmadı");
    c.pos = end + 2;
  }
  c.skipSpace();
  const root = readElement(c);
  c.skipSpace();
  if (c.pos !== xml.length) c.fail("kök öğeden sonra içerik var");
  return root;
}

/** Ad listesi verilen doğrudan çocuklar. */
export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((ch) => ch.name === name);
}
