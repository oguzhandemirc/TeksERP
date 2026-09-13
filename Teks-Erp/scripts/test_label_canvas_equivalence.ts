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

/**
 * Bu bekçinin ÖLÇTÜĞÜ şey iki çizicinin eşdeğerliğidir, kalite kataloğu DEĞİL —
 * bu yüzden kod burada SABİTTİR ve katalogdan çözülmez (fikstür tanımı, gömülü
 * varsayım değil). Uzunluğu geometriyi etkilediği için değeri DEĞİŞTİRİLMEZ.
 *
 * ⚠️ KAPSAM DIŞI — BU BİR TERCİH, ÇÖZÜM DEĞİL (2026-09-13):
 * `qualityGrade: ""` (KALİTESİZ top) bu bekçinin kapsamı DIŞINDADIR. Orada iki
 * çizici `customerName` üzerinde AYRIŞIYOR: dönüştürücü düşürüyor, akış
 * basıyor. Sabit kod o dalı ölçmez, SUSTURUR — ve saha vakası gerçek
 * (`Roll.qualityGrade` nullable, KK1 "Belirsiz" bırakabiliyor).
 * Açık bulgu, sahibi belge/etiket alanı; kuyrukta.
 */
const SABIT_KALITE_KODU = "1.KALITE";
const KAPSAM_DISI_BEYANI =
  '⚠️ KAPSAM DIŞI: qualityGrade:"" (kalitesiz top) ölçülmüyor — iki çizici ' +
  "orada customerName'de ayrışıyor (açık bulgu 2026-09-13, belge/etiket alanı).";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { escapeHtml } from "../src/services/helpers/label-html.shared";
import { asciiFold, cleanCtlCp1254 } from "../src/services/helpers/native-label.shared";
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
  console.log(`${templates.length} şablon karşılaştırılıyor (veri sadakati)...`);
  console.log(`${KAPSAM_DISI_BEYANI}\n`);

  for (const t of templates) {
    const kind = t.kind!;
    const tag = `[${kind}] ${t.name}`;
    const format = await resolveLabelFormat({ kind });
    // ⚠️ KALİTE KODU AÇIKÇA VERİLİR (2026-09-13, karar ①): `mockPayload`ın
    // varsayılanı artık `""` ("kalitesiz" sentinel'i) ve boş kalite ETİKET
    // GEOMETRİSİNİ değiştirir — bu bekçi iki çizicinin AYNI yükte aynı alanları
    // basmasını ölçer, yükün kendisini değil. Sabit bir kod vererek ölçüm
    // katalogdan da bağımsız kalır.
    const payload = { ...mockPayload(kind, SABIT_KALITE_KODU), kind };
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

    // NATIVE: değer çıktıda olmalı (veri düşmez) — ama BEKLENEN BİÇİM DİLE GÖRE
    // DEĞİŞİR ve bu bilinçlidir:
    //   • PPLA/ZPL → `cleanCtl` = asciiFold ("Merkez Şube" → "Merkez Sube")
    //   • PPLB     → `cleanCtlCp1254` ("Merkez Şube" → "Merkez Þube"): EPL2 header'ı
    //     `I8,E` ile CP1254 seçiyor, yani yazıcı GERÇEK TÜRKÇE basıyor (bkz.
    //     label-canvas-native.helper `eplData` notu). Katlanmış metin aramak
    //     PPLB'de veri düşmediği hâlde YANLIŞ KIRMIZI verir — 2026-08-13'te tam
    //     bu oldu: fabrikanın çuval şablonu dev'e çekilince Türkçe değerli iki
    //     alan (branchName "Merkez Şube", sackNote "Ölçü şüpheli…") ilk kez
    //     PPLB'den geçti ve bekçi "eksik" dedi. Beklentiyi emitter'ın kendi
    //     dönüşümüyle kur — yoksa Türkçe içeren HER yeni alan sahte kırmızı üretir.
    // (renderLabel 2026-07 icon işiyle ASYNC → await.)
    for (const lang of NATIVE_LANGS) {
      const out = (await renderLabel(lang as PrinterLanguage, {
        payload, template: flowTemplate, variant: fakeVariant, barcodeSvg: "", qrSvg: "", copies: 2,
        format: { ...format, language: lang as PrinterLanguage },
      })).content;
      const expectIn = lang === "PPLB" ? cleanCtlCp1254 : asciiFold;
      const missing = boundValues.filter((x) => !out.includes(expectIn(x.dv.value))).map((x) => x.key);
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
    //
    // ⚠️ BURADA DEĞER ARAMA (`output.includes(value)`) KULLANILMAZ — 2026-08-02'de
    // tam da o yüzden iki YANLIŞ kırmızı veriyordu: mock `batchNumber` "P1207260001",
    // mock `orderNumber` ise "SIP1207260001" ve birincisi ikincisinin ALT DİZGİSİ.
    // Akış batchNumber'ı hiç basmadığı hâlde `includes` sipariş numarasının içinde
    // buluyor, test "dönüştürücü alan düşürdü" diye suçluyordu. Alt-dizgi eşleşmesi
    // ters yönde daha da tehlikelidir: gerçekten düşen bir alan, değeri başka bir
    // alanın içinde geçtiği için sessizce AKLANIR.
    //
    // Doğru ölçüm KÜME karşılaştırmasıdır: akış (`templateTextLines` + PPLB döngüsü)
    // ile dönüştürücü (`flowTemplateToCanvas`) AYNI sıralı listeyi gezer ve ilk taşan
    // alanda `break` eder → her ikisinin bastığı küme, listenin bir ÖN EKİdir. Akışın
    // ön ek uzunluğu, çıktıdaki metin komutu sayısıdır.
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
      // PPLB metin komutu: `A<x>,<y>,<rot>,<font>,...`. Alan satırları rot=0 ile
      // çıkar; sağ dikey metraj bandı rot=1'dir (alan değil) → sayıma girmez.
      // QR (`b…`) ve alt barkod (`B…`) zaten farklı komutlar.
      const flowTextCmds = flowPplb
        .split(/\r?\n/)
        .filter((l) => /^A\d+,\d+,0,/.test(l));
      const flowOrdered = [...visibleKeys].sort((a, b) => a.f.order - b.f.order);
      // KÖRLÜK ZEMİNİ: komut biçimi değişip regex tutmazsa sayı 0'a düşer ve
      // "hiçbir alan yanlış düşmemiş" YEŞİLİ vakumen doğru olurdu. Ayrıştırma
      // kendisi doğrulanır — bu satır olmadan test sessizce hiçbir şey ölçmez.
      check(
        `${tag}: akış metin satırları ayrıştırıldı (ön ek ölçülebilir)`,
        flowTextCmds.length > 0 && flowTextCmds.length <= flowOrdered.length,
        `basılan=${flowTextCmds.length} / aday=${flowOrdered.length}`,
      );
      const printedByFlow = flowOrdered.slice(0, flowTextCmds.length);
      const wronglyDropped = printedByFlow
        .filter((x) => !layoutBinds.has(x.f.key))
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
