// =============================================================================
// EK MALİYET FORMÜLÜ BEKÇİSİ (SY-C1) — ifade değerlendirici + damgalı sürüm + sürüm donması
// =============================================================================
// Çalıştır: npx tsx scripts/test_maliyet_formul_ifade.ts   (yalnız *_test DB; aktif formül GLOBAL durumdur)
// §1 değerlendirici (paketsiz, Decimal): öncelik, işlevler, virgül, ; ayırıcı; kaçış/uzunluk/derinlik reddi.
// §2 kayıt kapısı: bilinmeyen değişken/işlev 400, pulAdet bağlı (SY-d), önizleme yazmaz.
// §3 damgalı sürüm: değişim eski satırı damgalar + versionNo+1; eski id ile değişim/kaldırma 409; kod çakışması 409.
// §4 motor: formül satırı FORMULA bileşeni; sıfıra bölme FORMULA_FAILED (sonuç yok); formülsüz girdi bayt-aynı;
//    sürüm donması: dondurulan girdi formül değişse de aynı sayı, yeni derleme yeni formülü okur;
//    pulAdet = ADET birimli atkı ipliğinin metre başı adedi, ADET yoksa 0 (§4j–§4k).
// =============================================================================
import "dotenv/config";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { CostFormulaError, evaluateCostFormula, parseCostFormula, COST_FORMULA_MAX_DEPTH } from "../src/services/helpers/cost-formula-expr.helper";
import { COST_FORMULA_UNBOUND_VARIABLES, COST_FORMULA_VARIABLE_NAMES } from "../src/services/helpers/cost-formula-vars.helper";
import { changeCostFormula, createCostFormula, previewCostFormula, revokeCostFormula, validateCostFormulaExpression } from "../src/services/cost-formula.service";
import { assembleCostInputTx } from "../src/services/helpers/cost-assembler.helper";
import { computeFabricCost } from "../src/services/helpers/fabric-cost.helper";
import { costInputHash, parseCostInputSnapshot, serializeCostInput } from "../src/services/helpers/cost-snapshot.helper";
import type { CostInput } from "../src/services/helpers/fabric-cost-types.helper";
import { goldenPureInput, GOLDEN_CASES } from "./lib/seyitoglu-altin-fikstur";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { assertGelistirmeVeritabani } from "./db-guard";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const USD = D("41.85");

function evalText(expr: string, vars: Record<string, string> = {}): string {
  const map = new Map(Object.entries(vars).map(([k, v]) => [k, D(v)]));
  return evaluateCostFormula(parseCostFormula(expr, COST_FORMULA_VARIABLE_NAMES), map).toString();
}
function errCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof CostFormulaError) return e.code;
    if (e instanceof AppError) return String((e.details as { code?: string } | undefined)?.code ?? e.statusCode);
    return "THROW";
  }
}
async function errCodeAsync(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}`;
    return "THROW";
  }
}

function section1(): void {
  console.log("\n--- §1 değerlendirici ---");
  check("§1a öncelik: 2 + 3 * 4 = 14", evalText("2 + 3 * 4") === "14");
  check("§1b parantez + × ÷ işaretleri: (2 + 3) × 4 ÷ 2 = 10", evalText("(2 + 3) × 4 ÷ 2") === "10");
  check("§1c virgüllü ondalık + değişken: 0,05 * hamMaliyet", evalText("0,05 * hamMaliyet", { hamMaliyet: "48" }) === "2.4");
  check("§1d işlevler ; ayırıcıyla: max(1; min(5; 3)) + round(2.345; 2)", evalText("max(1; min(5; 3)) + round(2.345; 2)") === "5.35");
  check("§1e tekli eksi: -metre + 3", evalText("-metre + 3", { metre: "1" }) === "2");
  check("§1f Decimal kesinliği: 0.1 + 0.2 = 0.3 (float değil)", evalText("0.1 + 0.2") === "0.3");
  check("§1g tanınmayan değişken → UNKNOWN_VARIABLE", errCode(() => evalText("fiyat * 2")) === "COST_FORMULA_UNKNOWN_VARIABLE");
  check("§1h tanınmayan işlev → INVALID", errCode(() => evalText("sqrt(4)")) === "COST_FORMULA_INVALID");
  check("§1i eval kaçışı reddedilir (constructor / process / köşeli parantez / tırnak)",
    ["constructor", "process.exit()", "metre[0]", "\"a\"", "metre; 1", "this", "globalThis.x"].every((x) => errCode(() => evalText(x)) !== null));
  check("§1j 500 karakter sınırı", errCode(() => parseCostFormula("1+".repeat(250) + "1", COST_FORMULA_VARIABLE_NAMES)) === "COST_FORMULA_INVALID");
  const deep = "(".repeat(COST_FORMULA_MAX_DEPTH + 2) + "1" + ")".repeat(COST_FORMULA_MAX_DEPTH + 2);
  check("§1k derinlik sınırı", errCode(() => parseCostFormula(deep, COST_FORMULA_VARIABLE_NAMES)) === "COST_FORMULA_INVALID");
  check("§1l sıfıra bölme → EVAL_FAILED (sessiz 0/Infinity yok)", errCode(() => evalText("metre / (metre - 1)", { metre: "1" })) === "COST_FORMULA_EVAL_FAILED");
  check("§1m yarım ifade / boş → INVALID", errCode(() => evalText("2 +")) === "COST_FORMULA_INVALID" && errCode(() => evalText("  ")) === "COST_FORMULA_INVALID");
}

function section2(): void {
  console.log("\n--- §2 kayıt kapısı + önizleme ---");
  // SY-d: pulAdet iplik kartı birimine bağlandı → kayıtta kabul; bağlı olmayan değişken kalmadı.
  check("§2a pulAdet bağlı: kayıtta kabul, katalogda yer tutucu yok",
    errCode(() => validateCostFormulaExpression("pulAdet * 0,02")) === null && COST_FORMULA_UNBOUND_VARIABLES.size === 0);
  check("§2b bilinmeyen değişken kayıtta 400", errCode(() => validateCostFormulaExpression("kur * 2")) === "COST_FORMULA_UNKNOWN_VARIABLE");
  const p = previewCostFormula({ expression: "atkiSikligi * 0,1", values: { atkiSikligi: "20" } });
  check("§2c önizleme örnek değeri ezer: 20 × 0,1 = 2", p.sonuc === "2" && p.hata === null && p.degiskenler.join() === "atkiSikligi", JSON.stringify(p));
  const z = previewCostFormula({ expression: "metre / (metre - 1)" });
  check("§2d önizlemede hesap hatası 200 + hata metni (400 gürültüsü yok)", z.sonuc === null && !!z.hata);
  check("§2e önizlemede ayrıştırma hatası 400", errCode(() => previewCostFormula({ expression: "metre +" })) === "COST_FORMULA_INVALID");
}

/** SY-d: `pulAdet` = ADET birimli atkı ipliğinin metre başı adedi (iplik satırıyla aynı sayı); ADET yoksa 0. */
function sectionPul(f: NonNullable<CostInput["formulas"]>[number]): void {
  const base = withFormulas([{ ...f, expression: "pulAdet * 0,01" }]);
  const weft = base.weft!;
  const last = weft.yarns.length - 1;
  const pulInput: CostInput = { ...base, weft: { ...weft, yarns: weft.yarns.map((y, i) => (i === last ? { ...y, unit: "ADET" as const, piecesPerM: D(2) } : y)) } };
  const out = computeFabricCost(pulInput, { USD });
  const pulLine = out.result?.lines.find((l) => l.component === "WEFT_YARN" && l.qtyUnit === "adet");
  const fLine = out.result?.lines.find((l) => l.component === "FORMULA");
  check("§4j pulAdet = adetle alınan atkının metre başı adedi (iplik satırıyla aynı) × 0,01",
    !!pulLine?.qty && pulLine.qty.gt(0) && !!fLine && fLine.amountPerMTry.eq(pulLine.qty.mul(D("0.01"))), `${pulLine?.qty?.toString()} / ${fLine?.amountPerMTry.toString()}`);
  const none = computeFabricCost(withFormulas([{ ...f, expression: "pulAdet + 1" }]), { USD });
  const noneLine = none.result?.lines.find((l) => l.component === "FORMULA");
  check("§4k adetle alınan atkı yoksa pulAdet = 0 (eksik değil, satır 1)", !!noneLine && noneLine.amountPerMTry.eq(D(1)), noneLine?.amountPerMTry.toString());
}

/** Formülsüz golden girdi + verilen formüller (motor kur listesi: USD). */
function withFormulas(formulas: CostInput["formulas"]): CostInput {
  const base = goldenPureInput(GOLDEN_CASES.find((c) => c.key === "S3000")!);
  return formulas?.length ? { ...base, formulas } : base;
}

async function section3and4(tag: string, userId: string, ids: string[]): Promise<void> {
  console.log("\n--- §3 damgalı sürüm ---");
  const code = `${tag}-F`;
  const v1 = await createCostFormula({ code, name: "Pul işçiliği", expression: "atkiSikligi * 0,1", currency: "TRY", sortOrder: 5 }, userId);
  ids.push(v1.id);
  check("§3a yaratım sürüm 1, aktif", v1.versionNo === 1 && v1.revokedAt === null && v1.code === code);
  check("§3b aynı kodla ikinci aktif formül 409", (await errCodeAsync(() => createCostFormula({ code, name: "X", expression: "1" }, userId))) === "409:COST_FORMULA_CODE_TAKEN");
  const same = await changeCostFormula(v1.id, { name: "Pul işçiliği", expression: "atkiSikligi * 0,1", currency: "TRY", sortOrder: 5 }, userId);
  check("§3c aynı değerle değişim no-op (yeni satır yok)", !same.wrote && same.row.id === v1.id);

  // §4 öncesi: v1 aktifken derleyici formülü girdiye dondurur.
  const adHoc = { warp: null, weft: { picksPerCm: D(20), rawWidthCm: D(300), yarns: [] } };
  const frozenIn = await prisma.$transaction((tx) => assembleCostInputTx(tx, { adHoc }));
  const mine = (frozenIn.formulas ?? []).find((f) => f.code === code);
  check("§4a derleyici aktif formülü girdiye koydu (sürüm 1)", mine?.versionNo === 1 && mine.expression === "atkiSikligi * 0,1");

  const v2 = await changeCostFormula(v1.id, { name: "Pul işçiliği", expression: "atkiSikligi * 0,2", currency: "TRY", sortOrder: 5 }, userId);
  ids.push(v2.row.id);
  const oldRow = await prisma.costFormula.findUnique({ where: { id: v1.id }, select: { revokedAt: true, revokeReason: true } });
  check("§3d değişim: yeni satır sürüm 2 + eski satır damgalı (silinmedi)", v2.wrote && v2.row.versionNo === 2 && !!oldRow?.revokedAt && oldRow.revokeReason === "Formül değişti");
  check("§3e eski id ile ikinci değişim 409 STALE", (await errCodeAsync(() => changeCostFormula(v1.id, { name: "Y", expression: "1" }, userId))) === "409:COST_FORMULA_STALE");
  check("§3f eski id ile kaldırma 409 STALE", (await errCodeAsync(() => revokeCostFormula(v1.id, userId))) === "409:COST_FORMULA_STALE");

  console.log("\n--- §4 motor + sürüm donması ---");
  const ownFrozen = { ...frozenIn, formulas: (frozenIn.formulas ?? []).filter((f) => f.code === code) };
  const snapJson = JSON.parse(JSON.stringify(serializeCostInput(ownFrozen)));
  const reread = parseCostInputSnapshot(snapJson);
  check("§4b donmuş girdi şema turunu formül metniyle geçer (hash aynı)", costInputHash(reread) === costInputHash(ownFrozen) && reread.formulas?.[0]?.expression === "atkiSikligi * 0,1");
  const fresh = await prisma.$transaction((tx) => assembleCostInputTx(tx, { adHoc }));
  const freshMine = (fresh.formulas ?? []).find((f) => f.code === code);
  check("§4c yeni derleme sürüm 2'yi okur; donmuş girdi sürüm 1'de kalır", freshMine?.versionNo === 2 && reread.formulas?.[0]?.versionNo === 1);

  const f1 = reread.formulas!;
  const f2 = [{ ...f1[0], versionNo: 2, expression: "atkiSikligi * 0,2" }];
  const r1 = computeFabricCost(withFormulas(f1), { USD });
  const r1again = computeFabricCost(withFormulas(f1), { USD });
  const r2 = computeFabricCost(withFormulas(f2), { USD });
  const none = computeFabricCost(withFormulas(undefined), { USD });
  const line = r1.result?.lines.find((l) => l.component === "FORMULA");
  check("§4d formül satırı FORMULA bileşeni, 17 atkı × 0,1 = 1,7 TL/m", !!line && line.amountPerMTry.eq(D("1.7")), line?.amountPerMTry.toString());
  check("§4e toplam = formülsüz toplam + formül (genel gider %3 dahil) — motor satırı gerçekten ekliyor",
    !!r1.result && !!none.result && r1.result.totalCostPerMTry.minus(none.result.totalCostPerMTry).toDecimalPlaces(6).eq(D("1.751")), r1.result && none.result ? r1.result.totalCostPerMTry.minus(none.result.totalCostPerMTry).toString() : "");
  check("§4f donmuş sürüm aynı sayıyı verir; değişen formül farklı sayı verir",
    !!r1.result && !!r1again.result && !!r2.result && r1.result.totalCostPerMTry.eq(r1again.result.totalCostPerMTry) && !r1.result.totalCostPerMTry.eq(r2.result.totalCostPerMTry));
  check("§4g formülsüz girdi formulas anahtarı taşımaz (hash bayt-aynı)", !("formulas" in withFormulas(undefined)) && !("formulas" in serializeCostInput(withFormulas(undefined))));
  const bad = computeFabricCost(withFormulas([{ ...f1[0], expression: "metre / (metre - 1)" }]), { USD });
  check("§4h hesapta sıfıra bölme → FORMULA_FAILED eksik, sonuç yok", bad.result === null && bad.missing.includes("FORMULA_FAILED"), bad.missing.join(","));
  const usdF = computeFabricCost(withFormulas([{ ...f1[0], currency: "USD", expression: "0,05" }]), {});
  check("§4i USD formül kursuz → FX_RATE_MISSING (uydurma kur yok)", usdF.result === null && usdF.missing.includes("FX_RATE_MISSING"));
  sectionPul(f1[0]);

  const rv = await revokeCostFormula(v2.row.id, userId);
  const after = await prisma.$transaction((tx) => assembleCostInputTx(tx, { adHoc }));
  check("§3g kaldırma: satır silinmez, yeni derlemeye girmez", rv.id === v2.row.id && !(after.formulas ?? []).some((f) => f.code === code) && (await prisma.costFormula.count({ where: { code } })) === 2);
}

async function main(): Promise<void> {
  console.log("=== EK MALİYET FORMÜLÜ BEKÇİSİ (SY-C1) ===");
  section1();
  section2();
  assertGelistirmeVeritabani("test_maliyet_formul_ifade");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`global durum yazımı durduruldu — ${engel}`);
  const tag = `TEST-SYC1${Date.now().toString(36).toUpperCase()}`.slice(0, 28);
  const user = await ensureTestAdmin();
  const ids: string[] = [];
  try {
    await section3and4(tag, user.id, ids);
  } finally {
    // Formül satırı yapılandırma geçmişidir (hiçbir sevk/defter onu göstermez); bekçi kendi TEST- satırlarını kaldırır.
    await prisma.costFormula.deleteMany({ where: { code: { startsWith: tag } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
