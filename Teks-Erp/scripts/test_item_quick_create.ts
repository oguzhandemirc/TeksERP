// =============================================================================
// Test: ItemService.quickCreateFabric — saha (KK1) hızlı desen oluşturma
// Çalıştır: npx tsx scripts/test_item_quick_create.ts
// Doğrulananlar:
//   1. quickCreateFabric(name) → FABRIC + MT + isActive + pendingReview=true,
//      otomatik STK-NNNNNN kod, ad TR-büyük harf normalize.
//   2. Aynı adla ikinci quick-create → 409 (ad-mükerrer guard yeniden kullanılır).
//   3. ANTI-SPOOF: public create({..., pendingReview:true}) gövdesindeki
//      pendingReview YOK SAYILIR (kayıt false kalır) — yalnız quick-create opt'u
//      işaretleyebilir. (create() Prisma data'yı açıkça kurar; super.create'e
//      refactor bu güvenceyi bozar.)
// =============================================================================
import prisma from "../src/lib/prisma";
import { ItemService } from "../src/services/item.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

// Route config'iyle birebir (item.routes.ts).
const service = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["code", "name"],
  defaultInclude: {
    allowedColors: { include: { color: true } },
    allowedProperties: { include: { property: true } },
  },
  duplicateNameField: "name",
  entityLabel: "ürün",
});

async function expectConflict(label: string, fn: () => Promise<unknown>, msgPart?: string) {
  let err: unknown;
  try { await fn(); } catch (e) { err = e; }
  const ok =
    err instanceof AppError &&
    err.statusCode === 409 &&
    (!msgPart || err.message.includes(msgPart));
  check(label, ok, err instanceof AppError ? err.message : String(err ?? "hata fırlatılmadı"));
}

type ItemRec = {
  id: string;
  code: string;
  name: string;
  itemType: string;
  unit: string;
  isActive: boolean;
  pendingReview: boolean;
};

async function main() {
  const ts = Date.now();
  const NAME = `TEST-DESEN-${ts}`;
  const NORM = NAME.toLocaleUpperCase("tr-TR");
  const createdIds: string[] = [];

  try {
    // 1) quickCreateFabric → tüm alanlar backend'den, pendingReview=true
    const res = await service.quickCreateFabric(NAME, undefined);
    const rec = res.data as ItemRec | null;
    if (rec?.id) createdIds.push(rec.id);
    check("quick-create başarılı", res.success === true);
    check("ad TR-büyük harf normalize", rec?.name === NORM, rec?.name);
    check("itemType FABRIC'e zorlandı", rec?.itemType === "FABRIC", rec?.itemType);
    check("birim MT (default)", rec?.unit === "MT", rec?.unit);
    check("isActive true", rec?.isActive === true);
    check("pendingReview true (saha işareti)", rec?.pendingReview === true);
    check("kod otomatik STK-NNNNNN", /^STK-\d{6,}$/.test(rec?.code ?? ""), rec?.code);

    // 2) Aynı adla ikinci quick-create → 409
    await expectConflict(
      "aynı adla ikinci quick-create → 409",
      () => service.quickCreateFabric(NAME.toLocaleLowerCase("tr-TR"), undefined),
      "zaten var",
    );

    // 3) ANTI-SPOOF: public create gövdesindeki pendingReview yok sayılır
    const spoofName = `TEST-DESEN-SPOOF-${ts}`;
    const spoof = await service.create(
      { name: spoofName, itemType: "FABRIC", pendingReview: true } as Record<string, unknown>,
      undefined,
    );
    const spoofRec = spoof.data as ItemRec | null;
    if (spoofRec?.id) createdIds.push(spoofRec.id);
    check(
      "anti-spoof: public create'te pendingReview yok sayıldı (false)",
      spoofRec?.pendingReview === false,
      `pendingReview=${spoofRec?.pendingReview}`,
    );
  } finally {
    for (const id of createdIds) {
      await prisma.item.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
