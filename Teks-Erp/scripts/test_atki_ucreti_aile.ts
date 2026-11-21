// =============================================================================
// DESEN AİLESİNE TOPLU ATKI ÜCRETİ BEKÇİSİ (SY-C3)
// =============================================================================
// Çalıştır: npx tsx scripts/test_atki_ucreti_aile.ts   (yalnız *_test DB)
// §1 aile listesi: etiketli desenler + kumaş sayıları; etiketsiz desen listede yok.
// §2 önizleme yazmaz; ailenin HER kumaşı (pasif dahil) mevcut ücret + kaynakla; başka aile yok.
// §3 uygula: YALNIZ seçilenler yazılır (yapısız kumaşa yapı doğar); seçilmeyen dokunulmaz.
// §4 fail-closed: aile dışı id → 400 + HİÇBİRİ yazılmaz; boş seçim / eksik döviz 400.
// =============================================================================
import "dotenv/config";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { applyPickRateFamily, listPickRateFamilies, previewPickRateFamily } from "../src/services/cost-pick-rate-family.service";
import { assertGelistirmeVeritabani } from "./db-guard";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function errCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return `${e.statusCode}:${String((e.details as { code?: string } | undefined)?.code ?? "")}`;
    return "THROW";
  }
}

const TAG = `TEST-SYC3${Date.now().toString(36).toUpperCase()}`.slice(0, 24);
const FAMILY = `${TAG}-AILE`;
const OTHER_FAMILY = `${TAG}-DIGER`;
const ids = { items: [] as string[], designs: [] as string[] };

async function setup() {
  const design = async (s: string, familyLabel: string | null) => {
    const r = await prisma.weaveDesign.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, kind: "DOBBY", familyLabel }, select: { id: true } });
    ids.designs.push(r.id);
    return r.id;
  };
  const item = async (s: string, weaveDesignId: string, extra: Record<string, unknown> = {}) => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType: "FABRIC", weaveDesignId, ...extra }, select: { id: true } });
    ids.items.push(r.id);
    return r.id;
  };
  const d1 = await design("D1", FAMILY);
  const d2 = await design("D2", FAMILY);
  const dOther = await design("D3", OTHER_FAMILY);
  const dNone = await design("D4", null);
  const withRate = await item("K1", d1);
  await prisma.costStructure.create({ data: { itemId: withRate, loomPickRate: "0.0100", loomPickCurrency: "USD" } });
  const bare = await item("K2", d1);
  const passive = await item("K3", d2, { isActive: false, lifecycleStatus: "ARCHIVED" });
  const other = await item("K4", dOther);
  const none = await item("K5", dNone);
  return { withRate, bare, passive, other, none };
}

async function cleanup(): Promise<void> {
  await prisma.costStructure.deleteMany({ where: { itemId: { in: ids.items } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.weaveDesign.deleteMany({ where: { id: { in: ids.designs } } });
}

async function main(): Promise<void> {
  console.log("=== DESEN AİLESİNE ATKI ÜCRETİ BEKÇİSİ (SY-C3) ===");
  assertGelistirmeVeritabani("test_atki_ucreti_aile");
  const admin = await ensureTestAdmin();
  try {
    const k = await setup();
    const rateOf = async (itemId: string) => {
      const cs = await prisma.costStructure.findUnique({ where: { itemId }, select: { loomPickRate: true, loomPickCurrency: true } });
      return cs ? `${cs.loomPickRate?.toFixed(4) ?? "-"} ${cs.loomPickCurrency ?? "-"}` : "YOK";
    };

    console.log("§1 aile listesi");
    const fams = await listPickRateFamilies();
    const mine = fams.find((f) => f.familyLabel === FAMILY);
    check("§1a aile 2 desen + 3 kumaş (pasif dahil)", mine?.designCount === 2 && mine.itemCount === 3, JSON.stringify(mine));
    check("§1b diğer aile ayrı satır; etiketsiz desen aile üretmez", fams.some((f) => f.familyLabel === OTHER_FAMILY && f.itemCount === 1) && !fams.some((f) => f.familyLabel.startsWith(`${TAG}-D4`)));

    console.log("§2 önizleme");
    const before = await prisma.costStructure.count({ where: { itemId: { in: ids.items } } });
    const pv = await previewPickRateFamily(FAMILY);
    const pvIds = new Set(pv.rows.map((r) => r.itemId));
    check("§2a ailenin HER kumaşı listede (pasif dahil), başka aile/etiketsiz yok",
      pv.rows.length === 3 && [k.withRate, k.bare, k.passive].every((x) => pvIds.has(x)) && !pvIds.has(k.other) && !pvIds.has(k.none));
    const r1 = pv.rows.find((r) => r.itemId === k.withRate);
    check("§2b mevcut ücret kaynağıyla (YAPI 0.0100 USD)", r1?.current.source === "YAPI" && r1.current.rate === "0.0100" && r1.current.currency === "USD", JSON.stringify(r1?.current));
    const r3 = pv.rows.find((r) => r.itemId === k.passive);
    check("§2c pasif kumaş işaretli", r3?.isActive === false);
    check("§2d önizleme hiçbir şey yazmadı", (await prisma.costStructure.count({ where: { itemId: { in: ids.items } } })) === before);
    check("§2e boş aile adı 400", (await errCode(() => previewPickRateFamily("  "))) === "400:COST_PICK_FAMILY_REQUIRED");

    console.log("§3 seçimli uygula");
    const res = await applyPickRateFamily({ familyLabel: FAMILY, rate: "0.0125", currency: "USD", itemIds: [k.withRate, k.bare] }, admin.id);
    check("§3a yalnız seçilen 2 kumaş güncellendi", res.updated === 2);
    check("§3b yapılı kumaşın ücreti değişti", (await rateOf(k.withRate)) === "0.0125 USD", await rateOf(k.withRate));
    check("§3c yapısız kumaşa yapı doğdu (ücretle)", (await rateOf(k.bare)) === "0.0125 USD", await rateOf(k.bare));
    check("§3d seçilmeyen (pasif) kumaşa dokunulmadı", (await rateOf(k.passive)) === "YOK");

    console.log("§4 fail-closed");
    const mismatch = await errCode(() => applyPickRateFamily({ familyLabel: FAMILY, rate: "0.02", currency: "EUR", itemIds: [k.passive, k.other] }, admin.id));
    check("§4a aile dışı id → 400 MISMATCH", mismatch === "400:COST_PICK_FAMILY_MISMATCH", String(mismatch));
    check("§4b ret sonrası aileden olan seçili kumaş da YAZILMADI (tek tx)", (await rateOf(k.passive)) === "YOK" && (await rateOf(k.other)) === "YOK");
    check("§4c boş seçim 400", (await errCode(() => applyPickRateFamily({ familyLabel: FAMILY, rate: "0.02", currency: "EUR", itemIds: [] }, admin.id))) === "400:COST_PICK_FAMILY_EMPTY");
    const noCur = await errCode(() => applyPickRateFamily({ familyLabel: FAMILY, rate: "0.02", itemIds: [k.passive] }, admin.id));
    check("§4d dövizsiz ücret 400 (sessiz varsayım yok)", noCur !== null && noCur.startsWith("400"), String(noCur));
  } finally {
    await cleanup();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
  process.exitCode = 1;
});
