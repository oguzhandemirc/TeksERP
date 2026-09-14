// =============================================================================
// test_default_defect_type — tipsiz hata girişi VARSAYILANA düşer, varsayılan yoksa 400
// =============================================================================
// Koşum: npx tsx scripts/test_default_defect_type.ts   (GERÇEK DB; yazılar tx içinde
// ve geri alınır — kalıntı bırakmaz)
//
// Karar A (çakılı varsayım, 2026-09-14): tablet "hata tipi seçilmedi"de listenin
// ilkini UYDURUYORDU. Artık boğaz tek: `resolveDefaultDefectTypeTx` — `isDefault`
// olan tipi yazar, yoksa 400 `DEFAULT_DEFECT_TYPE_MISSING`.
//   §1 katalogda varsayılan VARKEN tipsiz satır ona düşer, tipli satır dokunulmaz
//   §2 NEGATİF (gerçek katalogda, tx içinde varsayılanlar düşürülür): tipsiz → 400,
//      tipli satırlar yine geçer; tx geri alınır
//   §3 setDefaultDefectTypeTx tek varsayılan bırakır, pasife vermez; tx geri alınır
//   §4 statik: kursunFinish yazmadan önce çözümü çağırır; mobil Tambur `defectTypes[0]`
//      uydurmuyor, `isDefault` arıyor
//   §5 (47 K2/K3) gövde tutarlılığı: `isDefault:true` + `isActive:false` → 400 ÖNCE (yarım
//      yazım yok); VARSAYILAN tip pasife alınamaz/silinemez (PATCH isActive:false · DELETE
//      · kalıcı silme guard'ı) — 400 `DEFAULT_DEFECT_TYPE_DEACTIVATE`; tx geri alınır
//   §6 (47 K4) mobil KursunQc ilk tuşu `isDefault`la sıralar, `'GENEL'` literali yok
// Negatif sonda: helper'da `if (!def)` dalını kaldır → §2 kırmızı; mobilde `[0]`
// geri gelsin → §4 kırmızı.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import {
  DEFAULT_DEFECT_TYPE_DEACTIVATE,
  DEFAULT_DEFECT_TYPE_MISSING,
  assertDefaultWriteConsistent,
  assertNotDeactivatingDefault,
  findDefaultDefectType,
  resolveDefaultDefectTypeTx,
  setDefaultDefectTypeTx,
} from "../src/services/helpers/default-defect-type.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
class Rollback extends Error {}

async function main(): Promise<void> {
  const TS = Date.now();
  const def = await findDefaultDefectType(prisma);
  check("§1 katalogda aktif varsayılan hata tipi var (migration GENEL'i seçer)", !!def, def?.name ?? "YOK");
  if (def) {
    // Fikstür İŞ ANAHTARIYLA (code), ortamda arama yok; tx geri alınır.
    await prisma.$transaction(async (tx) => {
      const other = await tx.defectType.create({ data: { code: `TEST-DDT-A-${TS}`, name: `TEST DDT A ${TS}` }, select: { id: true } });
      const out = await resolveDefaultDefectTypeTx(tx, [
        { startMeter: 1, defectTypeId: null },
        { startMeter: 2, defectTypeId: undefined },
        { startMeter: 3, defectTypeId: other.id },
      ]);
      check("§1 tipsiz satırlar varsayılana düştü", out[0].defectTypeId === def.id && out[1].defectTypeId === def.id);
      check("§1 tipli satır DOKUNULMADI", out[2].defectTypeId === other.id);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  }

  // §2 — negatif, gerçek katalog, geri alınır
  let sec2: string = "koşmadı";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.defectType.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const typed = await tx.defectType.create({ data: { code: `TEST-DDT-B-${TS}`, name: `TEST DDT B ${TS}` }, select: { id: true } });
      try {
        await resolveDefaultDefectTypeTx(tx, [{ startMeter: 1, defectTypeId: null }]);
        sec2 = "400 GELMEDİ";
      } catch (e) {
        sec2 = e instanceof AppError && e.statusCode === 400 && (e.details as { code?: string } | undefined)?.code === DEFAULT_DEFECT_TYPE_MISSING ? "400" : `başka: ${String(e)}`;
      }
      const ok = await resolveDefaultDefectTypeTx(tx, [{ startMeter: 1, defectTypeId: typed.id }]);
      check("§2 varsayılansız katalogda TİPLİ satır yine geçer", ok[0].defectTypeId === typed.id);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  check("§2 ⭐ varsayılansız katalogda tipsiz satır 400 DEFAULT_DEFECT_TYPE_MISSING", sec2 === "400", sec2);
  check("§2 tx geri alındı — varsayılan yerinde", !!(await findDefaultDefectType(prisma)));

  // §3 — tek varsayılan, pasife verilmez; geri alınır
  try {
    await prisma.$transaction(async (tx) => {
      const cur = await findDefaultDefectType(tx);
      const other = await tx.defectType.create({ data: { code: `TEST-DDT-C-${TS}`, name: `TEST DDT C ${TS}` }, select: { id: true } });
      const r = await setDefaultDefectTypeTx(tx, other.id);
      const defaults = await tx.defectType.count({ where: { isDefault: true } });
      check("§3 setDefault: eski düştü, yeni yükseldi, tek varsayılan", r.previousId === (cur?.id ?? null) && defaults === 1);
      const back = await setDefaultDefectTypeTx(tx, other.id);
      check("§3 setDefault idempotent (aynı id → previousId kendisi)", back.previousId === other.id);
      const passive = await tx.defectType.create({ data: { code: `TEST-DDT-P-${TS}`, name: `TEST DDT P ${TS}`, isActive: false }, select: { id: true } });
      let msg = "";
      try { await setDefaultDefectTypeTx(tx, passive.id); } catch (e) { msg = e instanceof AppError ? String(e.statusCode) : "x"; }
      check("§3 pasif tip varsayılan yapılamaz (400)", msg === "400", msg);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // §5 — K2/K3
  let k2 = "";
  try { assertDefaultWriteConsistent({ isDefault: true, isActive: false }); k2 = "geçti"; } catch (e) { k2 = e instanceof AppError ? String(e.statusCode) : "x"; }
  check("§5 K2: isDefault:true + isActive:false gövdesi YAZMADAN 400", k2 === "400", k2);
  assertDefaultWriteConsistent({ isDefault: true, isActive: true });
  assertDefaultWriteConsistent({ isDefault: false, isActive: false });
  check("§5 K2: tutarlı gövdeler geçer", true);
  try {
    await prisma.$transaction(async (tx) => {
      const cur = await findDefaultDefectType(tx);
      if (!cur) throw new Rollback();
      const code = async (fn: () => Promise<void>): Promise<string> => {
        try { await fn(); return "geçti"; } catch (e) { return e instanceof AppError ? `${e.statusCode}:${(e.details as { code?: string } | undefined)?.code ?? ""}` : "x"; }
      };
      check("§5 K3: varsayılanı PATCH isActive:false → 400", (await code(() => assertNotDeactivatingDefault(tx, cur.id, { isActive: false }))) === `400:${DEFAULT_DEFECT_TYPE_DEACTIVATE}`);
      check("§5 K3: varsayılanı DELETE (softDelete) → 400", (await code(() => assertNotDeactivatingDefault(tx, cur.id))) === `400:${DEFAULT_DEFECT_TYPE_DEACTIVATE}`);
      check("§5 K3: varsayılanın başka alanı PATCH edilebilir (isActive dokunmuyor)", (await code(() => assertNotDeactivatingDefault(tx, cur.id, { name: "x" }))) === "geçti");
      const other = await tx.defectType.create({ data: { code: `TEST-DDT-D-${TS}`, name: `TEST DDT D ${TS}` }, select: { id: true } });
      check("§5 K3: varsayılan OLMAYAN tip pasife alınabilir", (await code(() => assertNotDeactivatingDefault(tx, other.id, { isActive: false }))) === "geçti");
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  const ghr = readFileSync(join(__dirname, "..", "src", "services", "helpers", "guarded-hard-remove.ts"), "utf8");
  check("§5 K3: kalıcı silme guard'ı isDefault sayıyor", /defectTypeHardRemove[\s\S]*?key: "isDefault"[\s\S]*?isDefault: true/.test(ghr));
  const routes = readFileSync(join(__dirname, "..", "src", "routes", "defect-type.routes.ts"), "utf8").replace(/\/\/.*$/gm, "");
  check("§5 route: yazma ÖNCE tutarlılık, update+delete ÖNCE varsayılan kapısı", /assertDefaultWriteConsistent\(body\)/.test(routes) && (routes.match(/assertNotDeactivatingDefaultById\(/g) ?? []).length >= 2);

  // §6 — K4 mobil KursunQc
  const kq = readFileSync(join(__dirname, "..", "..", "mobil", "src", "screens", "Modules", "KursunQc", "KursunQcScreen.tsx"), "utf8").replace(/\/\/.*$/gm, "");
  check("§6 KursunQc ilk tuş `isDefault`la sıralanır", /findIndex\(\(d\) => d\.isDefault === true\)/.test(kq));
  check("§6 KursunQc'de 'GENEL' literali yok", !/['"]GENEL['"]/.test(kq));

  // §4 — statik
  const inv = readFileSync(join(__dirname, "..", "src", "services", "inventory.service.ts"), "utf8");
  const iRes = inv.indexOf("resolveDefaultDefectTypeTx(prisma, rawErrors)");
  const iWrite = inv.indexOf("tx.rollError.createMany");
  check("§4 kursunFinish: varsayılan çözümü rollError yazımından ÖNCE", iRes > 0 && iWrite > iRes);
  const tambur = readFileSync(join(__dirname, "..", "..", "mobil", "src", "screens", "Modules", "Tambur", "TamburScreen.tsx"), "utf8").replace(/\/\/.*$/gm, "");
  check("§4 mobil Tambur `defectTypes[0]` uydurmuyor", !/defectTypes\[0\]/.test(tambur));
  check("§4 mobil Tambur varsayılanı `isDefault` ile seçiyor", /defectTypes\.find\(\(d\) => d\.isDefault\)/.test(tambur));
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  });
