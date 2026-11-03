// Cihazda OCR (S16c): tabletin ML Kit kelime listesini (`clientOcr`) okuma servisinin zarfına çevirir — şablon motoru
// iki kaynağı AYNI biçimde görür (her satır kendi bloğu, okuma sırası, açı = üst kenar; `okuma/app/motor.py` aynası).
// Saf modül: DB/ağ yok. Sözleşme katı (fazla alan 400); koordinat görüntü çerçevesine kırpılır.
import { z } from "zod";
import type { OcrElement, OcrLine, OcrPoint, OcrRect, OcrResult } from "./motor";

export const CLIENT_OCR_MAX_WORDS = 4000;
export const CLIENT_OCR_MAX_LINES = 2000;
export const CLIENT_OCR_ENGINE = "mlkit";

const Coord = z.number().min(-20000).max(20000);
const Quad = z.array(z.tuple([Coord, Coord])).length(4, "Dörtgen 4 köşe olmalı");
const Conf = z.number().min(0).max(1).nullable().optional();
const Word = z.strictObject({ t: z.string().max(200), c: Quad, l: z.number().int().min(0).max(CLIENT_OCR_MAX_LINES - 1).optional(), p: Conf });
const Line = z.strictObject({ c: Quad, p: Conf });
const Size = z.number().int().min(1).max(10000);

/** Tel sözleşmesi — tablet `mobil/src/services/deviceOcr.ts` `ClientOcr` ile aynı. */
export const ClientOcrSchema = z.strictObject({
  engine: z.literal(CLIENT_OCR_ENGINE),
  width: Size,
  height: Size,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  ms: z.number().min(0).max(600_000).optional(),
  words: z.array(Word).max(CLIENT_OCR_MAX_WORDS),
  lines: z.array(Line).max(CLIENT_OCR_MAX_LINES).optional(),
}).superRefine((v, ctx) => {
  const n = v.lines?.length;
  if (n !== undefined && v.words.some((w) => w.l !== undefined && w.l >= n)) ctx.addIssue({ code: "custom", message: "Kelimenin satır sırası satır listesinin dışında" });
});
export type ClientOcr = z.infer<typeof ClientOcrSchema>;
type Quad4 = [number, number][];

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

function clipQuad(q: Quad4, w: number, h: number): Quad4 {
  return q.map(([x, y]) => [Math.min(Math.max(x, 0), w), Math.min(Math.max(y, 0), h)] as [number, number]);
}

/** `poly_to_rect` aynası (0,1 yuvarlama). */
export function quadToRect(q: Quad4): OcrRect {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  return { x: r1(x0), y: r1(y0), width: r1(x1 - x0), height: r1(y1 - y0) };
}

const quadCorners = (q: Quad4): OcrPoint[] => q.map(([x, y]) => ({ x: r1(x), y: r1(y) }));

/** `poly_angle_deg` aynası: üst kenarın yatayla açısı, ±90'a katlanır. */
export function quadAngleDeg(q: Quad4): number {
  const [x0, y0] = q[0]!;
  const [x1, y1] = q[1]!;
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 0;
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  else if (ang < -90) ang += 180;
  return Math.round(ang * 100) / 100;
}

/** `sort_reading_order` aynası: dikey merkezi satır yüksekliğinin yarısı içinde olanlar aynı sıra, sonra x. */
export function sortReadingOrder<T extends { rect: OcrRect }>(lines: T[], tol = 0.5): T[] {
  const cy = (l: T) => l.rect.y + l.rect.height / 2;
  const items = [...lines].sort((a, b) => cy(a) - cy(b) || a.rect.x - b.rect.x);
  const rows: T[][] = [];
  for (const ln of items) {
    const ref = rows[rows.length - 1]?.[0];
    if (ref && Math.abs(cy(ln) - cy(ref)) <= Math.max(ref.rect.height, ln.rect.height) * tol) rows[rows.length - 1]!.push(ln);
    else rows.push([ln]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.rect.x - b.rect.x));
}

interface W { t: string; q: Quad4; p: number | null; rect: OcrRect }

/** Satır bilgisi (`l`) gelmediyse kelimeler geometriyle satırlanır: aynı sıra (y-tolerans) + yatay boşluk ≤ 0,5 × yükseklik (kelime arası ≈ 0,4; tablo hücresi ayrı satır kalır). */
function groupGeometric(words: W[]): W[][] {
  const out: W[][] = [];
  for (const row of [sortReadingOrder(words)].flatMap((s) => splitRows(s))) {
    let cur: W[] = [];
    for (const w of row) {
      const last = cur[cur.length - 1];
      if (last && w.rect.x - (last.rect.x + last.rect.width) > 0.5 * Math.max(last.rect.height, w.rect.height)) { out.push(cur); cur = []; }
      cur.push(w);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** Okuma sırasına dizilmiş kelimeleri sıra (row) gruplarına böler — `sortReadingOrder` ile aynı tolerans. */
function splitRows(sorted: W[]): W[][] {
  const rows: W[][] = [];
  const cy = (w: W) => w.rect.y + w.rect.height / 2;
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(cy(w) - cy(ref)) <= Math.max(ref.rect.height, w.rect.height) * 0.5 && w.rect.x >= row[row.length - 1]!.rect.x) row.push(w);
    else rows.push([w]);
  }
  return rows;
}

function meanConf(ws: W[]): number | null {
  const ps = ws.map((w) => w.p).filter((p): p is number => p !== null);
  return ps.length ? r4(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
}

function toLine(ws: W[], quad: Quad4 | null, p: number | null | undefined): OcrLine {
  const first = ws[0]!.q, last = ws[ws.length - 1]!.q;
  const q: Quad4 = quad ?? [first[0]!, last[1]!, last[2]!, first[3]!];
  const elements: OcrElement[] = ws.map((w) => ({ text: w.t, rect: w.rect, corners: quadCorners(w.q), confidence: w.p }));
  return { text: ws.map((w) => w.t).join(" "), rect: quadToRect(q), corners: quadCorners(q), confidence: p === undefined || p === null ? meanConf(ws) : r4(p), angle: quadAngleDeg(q), elements };
}

/**
 * Doğrulanmış `clientOcr` → `OcrResult` (okuma servisi zarfı biçimi). `l` her kelimede varsa satırlar cihazın satırıdır
 * (dörtgen `lines[l].c`, yoksa ilk/son kelime köşeleri); yoksa geometrik satırlama. Boş metinli kelime atlanır.
 */
export function clientOcrToResult(c: ClientOcr): OcrResult {
  const words: (W & { l?: number })[] = c.words
    .map((w) => ({ t: w.t.trim(), q: clipQuad(w.c, c.width, c.height), p: w.p === undefined || w.p === null ? null : r4(w.p), l: w.l }))
    .filter((w) => w.t.length > 0)
    .map((w) => ({ ...w, rect: quadToRect(w.q) }));
  const lineQuads = (c.lines ?? []).map((l) => ({ q: clipQuad(l.c, c.width, c.height), p: l.p }));
  let lines: OcrLine[];
  if (words.length && words.every((w) => w.l !== undefined)) {
    const groups = new Map<number, W[]>();
    for (const w of words) groups.set(w.l!, [...(groups.get(w.l!) ?? []), w]);
    lines = [...groups.entries()].map(([l, ws]) => toLine(ws, lineQuads[l]?.q ?? null, lineQuads[l]?.p));
  } else {
    lines = groupGeometric(words).map((ws) => toLine(ws, null, null));
  }
  const ordered = sortReadingOrder(lines);
  return {
    text: ordered.map((l) => l.text).join("\n"),
    blocks: ordered.map((l) => ({ text: l.text, rect: l.rect, corners: l.corners, lines: [l] })),
    imageWidth: c.width,
    imageHeight: c.height,
    ...(c.ms !== undefined ? { durationMs: Math.round(c.ms) } : {}),
    engine: CLIENT_OCR_ENGINE,
    rotation: c.rotation ?? 0,
  };
}
