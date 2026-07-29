// =============================================================================
// Test: akış→kanvas dönüşüm SADAKATİ (Etiket Stüdyosu — veri düşmez)
// =============================================================================
// F2'de yapısal byte-eşdeğerlik kanıtlanmıştı. Sonraki BİLİNÇLİ iyileştirmeler
// (barkod okunur-satırı ortalama, metraj bandı siyah-zemin/beyaz-yazı reverse,
// serbest boyut) kanvası akıştan kasıtlı ayırdı. Bu test artık VERİ SADAKATİNİ
// doğrular: dönüştürücü hiçbir görünür alan değerini DÜŞÜRMEZ — her dilde
// (PPLA/PPLB/ZPL native + HTML) kanvas çıktısı, o alanın değerini içerir; sığmayan
// alanlar native akışta da yoktu (fit gerçeği, dönüştürücü hatası değil).
// Çalıştır: npx tsx scripts/test_label_canvas_equivalence.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { renderLabel } from "../src/services/helpers/label-renderer.registry";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { flowTemplateToCanvas } from "../src/services/helpers/label-flow-to-canvas";
import { mockPayload } from "../src/services/helpers/label-rawcode";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { escapeHtml } from "../src/services/helpers/label-html.shared";
import { asciiFold } from "../src/services/helpers/native-label.shared";
import type { TemplateField } from "../src/config/label-fields";
import type { LabelTemplate, LabelTemplateVariant, PrinterLanguage } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
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
  console.log(`${templates.length} şablon karşılaştırılıyor (veri sadakati)...\n`);

  for (const t of templates) {
    const kind = t.kind!;
    const tag = `[${kind}] ${t.name}`;
    const format = await resolveLabelFormat({ kind });
    const payload = { ...mockPayload(kind), kind };
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

    // Kanvasa GİREN veri alanları (fit sonrası) + değerleri (present).
    const layoutBinds = new Set(
      layout.elements.filter((e) => e.type === "field").map((e) => (e as { bind: string }).bind),
    );
    const boundValues = [...layoutBinds]
      .map((key) => ({ key, dv: fieldDisplayValue(payload, key) }))
      .filter((x) => x.dv.present && x.dv.role !== "scan");

    // NATIVE: değer ASCII'ye katlanır → katlanmış değer çıktıda olmalı (veri düşmez).
    // (renderLabel 2026-07 icon işiyle ASYNC → await.)
    for (const lang of NATIVE_LANGS) {
      const out = (await renderLabel(lang as PrinterLanguage, {
        payload, template: flowTemplate, variant: fakeVariant, barcodeSvg: "", qrSvg: "", copies: 2,
        format: { ...format, language: lang as PrinterLanguage },
      })).content;
      const missing = boundValues.filter((x) => !out.includes(asciiFold(x.dv.value))).map((x) => x.key);
      check(`${tag} × ${lang}: kanvas alan değerleri çıktıda (${boundValues.length} alan, veri düşmez)`,
        missing.length === 0, missing.length ? `eksik: ${missing.join(", ")}` : "");
    }

    // HTML: değer tam UTF-8 (katlama yok) → escapeHtml'li değer içerikte.
    const html = (await renderLabel("RASTER_HTML" as PrinterLanguage, {
      payload, template: flowTemplate, variant: fakeVariant,
      barcodeSvg: "<svg viewBox=\"0 0 10 10\"></svg>", qrSvg: "<svg viewBox=\"0 0 10 10\"></svg>",
      copies: 1, format: { ...format, language: "RASTER_HTML" as PrinterLanguage },
    })).content;
    const missingHtml = boundValues.filter((x) => !html.includes(escapeHtml(asciiFold(x.dv.value)))).map((x) => x.key);
    check(`${tag} × HTML: kanvas alan değerleri içerikte (${boundValues.length} alan)`,
      missingHtml.length === 0, missingHtml.length ? `eksik: ${missingHtml.join(", ")}` : "");

    // Sığma gerçeği: şablonun görünür alanlarından kanvasa GİREMEYENLER (medya boyu)
    // native akışta da basılmıyordu — dönüştürücü hatası DEĞİL, fit gerçeği.
    const visibleKeys = ((t.fields as unknown as TemplateField[]) ?? [])
      .filter((f) => f.isVisible)
      .map((f) => ({ f, dv: fieldDisplayValue(payload, f.key) }))
      .filter((x) => x.dv.role !== "scan" && x.dv.present);
    const dropped = visibleKeys.filter((x) => !layoutBinds.has(x.f.key));
    if (dropped.length > 0) {
      const flowPplb = (await renderLabel("PPLB" as PrinterLanguage, {
        payload, template: flowTemplate, barcodeSvg: "", qrSvg: "", copies: 1,
        format: { ...format, language: "PPLB" as PrinterLanguage },
      })).content;
      const wronglyDropped = dropped
        .filter((x) => x.dv.value !== payload.barcode) // barkod değerini taşıyan alanlar hariç
        .filter((x) => flowPplb.includes(asciiFold(x.dv.value)))
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
