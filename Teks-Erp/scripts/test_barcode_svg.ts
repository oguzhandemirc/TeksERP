// =============================================================================
// BEKÇİ: Etiket/belge barkod SVG'si (Perf-2 B3) — DB gerektirmez
// Çalıştır: npx tsx scripts/test_barcode_svg.ts
// =============================================================================
// §1 raw() geometrisinden üretilen SVG, bwip toSVG ile AYNI viewBox ve AYNI kara
//    modülleri taşır (Code128 çubuk aralıkları; QR modül ızgarası çift-tek kuralıyla)
// §2 içerik önbelleği: isabet aynı metni döner ve kodlama yapmaz; LRU tavanı tutar,
//    dokunulan giriş düşmez; hata önbelleğe girmez
// §3 zaman dilimli nefes: 2.000 etiketlik senkron iş event-loop'u dilim + bir etiketten
//    uzun bloklamaz (setImmediate gecikmesi ölçülür)
// §4 tek kaynak: etiket/kart servislerinde çıplak bwipjs.toSVG yok; toplu etiket
//    döngüleri sayaçlı `% 25` değil zaman dilimli nefes kullanır
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import bwipjs from "bwip-js";
import {
  BARCODE_SVG_CACHE_MAX,
  BULK_LABEL_SLICE_MS,
  barcodeSvgCacheStats,
  clearBarcodeSvgCache,
  createSliceYielder,
  renderCode128Svg,
  renderQrSvg,
} from "../src/services/helpers/barcode-svg.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const viewBox = (svg: string): string => /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "?";

/** bwip Code128: `stroke-width=w` yolları, her `M x …` çubuğun ortası. */
function bwipBars(svg: string): string {
  const bars: Array<[number, number]> = [];
  for (const m of svg.matchAll(/stroke-width="([\d.]+)" d="([^"]+)"/g)) {
    const w = Number(m[1]);
    for (const mm of m[2]!.matchAll(/M([\d.]+) /g)) bars.push([Number(mm[1]) - w / 2, Number(mm[1]) + w / 2]);
  }
  return bars
    .sort((a, b) => a[0] - b[0])
    .map((b) => b.join("-"))
    .join(",");
}
function ourBars(svg: string): string {
  return [...svg.matchAll(/M([\d.]+) 0h([\d.]+)/g)].map((m) => `${Number(m[1])}-${Number(m[1]) + Number(m[2])}`).join(",");
}

type Pt = [number, number];
/** SVG yolu → kapalı çokgenler (M/L/H/V/Z, mutlak ve göreli h/v). */
function polygons(svg: string): Pt[][] {
  const out: Pt[][] = [];
  for (const m of svg.matchAll(/<path[^>]* d="([^"]+)"/g)) {
    if (/stroke-width/.test(m[0])) continue;
    let cur: Pt[] = [];
    let x = 0;
    let y = 0;
    for (const t of m[1]!.matchAll(/([MLHVZhvz])([^MLHVZhvz]*)/g)) {
      const nums = t[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      switch (t[1]) {
        case "M":
          if (cur.length) out.push(cur);
          [x, y] = [nums[0]!, nums[1]!];
          cur = [[x, y]];
          break;
        case "L":
          [x, y] = [nums[0]!, nums[1]!];
          cur.push([x, y]);
          break;
        case "h":
          x += nums[0]!;
          cur.push([x, y]);
          break;
        case "v":
          y += nums[0]!;
          cur.push([x, y]);
          break;
        case "H":
          x = nums[0]!;
          cur.push([x, y]);
          break;
        case "V":
          y = nums[0]!;
          cur.push([x, y]);
          break;
        default:
          if (cur.length) out.push(cur);
          cur = [];
      }
    }
    if (cur.length) out.push(cur);
  }
  return out;
}
/** Çift-tek kuralıyla ızgara: her modül merkezi kaç kenarı keser. */
function rasterize(svg: string, module: number): string {
  const [, , w, h] = viewBox(svg).split(" ").map(Number);
  const polys = polygons(svg);
  let bits = "";
  for (let cy = module / 2; cy < h!; cy += module) {
    for (let cx = module / 2; cx < w!; cx += module) {
      let inside = false;
      for (const p of polys) {
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xi, yi] = p[i]!;
          const [xj, yj] = p[j]!;
          if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
        }
      }
      bits += inside ? "1" : "0";
    }
  }
  return bits;
}

const SAMPLES = [
  "R2610120001",
  "CV3007260003",
  "TK-2026-000123",
  "A",
  "1234567890123",
  "kartela/123",
  "PK261012000045",
  "SEV-2026-00017",
  "X".repeat(40),
  ...Array.from({ length: 30 }, (_, i) => `R26${String(1012000000 + i * 7919)}`),
];

console.log("\n§1 bwip toSVG ile görsel eşdeğerlik");
{
  let c128Bad = 0;
  let qrBad = 0;
  for (const text of SAMPLES) {
    const old = bwipjs.toSVG({ bcid: "code128", text, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    const neu = renderCode128Svg(text);
    if (viewBox(old) !== viewBox(neu) || bwipBars(old) !== ourBars(neu)) {
      c128Bad++;
      console.log(`    Code128 fark: ${text} ${viewBox(old)} ↔ ${viewBox(neu)}`);
    }
    const oq = bwipjs.toSVG({ bcid: "qrcode", text, scale: 3, backgroundcolor: "FFFFFF" });
    const nq = renderQrSvg(text);
    if (viewBox(oq) !== viewBox(nq) || rasterize(oq, 6) !== rasterize(nq, 6)) {
      qrBad++;
      console.log(`    QR fark: ${text} ${viewBox(oq)} ↔ ${viewBox(nq)}`);
    }
  }
  check(`Code128: ${SAMPLES.length} metinde viewBox + çubuk aralıkları birebir`, c128Bad === 0, `${c128Bad} fark`);
  check(`QR: ${SAMPLES.length} metinde viewBox + modül ızgarası birebir`, qrBad === 0, `${qrBad} fark`);
  const sample = renderCode128Svg("R2610120001");
  check(
    "şablon yerleştirme sözleşmesi: `<svg ` ile başlar, viewBox taşır, beyaz zemin",
    sample.startsWith("<svg ") && /viewBox="0 0 \d+ \d+"/.test(sample) && sample.includes('fill="#FFFFFF"'),
  );
  check("Türkçe/geçersiz Code128 metni eskisi gibi hata verir", (() => {
    let oldThrows = false;
    let newThrows = false;
    try {
      bwipjs.toSVG({ bcid: "code128", text: "", scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" });
    } catch {
      oldThrows = true;
    }
    try {
      renderCode128Svg("");
    } catch {
      newThrows = true;
    }
    return oldThrows === newThrows;
  })());
}

console.log("\n§2 içerik önbelleği (LRU)");
{
  clearBarcodeSvgCache();
  const a = renderQrSvg("R2610120777");
  const t0 = performance.now();
  const b = renderQrSvg("R2610120777");
  const hitMs = performance.now() - t0;
  const s = barcodeSvgCacheStats();
  check("isabet aynı SVG'yi döner ve kodlamaz", a === b && s.hits === 1 && s.misses === 1, `${hitMs.toFixed(3)} ms`);
  check("Code128 ve QR ayrı anahtar", renderCode128Svg("R2610120777") !== b && barcodeSvgCacheStats().misses === 2);

  clearBarcodeSvgCache();
  for (let i = 0; i < BARCODE_SVG_CACHE_MAX; i++) renderCode128Svg(`L${i}`);
  renderCode128Svg("L0"); // dokun → en yeni olur
  renderCode128Svg("L-yeni"); // tavan aşıldı → en eski (L1) düşer
  const before = barcodeSvgCacheStats();
  renderCode128Svg("L0");
  const afterL0 = barcodeSvgCacheStats();
  renderCode128Svg("L1");
  const afterL1 = barcodeSvgCacheStats();
  check(`tavan ${BARCODE_SVG_CACHE_MAX}: boyut aşılmaz`, before.size === BARCODE_SVG_CACHE_MAX, `size=${before.size}`);
  check("dokunulan giriş kalır (isabet)", afterL0.hits === before.hits + 1);
  check("en uzun süre dokunulmayan düşer (ıska)", afterL1.misses === afterL0.misses + 1);

  clearBarcodeSvgCache();
  for (let k = 0; k < 2; k++) {
    try {
      renderCode128Svg("");
    } catch {
      /* beklenen */
    }
  }
  check("hata önbelleğe girmez", barcodeSvgCacheStats().size === 0 && barcodeSvgCacheStats().hits === 0);
}

async function sliceSection(): Promise<void> {
  console.log("\n§3 zaman dilimli nefes (2.000 etiket)");
  const LABELS = 2000;
  const PER_LABEL_MS = 1;
  const busy = (ms: number): void => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      /* senkron etiket işi */
    }
  };
  let maxGap = 0;
  let last = performance.now();
  let running = true;
  const tick = (): void => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  const breathe = createSliceYielder();
  const t0 = performance.now();
  for (let i = 0; i < LABELS; i++) {
    busy(PER_LABEL_MS);
    await breathe();
  }
  const total = performance.now() - t0;
  // Son bekleyen tik de ölçülsün: nefessiz döngüde tek tik döngünün TAMAMINI görür.
  await new Promise<void>((resolve) => setImmediate(resolve));
  running = false;
  const bound = BULK_LABEL_SLICE_MS + PER_LABEL_MS + 15;
  check(
    `en uzun blok ≤ dilim (${BULK_LABEL_SLICE_MS} ms) + bir etiket + pay`,
    maxGap <= bound,
    `en uzun ${maxGap.toFixed(1)} ms (sınır ${bound}), toplam ${(total / 1000).toFixed(2)} s`,
  );
  check("nefes toplam süreyi şişirmez (≤ %15)", total <= LABELS * PER_LABEL_MS * 1.15 + 50, `${total.toFixed(0)} ms`);
}

function singleSourceSection(): void {
  console.log("\n§4 tek kaynak");
  const root = join(__dirname, "..", "src", "services");
  const files = [
    "label.service.ts",
    "label-template.service.ts",
    "traveler-card.service.ts",
    "helpers/label-rawcode.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    check(`${f}: çıplak bwipjs.toSVG yok`, !/bwipjs\.toSVG\(/.test(src));
  }
  const label = readFileSync(join(root, "label.service.ts"), "utf8");
  const loops = (label.match(/const breathe = createSliceYielder\(\);/g) ?? []).length;
  check("toplu HTML + toplu native döngüleri zaman dilimli nefes kullanır", loops >= 2, `${loops} döngü`);
  check("sayaçlı nefes (`% 25`) kalmadı", !/% 25 === 0/.test(label));
}

void (async () => {
  await sliceSection();
  singleSourceSection();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail ? 1 : 0;
})();
