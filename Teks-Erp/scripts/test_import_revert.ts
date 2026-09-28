// =============================================================================
// BEKÇİ — İÇE AKTARIM GERİ SARMA (③)
// =============================================================================
// Sözleşme: docs/design/IMPORT-EXPORT-TASARIM.md §8 · doktrin docs/kurallar/defter.md
//
// Doğrulanan invariant'lar (her biri gerçek bir arıza sınıfı):
//   1. Yazılan HER satır bir `ImportRunLine` doğurur (CREATE · UPDATE · REVIVE)
//   2. Skaler alanlar `changedFields`te, REPLACE edilen çocuk `childSnapshot`ta —
//      aynı gerçek İKİ kolonda durmaz (tek kaynak), çocukta `{from,to}` ÇİFTİ durur
//      (`to` olmadan "sonradan değişti mi" sorulamaz)
//   3. Yaratılan kayıt geri sarmada PASİFE alınır (hard delete YOK)
//   4. Güncellenen kayıt ALAN BAZLI döner; dokunulmayan alana dokunulmaz
//   5. "Kayıt sonradan değişti" ATLAMA dalıdır (hata değil) ve gerekçe DEFTERE yazılır
//   6. İleri defter satırı geri sarmada NE SİLİNİR NE DEĞİŞTİRİLİR (damga kolonları dolar)
//   7. Çift geri sarma 409
//   8. `REVIVE`ın tersi kör `isActive:false` DEĞİL — kaydedilmiş önceki durum
//   9. Atomik claim (`updateMany WHERE {id, alan: onceki}`); `findUnique→if→update` YOK
//  10. ③b pivot: CREATE satırı YAZDIĞI değerleri (anahtar + ad) deftere dondurur;
//      geri sarma satırı ancak bunlar hâlâ yerindeyse siler (defter.md) — sonradan
//      değişen/taşınan satır ATLANIR, değeri taşımayan eski defter satırı silinmez
//  11. Çapraz defter sırası: içe aktar → birleştir (SKIP) → içe aktarmayı geri al →
//      birleştirmeyi geri al → içe aktarmayı yeniden geri al; hiçbir defter ötekinin
//      satırını sessizce yemez
//
// KÖRLÜK ZEMİNİ: route adım ağacı DB fixture'ıyla KOŞULMUYOR (istasyon fixture'ı
// gerektirir); plan tablosu üzerinden STATİK doğrulanır ve bu satır ekrana basılır
// ki "yeşil = kapsandı" sanılmasın. Alias pivotu §8/§9'da kumaşa özel renk adı
// (`customerItemColorAlias`) fixture'ıyla koşulur.
//
// NEGATİF SONDALAR (ölçüldü, geri alındı): deletePivot claim'i yalnız `id`e
// indirilince §8c + §9a kırmızı · motorun `createdClaim` aktarımı kaldırılınca
// §8a kırmızı · önizleme sapma kontrolü kaldırılınca §8c önizleme kırmızı.
//
// Fixture: `TEST-REV-` önekli renkler + `TRV…` kodlu cari/kumaş/renk. Cleanup
// `finally`de (defter satırı RESTRICT olduğu için ÖNCE satırlar, sonra koşum silinir).

import { CompanyType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { buildImportRunLine } from "../src/services/import/import-run-line.helper";
import type { PreparedRow } from "../src/services/import/import.types";
import { getImportAdapter } from "../src/services/import/import-registry";
import { PIVOT_LEGACY_SKIP } from "../src/services/import/import-revert.branches";
import { CustomerAliasService } from "../src/services/customer-alias.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { MasterDataUnmergeService } from "../src/services/master-data-unmerge.service";
import { ensureTestAdmin } from "./fixture-test-user";
import { readFileSync } from "fs";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** Yorumları söker — yorumda geçen bir desen KOD sayılmasın. */
function yorumlariSok(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PREFIX = "TEST-REV";
const SRC = (rel: string): string =>
  readFileSync(join(__dirname, "..", "src", "services", "import", rel), "utf8");

/** Sahte `PreparedRow` — saf yardımcıyı DB'siz ölçmek için. */
function fakeRow(
  rowNo: number,
  changes: Record<string, { from: unknown; to: unknown }>,
  extra?: Partial<PreparedRow["result"]>,
): PreparedRow {
  return {
    input: { rowNo, cells: {} },
    values: {},
    result: { rowNo, action: "UPDATE", errors: [], warnings: [], changes, ...extra },
  } as PreparedRow;
}

async function main(): Promise<void> {
  console.log("=== İçe aktarım geri sarma bekçisi ===\n");

  // ---------------------------------------------------------------------------
  // 1. Defter yükü — saf yardımcı (DB gerekmez)
  // ---------------------------------------------------------------------------
  console.log("--- 1. Defter yükü (saf) ---");
  const base = { entity: "color", tableName: "COLOR", recordId: "11111111-1111-1111-1111-111111111111" };

  const created = buildImportRunLine({ ...base, row: fakeRow(2, {}, { action: "CREATE" }), engineAction: "CREATE" });
  check("CREATE satırı: action=CREATE, changedFields YOK", created.action === "CREATE" && created.changedFields === undefined);
  check("rowNo dosyadaki satır numarasıdır", created.rowNo === 2);

  const updated = buildImportRunLine({
    ...base,
    row: fakeRow(3, { name: { from: "ESKİ", to: "YENİ" } }),
    engineAction: "UPDATE",
  });
  check(
    "UPDATE satırı: yalnız dokunulan alan saklanır",
    updated.action === "UPDATE" &&
      JSON.stringify(updated.changedFields) === JSON.stringify({ name: { from: "ESKİ", to: "YENİ" } }),
    JSON.stringify(updated.changedFields),
  );

  const revived = buildImportRunLine({
    ...base,
    row: fakeRow(4, { isActive: { from: false, to: true } }),
    engineAction: "UPDATE",
  });
  check("pasif kayıt dirildiyse action=REVIVE", revived.action === "REVIVE", revived.action);
  check(
    "REVIVE'ın tersi KAYITLI önceki durumdur (isActive.from=false defterde)",
    JSON.stringify(revived.changedFields) === JSON.stringify({ isActive: { from: false, to: true } }),
  );
  const notRevive = buildImportRunLine({
    ...base,
    row: fakeRow(5, { isActive: { from: true, to: false } }),
    engineAction: "UPDATE",
  });
  check("aktiften pasife çeken güncelleme REVIVE DEĞİL", notRevive.action === "UPDATE");

  const pivotCreate = buildImportRunLine({
    ...base,
    row: fakeRow(9, {}, { action: "CREATE" }),
    engineAction: "CREATE",
    createdClaim: { customerId: "c", alias: "ABC" },
  });
  check(
    "③b CREATE: yazılan değerler changedFields'e {from:null,to} olarak DONAR (geri sarma claim'i)",
    JSON.stringify(pivotCreate.changedFields) ===
      JSON.stringify({ customerId: { from: null, to: "c" }, alias: { from: null, to: "ABC" } }),
    JSON.stringify(pivotCreate.changedFields),
  );

  const withChildren = buildImportRunLine({
    ...base,
    row: fakeRow(6, {
      name: { from: "A", to: "B" },
      allowedColorCodes: { from: ["K1", "K2"], to: ["K3"] },
    }),
    engineAction: "UPDATE",
  });
  check(
    "ÇOCUK anahtarı changedFields'ten ÇIKAR (aynı gerçek iki kolonda durmaz)",
    JSON.stringify(withChildren.changedFields) === JSON.stringify({ name: { from: "A", to: "B" } }),
    JSON.stringify(withChildren.changedFields),
  );
  check(
    "childSnapshot {from,to} ÇİFTİ saklar ('to' olmadan sonradan-değişti sorulamaz)",
    JSON.stringify(withChildren.childSnapshot) ===
      JSON.stringify({ allowedColorCodes: { from: ["K1", "K2"], to: ["K3"] } }),
    JSON.stringify(withChildren.childSnapshot),
  );

  const grouped = buildImportRunLine({
    ...base,
    row: fakeRow(7, { __children: { from: [{ stepSequence: 1 }], to: [{ stepSequence: 2 }] } }, { rowNos: [7, 8] }),
    engineAction: "UPDATE",
  });
  check("gruplu satırda rowNos saklanır", JSON.stringify(grouped.rowNos) === "[7,8]");
  check(
    "route adım ağacı childSnapshot'a düşer",
    grouped.changedFields === undefined && grouped.childSnapshot !== undefined,
  );

  // ---------------------------------------------------------------------------
  // 2. Statik — motor ve geri sarma servisi sözleşmeleri
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Statik sözleşmeler ---");
  const engine = yorumlariSok(SRC("import.service.ts"));
  check(
    "motor defter satırını koşum satırıyla AYNI ifadede yazıyor (iç içe createMany)",
    /lines:\s*\{\s*createMany:\s*\{\s*data:\s*ledgerLines\s*\}\s*\}/.test(engine),
  );
  check("motor her yazılan satır için buildImportRunLine çağırıyor", /ledgerLines\.push\(\s*buildImportRunLine\(/.test(engine));

  // Plan servis dosyasında, YAZIM dal dosyasında (boyut kapısı değil okunabilirlik):
  // iki dosya BİRLİKTE ölçülür, yoksa kontrol dosya bölününce sessizce körleşir.
  let revertSrc = "";
  for (const f of ["import-revert.service.ts", "import-revert.branches.ts"]) {
    try {
      revertSrc += yorumlariSok(SRC(f));
    } catch {
      /* dosya yok → aşağıdaki kontrol kırmızı verir */
    }
  }
  check("geri sarma servisi + dal dosyası var", revertSrc.length > 0);
  check(
    "atomik claim: updateMany WHERE {id, <alan>: önceki} kullanılıyor",
    /updateMany\(/.test(revertSrc) && /count\s*===\s*0/.test(revertSrc),
  );
  check(
    "findUnique→if→update YASAĞI: geri sarma kararı taze okumayla DEĞİL claim ile alınıyor",
    !/findUnique\([\s\S]{0,400}?\}\s*\)\s*;[\s\S]{0,200}?await\s+\w*\.?\w*\.update\(/.test(revertSrc),
  );
  check(
    "ileri defter satırı SİLİNMİYOR/GÜNCELLENMİYOR (yalnız damga kolonları)",
    !/importRunLine\.(delete|deleteMany)\(/.test(revertSrc) &&
      !/importRun\.(delete|deleteMany)\(/.test(revertSrc),
  );
  check(
    "damga kolonları yazılıyor (revertedAt + revertSkipReason)",
    /revertedAt/.test(revertSrc) && /revertSkipReason/.test(revertSrc),
  );
  check(
    "ana veride hard delete YOK (yalnız iki alias pivotu ③b sınıfı)",
    !/(item|customer|color|station|machine|route|productRecipe|fabricProperty)\.(delete|deleteMany)\(/.test(revertSrc),
  );

  // ---------------------------------------------------------------------------
  // 3-7. DB dalları
  // ---------------------------------------------------------------------------
  const runIds: string[] = [];
  // ⚠️ `color` autoCode'dur (prefix RNK) ve `code` sütunu createOnly + "BOŞ BIRAKIN":
  // elle kod vermek DOĞRU şekilde reddedilir. Kod sistemden okunur (framework bekçisi
  // de böyle yapıyor); fixture adla temizlenir.
  let colorId = "";
  let colorCode = "";
  let revert: typeof import("../src/services/import/import-revert.service") | null = null;
  try {
    revert = await import("../src/services/import/import-revert.service");
  } catch {
    revert = null;
  }

  try {
    console.log("\n--- 3. Yaratılan kayıt → PASİFE alınır ---");
    const createRun = await ImportService.apply(
      "color",
      [{ rowNo: 2, cells: { name: `${PREFIX} MAVİ`, hex: "#0000FF" } }],
      { mode: "upsert", onError: "abort", fileName: "bekci.xlsx" },
    );
    runIds.push(createRun.runId);
    const lines = await prisma.importRunLine.findMany({ where: { importRunId: createRun.runId } });
    check("yazılan satır defterde (1 satır)", lines.length === 1, `${lines.length} satır`);
    check("action=CREATE · tableName=COLOR", lines[0]?.action === "CREATE" && lines[0]?.tableName === "COLOR");
    check("CREATE satırında changedFields/childSnapshot YOK", lines[0]?.changedFields === null && lines[0]?.childSnapshot === null);
    colorId = lines[0]?.recordId ?? "";
    colorCode = (await prisma.color.findUnique({ where: { id: colorId }, select: { code: true } }))?.code ?? "";
    check("defter satırı gerçek kaydı gösteriyor (recordId → renk)", colorCode.length > 0, colorId);

    // Koşum kayıtları ucu satır defterinden okur, audit'ten DEĞİL (test_audit_okuma_kaynagi K-A4).
    // Negatif sonda (2026-09-25): sorgu boş kümeye çevrildi → üç kontrol ❌, geri alındı.
    const kayitlar = await ImportService.getRunRecords(createRun.runId);
    check("koşum kayıtları = satır defteri (1 kayıt, aynı recordId · CREATE · COLOR)",
      kayitlar.records.length === 1 && kayitlar.records[0]?.recordId === colorId
        && kayitlar.records[0]?.action === "CREATE" && kayitlar.records[0]?.tableName === "COLOR",
      JSON.stringify(kayitlar.records));
    check("satır defterli koşum 'defter öncesi' sayılmaz", kayitlar.legacy === false);

    if (!revert) {
      check("geri sarma servisi yüklenebiliyor (DB dalları koşabilsin)", false, "modül yok");
    } else {
      const plan = await revert.ImportRevertService.preview(createRun.runId, ["admin:*"]);
      check("önizleme planı: yaratılan satır DEACTIVATE", plan.rows[0]?.action === "DEACTIVATE", plan.rows[0]?.action);

      const res = await revert.ImportRevertService.revert(createRun.runId, {
        reason: "bekçi geri sarma ölçümü",
        selectedRowNos: [2],
        permissions: ["admin:*"],
      });
      check("geri sarma 1 satır uyguladı", res.reverted === 1, JSON.stringify(res));
      const color = await prisma.color.findUnique({ where: { id: colorId } });
      check("yaratılan renk PASİF (hard delete YOK)", color !== null && color.isActive === false);
      const after = await prisma.importRunLine.findMany({ where: { importRunId: createRun.runId } });
      check("ileri defter satırı DURUYOR (silinmedi)", after.length === 1);
      check("satıra geri sarma damgası yazıldı", after[0]?.revertedAt !== null);
      const kayitlarSonra = await ImportService.getRunRecords(createRun.runId);
      check("koşum kayıtları geri sarma damgasını gösterir", kayitlarSonra.records[0]?.revertedAt != null);
      const run = await prisma.importRun.findUnique({ where: { id: createRun.runId } });
      check("koşum satırı damgalandı, status DEĞİŞMEDİ", run?.revertedAt !== null && run?.status === "APPLIED");
      check("koşum gerekçesi saklandı", (run?.revertReason ?? "").includes("bekçi"));

      console.log("\n--- 7. Çift geri sarma 409 ---");
      let conflict = false;
      try {
        await revert.ImportRevertService.revert(createRun.runId, {
          reason: "ikinci kez geri sarma denemesi",
          selectedRowNos: [2],
          permissions: ["admin:*"],
        });
      } catch (e) {
        conflict = (e as { statusCode?: number }).statusCode === 409;
      }
      check("aynı satır ikinci kez geri sarılamaz (409)", conflict);
    }

    console.log("\n--- 4/5. Güncellenen kayıt → alan bazlı dönüş + ATLAMA dalı ---");
    await prisma.color.updateMany({ where: { id: colorId }, data: { isActive: true } });
    const updRun = await ImportService.apply(
      "color",
      [{ rowNo: 2, cells: { code: colorCode, name: `${PREFIX} KOYU MAVİ` } }],
      { mode: "upsert", onError: "abort", fileName: "bekci2.xlsx" },
    );
    runIds.push(updRun.runId);
    const updLines = await prisma.importRunLine.findMany({ where: { importRunId: updRun.runId } });
    check("güncelleme satırı defterde action=UPDATE", updLines[0]?.action === "UPDATE", updLines[0]?.action);
    const cf = updLines[0]?.changedFields as Record<string, { from: unknown; to: unknown }> | null;
    check("changedFields yalnız DOKUNULAN alanı taşıyor (name)", cf !== null && Object.keys(cf ?? {}).join(",") === "name", JSON.stringify(cf));

    if (revert) {
      // ÜÇÜNCÜ TARAF araya giriyor: alan import'un yazdığı değerden FARKLI artık.
      await prisma.color.updateMany({ where: { id: colorId }, data: { name: `${PREFIX} BAŞKASI DEĞİŞTİRDİ` } });
      const res2 = await revert.ImportRevertService.revert(updRun.runId, {
        reason: "sonradan değişmiş alan ölçümü",
        selectedRowNos: [2],
        permissions: ["admin:*"],
      });
      check("sonradan değişen alan ATLANDI (hata değil, dal)", res2.skipped.length === 1, JSON.stringify(res2));
      const c2 = await prisma.color.findUnique({ where: { id: colorId } });
      check("üçüncü tarafın değeri EZİLMEDİ", c2?.name === `${PREFIX} BAŞKASI DEĞİŞTİRDİ`, c2?.name);
      const l2 = await prisma.importRunLine.findMany({ where: { importRunId: updRun.runId } });
      check("atlama GEREKÇESİ deftere yazıldı (revertSkipReason)", (l2[0]?.revertSkipReason ?? "").length > 0, String(l2[0]?.revertSkipReason));
      check("atlanan satıra revertedAt YAZILMADI", l2[0]?.revertedAt === null);
    }

    console.log("\n--- 6. Plan tablosu (statik): ters yol sınıfları ---");
    if (revert) {
      const plan = revert.REVERT_PLAN as Record<string, { mode: string }>;
      const entities = Object.keys(plan);
      check("18 varlığın tamamı plan tablosunda", entities.length === 18, `${entities.length} varlık`);
      const pivots = ["customerItemAlias", "customerColorAlias", "customerItemColorAlias"];
      check(
        "üç müşteri adı pivotu DELETE_PIVOT (③b) ve üçü de CREATE claim'ini beyan ediyor",
        pivots.every((e) => plan[e]?.mode === "DELETE_PIVOT" && typeof getImportAdapter(e).createdClaim === "function") &&
          Object.values(plan).filter((p) => p.mode === "DELETE_PIVOT").length === 3,
        pivots.filter((e) => plan[e]?.mode !== "DELETE_PIVOT").join(","),
      );
      check("sipariş CANCEL_DOCUMENT (mevcut iptal yolu)", plan.order?.mode === "CANCEL_DOCUMENT");
      const forbidden = ["customerBranch", "qualityGrade", "defectType", "returnReason", "subcontractorCategory", "route", "productRecipe"];
      check(
        "fiziksel silmenin YASAK olduğu yedi varlık DEACTIVATE",
        forbidden.every((e) => plan[e]?.mode === "DEACTIVATE"),
        forbidden.filter((e) => plan[e]?.mode !== "DEACTIVATE").join(","),
      );
    } else {
      check("plan tablosu okunabiliyor", false, "modül yok");
    }

    if (revert) {
      await aliasPivotDallari(revert.ImportRevertService, runIds);
      await caprazDefterSirasi(revert.ImportRevertService, runIds);
    }

    console.log(
      "\nℹ️ KÖRLÜK ZEMİNİ: route adım ağacının DB geri yazımı bu bekçide fixture ile" +
        " KOŞULMADI (istasyon fixture'ı gerekir) — yalnız plan tablosu ve saf yük doğrulandı.",
    );
  } finally {
    // Defter satırı RESTRICT: ÖNCE satırlar, sonra koşum.
    if (runIds.length > 0) {
      await prisma.importRunLine.deleteMany({ where: { importRunId: { in: runIds } } });
      await prisma.importRun.deleteMany({ where: { id: { in: runIds } } });
    }
    await temizlikAliasFixture();
    await prisma.color.deleteMany({ where: { name: { startsWith: PREFIX } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

// =============================================================================
// §8–§9 — ③b pivot (kumaşa özel renk adı) DB dalları
// =============================================================================
type RevertApi = typeof import("../src/services/import/import-revert.service").ImportRevertService;

const TRV = `TRV${Date.now().toString(36).toUpperCase()}`;
const fx = { customers: [] as string[], items: [] as string[], colors: [] as string[] };
const aliasService = new CustomerAliasService();
const ENTITY = "customerItemColorAlias";

async function yeniCari(sfx: string): Promise<{ id: string; code: string }> {
  const c = await prisma.customer.create({
    data: { code: `${TRV}-${sfx}`, name: `${PREFIX} ${TRV} CARI ${sfx}`, type: CompanyType.CUSTOMER },
    select: { id: true, code: true },
  });
  fx.customers.push(c.id);
  return c;
}
async function yeniKumas(sfx: string): Promise<{ id: string; code: string }> {
  const i = await prisma.item.create({
    data: { code: `${TRV}-${sfx}`, name: `${PREFIX} ${TRV} KUMAS ${sfx}`, itemType: "FABRIC" },
    select: { id: true, code: true },
  });
  fx.items.push(i.id);
  return i;
}
async function yeniRenk(sfx: string): Promise<{ id: string; code: string }> {
  const r = await prisma.color.create({
    data: { code: `${TRV}-${sfx}`, name: `${PREFIX} ${TRV} RENK ${sfx}` },
    select: { id: true, code: true },
  });
  fx.colors.push(r.id);
  return r;
}

const anahtar = (...codes: string[]): string => codes.join("|");
async function iceAktar(runIds: string[], rows: Array<{ rowNo: number; key: string; alias: string }>): Promise<string> {
  const res = await ImportService.apply(
    ENTITY,
    rows.map((r) => ({ rowNo: r.rowNo, cells: { externalKey: r.key, alias: r.alias } })),
    { mode: "upsert", onError: "abort", fileName: "bekci-ica.xlsx" },
  );
  runIds.push(res.runId);
  return res.runId;
}
const ad = async (customerId: string, itemId: string, colorId: string): Promise<string | null> =>
  (
    await prisma.customerItemColorAlias.findUnique({
      where: { customerId_itemId_colorId: { customerId, itemId, colorId } },
      select: { alias: true },
    })
  )?.alias ?? null;

async function aliasPivotDallari(revertSvc: RevertApi, runIds: string[]): Promise<void> {
  console.log("\n--- 8. ③b pivot: kumaşa özel renk adı içe aktar → geri sar ---");
  const c = await yeniCari("A");
  const x = await yeniKumas("X");
  const e = await yeniRenk("E");
  const e2 = await yeniRenk("E2");

  // §8a CREATE: yazılan anahtar + ad deftere donar
  const createRun = await iceAktar(runIds, [
    { rowNo: 2, key: anahtar(c.code, x.code, e.code), alias: "abc" },
    { rowNo: 3, key: anahtar(c.code, x.code, e2.code), alias: "def" },
  ]);
  const lines = await prisma.importRunLine.findMany({ where: { importRunId: createRun }, orderBy: { rowNo: "asc" } });
  const cf0 = lines[0]?.changedFields as Record<string, { from: unknown; to: unknown }> | null;
  check("§8a iki CREATE satırı defterde", lines.length === 2 && lines.every((l) => l.action === "CREATE"), `${lines.length}`);
  check(
    "§8a CREATE satırı yazılan anahtar + NORMALİZE ad claim'ini taşıyor",
    cf0?.customerId?.to === c.id && cf0?.itemId?.to === x.id && cf0?.colorId?.to === e.id && cf0?.alias?.to === "ABC",
    JSON.stringify(cf0),
  );
  check("§8a kayıt DB'de BÜYÜK harfle", (await ad(c.id, x.id, e.id)) === "ABC");

  // §8b UPDATE → alan bazlı geri dönüş (jenerik restoreRow yeni tabloda)
  const updRun = await iceAktar(runIds, [{ rowNo: 2, key: anahtar(c.code, x.code, e.code), alias: "xyz" }]);
  const updLine = (await prisma.importRunLine.findMany({ where: { importRunId: updRun } }))[0];
  const ucf = updLine?.changedFields as Record<string, { from: unknown; to: unknown }> | null;
  check("§8b güncelleme UPDATE satırı, yalnız alias", updLine?.action === "UPDATE" &&
    Object.keys(ucf ?? {}).join(",") === "alias" && ucf?.alias?.from === "ABC" && ucf?.alias?.to === "XYZ", JSON.stringify(ucf));
  await revertSvc.revert(updRun, { reason: "bekçi pivot güncelleme geri sarma", selectedRowNos: [2], permissions: ["admin:*"] });
  check("§8b güncellemenin geri sarması adı ABC'ye döndürdü", (await ad(c.id, x.id, e.id)) === "ABC");

  // §8c üçüncü taraf E2'nin adını değiştiriyor → önizleme ve yazım ATLAR, E silinir
  await aliasService.upsertItemColorAlias({ customerId: c.id, itemId: x.id, colorId: e2.id }, "başka");
  const plan = await revertSvc.preview(createRun, ["admin:*"]);
  const pE = plan.rows.find((r) => r.rowNo === 2);
  const pE2 = plan.rows.find((r) => r.rowNo === 3);
  check("§8c önizleme: dokunulmamış satır DELETE_PIVOT, atlamasız, alan listesi boş",
    pE?.action === "DELETE_PIVOT" && !pE.skipReason && pE.fields.length === 0, JSON.stringify(pE));
  check("§8c önizleme: adı sonradan değişen satır gerekçeyle ATLANACAK (alias)",
    (pE2?.skipReason ?? "").includes("alias"), String(pE2?.skipReason));
  const res = await revertSvc.revert(createRun, { reason: "bekçi pivot yaratma geri sarma", selectedRowNos: [2, 3], permissions: ["admin:*"] });
  check("§8c geri sarma: 1 silindi, 1 atlandı", res.reverted === 1 && res.skipped.length === 1, JSON.stringify(res));
  check("§8c koşumun yazdığı satır SİLİNDİ", (await ad(c.id, x.id, e.id)) === null);
  check("§8c ⭐ üçüncü tarafın adı EZİLMEDİ/SİLİNMEDİ", (await ad(c.id, x.id, e2.id)) === "BAŞKA");

  // §8d claim'siz (eski) CREATE satırı: sorulamayan soru → silinmez
  const leg = await aliasService.upsertItemColorAlias({ customerId: c.id, itemId: x.id, colorId: e.id }, "eski");
  const legRun = await prisma.importRun.create({
    data: { entity: ENTITY, status: "APPLIED", finishedAt: new Date(), rowCount: 1, created: 1 },
    select: { id: true },
  });
  runIds.push(legRun.id);
  await prisma.importRunLine.create({
    data: { importRunId: legRun.id, entity: ENTITY, tableName: "CUSTOMER_ITEM_COLOR_ALIAS", recordId: leg.data.id, rowNo: 2, action: "CREATE" },
  });
  const legPlan = await revertSvc.preview(legRun.id, ["admin:*"]);
  check("§8d önizleme: değersiz eski satır gerekçeyle atlanacak", legPlan.rows[0]?.skipReason === PIVOT_LEGACY_SKIP, String(legPlan.rows[0]?.skipReason));
  const legRes = await revertSvc.revert(legRun.id, { reason: "bekçi eski defter satırı", selectedRowNos: [2], permissions: ["admin:*"] });
  check("§8d yazım da atladı, satır DURUYOR", legRes.reverted === 0 && (await ad(c.id, x.id, e.id)) === "ESKİ", JSON.stringify(legRes));

  // §8e önizleme kapıları: "Tükenene kadar" kumaş + iki parçalı anahtar
  const y = await yeniKumas("Y");
  await prisma.item.update({ where: { id: y.id }, data: { lifecycleStatus: "PHASE_OUT" } });
  const pv = await ImportService.preview(ENTITY, [
    { rowNo: 2, cells: { externalKey: anahtar(c.code, y.code, e.code), alias: "Z" } },
    { rowNo: 3, cells: { externalKey: anahtar(c.code, x.code), alias: "Z" } },
  ], { mode: "upsert", onError: "abort" });
  check("§8e 'Tükenene kadar' kumaşa yeni ad ÖNİZLEMEDE hata (yazımda koşumu durdurmaz)", pv.rows[0]?.action === "ERROR", JSON.stringify(pv.rows[0]?.errors));
  check("§8e iki parçalı anahtar üçlü şablonda okunamaz", pv.rows[1]?.action === "ERROR" &&
    (pv.rows[1]?.errors ?? []).some((er) => er.message.includes("okunamadı")), JSON.stringify(pv.rows[1]?.errors));

  // §8f round-trip: dışa aktarılan satır aynı dosyayla yüklenince SKIP
  const exported = (await getImportAdapter(ENTITY).exportRows()).filter((r) => r.externalKey?.startsWith(TRV));
  const cols = new Set(getImportAdapter(ENTITY).columns.map((k) => k.key));
  check("§8f dışa aktarım fixture satırlarını üçlü anahtarla veriyor", exported.length === 2 &&
    exported.every((r) => r.externalKey!.split("|").length === 3 && Object.keys(r).every((k) => cols.has(k))), JSON.stringify(exported));
  const rt = await ImportService.preview(ENTITY, exported.map((r, i) => ({ rowNo: i + 2, cells: r })), { mode: "upsert", onError: "abort" });
  check("§8f dışa aktarılan dosya geri yüklenince her satır SKIP", rt.rows.every((r) => r.action === "SKIP"), rt.rows.map((r) => r.action).join(","));

  // §8g kumaşı sonradan "Tükenene kadar"a alınmış MEVCUT satır: değişmeden geri yüklenince
  // SKIP (hata yok, koşum reddedilmez); adı değişirse yazılacağı için önizlemede hata.
  await prisma.customerItemColorAlias.create({ data: { customerId: c.id, itemId: y.id, colorId: e.id, alias: "ESKI-Y" } });
  const exp2 = (await getImportAdapter(ENTITY).exportRows()).filter((r) => r.externalKey?.startsWith(TRV));
  const rt2 = await ImportService.preview(ENTITY, exp2.map((r, i) => ({ rowNo: i + 2, cells: r })), { mode: "upsert", onError: "abort" });
  check("§8g 'Tükenene kadar' kumaşın DEĞİŞMEYEN satırı SKIP, hatasız", exp2.length === 3 && rt2.rows.every((r) => r.action === "SKIP" && r.errors.length === 0),
    rt2.rows.map((r) => `${r.action}:${r.errors.map((er) => er.message).join("/")}`).join(","));
  const yKey = anahtar(c.code, y.code, e.code);
  const rt3 = await ImportService.preview(ENTITY, [{ rowNo: 2, cells: { externalKey: yKey, alias: "YENI-Y" } }], { mode: "upsert", onError: "abort" });
  check("§8g aynı satırın ADI değişirse (UPDATE) önizlemede hata — servis 409'u koşumu durdurmaz", rt3.rows[0]?.action === "ERROR", JSON.stringify(rt3.rows[0]?.errors));

  // §8h anahtar AD ile yazılınca `findExisting` (yalnız KOD) mevcut satırı göremez: CREATE diye
  // deftere geçip geri sarmada içe aktarmadan ÖNCE var olan satırı silerdi → önizlemede hata.
  const xAdi = `${PREFIX} ${TRV} KUMAS X`;
  const adli = await ImportService.preview(ENTITY, [{ rowNo: 2, cells: { externalKey: anahtar(c.code, xAdi, e.code), alias: "Q" } }], { mode: "upsert", onError: "abort" });
  check("§8h ⭐ AD anahtarlı mevcut kumaşa özel eşleme CREATE değil hata", adli.rows[0]?.action === "ERROR" &&
    (adli.rows[0]?.errors ?? []).some((er) => er.message.includes("AD ile")), `${adli.rows[0]?.action} ${JSON.stringify(adli.rows[0]?.errors)}`);
  await aliasService.upsertItemAlias(c.id, x.id, "KARDES-X");
  const kardes = await ImportService.preview("customerItemAlias", [{ rowNo: 2, cells: { externalKey: anahtar(c.code, xAdi), alias: "Q" } }], { mode: "upsert", onError: "abort" });
  check("§8h kardeş kumaş adı şablonu da aynı kapıdan geçer", kardes.rows[0]?.action === "ERROR", `${kardes.rows[0]?.action} ${JSON.stringify(kardes.rows[0]?.errors)}`);
  const e3 = await yeniRenk("E3");
  const yeni = await ImportService.preview(ENTITY, [{ rowNo: 2, cells: { externalKey: anahtar(c.code, xAdi, e3.code), alias: "Q" } }], { mode: "upsert", onError: "abort" });
  check("§8h kontrol: AD anahtarlı YENİ eşleme hâlâ CREATE (uyarılı)", yeni.rows[0]?.action === "CREATE" && (yeni.rows[0]?.warnings.length ?? 0) > 0,
    `${yeni.rows[0]?.action} ${JSON.stringify(yeni.rows[0]?.errors)}`);
}

async function caprazDefterSirasi(revertSvc: RevertApi, runIds: string[]): Promise<void> {
  console.log("\n--- 9. Çapraz defter: içe aktar → birleştir → geri sar → birleştirmeyi geri al → geri sar ---");
  const admin = (await ensureTestAdmin()).id;
  const s = await yeniCari("S");
  const k = await yeniCari("K");
  const x = await yeniKumas("X9");
  const e = await yeniRenk("E9");
  const e2 = await yeniRenk("F9");
  await aliasService.upsertItemColorAlias({ customerId: s.id, itemId: x.id, colorId: e.id }, "S-GENEL");

  const run = await iceAktar(runIds, [
    { rowNo: 2, key: anahtar(k.code, x.code, e.code), alias: "P" }, // survivor'la çakışır → SKIP atar
    { rowNo: 3, key: anahtar(k.code, x.code, e2.code), alias: "Q" }, // survivor'a taşınır
  ]);
  const pv = await MasterDataMergeService.preview("customer", s.id, [k.id]);
  await MasterDataMergeService.merge("customer", {
    survivorId: s.id, sourceIds: [k.id], reason: "bekçi çapraz defter sırası", acknowledgedConflicts: pv.conflicts.length, userId: admin,
  });
  check("§9 birleştirme: survivor'da S-GENEL korundu + Q taşındı", (await ad(s.id, x.id, e.id)) === "S-GENEL" && (await ad(s.id, x.id, e2.id)) === "Q");

  const r1 = await revertSvc.revert(run, { reason: "bekçi birleşmiş kaydın geri sarması", selectedRowNos: [2, 3], permissions: ["admin:*"] });
  check("§9a ⭐ içe aktarma geri sarması iki satırı da ATLADI (biri silinmiş, biri başka cariye taşınmış)",
    r1.reverted === 0 && r1.skipped.length === 2, JSON.stringify(r1));
  check("§9a survivor'ın taşınmış Q adı SİLİNMEDİ", (await ad(s.id, x.id, e2.id)) === "Q");

  const op = await prisma.mergeOperation.findFirstOrThrow({ where: { survivorId: s.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const un = await MasterDataUnmergeService.revert(op.id, { reason: "bekçi çapraz defter geri alma", userId: admin });
  check("§9b birleştirmeyi geri alma hiçbir satırı atlamadı (P ve Q kaynağa döndü)", un.skippedRows === 0 &&
    (await ad(k.id, x.id, e.id)) === "P" && (await ad(k.id, x.id, e2.id)) === "Q", JSON.stringify(un));

  const r2 = await revertSvc.revert(run, { reason: "bekçi atlanan satırların ikinci geri sarması", selectedRowNos: [2, 3], permissions: ["admin:*"] });
  check("§9c atlanan satırlar ikinci geri sarmada silindi", r2.reverted === 2, JSON.stringify(r2));
  const kalan = await prisma.customerItemColorAlias.findMany({ where: { customerId: { in: [s.id, k.id] } }, select: { alias: true } });
  check("§9c son durum: yalnız survivor'ın kendi adı (S-GENEL)", kalan.map((r) => r.alias).join(",") === "S-GENEL", kalan.map((r) => r.alias).join(","));
}

async function temizlikAliasFixture(): Promise<void> {
  try {
    if (fx.customers.length > 0) {
      const ops = await prisma.mergeOperation.findMany({
        where: { OR: [{ survivorId: { in: fx.customers } }, { sources: { some: { sourceId: { in: fx.customers } } } }] },
        select: { id: true },
      });
      const opIds = ops.map((o) => o.id);
      if (opIds.length > 0) {
        await prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } });
      }
      await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: fx.customers } }, { bId: { in: fx.customers } }] } });
      await prisma.customerItemColorAlias.deleteMany({ where: { customerId: { in: fx.customers } } });
      await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: fx.customers } } });
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: fx.customers } } });
      await prisma.customer.deleteMany({ where: { id: { in: fx.customers } } });
    }
    if (fx.items.length > 0) await prisma.item.deleteMany({ where: { id: { in: fx.items } } });
    if (fx.colors.length > 0) await prisma.color.deleteMany({ where: { id: { in: fx.colors } } });
  } catch (err) {
    console.warn("Temizlik uyarısı:", (err as Error).message.slice(0, 300));
  }
}

main().catch((e) => {
  console.error("ÇÖKTÜ:", e);
  process.exit(1);
});
