// =============================================================================
// Test: boyut varyantı seçimi (pickVariant) — Etiket Stüdyosu F3
// =============================================================================
// DB'siz: ±1mm tolerans, exact > primary-fallback > en-eski-fallback > null;
// orientation normalizasyonu YOK (100×148 ≠ 148×100); medya komutları formattan,
// koordinatlar varyanttan (fallback'te kırpma yazıcıya kalır — bloklama yok).
// Çalıştır: npx tsx scripts/test_label_variant_selection.ts
// =============================================================================
import { pickVariant, VARIANT_MATCH_TOLERANCE_MM } from "../src/services/helpers/label-variant.resolver";
import { emitCanvasPplb } from "../src/services/helpers/label-canvas-native.helper";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";
import type { LabelTemplateVariant } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

function v(id: string, w: number, h: number, primary = false, createdAt = new Date("2026-01-01")): LabelTemplateVariant {
  return { id, widthMm: w, heightMm: h, isPrimary: primary, createdAt } as unknown as LabelTemplateVariant;
}

async function main() {
  // exact eşleşme
  const vars = [v("a", 100, 148), v("b", 100, 60, true), v("c", 100, 50)];
  check("exact: birebir boyut", pickVariant(vars, { widthMm: 100, heightMm: 50 }).variant?.id === "c");
  check("exact: match=exact", pickVariant(vars, { widthMm: 100, heightMm: 50 }).match === "exact");
  check(`exact: ±${VARIANT_MATCH_TOLERANCE_MM}mm tolerans`, pickVariant(vars, { widthMm: 100.9, heightMm: 148.5 }).variant?.id === "a");
  check("orientation normalize edilmez (148×100 ≠ 100×148)", pickVariant(vars, { widthMm: 148, heightMm: 100 }).match === "fallback");

  // fallback: primary
  const fb = pickVariant(vars, { widthMm: 80, heightMm: 40 });
  check("fallback: primary varyant", fb.variant?.id === "b" && fb.match === "fallback");

  // fallback: primary yoksa en eski
  const noPrimary = [v("y", 100, 148, false, new Date("2026-03-01")), v("x", 100, 60, false, new Date("2026-02-01"))];
  check("fallback: primary yoksa en eski", pickVariant(noPrimary, { widthMm: 80, heightMm: 40 }).variant?.id === "x");

  // boş → null (akış-modeli dual-mode)
  const empty = pickVariant([], { widthMm: 100, heightMm: 50 });
  check("varyantsız: null + match null", empty.variant == null && empty.match == null);
  check("undefined: null", pickVariant(undefined, { widthMm: 100, heightMm: 50 }).variant == null);

  // Medya komutları FORMATTAN, koordinatlar VARYANTTAN (fallback senaryosu):
  // 100×50 tasarım 100×60 medyada basılır → q/Q 100×60, eleman koordinatı aynı.
  const format: ResolvedLabelFormat = {
    widthMm: 100, heightMm: 60, marginMm: 3, marginTopMm: 3, marginRightMm: 3,
    marginBottomMm: 3, marginLeftMm: 3, gapMm: 2, orientation: "LANDSCAPE" as never,
    dpi: 203, language: "PPLB" as never, profileId: "p", source: "machine" as never,
  };
  const payload = { barcode: "TEKS20260706XX01", itemName: "PATOS", lengthMeters: 100 } as unknown as LabelPayload;
  const out = emitCanvasPplb({
    payload, format, copies: 1,
    layout: { v: 1, elements: [
      { id: "q", type: "qr", x: 3, y: 3, scale: 5 },
      { id: "t", type: "field", bind: "itemName", x: 30, y: 3 },
    ] },
  });
  check("fallback emit: medya q/Q formattan (100×60)", out.includes("q799") && /Q480,/.test(out));
  check("fallback emit: eleman koordinatı varyant tuvalinden", /A240,24,/.test(out));
}

main()
  .then(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => { console.error("HATA:", e); process.exit(1); });
