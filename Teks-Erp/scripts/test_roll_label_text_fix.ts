// =============================================================================
// Bekçi: TOP ETİKET AD/RENK/PARTİ DÜZELTMESİ — sevk edilene kadar (Gülkesim 2026-11-09)
// Çalıştır: npx tsx scripts/test_roll_label_text_fix.ts   (DB'li, _test DB)
// =============================================================================
//   §1 Zod: şema üç alanı + sebebi TAŞIR (strip tuzağı); sebepsiz / 80 üstü red
//   §2 başarı: değer normalize yazılır, labelDirty=true, etiket payload'u topun değerini basar (ROLL)
//   §3 audit: eski→yeni + sebep + event LABEL_TEXT_FIX; gönderilmeyen alan dokunulmaz ve audit'e girmez
//   §4 boş string temizler → etiket çözümü varsayılana (Item/Color adı) döner; değişmeyen gövde no-op (audit yok)
//   §5 kapı: SHIPPED / fason (AT_SUBCONTRACTOR) 409 ROLL_SHIPPED; K18 ölü + SCRAP 409 ROLL_DEAD; kolon değişmez
//   §6 yarış: claim öncesi okunan top, kilit tutan tx'te SHIPPED'e çekilir → 409 ROLL_SHIPPED, kolon değişmez
//   §7 izin: route zinciri roll:write / label:edit / mobile:tambur ile GEÇER, ilgisiz izinle 403
// Negatif sonda (ölçüldü 2026-11-09, B — dosya dışı, her biri md5 ile geri alındı; 4/5 ısırdı):
//   claim WHERE'inden `status: { notIn: ... }` çıkarıldı → §6 kırmızı · ölü kümeden SCRAP çıkarıldı → §5 kırmızı ·
//   `labelDirty: true` düşürüldü → §2 kırmızı · route'tan "mobile:tambur" düşürüldü → §7 kırmızı.
//   ISIRMAYAN: ön kapıdaki `if (block) throw` kapatılınca yeşil kalır — claim WHERE'i + geç yeniden okuma
//   aynı 409'u verir (savunma katmanı; kapının asıl taşıyıcısı claim'dir).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { LabelService } from "../src/services/label.service";
import { labelTextsFixSchema } from "../src/controllers/inventory.controller";
import inventoryRouter from "../src/routes/inventory.routes";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const inv = new InventoryService();
const labels = new LabelService();
const ts = Date.now().toString().slice(-6);
const rollIds: string[] = [];
let seq = 0;

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ name: string; handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};
/** Route'un yetki halkalarını gerçek izin listesiyle koşturur ([verifyToken, ...yetki, controller]). */
function routeAllows(permissions: string[]): boolean | null {
  const layers = (inventoryRouter as unknown as { stack: RouteLayer[] }).stack;
  const layer = layers.find((l) => l.route?.path === "/:id/label-texts" && l.route.methods.patch);
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = { user: { permissions }, params: {}, query: {}, body: {} } as unknown as Request;
  for (const link of chain.slice(1, -1)) {
    let err: unknown;
    let called = false;
    link.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called) return false;
    if (err) return (err as { statusCode?: number }).statusCode === 403 ? false : null;
  }
  return true;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true, name: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true, name: true } });
  if (!item || !color) throw new Error("fixture: PATOS ürünü / MAVI renk yok");
  const grade = await roleGrade("FIRST");
  const actor = await testActorId();

  const mkRoll = async (status: RollStatus, extra: { labelItemName?: string; labelColorName?: string; labelBatchNo?: string } = {}) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-RLF-${seq++}-${ts}`, itemId: item.id, colorId: color.id, status, currentQty: 50, initialQty: 50,
        width: 150, qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "TAMBUR_SPLIT", ...extra,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  const cols = (id: string) =>
    prisma.roll.findUnique({ where: { id }, select: { labelItemName: true, labelColorName: true, labelBatchNo: true, labelDirty: true } });

  console.log("\n[§1] Zod şeması");
  const parsed = labelTextsFixSchema.parse({ labelItemName: "a", labelColorName: "", labelBatchNo: null, reason: " müşteri aradı " });
  check("§1 üç alan + sebep taşınır", parsed.labelItemName === "a" && parsed.labelColorName === "" && parsed.labelBatchNo === null && parsed.reason === "müşteri aradı");
  check("§1 sebepsiz reddedilir", !labelTextsFixSchema.safeParse({ labelItemName: "a" }).success);
  check("§1 80 üstü reddedilir", !labelTextsFixSchema.safeParse({ labelColorName: "x".repeat(81), reason: "abc" }).success);
  check("§1 servis de sebepsizi reddeder (400)", (await errCode(inv.fixLabelTexts(rollIds[0] ?? "00000000-0000-4000-8000-000000000000", { labelItemName: "a", reason: " " }, actor))).startsWith("400"));

  console.log("\n[§2] başarı");
  const r1 = await mkRoll(RollStatus.WAREHOUSE, { labelItemName: "SULTAN", labelColorName: "EKRU", labelBatchNo: "J1" });
  const res = await inv.fixLabelTexts(r1, { labelItemName: "  lale  ipek ", labelBatchNo: "K30", reason: "Müşteri yanlış ad dedi" }, actor);
  let v = await cols(r1);
  check("§2 ad normalize yazılır, renk dokunulmaz, parti yazılır", v?.labelItemName === "LALE İPEK" && v.labelColorName === "EKRU" && v.labelBatchNo === "K30", JSON.stringify(v));
  check("§2 labelDirty=true (yeniden basılmalı)", v?.labelDirty === true);
  check("§2 yanıt son değerleri döner, changed=true", res.data?.changed === true && res.data.labelItemName === "LALE İPEK" && res.data.labelColorName === "EKRU");
  const p1 = (await labels.getRollLabel(r1)).data!;
  check("§2 etiket payload'u yeni adı basar (kaynak ROLL)", p1.itemName === "LALE İPEK" && p1.itemNameSource === "ROLL", `${p1.itemName}/${p1.itemNameSource}`);
  const r2 = await mkRoll(RollStatus.IN_PRODUCTION);
  await inv.fixLabelTexts(r2, { labelColorName: "krem", reason: "üretimdeki top" }, actor);
  check("§2 üretimdeki (sevk edilmemiş) top da düzeltilir", (await cols(r2))?.labelColorName === "KREM");

  console.log("\n[§3] audit");
  const a1 = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: r1, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { oldData: true, newData: true } });
  const od = a1?.oldData as Record<string, unknown> | undefined;
  const nd = a1?.newData as Record<string, unknown> | undefined;
  check("§3 eski değerler audit'te", od?.labelItemName === "SULTAN" && od?.labelBatchNo === "J1", JSON.stringify(od));
  check("§3 yeni değerler + sebep + event", nd?.labelItemName === "LALE İPEK" && nd?.labelBatchNo === "K30" && nd?.reason === "Müşteri yanlış ad dedi" && nd?.event === "LABEL_TEXT_FIX", JSON.stringify(nd));
  check("§3 değişmeyen alan (renk) audit yükünde yok", !!nd && !("labelColorName" in nd));

  console.log("\n[§4] boş string temizler, no-op");
  await inv.fixLabelTexts(r1, { labelItemName: "", labelColorName: "   ", reason: "varsayılana dön" }, actor);
  v = await cols(r1);
  check("§4 boş/boşluk → null", v?.labelItemName === null && v.labelColorName === null && v.labelBatchNo === "K30", JSON.stringify(v));
  const p2 = (await labels.getRollLabel(r1)).data!;
  check("§4 etiket çözümü varsayılana döner (kumaşın/rengin kendi adı)", p2.itemName === item.name && p2.itemNameSource !== "ROLL" && p2.colorName === color.name && p2.colorNameSource !== "ROLL", `${p2.itemName}/${p2.itemNameSource} · ${p2.colorName}/${p2.colorNameSource}`);
  const before = await prisma.systemLog.count({ where: { tableName: "ROLL", recordId: r1 } });
  const noop = await inv.fixLabelTexts(r1, { labelItemName: null, labelBatchNo: " K30 ", reason: "aynı değer" }, actor);
  const after = await prisma.systemLog.count({ where: { tableName: "ROLL", recordId: r1 } });
  check("§4 aynı değer → changed=false, audit yazılmaz", noop.data?.changed === false && before === after, `${before}→${after}`);
  check("§4 hiç alan yoksa 400", (await errCode(inv.fixLabelTexts(r1, { reason: "boş gövde" }, actor))) === "400:LABEL_TEXT_EMPTY_PATCH");

  console.log("\n[§5] kapı");
  const cases: Array<[RollStatus, string]> = [
    [RollStatus.SHIPPED, "409:ROLL_SHIPPED"],
    [RollStatus.AT_SUBCONTRACTOR, "409:ROLL_SHIPPED"],
    [RollStatus.CANCELLED, "409:ROLL_DEAD"],
    [RollStatus.TAMBUR_CONSUMED, "409:ROLL_DEAD"],
    [RollStatus.SCRAP, "409:ROLL_DEAD"],
  ];
  for (const [status, want] of cases) {
    const id = await mkRoll(status, { labelItemName: "ESKİ" });
    const got = await errCode(inv.fixLabelTexts(id, { labelItemName: "YENİ", reason: "sevkten sonra" }, actor));
    const c = await cols(id);
    check(`§5 ${status} → ${want}, kolon değişmez`, got === want && c?.labelItemName === "ESKİ" && c.labelDirty === false, `${got} · ${c?.labelItemName}`);
  }

  console.log("\n[§6] yarış — okuma ile claim arasında sevk");
  const r6 = await mkRoll(RollStatus.WAREHOUSE, { labelItemName: "ESKİ" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockedP = new Promise<void>((resolve) => { locked = resolve; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM rolls WHERE id = ${r6}::uuid FOR UPDATE`;
    locked();
    await gate;
    await tx.roll.update({ where: { id: r6 }, data: { status: RollStatus.SHIPPED } });
  }, { timeout: 20_000 });
  await lockedP;
  const racer = errCode(inv.fixLabelTexts(r6, { labelItemName: "YENİ", reason: "yarış" }, actor));
  await new Promise((r) => setTimeout(r, 600));
  release();
  await holder;
  const raced = await racer;
  const c6 = await cols(r6);
  check("§6 sevk claim'i yener → 409 ROLL_SHIPPED, kolon değişmez", raced === "409:ROLL_SHIPPED" && c6?.labelItemName === "ESKİ", `${raced} · ${c6?.labelItemName}`);

  console.log("\n[§7] izin");
  check("§7 zincir okunabildi", routeAllows(["roll:write"]) !== null);
  check("§7 roll:write geçer", routeAllows(["roll:write"]) === true);
  check("§7 label:edit geçer", routeAllows(["label:edit"]) === true);
  check("§7 mobile:tambur geçer", routeAllows(["mobile:tambur"]) === true);
  check("§7 ilgisiz izin (order:read, mobile:kk1) 403", routeAllows(["order:read", "mobile:kk1"]) === false);
}

async function cleanup(): Promise<void> {
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
