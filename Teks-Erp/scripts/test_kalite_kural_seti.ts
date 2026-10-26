// =============================================================================
// BEKÇİ: K4P 4 puan kural setleri — çözüm sırası, tek aktif fabrika, kapsam, snapshot (K4P-MOTOR)
// Çalıştır: npx tsx scripts/test_kalite_kural_seti.ts
// =============================================================================
// NEDEN: derece kuralı koddan değil kural setinden gelir ve muayene kural setinin O ANKİ hâlini
// snapshot'lar. Kural değişince geçmiş muayenenin derecesi değişirse müşteriye verilmiş rapor
// sessizce yalan olur.
//   §1 çözüm sırası: müşteri+ürün → müşteri → fabrika; pasif set atlanır
//   §2 tek aktif FACTORY (409) · pasife alınca yenisi açılır · eskisini geri açmak 409
//   §3 CUSTOMER setinde qualityGradeId yasak · FACTORY setinde zorunlu · müşteri rolü kapalı iş ortağı 400
//   §4 snapshot: bant eşiği değişince kayıtlı muayene (skor, öneri, snapshot) değişmez; yeni önizleme değişir
//   §5 canlı referans (K4P-TANIM): aktif setin bandındaki derece pasife alınamaz (409 QUALITY_GRADE_IN_RULE_SET,
//      route DELETE + PATCH isActive:false); pasif set/kullanılmayan derece/modül kapalı serbest; set pasife
//      alınınca kayıtlı muayene snapshot'ı aynı
//   §6 ürün eni (K4P-TANIM): POST yolu `widthCm` yazar; içe aktarım "En (cm)" kolonu, biçim hatası satır hatası
// Negatif sonda (2026-10-25): `updateRuleSet` bant replace'inden sonra muayeneleri "yeniden derecelendirirse"
// (`rollInspection.updateMany({ ruleSetId }, suggestedGradeCode)`) §4 iki satır kırmızı; geri alındı.
// =============================================================================
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { readFileSync } from "fs";
import path from "path";
import { assertGradeNotInActiveRuleSet, createRuleSet, setRuleSetActive, updateRuleSet } from "../src/services/four-point-rule.service";
import { itemService } from "../src/routes/item.routes";
import { itemImportAdapter } from "../src/services/import/adapters/item.adapter";
import type { PreparedRow } from "../src/services/import/import.types";
import { resolveFourPointRule } from "../src/services/helpers/four-point-resolve.helper";
import * as insp from "../src/services/quality-inspection.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) {
    const x = e as { details?: { code?: string }; code?: string; message?: string };
    return String(x.details?.code ?? x.code ?? x.message);
  }
}

const TAG = `K4R${Date.now().toString(36).toUpperCase()}`;
const made = { items: [] as string[], rolls: [] as string[], types: [] as string[], grades: [] as string[], sets: [] as string[], customers: [] as string[] };
let parkedFactory: string[] = [];
const KG = "kaliteGuvence.enabled";
let kgPrior: { value: unknown } | null = null;
const setKg = (v: boolean) => prisma.systemSetting.upsert({ where: { key: KG }, create: { key: KG, value: v }, update: { value: v } });

async function cleanup(): Promise<void> {
  const ins = { rollId: { in: made.rolls } };
  await prisma.rollError.deleteMany({ where: ins });
  for (let i = 0; i < 20 && (await prisma.rollInspection.count({ where: ins })) > 0; i++) {
    await prisma.rollInspection.deleteMany({ where: { ...ins, supersededBy: { is: null } } });
  }
  await prisma.fourPointRuleBand.deleteMany({ where: { ruleSetId: { in: made.sets } } });
  await prisma.fourPointRuleSet.deleteMany({ where: { id: { in: made.sets } } });
  await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: true } });
  await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.defectType.deleteMany({ where: { id: { in: made.types } } });
  await prisma.qualityGrade.deleteMany({ where: { id: { in: made.grades } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
  if (kgPrior) await prisma.systemSetting.update({ where: { key: KG }, data: { value: kgPrior.value as never } });
  else await prisma.systemSetting.deleteMany({ where: { key: KG } });
}

async function main(): Promise<void> {
  console.log("=== K4P kural seti bekçisi ===\n");
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const uid = admin.id;
  try {
    parkedFactory = (await prisma.fourPointRuleSet.findMany({ where: { scope: "FACTORY", isActive: true }, select: { id: true } })).map((s) => s.id);
    await prisma.fourPointRuleSet.updateMany({ where: { id: { in: parkedFactory } }, data: { isActive: false } });
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC", widthCm: 100 }, select: { id: true } });
    const other = await prisma.item.create({ data: { code: `${TAG}-J`, name: `${TAG} diğer`, itemType: "FABRIC" }, select: { id: true } });
    made.items.push(item.id, other.id);
    const cust = await prisma.customer.create({ data: { code: `${TAG}C`, name: `${TAG} müşteri`, isCustomerRole: true }, select: { id: true } });
    const supplier = await prisma.customer.create({ data: { code: `${TAG}S`, name: `${TAG} tedarikçi`, isCustomerRole: false, isSupplierRole: true }, select: { id: true } });
    made.customers.push(cust.id, supplier.id);
    const g = async (s: string) => { const r = await prisma.qualityGrade.create({ data: { code: `${TAG}${s}`, name: `${TAG} ${s}` }, select: { id: true, code: true } }); made.grades.push(r.id); return r; };
    const ga = await g("A");
    const gb = await g("B");
    const factoryBands = (a: number) => [
      { sortOrder: 0, maxScore: a, label: "A", accepted: true, qualityGradeId: ga.id },
      { sortOrder: 1, maxScore: null, label: "B", accepted: false, qualityGradeId: gb.id },
    ];
    const custBands = (a: number) => [
      { sortOrder: 0, maxScore: a, label: "GEÇER", accepted: true },
      { sortOrder: 1, maxScore: null, label: "KALIR", accepted: false },
    ];

    console.log("§3 kapsam doğrulaması");
    check("CUSTOMER setinde qualityGradeId → 400", (await errCode(createRuleSet({ name: "x", scope: "CUSTOMER", customerId: cust.id, bands: factoryBands(10) }, uid))) === "FOUR_POINT_BANDS_INVALID");
    check("FACTORY setinde derecesiz bant → 400", (await errCode(createRuleSet({ name: "x", scope: "FACTORY", bands: custBands(10) }, uid))) === "FOUR_POINT_BANDS_INVALID");
    check("müşteri rolü kapalı iş ortağı → 400 CUSTOMER_ROLE_REQUIRED", (await errCode(createRuleSet({ name: "x", scope: "CUSTOMER", customerId: supplier.id, bands: custBands(10) }, uid))) === "CUSTOMER_ROLE_REQUIRED");
    check("FACTORY setinde müşteri → 400", (await errCode(createRuleSet({ name: "x", scope: "FACTORY", customerId: cust.id, bands: factoryBands(10) }, uid))) === "FOUR_POINT_RULE_INVALID");
    check("artmayan bantlar → 400", (await errCode(createRuleSet({ name: "x", scope: "FACTORY", bands: [{ sortOrder: 0, maxScore: 10, label: "A", accepted: true, qualityGradeId: ga.id }, { sortOrder: 1, maxScore: 5, label: "B", accepted: true, qualityGradeId: gb.id }, { sortOrder: 2, maxScore: null, label: "C", accepted: false, qualityGradeId: gb.id }] }, uid))) === "FOUR_POINT_BANDS_INVALID");

    console.log("§2 tek aktif fabrika seti");
    const f1 = await createRuleSet({ name: `${TAG} F1`, scope: "FACTORY", bands: factoryBands(20) }, uid);
    made.sets.push(f1.id);
    check("ikinci aktif FACTORY → 409", (await errCode(createRuleSet({ name: `${TAG} F2`, scope: "FACTORY", bands: factoryBands(20) }, uid))) === "FOUR_POINT_RULE_ACTIVE_EXISTS");
    await setRuleSetActive(f1.id, false, uid);
    const f2 = await createRuleSet({ name: `${TAG} F2`, scope: "FACTORY", bands: factoryBands(20) }, uid);
    made.sets.push(f2.id);
    check("pasife alınca yenisi açılır", f2.isActive === true);
    check("eskisini geri açmak → 409", (await errCode(setRuleSetActive(f1.id, true, uid))) === "FOUR_POINT_RULE_ACTIVE_EXISTS");
    const auditRows = await prisma.systemLog.count({ where: { tableName: "FOUR_POINT_RULE_SET", recordId: { in: [f1.id, f2.id] } } });
    check("kural seti CUD audit'te", auditRows >= 3, String(auditRows));

    console.log("§1 çözüm sırası");
    const cGen = await createRuleSet({ name: `${TAG} müşteri`, scope: "CUSTOMER", customerId: cust.id, unit: "YD2", bands: custBands(15) }, uid);
    const cItem = await createRuleSet({ name: `${TAG} müşteri+ürün`, scope: "CUSTOMER", customerId: cust.id, itemId: item.id, bands: custBands(5) }, uid);
    made.sets.push(cGen.id, cItem.id);
    check("aynı müşteri genel setinden ikincisi → 409", (await errCode(createRuleSet({ name: "x", scope: "CUSTOMER", customerId: cust.id, bands: custBands(15) }, uid))) === "FOUR_POINT_RULE_ACTIVE_EXISTS");
    check("müşteri+ürün → kendi seti", (await resolveFourPointRule(prisma, { customerId: cust.id, itemId: item.id }))?.id === cItem.id);
    check("müşteri + başka ürün → müşteri geneli", (await resolveFourPointRule(prisma, { customerId: cust.id, itemId: other.id }))?.id === cGen.id);
    check("müşterisiz → fabrika", (await resolveFourPointRule(prisma, { itemId: item.id }))?.id === f2.id);
    check("bilinmeyen müşteri → fabrika", (await resolveFourPointRule(prisma, { customerId: randomUUID(), itemId: item.id }))?.id === f2.id);
    await setRuleSetActive(cItem.id, false, uid);
    check("pasif müşteri+ürün seti atlanır → müşteri geneli", (await resolveFourPointRule(prisma, { customerId: cust.id, itemId: item.id }))?.id === cGen.id);

    console.log("§4 snapshot donukluğu");
    const t = await prisma.defectType.create({ data: { code: `${TAG}T`, name: `${TAG} T` }, select: { id: true } });
    made.types.push(t.id);
    const roll = await prisma.roll.create({ data: { barcode: `${TAG}-R`, itemId: item.id, initialQty: 100, currentQty: 100, createdById: uid }, select: { id: true } });
    made.rolls.push(roll.id);
    // 4 puan · 100 cm · 100 m → 4,00 /100 m² → A (≤ 20)
    const row = await insp.create({ rollId: roll.id, defects: [{ defectTypeId: t.id, sizeClass: "OVER_9IN", startMeter: "1" }] }, uid);
    check("muayene: 4,00 → A", row.gradeScore?.toFixed(2) === "4.00" && row.suggestedGradeCode === ga.code);
    const before = await prisma.rollInspection.findUniqueOrThrow({ where: { id: row.id }, select: { ruleSnapshot: true, gradeScore: true, suggestedGradeCode: true, suggestedQualityGradeId: true, pointsPer100M2: true } });
    await updateRuleSet(f2.id, { name: `${TAG} F2 sıkı`, bands: factoryBands(2) }, uid);
    const after = await prisma.rollInspection.findUniqueOrThrow({ where: { id: row.id }, select: { ruleSnapshot: true, gradeScore: true, suggestedGradeCode: true, suggestedQualityGradeId: true, pointsPer100M2: true } });
    check("kural değişti: kayıtlı öneri aynı (A)", after.suggestedGradeCode === ga.code && after.suggestedQualityGradeId === ga.id);
    check("kural değişti: skor ve snapshot aynı", JSON.stringify(after) === JSON.stringify(before));
    const pv = await insp.preview({ rollId: roll.id, defects: [{ defectTypeId: t.id, sizeClass: "OVER_9IN", startMeter: "1" }] });
    check("yeni önizleme yeni kuralı kullanır (B)", pv.suggested?.code === gb.code, String(pv.suggested?.code));
    const det = await insp.getInspection(row.id);
    check("detay snapshot'tan okur (eşik 20,00)", (det.ruleSnapshot as { bands: Array<{ maxScore: string | null }> }).bands[0]?.maxScore === "20.00");
    const pc = await insp.preview({ rollId: roll.id, customerId: cust.id, defects: [{ defectTypeId: t.id, sizeClass: "OVER_9IN", startMeter: "1" }] });
    check("müşteri önizlemesi müşteri setinin biriminde (YD2 3,34) + etiket, derecesiz", pc.ruleSet?.id === cGen.id && pc.gradeScore?.toFixed(2) === "3.34" && pc.suggested?.label === "GEÇER" && pc.suggested.qualityGradeId === null);

    console.log("§5 canlı referans: aktif setteki derece pasife alınamaz");
    kgPrior = await prisma.systemSetting.findUnique({ where: { key: KG }, select: { value: true } });
    await setKg(true);
    const live = await errCode(assertGradeNotInActiveRuleSet(ga.id));
    check("aktif fabrika setinin derecesi → 409 QUALITY_GRADE_IN_RULE_SET", live === "QUALITY_GRADE_IN_RULE_SET", live);
    const gc = await g("C");
    check("kullanılmayan derece serbest", (await errCode(assertGradeNotInActiveRuleSet(gc.id))) === "ok");
    await setKg(false);
    check("modül kapalı → kural koşmaz (serbest)", (await errCode(assertGradeNotInActiveRuleSet(ga.id))) === "ok");
    await setKg(true);
    const routeSrc = readFileSync(path.join(__dirname, "../src/routes/quality-grade.routes.ts"), "utf8");
    check("route: PATCH ve DELETE kapıdan geçer",
      /router\.patch\("\/:id"[^\n]*gradeDeactivationGuard[^\n]*controller\.update/.test(routeSrc) && /router\.delete\("\/:id"[^\n]*gradeDeactivationGuard[^\n]*controller\.remove/.test(routeSrc));
    await setRuleSetActive(f2.id, false, uid);
    check("set pasife alınınca derece serbest (f1 de pasif)", (await errCode(assertGradeNotInActiveRuleSet(ga.id))) === "ok");
    const afterOff = await prisma.rollInspection.findUniqueOrThrow({ where: { id: row.id }, select: { ruleSnapshot: true, gradeScore: true, suggestedGradeCode: true, suggestedQualityGradeId: true, pointsPer100M2: true } });
    check("set pasife alındı: kayıtlı muayene snapshot'ı aynı", JSON.stringify(afterOff) === JSON.stringify(before));

    console.log("§6 ürün eni (widthCm)");
    const created = await itemService.create({ name: `${TAG} enli`, itemType: "FABRIC", widthCm: 280.5 } as never, uid);
    const cid = (created.data as { id: string }).id;
    made.items.push(cid);
    const stored = await prisma.item.findUniqueOrThrow({ where: { id: cid }, select: { widthCm: true } });
    check("POST yolu widthCm yazar (280,5)", stored.widthCm?.toFixed(2) === "280.50", String(stored.widthCm));
    const col = itemImportAdapter.columns.find((c) => c.key === "widthCm");
    check("içe aktarım: \"En (cm)\" sayı kolonu", col?.label === "En (cm)" && col.type === "number");
    const mk = (v: unknown): PreparedRow => ({ values: { name: "x", widthCm: v }, result: { errors: [], warnings: [] } }) as unknown as PreparedRow;
    const badRow = mk(-5);
    await itemImportAdapter.validateRow!(badRow, {} as never);
    check("içe aktarım: negatif en → satır hatası", badRow.result.errors.some((e) => e.column === "widthCm"));
    const okRow = mk(150);
    await itemImportAdapter.validateRow!(okRow, {} as never);
    check("içe aktarım: geçerli en hatasız", okRow.result.errors.length === 0);
    const ex = await itemImportAdapter.findExisting([`${TAG}-I`]);
    check("içe aktarım: mevcut kayıt eni sayı (diff için)", [...ex.values()][0]?.widthCm === 100);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
