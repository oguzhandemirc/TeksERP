// =============================================================================
// Test: Serbest (statik) etiket şablonu — "standalone" bayrağı uçtan uca
// Çalıştır: npx tsx scripts/test_standalone_label.ts
// =============================================================================
// Kapsam (gerçek DB — adnansahin_db; fixtures TEST- prefix, finally'de temizlenir):
//   1. create(standalone:true) → kind NULL doğar, standalone=true, fields boş.
//   2. create(standalone:true, isDefault:true) → 400 (serbest atanamaz/varsayılan).
//   3. createVariant barkodsuz (yalnız text) → serbest şablonda KABUL (requireScannable
//      false yolu). Türlü + atanmamış şablon da barkodsuz kabul eder (mevcut davranış),
//      serbest şablon FARKI: atansa BİLE her zaman barkod-muaf (atanamadığından).
//   4. assertTemplateAssignable(standalone) → throw (barkod içerse bile).
//   5. setContextDefault / setDefault(standalone) → throw.
//   6. findAll { standalone:true } vs { assignable:true } bölümlemesi.
//   7. listStandaloneTemplates() serbest şablonu + varyantını döner; türlüyü döndürmez.
//   8. renderStandaloneTemplateNative/Html → seçili varyant için BAYT/HTML üretir;
//      variantId seçimi; geçersiz variantId → 400; varyantsız şablon → 400;
//      olmayan/pasif şablon → 404; kopya 1..100 clamp.
// =============================================================================

import { LabelKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  LabelTemplateService,
  assertTemplateAssignable,
} from "../src/services/label-template.service";
import { LabelService } from "../src/services/label.service";
import { createSchema } from "../src/controllers/label-template.controller";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Bir async çağrının Türkçe mesajlı AppError fırlatıp fırlatmadığını doğrular. */
async function expectThrow(fn: () => Promise<unknown>, label: string, msgPart?: string): Promise<void> {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, msgPart ? msg.includes(msgPart) : true, msg);
  }
}

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const tplService = new LabelTemplateService();
const labelService = new LabelService();
const createdTemplateIds: string[] = [];

// Barkodsuz (yalnız statik metin) kanvas yerleşimi — serbest etiketin özü.
const BARCODELESS_LAYOUT = {
  v: 1,
  elements: [{ id: "t1", type: "text", x: 5, y: 5, text: "BAKIM ETİKETİ", hMm: 4 }],
};

async function main(): Promise<void> {
  // --- 1. create(standalone:true) → kind null ---
  const std = await tplService.create({ name: `TEST-STD-${stamp}`, standalone: true }, undefined);
  createdTemplateIds.push(std.data.id);
  check("standalone create → standalone=true", std.data.standalone === true);
  check("standalone create → kind NULL", std.data.kind === null, String(std.data.kind));
  check("standalone create → fields boş dizi", Array.isArray(std.data.fields) && (std.data.fields as unknown[]).length === 0);

  // Karşılaştırma: türlü (atanabilir) şablon.
  const norm = await tplService.create(
    { name: `TEST-NORM-${stamp}`, kind: LabelKind.ROLL_FINISHED },
    undefined,
  );
  createdTemplateIds.push(norm.data.id);
  check("türlü create → standalone=false", norm.data.standalone === false);
  check("türlü create → kind=ROLL_FINISHED", norm.data.kind === LabelKind.ROLL_FINISHED);

  // --- 2. standalone + isDefault → 400 ---
  await expectThrow(
    () => tplService.create({ name: `TEST-STD2-${stamp}`, standalone: true, isDefault: true }),
    "standalone + isDefault → 400",
    "varsayılan",
  );
  // Türsüz + standalone değil → kind zorunlu.
  await expectThrow(
    () => tplService.create({ name: `TEST-NOKIND-${stamp}` }),
    "türlü şablon kind'sız → 400",
    "kind",
  );

  // --- 2b. Controller Zod katmanı: serbest etiket kind:null KABUL etmeli ---
  // (Regresyon: NewTemplateDialog kind:null gönderir; .optional() null'ı reddederdi
  //  → HTTP 400 → serbest etiket oluşturma tamamen kırık. .nullish() düzeltir.)
  const zParsed = createSchema.safeParse({ name: "TEST-Z", kind: null, standalone: true, fields: [] });
  check("createSchema: serbest etiket kind:null KABUL", zParsed.success, zParsed.success ? "" : JSON.stringify(zParsed.error?.issues));
  const zNorm = createSchema.safeParse({ name: "TEST-Z2", kind: LabelKind.ROLL_RAW });
  check("createSchema: türlü kind KABUL", zNorm.success);

  // --- 3. createVariant barkodsuz → serbest şablonda kabul ---
  const v1 = await tplService.createVariant(
    std.data.id,
    { name: "100x60", widthMm: 100, heightMm: 60, elements: BARCODELESS_LAYOUT },
    undefined,
  );
  check("standalone barkodsuz varyant KAYDEDİLDİ (requireScannable false)", !!v1.data.id);
  check("standalone varyant primary (ilk)", v1.data.isPrimary === true);
  // İkinci boyut varyantı (variantId seçimi testi için).
  const v2 = await tplService.createVariant(
    std.data.id,
    { name: "80x50", widthMm: 80, heightMm: 50, elements: BARCODELESS_LAYOUT },
    undefined,
  );
  check("standalone ikinci varyant kaydedildi", !!v2.data.id);

  // --- 4. assertTemplateAssignable(standalone) → throw ---
  await expectThrow(
    () => assertTemplateAssignable(std.data.id),
    "assertTemplateAssignable(standalone) → throw",
    "Serbest",
  );
  // Türlü + varyantsız → geçer (legacy akış).
  let normAssignableOk = true;
  try { await assertTemplateAssignable(norm.data.id); } catch { normAssignableOk = false; }
  check("assertTemplateAssignable(türlü, varyantsız) → geçer", normAssignableOk);

  // --- 5. setContextDefault / setDefault(standalone) → throw ---
  await expectThrow(
    () => tplService.setContextDefault(LabelKind.ROLL_FINISHED, std.data.id),
    "setContextDefault(standalone) → throw",
    "Serbest",
  );
  await expectThrow(
    () => tplService.setDefault(std.data.id),
    "setDefault(standalone) → throw",
  );
  // update ile default'a çekme → throw.
  await expectThrow(
    () => tplService.update(std.data.id, { isDefault: true }),
    "update(standalone → isDefault:true) → throw",
  );

  // --- 6. findAll bölümleme ---
  const stdList = (await tplService.findAll({ standalone: true })).data;
  check("findAll{standalone} → serbest şablonu içerir", stdList.some((t) => t.id === std.data.id));
  check("findAll{standalone} → türlü şablonu İÇERMEZ", !stdList.some((t) => t.id === norm.data.id));
  check("findAll{standalone} → hepsi standalone=true", stdList.every((t) => t.standalone === true));

  const assignableList = (await tplService.findAll({ assignable: true })).data;
  check("findAll{assignable} → türlü şablonu içerir", assignableList.some((t) => t.id === norm.data.id));
  check("findAll{assignable} → serbest şablonu İÇERMEZ", !assignableList.some((t) => t.id === std.data.id));
  check("findAll{assignable} → hiçbiri standalone değil", assignableList.every((t) => t.standalone === false));

  // Filtresiz liste standalone bayrağını taşır.
  const plainList = (await tplService.findAll()).data;
  const stdRow = plainList.find((t) => t.id === std.data.id);
  check("findAll (filtresiz) satırı standalone alanını taşır", stdRow?.standalone === true);

  // findById standalone taşır.
  const byId = (await tplService.findById(std.data.id)).data;
  check("findById → standalone=true", byId.standalone === true);

  // --- 7. listStandaloneTemplates ---
  const picker = (await labelService.listStandaloneTemplates()).data;
  const pStd = picker.find((t) => t.id === std.data.id);
  check("listStandaloneTemplates → serbest şablon var", !!pStd);
  check("listStandaloneTemplates → 2 varyant döndü", (pStd?.variants.length ?? 0) === 2);
  check("listStandaloneTemplates → widthMm sayı", typeof pStd?.variants[0]?.widthMm === "number");
  check("listStandaloneTemplates → türlü şablon YOK", !picker.some((t) => t.id === norm.data.id));

  // --- 8. render: native + html ---
  const nat = await labelService.renderStandaloneTemplateNative({
    templateId: std.data.id,
    rasterCapable: true,
    copies: 3,
  });
  check("renderNative → contentB64 baytları var", nat.data.contentB64.length > 0);
  check("renderNative → count=copies (3)", nat.data.count === 3);
  check("renderNative → dil döndü", !!nat.data.language);

  const natClamp = await labelService.renderStandaloneTemplateNative({ templateId: std.data.id, copies: 999 });
  check("renderNative → kopya 100'e clamp", natClamp.data.count === 100);

  const html = await labelService.renderStandaloneTemplateHtml({ templateId: std.data.id });
  check("renderHtml → HTML üretildi", html.data.html.includes("<") && html.data.html.length > 50);
  check("renderHtml → kind fallback (ROLL_FINISHED)", html.data.kind === LabelKind.ROLL_FINISHED);

  // Explicit variantId → o varyant boyutunda basar (80x50).
  const natV2 = await labelService.renderStandaloneTemplateNative({ templateId: std.data.id, variantId: v2.data.id });
  check("renderNative(variantId=v2) → baytlar üretildi", natV2.data.contentB64.length > 0);

  // Geçersiz variantId → 400.
  await expectThrow(
    () => labelService.renderStandaloneTemplateNative({ templateId: std.data.id, variantId: "00000000-0000-0000-0000-000000000000" }),
    "renderNative(geçersiz variantId) → 400",
    "varyant",
  );

  // Varyantsız serbest şablon → 400.
  const stdEmpty = await tplService.create({ name: `TEST-STD-EMPTY-${stamp}`, standalone: true });
  createdTemplateIds.push(stdEmpty.data.id);
  await expectThrow(
    () => labelService.renderStandaloneTemplateNative({ templateId: stdEmpty.data.id }),
    "renderNative(varyantsız) → 400",
    "varyant",
  );

  // Olmayan şablon → 404.
  await expectThrow(
    () => labelService.renderStandaloneTemplateHtml({ templateId: "00000000-0000-0000-0000-000000000000" }),
    "renderHtml(olmayan şablon) → 404",
    "bulunamadı",
  );

  // Türlü (standalone olmayan) şablon render ucuna kapalı → 404.
  await expectThrow(
    () => labelService.renderStandaloneTemplateNative({ templateId: norm.data.id }),
    "renderNative(türlü şablon) → 404 (yalnız serbest basılır)",
    "Serbest etiket",
  );

  // --- 9. Integrity guard: ATANMIŞ şablon serbeste çevrilemez ---
  // (Regresyon: atama korunurken standalone:true → sonra barkodsuz varyant → gerçek
  //  rulo için izsiz etiket. Önce atamalar kaldırılmalı.)
  const SCANNABLE_LAYOUT = {
    v: 1,
    elements: [
      { id: "q1", type: "qr", x: 5, y: 5, scale: 5 },
      { id: "t1", type: "text", x: 5, y: 32, text: "X", hMm: 4 },
    ],
  };
  const assigned = await tplService.create({ name: `TEST-ASSIGNED-${stamp}`, kind: LabelKind.ROLL_RAW });
  createdTemplateIds.push(assigned.data.id);
  await tplService.createVariant(
    assigned.data.id,
    { name: "100x60", widthMm: 100, heightMm: 60, elements: SCANNABLE_LAYOUT },
    undefined,
  );
  await tplService.setContextDefault(LabelKind.ROLL_RAW, assigned.data.id); // atandı (scannable → geçer)
  await expectThrow(
    () => tplService.update(assigned.data.id, { standalone: true }),
    "atanmış şablon → standalone:true → throw",
    "Atanmış",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function cleanup(): Promise<void> {
  // Bağlam varsayılanı (LabelContextDefault.templateId Restrict) önce silinmeli;
  // integrity testi gerçek bir atama yazar. Varyantlar cascade.
  await prisma.labelContextDefault.deleteMany({ where: { templateId: { in: createdTemplateIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: createdTemplateIds } } });
  console.log("Cleanup: test şablonları silindi.");
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => {
    await cleanup().catch((err) => console.error("Cleanup hatası:", err));
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
