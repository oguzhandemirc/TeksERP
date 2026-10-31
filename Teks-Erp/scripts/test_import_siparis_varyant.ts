// =============================================================================
// test_import_siparis_varyant — SY-K3: sipariş içe aktarımında varyant + hedef değer sütunları
// =============================================================================
//   §1 eski şablon SIRASI değişmez; yeni iki sütun SONDA, isteğe bağlı, çocuk sütun
//   §2 ⭐ eski dosya (yeni sütunsuz) bugünkü gibi: varyant NULL, hedef yok, özellik yok
//   §3 ⭐ çözülemeyen varyant SATIR HATASI (yok · başka kumaşın kodu · pasif) — negatif sonda hedefi
//   §4 ⭐ varyant + hedef değer yazılır (harf duyarsız); BAYRAK ikizi requiredProperties'e girer
//   §5 hedef değer hataları: biçim · bilinmeyen değer · çeşit olmayan özellik
// Çalıştır: npx tsx scripts/test_import_siparis_varyant.ts (yalnız test DB)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { getImportAdapter } from "../src/services/import/import-registry";
import { teklifFiksturKur, teklifFiksturSil } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

// SY-K3 öncesi şablonun sütun sırası (bayt-aynı ölçütü).
const LEGACY_KEYS = [
  "ref", "customerCode", "branchName", "orderDate", "deadline", "currency", "itemCode", "colorCode", "quantity",
  "unit", "width", "unitPrice", "pieceLengthM", "cutNote", "requiredPropertyCodes", "customerItemName", "customerColorName",
];
const FIXTURE_FILE = "bekçi-syk3.xlsx";

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_import_siparis_varyant");
  const t = await teklifFiksturKur("SYK3");
  const made = { recipes: [] as string[], props: [] as string[], items: [] as string[] };
  const runIds: string[] = [];
  try {
    // §1
    const cols = getImportAdapter("order").columns;
    const keys = cols.map((c) => c.key);
    check("§1a eski sütun sırası değişmedi", JSON.stringify(keys.slice(0, LEGACY_KEYS.length)) === JSON.stringify(LEGACY_KEYS), keys.join(","));
    const extra = cols.slice(LEGACY_KEYS.length);
    check(
      "§1b yeni sütunlar sonda, isteğe bağlı, çocuk",
      extra.map((c) => c.key).join(",") === "variantCode,targetValueCodes" && extra.every((c) => !c.required && c.child),
      extra.map((c) => c.key).join(","),
    );

    // Fikstür
    const item = await prisma.item.create({ data: { code: `${t.tag}-K`, name: `${t.tag} kumaş`, itemType: "FABRIC" }, select: { id: true } });
    const other = await prisma.item.create({ data: { code: `${t.tag}-O`, name: `${t.tag} başka kumaş`, itemType: "FABRIC" }, select: { id: true } });
    made.items.push(item.id, other.id);
    const recipe = (code: string, itemId: string, isActive = true) =>
      prisma.productRecipe.create({ data: { code: `${t.tag}-${code}`, name: `${t.tag} ${code}`, itemId, variantCode: code, isActive }, select: { id: true } });
    const v1 = await recipe("V01", item.id);
    const vPassive = await recipe("V09", item.id, false);
    const vOther = await recipe("V07", other.id);
    made.recipes.push(v1.id, vPassive.id, vOther.id);
    const flag = await prisma.fabricProperty.create({ data: { code: `${t.tag}-KS`, name: `TEST Kuşak ${t.tag}`, valueType: "FLAG" }, select: { id: true } });
    made.props.push(flag.id);
    const kusakCode = `${t.tag}-KM`;
    const kusak = await prisma.fabricProperty.create({
      data: {
        code: kusakCode, name: `TEST Kuşak markası ${t.tag}`, valueType: "CHOICE", variantOfPropertyId: flag.id,
        values: { create: [{ code: "ZEBRA", name: "Zebra" }, { code: "JASMIN", name: "Jasmin" }] },
      },
      select: { id: true, values: { select: { id: true, code: true } } },
    });
    made.props.push(kusak.id);
    const zebra = kusak.values.find((v) => v.code === "ZEBRA")!.id;
    const plainCode = `${t.tag}-GR`;
    const plain = await prisma.fabricProperty.create({
      data: { code: plainCode, name: `TEST Gramaj ${t.tag}`, valueType: "CHOICE", values: { create: [{ code: "G1", name: "G1" }] } },
      select: { id: true },
    });
    made.props.push(plain.id);

    const cust = `${t.tag}-M`.slice(0, 32);
    const row = (rowNo: number, ref: string, cells: Record<string, string> = {}) => ({
      rowNo,
      cells: { ref, customerCode: cust, currency: "TRY", itemCode: `${t.tag}-K`, quantity: "100", unitPrice: "10", ...cells },
    });
    const apply = async (rows: ReturnType<typeof row>[]) => {
      const r = await ImportService.apply("order", rows, { fileName: FIXTURE_FILE });
      runIds.push(r.runId);
      return r;
    };
    const linesOfRun = async (runId: string) => {
      const ids = (await prisma.importRunLine.findMany({ where: { importRunId: runId }, select: { recordId: true } })).map((l) => l.recordId);
      return prisma.orderLine.findMany({
        where: { orderId: { in: ids.filter((x): x is string => !!x) } },
        select: { recipeId: true, requiredProperties: { select: { propertyId: true } }, targetValues: { select: { propertyId: true, valueId: true } } },
      });
    };
    const errorsOf = async (cells: Record<string, string>) =>
      (await ImportService.preview("order", [row(2, `${t.tag}-E`, cells)], {})).rows.flatMap((r) => r.errors);

    // §2
    const old = await apply([row(2, `${t.tag}-1`)]);
    const l2 = await linesOfRun(old.runId);
    check(
      "§2 ⭐ eski dosya: varyant NULL, hedef yok, özellik yok (bugünkü)",
      old.created === 1 && l2.length === 1 && l2[0]!.recipeId === null && l2[0]!.targetValues.length === 0 && l2[0]!.requiredProperties.length === 0,
      JSON.stringify({ created: old.created, l2 }),
    );

    // §3
    const e3a = await errorsOf({ variantCode: "V99" });
    check("§3a ⭐ kumaşta olmayan varyant → satır HATASI (variantCode)", e3a.some((e) => e.column === "variantCode"), JSON.stringify(e3a));
    const e3b = await errorsOf({ variantCode: "V07" });
    check("§3b başka kumaşın varyant kodu → satır HATASI", e3b.some((e) => e.column === "variantCode"), JSON.stringify(e3b));
    const e3c = await errorsOf({ variantCode: "V09" });
    check("§3c pasif varyant → satır HATASI", e3c.some((e) => e.column === "variantCode" && /pasif/.test(e.message)), JSON.stringify(e3c));

    // §4
    const ok = await apply([row(2, `${t.tag}-2`, { variantCode: "v01", targetValueCodes: `${kusakCode.toLowerCase()}=zebra` })]);
    const l4 = await linesOfRun(ok.runId);
    check(
      "§4 ⭐ varyant + hedef yazılır; BAYRAK ikizi requiredProperties'te",
      l4.length === 1 && l4[0]!.recipeId === v1.id && l4[0]!.targetValues.length === 1 && l4[0]!.targetValues[0]!.valueId === zebra &&
        l4[0]!.requiredProperties.some((p) => p.propertyId === flag.id),
      JSON.stringify(l4),
    );

    // §5
    const e5a = await errorsOf({ targetValueCodes: "ZEBRA" });
    check("§5a ÖZELLİK=DEĞER biçimi değil → HATA", e5a.some((e) => e.column === "targetValueCodes"), JSON.stringify(e5a));
    const e5b = await errorsOf({ targetValueCodes: `${kusakCode}=YOK` });
    check("§5b bilinmeyen değer → HATA", e5b.some((e) => e.column === "targetValueCodes"), JSON.stringify(e5b));
    const e5c = await errorsOf({ targetValueCodes: `${plainCode}=G1` });
    check("§5c çeşit olmayan özellik → HATA", e5c.some((e) => e.column === "targetValueCodes" && /çeşit/.test(e.message)), JSON.stringify(e5c));
  } finally {
    if (runIds.length) {
      await prisma.importRunLine.deleteMany({ where: { importRunId: { in: runIds } } });
      await prisma.importRun.deleteMany({ where: { id: { in: runIds } } });
    }
    await teklifFiksturSil(t);
    await prisma.productRecipe.deleteMany({ where: { id: { in: made.recipes } } });
    await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } });
    await prisma.fabricProperty.deleteMany({ where: { id: { in: [...made.props].reverse() } } });
    await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
