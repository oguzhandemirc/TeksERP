// =============================================================================
// test_desen_siniflama — kumaş sınıflaması üç eksen (2026-11-25, GERÇEK DB)
// =============================================================================
// Kabul: (1) migration backfill eşlemesi `KIND_TO_CLASS`ın SQL ikizi (dört eski tür → beklenen çift; SQL metni
// migration dosyasından koşulur), (2) çift yazım: yeni eksen → `kind`, eski istemci `kind` → yeni eksen, çelişki
// 400, (3) Armür dışı kartta ızgara yazımı 400 + saklı ızgara okuyucuda gizli (etkin yapı / drawdown), Jakar dışı
// kanca 400, (4) ürün tekniği: kumaş doğuşta WOVEN, Örme 400, iplikte null. Negatif sonda: eşleme ya da ret
// kaldırılınca ilgili check kırmızı. Fikstür `TEST-DSN-<ts>`; temizlik `finally`de FK sırasıyla.
// =============================================================================
import { readFileSync } from "fs";
import path from "path";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { KIND_TO_CLASS, kindFromClass, resolveWeaveClass, WEAVE_SHED_MECHANISMS, WEAVE_STRUCTURES } from "../src/constants/weave-classification";
import { createWeaveDesign, getWeaveDesign, updateWeaveDesign } from "../src/services/weave-design.service";
import { deleteWeaveDesignImage, readWeaveDesignImage, uploadWeaveDesignImage } from "../src/services/weave-design-image.service";
import { resolveEffectiveConstruction } from "../src/services/helpers/effective-construction.helper";
import { itemService } from "../src/routes/item.routes";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? (e.details?.code ?? `HTTP${e.statusCode}`) : (e as Error).message;
  }
}

const TAG = `TEST-DSN-${Date.now()}`;
const ids = { design: [] as string[], items: [] as string[] };
const MIGRATION = path.join(__dirname, "../prisma/migrations/20261125120000_desen_siniflama_eksen/migration.sql");

/** Migration'ın weave_designs backfill UPDATE'i (dosyadan; elle kopya değil). */
function backfillSql(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const m = sql.match(/UPDATE "weave_designs" SET[\s\S]*?WHERE "shedMechanism" IS NULL;/);
  if (!m) throw new Error("migration backfill UPDATE'i bulunamadı");
  return m[0];
}

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();

  console.log("§0 tek kaynak (saf)");
  for (const k of Object.keys(KIND_TO_CLASS) as Array<keyof typeof KIND_TO_CLASS>) {
    check(`§0 kindFromClass(KIND_TO_CLASS.${k}) = ${k} (gidiş-dönüş)`, kindFromClass(KIND_TO_CLASS[k]) === k);
  }
  check("§0 yeni alan boşken okuyucu kind'dan türetir", resolveWeaveClass({ kind: "LENO", shedMechanism: null }).weaveStructure === "LENO");
  check("§0 mekanizma/örgü listeleri", WEAVE_SHED_MECHANISMS.length === 3 && WEAVE_STRUCTURES.length === 5);

  console.log("§1 migration backfill eşlemesi = KIND_TO_CLASS");
  const kinds = ["PLAIN", "DOBBY", "JACQUARD", "LENO"] as const;
  for (const k of kinds) {
    const r = await prisma.weaveDesign.create({ data: { code: `${TAG}-B${k}`, name: `${TAG} B ${k}`, kind: k }, select: { id: true } });
    ids.design.push(r.id);
  }
  await prisma.$executeRawUnsafe(backfillSql().replace('WHERE "shedMechanism" IS NULL;', `WHERE "shedMechanism" IS NULL AND "code" LIKE '${TAG}-B%';`));
  const back = await prisma.weaveDesign.findMany({ where: { code: { startsWith: `${TAG}-B` } }, select: { kind: true, shedMechanism: true, weaveStructure: true } });
  for (const k of kinds) {
    const row = back.find((b) => b.kind === k);
    const want = KIND_TO_CLASS[k];
    check(`§1 ${k} → ${want.shedMechanism}+${want.weaveStructure ?? "boş"}`, row?.shedMechanism === want.shedMechanism && (row?.weaveStructure ?? null) === want.weaveStructure, JSON.stringify(row));
  }

  console.log("§2 çift yazım");
  const jac = await createWeaveDesign({ code: `${TAG}-J`, name: `${TAG} jakar`, shedMechanism: "JACQUARD", hookCount: 2688, repeatWidthCm: "70", repeatCm: "45", loomFileName: "DSN.JC5" }, admin.id);
  ids.design.push(jac.id);
  const jacRaw = await prisma.weaveDesign.findUniqueOrThrow({ where: { id: jac.id }, select: { kind: true, hookCount: true } });
  check("§2a yeni eksen → kind çift yazılır (JACQUARD)", jacRaw.kind === "JACQUARD" && jacRaw.hookCount === 2688);
  const leno = await createWeaveDesign({ code: `${TAG}-L`, name: `${TAG} döner`, shedMechanism: "DOBBY", weaveStructure: "LENO" }, admin.id);
  ids.design.push(leno.id);
  check("§2b Armür+Döner → kind LENO", (await prisma.weaveDesign.findUniqueOrThrow({ where: { id: leno.id }, select: { kind: true } })).kind === "LENO");
  const old = await createWeaveDesign({ code: `${TAG}-O`, name: `${TAG} eski`, kind: "PLAIN" }, admin.id);
  ids.design.push(old.id);
  check("§2c eski istemci kind=PLAIN → Eksantrik+Bezayağı", old.shedMechanism === "CAM" && old.weaveStructure === "PLAIN");
  const twill = await updateWeaveDesign(old.id, { weaveStructure: "TWILL" }, admin.id);
  check("§2d örgü değişir, mekanizma korunur, kind PLAIN", twill.shedMechanism === "CAM" && twill.weaveStructure === "TWILL" && twill.kind === "PLAIN");
  const same = await updateWeaveDesign(old.id, { kind: "PLAIN", name: `${TAG} eski 2` }, admin.id);
  check("§2e eski istemci aynı kind'ı yollar → yeni eksen DOKUNULMAZ", same.weaveStructure === "TWILL");
  const switched = await updateWeaveDesign(old.id, { kind: "DOBBY" }, admin.id);
  check("§2f eski istemci kind değiştirir → yeni eksen ondan türer", switched.shedMechanism === "DOBBY" && switched.weaveStructure === null);
  check("§2g kind ile yeni eksen çelişir → 400", (await codeOf(() => createWeaveDesign({ code: `${TAG}-X`, name: `${TAG} x`, kind: "PLAIN", shedMechanism: "JACQUARD" }, admin.id))) === "WEAVE_DESIGN_KIND_CONFLICT");
  check("§2h mekanizmasız + kind'sız doğuş → 400", (await codeOf(() => createWeaveDesign({ code: `${TAG}-Y`, name: `${TAG} y` }, admin.id))) === "WEAVE_DESIGN_MECHANISM_REQUIRED");
  check("§2i tanınmayan mekanizma → 400", (await codeOf(() => createWeaveDesign({ code: `${TAG}-Z`, name: `${TAG} z`, shedMechanism: "ROTARY" }, admin.id))) === "WEAVE_DESIGN_MECHANISM_INVALID");

  console.log("§3 mekanizmaya ait olmayan alan");
  check("§3a Jakar kartta ızgara yazımı → 400", (await codeOf(() => updateWeaveDesign(jac.id, { liftPlan: [[1, 0], [0, 1]] }, admin.id))) === "WEAVE_DESIGN_LIFT_PLAN_DOBBY_ONLY");
  check("§3b Eksantrik kartta ızgara yazımı → 400", (await codeOf(() => createWeaveDesign({ code: `${TAG}-C`, name: `${TAG} c`, shedMechanism: "CAM", liftPlan: [[1, 0], [0, 1]] }, admin.id))) === "WEAVE_DESIGN_LIFT_PLAN_DOBBY_ONLY");
  check("§3c Armür kartta kanca → 400", (await codeOf(() => updateWeaveDesign(leno.id, { hookCount: 1000 }, admin.id))) === "WEAVE_DESIGN_HOOKS_JACQUARD_ONLY");
  const dob = await createWeaveDesign({ code: `${TAG}-D`, name: `${TAG} armür`, shedMechanism: "DOBBY", liftPlan: [[1, 0], [0, 1]] }, admin.id);
  ids.design.push(dob.id);
  check("§3d Armür kartta ızgara yazılır", Array.isArray(dob.liftPlan));
  await updateWeaveDesign(dob.id, { shedMechanism: "JACQUARD" }, admin.id);
  const kept = await prisma.weaveDesign.findUniqueOrThrow({ where: { id: dob.id }, select: { liftPlan: true } });
  check("§3e Jakar'a geçince saklı ızgara SİLİNMEZ", Array.isArray(kept.liftPlan));
  const fab = await itemService.create({ code: `${TAG}-F`, name: `${TAG} KUMAS`, itemType: "FABRIC", unit: "MT" }, admin.id);
  const fabId = (fab.data as { id: string }).id;
  ids.items.push(fabId);
  await prisma.item.update({ where: { id: fabId }, data: { weaveDesignId: dob.id } });
  const eff = await resolveEffectiveConstruction(prisma, fabId, null);
  check("§3f etkin yapı: Jakar desende ızgara GİZLİ, mekanizma JACQUARD", eff.weaveDesign?.liftPlan === null && eff.weaveDesign?.shedMechanism === "JACQUARD");
  await updateWeaveDesign(dob.id, { shedMechanism: "DOBBY" }, admin.id);
  const eff2 = await resolveEffectiveConstruction(prisma, fabId, null);
  check("§3g Armür'e dönünce saklı ızgara geri görünür", Array.isArray(eff2.weaveDesign?.liftPlan));

  console.log("§4 ürün üretim tekniği");
  const fabRow = await prisma.item.findUniqueOrThrow({ where: { id: fabId }, select: { fabricTechnique: true } });
  check("§4a kumaş doğuşta Dokuma (WOVEN)", fabRow.fabricTechnique === "WOVEN");
  check("§4b Örme seçimi → 400", (await codeOf(() => itemService.update(fabId, { fabricTechnique: "KNITTED" }, admin.id))) === "FABRIC_TECHNIQUE_NOT_AVAILABLE");
  const yarn = await itemService.create({ code: `${TAG}-Y`, name: `${TAG} IPLIK`, itemType: "YARN", unit: "KG" }, admin.id);
  const yarnId = (yarn.data as { id: string }).id;
  ids.items.push(yarnId);
  check("§4c iplikte teknik boş", (await prisma.item.findUniqueOrThrow({ where: { id: yarnId }, select: { fabricTechnique: true } })).fabricTechnique === null);
  check("§4d iplik kartına teknik → 400", (await codeOf(() => itemService.update(yarnId, { fabricTechnique: "WOVEN" }, admin.id))) === "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY");

  console.log("§5 desen görseli");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
  const up = await uploadWeaveDesignImage(jac.id, { fileName: "desen.png", contentBase64: png.toString("base64") }, admin.id);
  check("§5a PNG yüklenir", up.image.mimeType === "image/png" && up.duplicate === false);
  check("§5b aynı dosya → duplicate", (await uploadWeaveDesignImage(jac.id, { fileName: "desen.png", contentBase64: png.toString("base64") }, admin.id)).duplicate === true);
  check("§5c PDF → 400", (await codeOf(() => uploadWeaveDesignImage(jac.id, { fileName: "x.pdf", contentBase64: Buffer.from("%PDF-1.4 test").toString("base64") }, admin.id))) === "WEAVE_DESIGN_IMAGE_TYPE");
  check("§5d detayda görsel künyesi", (await getWeaveDesign(jac.id)).image?.fileName === "desen.png");
  check("§5e görsel okunur", (await readWeaveDesignImage(jac.id)).content.length === png.length);
  await deleteWeaveDesignImage(jac.id, admin.id);
  check("§5f kaldırılınca 404", (await codeOf(() => readWeaveDesignImage(jac.id))) === "WEAVE_DESIGN_IMAGE_NOT_FOUND");
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.item.updateMany({ where: { id: { in: ids.items } }, data: { weaveDesignId: null } }));
  await t(() => prisma.weaveDesignImage.deleteMany({ where: { weaveDesignId: { in: ids.design } } }));
  await t(() => prisma.weaveDesign.deleteMany({ where: { id: { in: ids.design } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
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
