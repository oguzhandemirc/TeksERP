// =============================================================================
// Test: TOP etiketi sistem-varsayılanı (isRollDefault) — TOP isRollDefault profili
// kullanır, KARTELA (SWATCH) code="DEFAULT" kullanır (boyutlar bağımsız). +
// LabelFormatProfileService.setRollDefault atomik + getSampleNative.
// Çalıştır: npx tsx scripts/test_label_roll_default.ts
// =============================================================================
import { PrinterLanguage, LabelKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { resolveLabelFormat } from "../src/services/helpers/label-format.resolver";
import { LabelFormatProfileService } from "../src/services/label-format-profile.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", searchFields: ["code", "name"], uniqueField: "code" });

let defWasActive = true;
let defId = "";

async function main() {
  const roll50 = await prisma.labelFormatProfile.findFirst({ where: { code: "TOP_100x50" } });
  const def58 = await prisma.labelFormatProfile.findFirst({ where: { code: "DEFAULT" } });
  if (!roll50 || !def58) throw new Error("Beklenen profiller yok (TOP_100x50 / DEFAULT). Önce kurulum yapılmalı.");
  // Canlı DB'de DEFAULT panelden pasifleştirilmiş olabilir — test süresince aktive et,
  // sonda eski haline dön (aşağıdaki then bloğu). Boyutlar da sabit değil → dinamik oku.
  defWasActive = def58.isActive;
  defId = def58.id;
  if (!defWasActive) await prisma.labelFormatProfile.update({ where: { id: def58.id }, data: { isActive: true } });
  const defH = Number(def58.heightMm);
  const rollH = Number(roll50.heightMm);

  // 1) TOP etiketi → isRollDefault (100×50)
  const rollFmt = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("TOP (ROLL_FINISHED) → top varsayılanı", rollFmt.widthMm === 100 && rollFmt.heightMm === rollH, `${rollFmt.widthMm}×${rollFmt.heightMm}`);
  const rawFmt = await resolveLabelFormat({ kind: "ROLL_RAW" });
  check("TOP (ROLL_RAW) → top varsayılanı", rawFmt.heightMm === rollH);

  // 2) KARTELA → code="DEFAULT" (100×58), top varsayılanından ETKİLENMEZ
  const swFmt = await resolveLabelFormat({ kind: "SWATCH" });
  check("KARTELA (SWATCH) → code=DEFAULT (bağımsız)", swFmt.widthMm === 100 && swFmt.heightMm === defH, `${swFmt.widthMm}×${swFmt.heightMm}`);

  // 3) kind verilmezse (bulk/önizleme) → TOP varsayılanı (SWATCH hariç her şey rulo).
  const noKind = await resolveLabelFormat({});
  check("kind yok (bulk) → TOP varsayılanı", noKind.heightMm === rollH);

  // 4) setRollDefault atomik: 100×58'i top varsayılanı yap → TOP artık 100×58, tek true
  await svc.setRollDefault(def58.id);
  const afterFmt = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("setRollDefault(DEFAULT) → TOP artık DEFAULT boyutu", afterFmt.heightMm === defH, `${afterFmt.heightMm}`);
  const trues = await prisma.labelFormatProfile.count({ where: { isRollDefault: true } });
  check("aynı anda EN FAZLA bir top varsayılanı", trues === 1, `${trues} adet`);
  check("KARTELA hâlâ DEFAULT boyutu (etkilenmedi)", (await resolveLabelFormat({ kind: "SWATCH" })).heightMm === defH);

  // 5) getSampleNative → explicit profileId geometriyi verir (100×50 → Q400), kind
  //    yalnız şablonu/payload'u seçer. NOT: ROLL şablonu rawCode taşıyabilir (auto'yu
  //    ezer) → geometri kontrolü için rawCode'suz SWATCH şablonu kullan.
  await svc.setRollDefault(roll50.id); // geri al
  const sample = await svc.getSampleNative(roll50.id, PrinterLanguage.PPLB, LabelKind.SWATCH);
  check("getSampleNative dil=PPLB", sample.data.language === "PPLB");
  const expectedQ = `Q${Math.round(rollH * 8)}`; // PPLB: yükseklik dot (203dpi ≈ 8 dot/mm)
  check(`getSampleNative profil geometrisi → ${expectedQ}`, sample.data.content.includes(expectedQ), sample.data.content.split("\n").slice(0, 3).join(" "));
  check("getSampleNative örnek barkod içerir", sample.data.content.includes("TEKSORNEK0001"));

  const restored = await resolveLabelFormat({ kind: "ROLL_FINISHED" });
  check("restore → TOP tekrar top varsayılanı", restored.heightMm === rollH);
}

main()
  .then(async () => {
    // Güvenlik: top varsayılanı 100×50'de kalsın; DEFAULT'un aktifliği eski haline dönsün.
    const roll50 = await prisma.labelFormatProfile.findFirst({ where: { code: "TOP_100x50" } });
    if (roll50 && !roll50.isRollDefault) await new LabelFormatProfileService({ modelName: "labelFormatProfile", tableName: "LABEL_FORMAT_PROFILE", searchFields: ["code"], uniqueField: "code" }).setRollDefault(roll50.id);
    if (defId && !defWasActive) await prisma.labelFormatProfile.update({ where: { id: defId }, data: { isActive: false } });
    console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => { console.error("HATA:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
