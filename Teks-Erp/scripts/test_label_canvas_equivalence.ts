// =============================================================================
// Test: akış→kanvas dönüşüm SADAKATİ (Etiket Stüdyosu F2 kanıtı)
// =============================================================================
// DB'deki her aktif akış şablonu için: mevcut üretici çıktısı (flow) ile
// dönüştürücünün (flowTemplateToCanvas) ürettiği kanvasın emit çıktısını
// PPLA/PPLB/ZPL'de karşılaştırır — komut iskeleti AYNI + koordinatlar ±8 dot
// (1mm; mm-yuvarlama + PPLA okunur-satır payı farkını emer). HTML bilinçli
// sapmadır (kanvas mutlak düzen) — yalnız İÇERİK paritesi doğrulanır.
// Çalıştır: npx tsx scripts/test_label_canvas_equivalence.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { renderLabel } from "../src/services/helpers/label-renderer.registry";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { flowTemplateToCanvas } from "../src/services/helpers/label-flow-to-canvas";
import { mockPayload } from "../src/services/helpers/label-rawcode";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { escapeHtml } from "../src/services/helpers/label-html.shared";
import type { TemplateField } from "../src/config/label-fields";
import type { LabelTemplate, LabelTemplateVariant, PrinterLanguage } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Koordinat toleransı (dot @203dpi): 8 dot ≈ 1mm. */
const TOL_DOTS = 8;
const NUM_RE = /\d+/g;

/** İki rakam-dizisi toleransla "yakın" mı? PPLA gibi AYRAÇSIZ formatlarda birden
 *  çok sabit-genişlik alan tek rakam-koşusuna yapışır (nw+h4+row4+col4) — düz
 *  int farkı anlamsız büyür. Eşit uzunluklu koşularda ortak önek+sonek soyulup
 *  kalan hizalı bölüm karşılaştırılır (fark tek alanda lokalize ise gerçek dot
 *  farkını verir). */
function numbersClose(aStr: string, bStr: string, tol: number): boolean {
  if (aStr === bStr) return true;
  if (Math.abs(+aStr - +bStr) <= tol) return true;
  if (aStr.length !== bStr.length) return false;
  let p = 0;
  while (p < aStr.length && aStr[p] === bStr[p]) p++;
  let s = 0;
  while (s < aStr.length - p && aStr[aStr.length - 1 - s] === bStr[bStr.length - 1 - s]) s++;
  const ma = aStr.slice(p, aStr.length - s) || "0";
  const mb = bStr.slice(p, bStr.length - s) || "0";
  return Math.abs(+ma - +mb) <= tol;
}

/** İki komut akışını yapısal karşılaştır: satır sayısı + sayı-dışı iskelet birebir,
 *  sayılar çift-çift ±tol. Uymayan ilk farkı döner (null = eşdeğer). */
function structuralDiff(a: string, b: string, tol = TOL_DOTS): string | null {
  // PPLA satırları yalnız CR ile ayrılır — \r|\r\n|\n hepsini böl.
  const la = a.split(/\r\n|\r|\n/).filter(Boolean);
  const lb = b.split(/\r\n|\r|\n/).filter(Boolean);
  if (la.length !== lb.length) return `satır sayısı ${la.length} ≠ ${lb.length}`;
  for (let i = 0; i < la.length; i++) {
    const ska = la[i].replace(NUM_RE, "#");
    const skb = lb[i].replace(NUM_RE, "#");
    if (ska !== skb) return `satır ${i + 1} iskelet farkı:\n  flow  : ${la[i]}\n  canvas: ${lb[i]}`;
    const na = la[i].match(NUM_RE) ?? [];
    const nb = lb[i].match(NUM_RE) ?? [];
    for (let j = 0; j < na.length; j++) {
      if (!numbersClose(na[j], nb[j], tol)) {
        return `satır ${i + 1} sayı farkı ${na[j]} vs ${nb[j]} (>±${tol}):\n  flow  : ${la[i]}\n  canvas: ${lb[i]}`;
      }
    }
  }
  return null;
}

const NATIVE_LANGS = ["PPLA", "PPLB", "ZPL"] as const;

async function main() {
  const templates = await prisma.labelTemplate.findMany({
    where: { isActive: true, deletedAt: null, kind: { not: null } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  if (templates.length === 0) {
    check("aktif akış şablonu yok — dönüşüm kanıtlanacak şablon bulunamadı", false);
    return;
  }
  console.log(`${templates.length} şablon karşılaştırılıyor (±${TOL_DOTS} dot tolerans)...\n`);

  for (const t of templates) {
    const kind = t.kind!;
    const tag = `[${kind}] ${t.name}`;
    const format = await resolveLabelFormat({ kind });
    const payload = { ...mockPayload(kind), kind };
    // rawCode sıyrılır — iki yol da OTOMATİK üretimle karşılaştırılır.
    const flowTemplate = { ...t, rawCode: null } as LabelTemplate;
    const layout = flowTemplateToCanvas(
      {
        kind,
        fields: (t.fields as unknown as TemplateField[]) ?? [],
        lineStepMm: t.lineStepMm != null ? Number(t.lineStepMm) : null,
        qrScale: t.qrScale,
        lengthBanner: t.lengthBanner,
      },
      format,
    );
    const fakeVariant = {
      elements: layout,
      widthMm: format.widthMm,
      heightMm: format.heightMm,
    } as unknown as LabelTemplateVariant;

    for (const lang of NATIVE_LANGS) {
      const flow = renderLabel(lang as PrinterLanguage, {
        payload, template: flowTemplate, barcodeSvg: "", qrSvg: "", copies: 2,
        format: { ...format, language: lang as PrinterLanguage },
      }).content;
      const canvas = renderLabel(lang as PrinterLanguage, {
        payload, template: flowTemplate, variant: fakeVariant, barcodeSvg: "", qrSvg: "", copies: 2,
        format: { ...format, language: lang as PrinterLanguage },
      }).content;
      const diff = structuralDiff(flow, canvas);
      check(`${tag} × ${lang}: yapısal eşdeğer`, diff == null, diff ?? "");
    }

    // HTML içerik paritesi — NATIVE'E GÖRE (bilinçli sapma: kanvas HTML'i native
    // yerleşime yakınsar). Kanvasa giren her alanın değeri HTML'de olmalı.
    const html = renderLabel("RASTER_HTML" as PrinterLanguage, {
      payload, template: flowTemplate, variant: fakeVariant,
      barcodeSvg: "<svg viewBox=\"0 0 10 10\"></svg>", qrSvg: "<svg viewBox=\"0 0 10 10\"></svg>",
      copies: 1, format: { ...format, language: "RASTER_HTML" as PrinterLanguage },
    }).content;
    const layoutBinds = new Set(
      layout.elements.filter((e) => e.type === "field").map((e) => (e as { bind: string }).bind),
    );
    const missing = [...layoutBinds]
      .map((key) => ({ key, dv: fieldDisplayValue(payload, key) }))
      .filter((x) => x.dv.present && !html.includes(escapeHtml(x.dv.value)))
      .map((x) => x.key);
    check(`${tag} × HTML: kanvas alanları içerikte (${layoutBinds.size} alan)`, missing.length === 0,
      missing.length ? `eksik: ${missing.join(", ")}` : "");

    // Sığma gerçeği raporu: şablonun görünür alanlarından kanvasa GİREMEYENLER
    // (medya boyuna sığmadı). Bunlar native akışta da basılmıyordu — kanıtla:
    // flow PPLB çıktısında da değerleri yok (dönüştürücü hatası DEĞİL, fit gerçeği).
    const visibleKeys = ((t.fields as unknown as TemplateField[]) ?? [])
      .filter((f) => f.isVisible)
      .map((f) => ({ f, dv: fieldDisplayValue(payload, f.key) }))
      .filter((x) => x.dv.role !== "scan" && x.dv.present);
    const dropped = visibleKeys.filter((x) => !layoutBinds.has(x.f.key));
    if (dropped.length > 0) {
      const flowPplb = renderLabel("PPLB" as PrinterLanguage, {
        payload, template: flowTemplate, barcodeSvg: "", qrSvg: "", copies: 1,
        format: { ...format, language: "PPLB" as PrinterLanguage },
      }).content;
      const wronglyDropped = dropped
        // Barkod değerini taşıyan metin alanları (parentRollBarcode) hariç — değer
        // barkod satırında zaten geçer, yanlış pozitif üretir.
        .filter((x) => x.dv.value !== payload.barcode)
        .filter((x) => flowPplb.includes(x.dv.value))
        .map((x) => x.f.key);
      check(
        `${tag}: sığmayan ${dropped.length} alan native akışta da yoktu (${dropped.map((x) => x.f.key).join(", ")})`,
        wronglyDropped.length === 0,
        wronglyDropped.length ? `dönüştürücü DÜŞÜRDÜ ama akış basıyordu: ${wronglyDropped.join(", ")}` : "medya boyu sığdırmıyor",
      );
    }
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
