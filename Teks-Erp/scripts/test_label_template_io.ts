// =============================================================================
// Test: Şablon dışa/içe aktar (JSON zarf) round-trip + çoğaltma
//       — exportTemplate / importTemplate / duplicateTemplate.
// Çalıştır: npx tsx scripts/test_label_template_io.ts
// Test verisi üretir (TEST- prefix), sonunda fiziksel temizler.
// =============================================================================
import { LabelKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const svc = new LabelTemplateService();
const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const templateIds: string[] = [];

// itemName + barcode katalog anahtarları — parseCanvas bind whitelist'inden geçmeli.
const layout = {
  v: 1,
  elements: [
    { id: "qr1", type: "qr", x: 3, y: 3, scale: 5 },
    { id: "t1", type: "field", bind: "itemName", label: "", x: 26, y: 3, hMm: 4, align: "center", textCase: "upper" },
    { id: "t2", type: "text", text: "Statik Not", x: 5, y: 45, font: "md" },
  ],
};

async function main() {
  // --- Kaynak şablon + varyant ---
  const srcName = `TEST-IO-${stamp}`;
  const created = await svc.create({ name: srcName, kind: LabelKind.ROLL_FINISHED, isDefault: false });
  const srcId = created.data.id;
  templateIds.push(srcId);
  await svc.createVariant(srcId, { widthMm: 100, heightMm: 60, elements: layout });
  await svc.createVariant(srcId, { widthMm: 100, heightMm: 50, elements: layout });

  // --- EXPORT ---
  const { data: env } = await svc.exportTemplate(srcId);
  check("export: ad + kind taşınır", env.template.name === srcName && env.template.kind === LabelKind.ROLL_FINISHED);
  check("export: 2 varyant", env.variants.length === 2);
  check("export: id/timestamp yok (zarf sadece taşınabilir alanlar)", !("id" in (env.variants[0] as object)) && !("createdAt" in (env.template as object)));
  const exFirst = env.variants.find((v) => v.widthMm === 100 && v.heightMm === 60);
  const exEls = (exFirst?.elements as { elements: Array<Record<string, unknown>> }).elements;
  const exText = exEls.find((e) => e.id === "t1");
  check("export: align + textCase korunur", exText?.align === "center" && exText?.textCase === "upper");

  // --- IMPORT (aynı ad DOLU → dedup) ---
  const imported = await svc.importTemplate(env);
  templateIds.push(imported.data.id);
  check("import: yeni id, farklı satır", imported.data.id !== srcId);
  check("import: ad dedup (aynı ad kullanımda → ' 2')", imported.data.name.startsWith(srcName) && imported.data.name !== srcName);
  check("import: isDefault ASLA taşınmaz", imported.data.isDefault === false);
  const impVars = (await svc.listVariants(imported.data.id)).data;
  check("import: 2 varyant kopyalandı", impVars.length === 2);
  check("import: tam bir primary", impVars.filter((v) => v.isPrimary).length === 1);
  const impFirst = impVars.find((v) => Number(v.widthMm) === 100 && Number(v.heightMm) === 60);
  const impEls = (impFirst?.elements as { elements: Array<Record<string, unknown>> }).elements;
  const impText = impEls.find((e) => e.id === "t1");
  check("import: elements birebir (align/textCase/qr korunur)",
    impText?.align === "center" && impText?.textCase === "upper" && impEls.some((e) => e.type === "qr"));

  // --- DUPLICATE ---
  const dup = await svc.duplicateTemplate(srcId);
  templateIds.push(dup.data.id);
  check("duplicate: '(kopya)' adı", dup.data.name === `${srcName} (kopya)`);
  check("duplicate: yeni id + isDefault false", dup.data.id !== srcId && dup.data.isDefault === false);
  const dupVars = (await svc.listVariants(dup.data.id)).data;
  check("duplicate: 2 varyant + tam bir primary", dupVars.length === 2 && dupVars.filter((v) => v.isPrimary).length === 1);

  // --- Kenar durum: 100-karakterlik ad → dedup son-eki taşmaz (findAvailableName fix) ---
  const longName = `TEST-IO-LONG-${stamp}-`.padEnd(100, "x").slice(0, 100);
  const longCreated = await svc.create({ name: longName, kind: LabelKind.ROLL_FINISHED, isDefault: false });
  templateIds.push(longCreated.data.id);
  await svc.createVariant(longCreated.data.id, { widthMm: 100, heightMm: 60, elements: layout });
  const longDup = await svc.duplicateTemplate(longCreated.data.id); // eskiden 100-char'da sonsuz çakışırdı
  templateIds.push(longDup.data.id);
  check("100-char ad çoğaltma: dedup taşmadan çalışır",
    longName.length === 100 && longDup.data.id !== longCreated.data.id && longDup.data.name.length <= 100 && longDup.data.name !== longName);

  // --- Import geçersiz zarf reddi ---
  let rejected = false;
  try { await svc.importTemplate({ template: { name: "" }, variants: [] } as never); }
  catch { rejected = true; }
  check("import: geçersiz zarf (adsız) reddedilir", rejected);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  console.log("Cleanup: test kayıtları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("Cleanup hatası:", e)); await prisma.$disconnect(); });
