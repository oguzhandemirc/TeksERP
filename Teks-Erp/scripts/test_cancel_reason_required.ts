// =============================================================================
// BEKÇİ — İPTALDE SEBEP ZORUNLULUĞU BAYRAĞI (`production.cancelReasonRequired`, kullanıcı kararı 2026-09-18)
// =============================================================================
//   §0 statik — ÖLÇÜM: sebep alanı taşıyan üretim iptal uçlarında bugünkü zorunluluk (Zod): top iptali OPSİYONEL (tek
//      bayrağa bağlı yol), iş emri · dokuma işi · levent sarım/olay/tüketim iptali · fason sevk/makbuz iptali ZATEN zorunlu;
//      kapı TEK helper (`assertCancelReasonTx`), `inventory.service.softDelete`te yazımdan önce, yalnız iptal (fire değil);
//      resolver üretim ∧ bayrak; önizlemeler `reasonRequired` taşır (top: bayrak · levent/makbuz: sabit true)
//   §1 ⭐ DEFAULT = BUGÜNKÜ DAVRANIŞ: satır YOK ↔ `false` — sebepsiz top iptali GEÇER, önizleme `reasonRequired: false`
//   §2 bayrak AÇIK: sebepsiz iptal 400 `CANCEL_REASON_REQUIRED` (top CANCELLED olmadı) · metinle geçer · yalnız katalog
//      koduyla geçer · fire (scrap) sebepsiz yine geçer (kapsam dışı) · önizleme `reasonRequired: true`
//   §3 üretim modülü KAPALI + bayrak açık → etkin değer false (kapı koşmaz)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18): ① `softDelete`ten `assertCancelReasonTx` çağrısı silinince §0c + §2a/§2c/§2d ❌ ·
//    ② resolver sabit `true` dönünce §0d + §1a/§1b ❌ ve §1c'de 400 ile ÇÖKME (kırmızı yine kırmızı).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; bayraklar (üretim · sebep) fotoğrafa döner; temizlik yalnız `temizle`.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { InventoryService } from "../src/services/inventory.service";
import { SETTING_KEYS, readProductionCancelReasonRequired, resolveCancelReasonRequired } from "../src/services/system-setting.service";
import { CANCEL_REASON_REQUIRED_CODE, hasCancelReason } from "../src/services/helpers/cancel-reason.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-CRR-${process.pid}`;
const FLAG = SETTING_KEYS.PRODUCTION_CANCEL_REASON_REQUIRED;
const PROD = SETTING_KEYS.PRODUCTION_ENABLED;
const inventory = new InventoryService();

function statik(): void {
  console.log("── §0 Statik (ölçüm) ──");
  const oku = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
  const zorunlu: Array<[string, RegExp]> = [
    ["iş emri iptali (controller cancelSchema reason min 3)", /reason: z\.string\(\)\.trim\(\)\.min\(3, "İptal nedeni en az 3 karakter olmalı"\)/],
    ["dokuma işi iptali (reason min 1)", /cancelWeavingOrderSchema = z\.object\(\{ reason: z\.string\(\)\.trim\(\)\.min\(1\)/],
    ["levent sarım iptali (reason min 3)", /const cancelSchema = z\.object\(\{ reason: z\.string\(\)\.trim\(\)\.min\(3, "Gerekçe en az 3 karakter"\)/],
    ["levent olay/tüketim iptali (reasonRequired min 3)", /const reasonRequired = z\.string\(\)\.trim\(\)\.min\(3/],
    ["fason dokuma sevk/makbuz iptali (reason min 3)", /const reasonSchema = z\.object\(\{ reason: z\.string\(\)\.trim\(\)\.min\(3, "Sebep en az 3 karakter"\) \}\)/],
  ];
  const kaynaklar = [oku("src/controllers/workorder.controller.ts"), oku("src/routes/weaving-order.routes.ts"), oku("src/routes/warp-beam.routes.ts"), oku("src/routes/warp-beam-mount.routes.ts"), oku("src/routes/subcontractor-weaving.routes.ts")].join("\n");
  const eksik = zorunlu.filter(([, re]) => !re.test(kaynaklar)).map(([ad]) => ad);
  check("§0a ÖLÇÜM: beş üretim iptal ucunda sebep Zod ile ZATEN zorunlu (bayrak onlara dokunmaz)", eksik.length === 0, eksik.join(", ") || "beşi de zorunlu");
  const invCtrl = oku("src/controllers/inventory.controller.ts");
  check("§0b top iptali sebebi OPSİYONEL alır (query `reason`/`reasonCode`) — bayrağın tek yolu", /const reason = typeof req\.query\.reason === "string" \? req\.query\.reason : undefined;/.test(invCtrl));
  const inv = oku("src/services/inventory.service.ts");
  check("§0c kapı TEK helper: `softDelete`te `assertCancelReasonTx` yalnız iptalde (`!isScrap`), `existing` okunmadan ÖNCE; elle kopya yok", /if \(!isScrap\) await assertCancelReasonTx\(prisma, \{ reason: opts\?\.reason, reasonCode: opts\?\.reasonCode \}, "Top iptali"\);\n\s*const existing = await prisma\.roll\.findUnique/.test(inv) && (inv.match(/assertCancelReasonTx\(/g) ?? []).length === 1 && !/code: "CANCEL_REASON_REQUIRED"/.test(inv));
  const sys = oku("src/services/system-setting.service.ts");
  const govde = sys.slice(sys.indexOf("export async function resolveCancelReasonRequired"), sys.indexOf("export async function resolveCancelReasonRequired") + 300);
  check("§0d resolver = üretim ∧ bayrak", /readProductionEnabled\(tx\)/.test(govde) && /readProductionCancelReasonRequired\(tx\)/.test(govde));
  check("§0e önizlemeler `reasonRequired` taşır: top (resolver) · levent sarım (sabit true) · fason makbuz (sabit true)", /reasonRequired: await resolveCancelReasonRequired\(\)/.test(inv) && /reasonRequired: true,/.test(oku("src/services/warp-beam-wind.service.ts")) && /reasonRequired: true,/.test(oku("src/services/subcontractor-weaving-receipt.service.ts")));
  check("§0f `hasCancelReason`: boş/boşluk → yok · metin → var · yalnız kod → var", !hasCancelReason({}) && !hasCancelReason({ reason: "   " }) && hasCancelReason({ reason: "yanlış giriş" }) && hasCancelReason({ reasonCode: "YANLIS_GIRIS" }));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== İPTALDE SEBEP ZORUNLULUĞU BEKÇİSİ ===\n");
  statik();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [FLAG, PROD] } }, select: { key: true, value: true } });
  const setFlag = async (key: string, v: boolean | null) => {
    if (v === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  };
  const admin = await ensureTestAdmin();
  const item = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const rollIds: string[] = [];
  const top = async (): Promise<string> => {
    const r = (await inventory.createInitialEntry({ itemId: item.id, initialQty: 10, width: 150 }, admin.id, null, false, { forcedStatus: RollStatus.WAREHOUSE, warehouseId: await fixtureWarehouseId(), gradeRequired: false })) as { data: { id: string } };
    rollIds.push(r.data.id);
    return r.data.id;
  };
  const durum = async (id: string) => (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { status: true, cancelReasonCode: true, cancelReason: true } }));
  const kod2 = async (): Promise<string | null> => (await prisma.reasonPreset.findFirst({ where: { kind: "ROLL_CANCEL", isActive: true }, select: { code: true } }))?.code ?? null;
  try {
    await setFlag(PROD, true);
    console.log("\n── §1 ⭐ DEFAULT = bugünkü davranış ──");
    await setFlag(FLAG, null);
    check("§1a satır YOK → okuyucu false, etkin false", (await readProductionCancelReasonRequired()) === false && (await resolveCancelReasonRequired()) === false);
    const t1 = await top();
    const p1 = (await inventory.getCancelPreview(t1)).data;
    check("§1b önizleme `reasonRequired: false`", p1.reasonRequired === false);
    await inventory.softDelete(t1, admin.id, {});
    await setFlag(FLAG, false);
    const t1b = await top();
    await inventory.softDelete(t1b, admin.id, {});
    check("§1c satır YOK ↔ `false`: sebepsiz iptal GEÇER (iki yanıt birebir: CANCELLED, kod null)", (await durum(t1)).status === RollStatus.CANCELLED && (await durum(t1b)).status === RollStatus.CANCELLED && (await durum(t1)).cancelReasonCode === (await durum(t1b)).cancelReasonCode);

    console.log("\n── §2 Bayrak AÇIK ──");
    await setFlag(FLAG, true);
    check("§2 zemin: etkin true", (await resolveCancelReasonRequired()) === true);
    const t2 = await top();
    const e2a = await beklenenHata(() => inventory.softDelete(t2, admin.id, {}));
    check("§2a ⭐ sebepsiz iptal → 400 CANCEL_REASON_REQUIRED; top CANCELLED OLMADI", e2a?.statusCode === 400 && kod(e2a) === CANCEL_REASON_REQUIRED_CODE && (await durum(t2)).status === RollStatus.WAREHOUSE, kod(e2a));
    check("§2b önizleme `reasonRequired: true`", (await inventory.getCancelPreview(t2)).data.reasonRequired === true);
    const e2c = await beklenenHata(() => inventory.softDelete(t2, admin.id, { reason: "   " }));
    check("§2c yalnız boşluk sebep → yine 400 (trim)", kod(e2c) === CANCEL_REASON_REQUIRED_CODE);
    await inventory.softDelete(t2, admin.id, { reason: "yanlış giriş, tekrar okutulacak" });
    check("§2d metinle iptal GEÇER, metin lotta", (await durum(t2)).status === RollStatus.CANCELLED && /yanlış giriş/.test((await durum(t2)).cancelReason ?? ""));
    const kk = await kod2();
    if (kk) {
      const t3 = await top();
      await inventory.softDelete(t3, admin.id, { reasonCode: kk });
      check("§2e yalnız katalog koduyla iptal GEÇER (kod satırda)", (await durum(t3)).status === RollStatus.CANCELLED && (await durum(t3)).cancelReasonCode === kk);
    } else {
      check("§2e ATLANDI — ROLL_CANCEL kataloğu boş (uzlaştırma koşmamış DB)", true, "atlandı");
    }
    const t4 = await top();
    await inventory.softDelete(t4, admin.id, { mode: "SCRAP" });
    check("§2f fire (scrap) sebepsiz yine GEÇER — kapsam dışı (ayrı karar)", (await durum(t4)).status === RollStatus.SCRAP);

    console.log("\n── §3 Modül kapalı ──");
    await setFlag(PROD, false);
    check("§3a üretim KAPALI + bayrak açık → etkin false (kapı koşmaz)", (await resolveCancelReasonRequired()) === false && (await readProductionCancelReasonRequired()) === true);
  } finally {
    await temizle({ itemId: item.id, rollIds, foto });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(f: { itemId: string; rollIds: string[]; foto: Array<{ key: string; value: Prisma.JsonValue }> }): Promise<void> {
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: f.rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: f.rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: f.rollIds } } });
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: f.rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: f.rollIds } } });
  await prisma.item.deleteMany({ where: { id: f.itemId } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: f.rollIds } } });
  for (const key of [FLAG, PROD]) {
    const eski = f.foto.find((x) => x.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
