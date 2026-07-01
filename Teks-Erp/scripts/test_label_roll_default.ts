// =============================================================================
// Test: TOP etiketi sistem-varsayılanı (isRollDefault) — TOP isRollDefault profili
// kullanır, KARTELA (SWATCH) code="DEFAULT" kullanır (boyutlar bağımsız). +
// LabelFormatProfileService.setRollDefault atomik + getSampleNative.
// Çalıştır: npx tsx scripts/test_label_roll_default.ts
// =============================================================================
import { PrinterLanguage, LabelKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { LabelFormatProfileService } from "../src/services/printer.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", searchFields: ["code", "name"], uniqueField: "code" });

async function main() {
  const roll50 = await prisma.labelFormatProfile.findFirst({ where: { code: "TOP_100x50" } });
  const def58 = await prisma.labelFormatProfile.findFirst({ where: { code: "DEFAULT" } });
  if (!roll50 || !def58) throw new Error("Beklenen profiller yok (TOP_100x50 / DEFAULT). Önce kurulum yapılmalı.");

  // 1) TOP etiketi → isRollDefault (100×50)
  const rollFmt = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("TOP (ROLL_FINISHED) → 100×50", rollFmt.widthMm === 100 && rollFmt.heightMm === 50, `${rollFmt.widthMm}×${rollFmt.heightMm}`);
  const rawFmt = await resolveLabelFormat({ kind: "ROLL_RAW" });
  check("TOP (ROLL_RAW) → 100×50", rawFmt.heightMm === 50);

  // 2) KARTELA → code="DEFAULT" (100×58), top varsayılanından ETKİLENMEZ
  const swFmt = await resolveLabelFormat({ kind: "SWATCH" });
  check("KARTELA (SWATCH) → 100×58 (bağımsız)", swFmt.widthMm === 100 && swFmt.heightMm === 58, `${swFmt.widthMm}×${swFmt.heightMm}`);

  // 3) kind verilmezse (bulk/önizleme) → TOP varsayılanı (SWATCH hariç her şey rulo).
  const noKind = await resolveLabelFormat({});
  check("kind yok (bulk) → TOP varsayılanı 100×50", noKind.heightMm === 50);

  // 4) setRollDefault atomik: 100×58'i top varsayılanı yap → TOP artık 100×58, tek true
  await svc.setRollDefault(def58.id);
  const afterFmt = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("setRollDefault(100×58) → TOP artık 100×58", afterFmt.heightMm === 58, `${afterFmt.heightMm}`);
  const trues = await prisma.labelFormatProfile.count({ where: { isRollDefault: true } });
  check("aynı anda EN FAZLA bir top varsayılanı", trues === 1, `${trues} adet`);
  check("KARTELA hâlâ 100×58 (etkilenmedi)", (await resolveLabelFormat({ kind: "SWATCH" })).heightMm === 58);

  // 5) getSampleNative → explicit profileId geometriyi verir (100×50 → Q400), kind
  //    yalnız şablonu/payload'u seçer. NOT: ROLL şablonu rawCode taşıyabilir (auto'yu
  //    ezer) → geometri kontrolü için rawCode'suz SWATCH şablonu kullan.
  await svc.setRollDefault(roll50.id); // geri al
  const sample = await svc.getSampleNative(roll50.id, PrinterLanguage.PPLB, LabelKind.SWATCH);
  check("getSampleNative dil=PPLB", sample.data.language === "PPLB");
  check("getSampleNative profil geometrisi → Q400 (100×50)", sample.data.content.includes("Q400"), sample.data.content.split("\n").slice(0, 3).join(" "));
  check("getSampleNative örnek barkod içerir", sample.data.content.includes("TEKSORNEK0001"));

  const restored = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("restore → TOP tekrar 100×50", restored.heightMm === 50);
}

main()
  .then(async () => {
    // Güvenlik: top varsayılanı 100×50'de kalsın.
    const roll50 = await prisma.labelFormatProfile.findFirst({ where: { code: "TOP_100x50" } });
    if (roll50 && !roll50.isRollDefault) await new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", searchFields: ["code"], uniqueField: "code" }).setRollDefault(roll50.id);
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => { console.error("HATA:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
