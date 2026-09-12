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
//
// KÖRLÜK ZEMİNİ: route adım ağacı ve alias pivotu DB fixture'ıyla KOŞULMUYOR
// (istasyon/müşteri fixture'ı gerektirir); onlar plan tablosu üzerinden STATİK
// doğrulanır ve bu satır ekrana basılır ki "yeşil = kapsandı" sanılmasın.
//
// Fixture: `TEST-REV-` önekli renkler. Cleanup `finally`de (defter satırı RESTRICT
// olduğu için ÖNCE satırlar, sonra koşum silinir).

import prisma from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { buildImportRunLine } from "../src/services/import/import-run-line.helper";
import type { PreparedRow } from "../src/services/import/import.types";
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
      check("17 varlığın tamamı plan tablosunda", entities.length === 17, `${entities.length} varlık`);
      check("iki alias pivotu DELETE_PIVOT (③b)", plan.customerItemAlias?.mode === "DELETE_PIVOT" && plan.customerColorAlias?.mode === "DELETE_PIVOT");
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

    console.log(
      "\nℹ️ KÖRLÜK ZEMİNİ: route adım ağacının ve alias pivotunun DB geri yazımı bu bekçide" +
        " fixture ile KOŞULMADI (istasyon/müşteri fixture'ı gerekir) — yalnız plan tablosu ve" +
        " saf yük doğrulandı.",
    );
  } finally {
    // Defter satırı RESTRICT: ÖNCE satırlar, sonra koşum.
    if (runIds.length > 0) {
      await prisma.importRunLine.deleteMany({ where: { importRunId: { in: runIds } } });
      await prisma.importRun.deleteMany({ where: { id: { in: runIds } } });
    }
    await prisma.color.deleteMany({ where: { name: { startsWith: PREFIX } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("ÇÖKTÜ:", e);
  process.exit(1);
});
