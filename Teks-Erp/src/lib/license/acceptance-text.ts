// İLK KURULUM KABUL METNİ (Ek-7 §2) — fabrikanın gösterdiği güncel metin ve ekran blokları. Metnin kendisi
// üretilmiş dosyadadır (`acceptance-text.generated.ts`, hukuk belgesinden); panel metni KOPYALAMAZ, bu bloklardan çizer.
import { ACCEPTANCE_TEXTS, acceptanceTextDigest } from "./protocol";
import { CURRENT_ACCEPTANCE_TEXT } from "./acceptance-text.generated";

export type AcceptanceBlock =
  | { readonly tur: "paragraf"; readonly satirlar: readonly string[] }
  | { readonly tur: "liste"; readonly maddeler: readonly string[] }
  | { readonly tur: "kutu"; readonly no: string; readonly metin: string }
  | { readonly tur: "alanlar" }
  | { readonly tur: "dugmeler" };

const BOX = /^☐ \*\*(\d{1,2})\.\*\*\s+(.+)$/;
const FIELDS = /^Ad Soyad:\s*\[_+\]\s+Unvan:\s*\[_+\]$/;
const BUTTONS = /^\[ \*\*[^*]+\*\* \](\s+\[ [^\]]+ \])*$/;

/** Paragraf içinde ardışık `- ` satırları liste, diğerleri paragraf olur — metin sırası korunur. */
function splitRuns(lines: readonly string[], out: AcceptanceBlock[]): void {
  let run: string[] = [];
  let list = false;
  const flush = (): void => {
    if (run.length > 0) out.push(list ? { tur: "liste", maddeler: run } : { tur: "paragraf", satirlar: run });
    run = [];
  };
  for (const line of lines) {
    const item = line.startsWith("- ");
    if (item !== list) flush();
    list = item;
    run.push(item ? line.slice(2) : line);
  }
  flush();
}

/** Boş satırla ayrılan paragraflar → bloklar; tanınmayan biçim paragraf kalır (metin kaybolmaz). */
export function parseAcceptanceBlocks(text: string): AcceptanceBlock[] {
  const blocks: AcceptanceBlock[] = [];
  const paragraphs = text
    .split("\n")
    .reduce<string[][]>((acc, line) => {
      if (line.trim() === "") acc.push([]);
      else acc[acc.length - 1]!.push(line);
      return acc;
    }, [[]])
    .filter((p) => p.length > 0);
  for (const lines of paragraphs) {
    const only = lines.length === 1 ? lines[0]! : null;
    const box = only === null ? null : BOX.exec(only);
    if (box) blocks.push({ tur: "kutu", no: box[1]!, metin: box[2]! });
    else if (only !== null && FIELDS.test(only)) blocks.push({ tur: "alanlar" });
    else if (only !== null && BUTTONS.test(only)) blocks.push({ tur: "dugmeler" });
    else splitRuns(lines, blocks);
  }
  return blocks;
}

export function acceptanceBoxes(blocks: readonly AcceptanceBlock[]): string[] {
  return blocks.flatMap((b) => (b.tur === "kutu" ? [b.no] : []));
}

export interface CurrentAcceptanceText {
  readonly kimlik: string;
  readonly ozet: string;
  readonly metin: string;
  /** Avukat onayı bekleyen taslak (`-taslak`) — panel bunu açıkça yazar. */
  readonly taslak: boolean;
  readonly bloklar: readonly AcceptanceBlock[];
  readonly kutular: readonly string[];
  /** Metin protokol kataloğunun SON satırı mı (satıcı onu tanıyacak mı) — değilse kabul alınmaz. */
  readonly katalogda: boolean;
}

function build(): CurrentAcceptanceText {
  const { kimlik: id, metin: text } = CURRENT_ACCEPTANCE_TEXT;
  const digest = acceptanceTextDigest(text);
  const blocks = parseAcceptanceBlocks(text);
  const boxes = acceptanceBoxes(blocks);
  const last = ACCEPTANCE_TEXTS.at(-1);
  const inCatalog = !!last && last.kimlik === id && last.ozet === digest && last.kutular.join(",") === boxes.join(",");
  return { kimlik: id, ozet: digest, metin: text, taslak: id.endsWith("-taslak"), bloklar: blocks, kutular: boxes, katalogda: inCatalog };
}

let memo: CurrentAcceptanceText | null = null;
export function currentAcceptanceText(): CurrentAcceptanceText {
  return (memo ??= build());
}
