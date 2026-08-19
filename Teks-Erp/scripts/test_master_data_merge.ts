// =============================================================================
// ANA VERİ BİRLEŞTİRME — MUTLU YOL + SÖZLEŞME (Faz B5)
// =============================================================================
// Kapsam:
//   1) Dört varlığın da write izni katalogda tanımlı (permission-catalog'un
//      DEVRETTİĞİ kapsam — devir ölü olmamalı)
//   2) Mutlu yol: referanslar taşınır, KAYNAK SİLİNMEZ, tombstone doğar
//   3) Kimlik guard'ı: birim farklıysa reddedilir (en sinsi veri bozma yolu)
//   4) Tombstone dirilmez (iki kapı: update + reactivate)
//   5) Ad-mükerrer guard'ı tombstone'a yönlendirmiyor; uyarı yüzeyi GÖSTERİYOR
//   6) Snapshot dokunulmazlığı
//   7) Atomik claim: zaten birleşmiş kayıt ikinci kez birleştirilemez

import prisma, { pool } from "../src/lib/prisma";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { getImportAdapter } from "../src/services/import/import-registry";
import { MERGE_ENTITIES, MERGE_MAP } from "../src/constants/merge-map";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
// ⚠️ Servis örneği ROUTE dosyasından alınır — `new ItemService()` konfigsiz
// patlar (BaseService config zorunlu) ve testin kendi konfigini uydurması
// üretimdekinden SAPAR (duplicateNameField/uniqueField farklı olabilir).
import { itemService } from "../src/routes/item.routes";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TESTMRG${Date.now().toString().slice(-8)}`;
const created: { items: string[]; customers: string[]; rolls: string[] } = {
  items: [],
  customers: [],
  rolls: [],
};

async function main(): Promise<void> {
  console.log("=== Ana veri birleştirme ===\n");

  // ── 1) İzin kapsamı (permission-catalog'un devrettiği kontrol) ───────────
  console.log("── 1) Çift kapı izinleri katalogda tanımlı ──");
  const codes = new Set(PERMISSION_CATALOG.map((p) => p.code));
  check("master-data:merge katalogda", codes.has("master-data:merge"));
  for (const entity of MERGE_ENTITIES) {
    const adapter = getImportAdapter(entity);
    check(
      `${entity}: ikinci kapı '${adapter.writePermission}' katalogda tanımlı`,
      codes.has(adapter.writePermission),
    );
  }
  // ⚠️ Elle yazılmış bir allowlist tam BURADA sessizce yanlış olurdu:
  // `color:write` diye bir izin kodu YOKTUR, renk `property:write` taşır.
  check(
    "renk ikinci kapısı property:write (color:write DİYE BİR KOD YOK)",
    getImportAdapter("color").writePermission === "property:write",
    getImportAdapter("color").writePermission,
  );
  check("körlük zemini: katalog okundu", codes.size > 50, `${codes.size} kod`);

  // ── Fixture: iki kumaş + onlara bağlı toplar ─────────────────────────────
  const anyItem = await prisma.item.findFirst({ where: { itemType: "FABRIC" } });
  if (!anyItem) throw new Error("Fixture kurulamadı: FABRIC kumaş yok");

  const survivor = await prisma.item.create({
    data: { code: `${TAG}-S`, name: `${TAG} SURVIVOR`, itemType: "FABRIC", unit: "MT" },
  });
  const source = await prisma.item.create({
    data: { code: `${TAG}-K`, name: `${TAG} KAYNAK`, itemType: "FABRIC", unit: "MT" },
  });
  const otherUnit = await prisma.item.create({
    data: { code: `${TAG}-KG`, name: `${TAG} KILO`, itemType: "FABRIC", unit: "KG" },
  });
  created.items.push(survivor.id, source.id, otherUnit.id);

  const roll = await prisma.roll.create({
    data: {
      barcode: `${TAG}R1`,
      itemId: source.id,
      status: "STOCK",
      initialQty: 100,
      currentQty: 100,
      labelDirty: false,
    },
  });
  created.rolls.push(roll.id);

  // ── 2) Önizleme yan etkisiz + sayılar somut ──────────────────────────────
  console.log("\n── 2) Önizleme ──");
  const pv = await MasterDataMergeService.preview("item", survivor.id, [source.id]);
  check("önizleme birleştirmeye izin veriyor", pv.canMerge, pv.blockers.map((b) => b.key).join(","));
  const rollMove = pv.moves.find((m) => m.table === "rolls");
  check("top satırı sayıldı", rollMove?.count === 1, String(rollMove?.count));
  check("tüm sayımlar ölçülebildi", pv.measuredAll);
  check(
    "önizleme YAN ETKİSİZ (kaynak hâlâ birleşmemiş)",
    (await prisma.item.findUnique({ where: { id: source.id } }))?.mergedIntoId === null,
  );
  check(
    "belge dokunulmazlığı yan etki listesinde YAZILI",
    pv.sideEffects.some((s) => s.includes("DEĞİŞMEZ")),
  );

  // ── 3) Kimlik guard'ı: birim farkı ───────────────────────────────────────
  console.log("\n── 3) Kimlik guard'ı (birim) ──");
  const pvUnit = await MasterDataMergeService.preview("item", survivor.id, [otherUnit.id]);
  check(
    "MT ↔ KG birleştirmesi ÖNİZLEMEDE engelleniyor",
    !pvUnit.canMerge && pvUnit.blockers.some((b) => b.key === "IDENTITY_UNIT"),
    pvUnit.blockers.map((b) => b.key).join(","),
  );
  let unitBlocked = false;
  try {
    await MasterDataMergeService.merge("item", {
      survivorId: survivor.id,
      sourceIds: [otherUnit.id],
      reason: "birim farkı sondası",
      acknowledgedConflicts: 0,
    });
  } catch {
    unitBlocked = true;
  }
  check("MT ↔ KG birleştirmesi UYGULAMADA da engelleniyor (çift kapı)", unitBlocked);

  // ── 4) Mutlu yol ─────────────────────────────────────────────────────────
  console.log("\n── 4) Birleştirme ──");
  const res = await MasterDataMergeService.merge("item", {
    survivorId: survivor.id,
    sourceIds: [source.id],
    reason: "aynı kumaşın iki kez açılmış kaydı (test)",
    acknowledgedConflicts: 0,
  });
  check("1 kayıt birleşti", res.mergedCount === 1);

  const movedRoll = await prisma.roll.findUnique({ where: { id: roll.id } });
  check("top survivor'a taşındı", movedRoll?.itemId === survivor.id);
  check("topun etiketi 'yeniden bas' işaretlendi", movedRoll?.labelDirty === true);

  const tombstone = await prisma.item.findUnique({ where: { id: source.id } });
  // ⚠️ En önemli tek iddia: SİLİNMEDİ.
  check("KAYNAK SİLİNMEDİ (tombstone olarak duruyor)", tombstone !== null);
  check("tombstone survivor'ı işaret ediyor", tombstone?.mergedIntoId === survivor.id);
  check("tombstone pasifleşti", tombstone?.isActive === false);
  check("birleştirme künyesi yazıldı", tombstone?.mergedAt !== null);

  const audit = await prisma.systemLog.findFirst({
    where: { tableName: "items", recordId: source.id },
    orderBy: { createdAt: "desc" },
  });
  check(
    "audit satırı MASTER_DATA_MERGE olayını taşıyor",
    JSON.stringify(audit?.newData ?? {}).includes("MASTER_DATA_MERGE"),
  );
  check(
    "audit gerekçeyi saklıyor",
    JSON.stringify(audit?.newData ?? {}).includes("iki kez açılmış"),
  );

  // ── 5) Atomik claim: ikinci kez birleştirilemez ──────────────────────────
  console.log("\n── 5) Atomik claim ──");
  let secondBlocked = false;
  try {
    await MasterDataMergeService.merge("item", {
      survivorId: survivor.id,
      sourceIds: [source.id],
      reason: "ikinci kez birleştirme sondası",
      acknowledgedConflicts: 0,
    });
  } catch {
    secondBlocked = true;
  }
  check("zaten birleşmiş kayıt ikinci kez birleştirilemez", secondBlocked);

  // ── 6) Tombstone dirilmez ────────────────────────────────────────────────
  console.log("\n── 6) Tombstone diriltme yasağı ──");
  let reviveBlocked = false;
  try {
    await itemService.update(source.id, { isActive: true });
  } catch {
    reviveBlocked = true;
  }
  check("PATCH { isActive: true } reddediliyor", reviveBlocked);
  check(
    "tombstone hâlâ pasif",
    (await prisma.item.findUnique({ where: { id: source.id } }))?.isActive === false,
  );

  // ── 7) Ad guard'ı ile uyarı yüzeyi TERS yönde çalışıyor ──────────────────
  console.log("\n── 7) Sert kapı ↔ uyarı yüzeyi ayrımı ──");
  // Sert kapı: tombstone'un adı yeniden KULLANILABİLİR olmalı (B6'daki partial
  // UNIQUE de aynısını söyleyecek) ve "PASİF kayıt var, aktifleştirin" DEMEMELİ.
  let dupMessage = "";
  try {
    const revived = await itemService.create({
      code: `${TAG}-YENI`,
      name: `${TAG} KAYNAK`,
      itemType: "FABRIC",
      unit: "MT",
    });
    const id = (revived.data as { id: string }).id;
    created.items.push(id);
  } catch (e) {
    dupMessage = e instanceof Error ? e.message : String(e);
  }
  check(
    "tombstone adı yeniden kullanılabiliyor (guard 'aktifleştirin' DEMİYOR)",
    dupMessage === "",
    dupMessage,
  );
  // Uyarı yüzeyi: aynı ad TOMBSTONE olarak GÖSTERİLMELİ.
  const similar = await itemService.findSimilarNames(`${TAG} KAYNAK`);
  const asTombstone = similar.find((r) => r.id === source.id);
  check(
    "uyarı yüzeyi tombstone'u gösteriyor",
    Boolean(asTombstone),
    similar.map((r) => r.name).join(" | "),
  );
  check(
    "tombstone satırı hangi kayda birleştiğini söylüyor",
    asTombstone?.mergedIntoName === survivor.name,
    String(asTombstone?.mergedIntoName),
  );

  // ── 8) Harita bütünlüğü ──────────────────────────────────────────────────
  console.log("\n── 8) Harita ──");
  for (const e of MERGE_ENTITIES) {
    check(`${e}: harita dolu`, MERGE_MAP[e].length > 0, `${MERGE_MAP[e].length} kural`);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    // Temizlik — RESTRICT FK'lar yüzünden sıra önemli.
    await prisma.rollVariance?.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(() => undefined);
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: created.rolls } } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: created.rolls } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { recordId: { in: created.items } } }).catch(() => undefined);
    await prisma.item.updateMany({
      where: { id: { in: created.items } },
      data: { mergedIntoId: null },
    }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: created.items } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } }).catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
