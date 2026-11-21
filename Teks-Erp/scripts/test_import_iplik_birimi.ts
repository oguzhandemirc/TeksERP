// =============================================================================
// test_import_iplik_birimi — ürün kartı Excel içe/dışa aktarımı iplik alış birimini taşır (SY-d, GERÇEK DB)
// =============================================================================
// Kabul: "İplik Alış Birimi" + "Metredeki Adet" kolonları yeni kartı ADET/METRE doğurur; kolonsuz (eski)
// şablon yeni kartı KG (NULL) doğurur ve mevcut kartın birimine DOKUNMAZ; iplikte "KG" yazan satır
// değişiklik sayılmaz (NULL = KG); dışa aktarım iplikte etkin birimi (NULL → KG), iplik dışında boş basar;
// iplik dışı karta birim önizlemede satır hatasıdır.
// NEGATİF SONDA (ölçüldü, geri alındı): `toServicePayload` listesinden `yarnPurchaseUnit` çıkarılınca §1a–§1c,
// §2a, §5b–§5d ❌ (4/7); `findExisting`te `exportYarnUnit` yerine ham kolon okununca §4a ❌ (10/1).
// Fikstür `TEST-SYD-<ts>`; temizlik `finally`de FK sırasıyla.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import type { ImportRowInput } from "../src/services/import/import.types";
import { ensureTestAdmin } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-SYD-${Date.now()}`;
const ALL = ["*"];
const runs: string[] = [];
const c = (s: string): string => `${TAG}-${s}`;
const row = (rowNo: number, cells: Record<string, string>): ImportRowInput => ({ rowNo, cells });
let adminId = "";

async function apply(rows: ImportRowInput[]): Promise<void> {
  const r = await ImportService.apply("item", rows, {}, { userId: adminId, permissions: ALL });
  runs.push(r.runId);
}
const read = (code: string) => prisma.item.findUnique({ where: { code }, select: { yarnPurchaseUnit: true, yarnPiecesPerM: true, name: true } });

async function main(): Promise<void> {
  const block = hedefDbEngeli();
  if (block) throw new Error(block);
  adminId = (await ensureTestAdmin()).id;

  console.log("§1 yeni kart: birim kolonu taşınır");
  await apply([
    row(2, { code: c("PUL"), name: `${TAG} PUL 3 MM`, itemType: "İplik", yarnPurchaseUnit: "Adet", yarnPiecesPerM: "333,5" }),
    row(3, { code: c("PYT"), name: `${TAG} PAYET ŞERİT`, itemType: "YARN", yarnPurchaseUnit: "METRE" }),
    row(4, { code: c("ESK"), name: `${TAG} ESKİ ŞABLON`, itemType: "YARN", linearDensityDen: "150" }),
    row(5, { code: c("KMS"), name: `${TAG} KUMAŞ`, itemType: "FABRIC" }),
  ]);
  const pul = await read(c("PUL"));
  check("§1a Adet + metredeki adet '333,5' yazıldı", pul?.yarnPurchaseUnit === "ADET" && pul.yarnPiecesPerM?.toString() === "333.5", `${pul?.yarnPurchaseUnit} ${pul?.yarnPiecesPerM}`);
  check("§1b METRE yazıldı", (await read(c("PYT")))?.yarnPurchaseUnit === "METRE");
  check("§1c kolonsuz (eski) şablon → KG (NULL)", (await read(c("ESK")))?.yarnPurchaseUnit === null);

  console.log("§2 eski şablon mevcut kartın birimine dokunmaz");
  await apply([row(2, { code: c("PUL"), name: `${TAG} PUL 3 MM YENİ`, itemType: "YARN" })]);
  const pul2 = await read(c("PUL"));
  check("§2a ad güncellendi, ADET + 333.5 korundu", pul2?.name === `${TAG} PUL 3 MM YENİ` && pul2.yarnPurchaseUnit === "ADET" && pul2.yarnPiecesPerM?.toString() === "333.5");

  console.log("§3 iplik dışı karta birim önizlemede satır hatası");
  const bad = await ImportService.preview("item", [row(2, { code: c("KMS"), name: `${TAG} KUMAŞ`, itemType: "FABRIC", yarnPurchaseUnit: "ADET" })], {}, { userId: adminId, permissions: ALL });
  check("§3a kumaşa Adet → satır hatası (yarnPurchaseUnit)", bad.rows[0]?.errors.some((e) => e.column === "yarnPurchaseUnit") === true, JSON.stringify(bad.rows[0]?.errors));
  const bad2 = await ImportService.preview("item", [row(2, { code: c("ES2"), name: `${TAG} ES2`, itemType: "YARN", yarnPurchaseUnit: "KG", yarnPiecesPerM: "5" })], {}, { userId: adminId, permissions: ALL });
  check("§3b KG iplikte metredeki adet → satır hatası", bad2.rows[0]?.errors.some((e) => e.column === "yarnPiecesPerM") === true);

  console.log("§4 NULL = KG: iplikte 'KG' yazan satır değişiklik sayılmaz");
  const same = await ImportService.preview("item", [row(2, { code: c("ESK"), name: `${TAG} ESKİ ŞABLON`, itemType: "YARN", yarnPurchaseUnit: "KG" })], {}, { userId: adminId, permissions: ALL });
  const changes = same.rows[0]?.changes ?? {};
  check("§4a NULL kartta 'KG' → yarnPurchaseUnit değişikliği yok", !("yarnPurchaseUnit" in changes) && (same.rows[0]?.errors.length ?? 1) === 0, JSON.stringify(changes));

  console.log("§5 dışa aktarım");
  const exp = await ImportService.exportRows("item");
  const byCode = new Map(exp.rows.map((r) => [r.code, r]));
  check("§5a kolonlar şablonda", exp.columns.some((col) => col.key === "yarnPurchaseUnit") && exp.columns.some((col) => col.key === "yarnPiecesPerM"));
  check("§5b ADET kart → 'ADET' + '333.5'", byCode.get(c("PUL"))?.yarnPurchaseUnit === "ADET" && byCode.get(c("PUL"))?.yarnPiecesPerM === "333.5");
  check("§5c NULL iplik → 'KG', adet boş", byCode.get(c("ESK"))?.yarnPurchaseUnit === "KG" && byCode.get(c("ESK"))?.yarnPiecesPerM === "");
  check("§5d kumaş satırında birim boş", byCode.get(c("KMS"))?.yarnPurchaseUnit === "");
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.importRunLine.deleteMany({ where: { importRunId: { in: runs } } }));
  await t(() => prisma.importRun.deleteMany({ where: { id: { in: runs } } }));
  await t(() => prisma.item.deleteMany({ where: { code: { startsWith: TAG } } }));
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
