// =============================================================================
// İPLİK LİF BİLEŞİMİ + KUMAŞ KOMPOZİSYONU + KUMAŞ TÜRÜ BEKÇİSİ (K7/K8, Seyitoğlu 2026-11-25)
// =============================================================================
//   §1 lif bileşimi kapısı: Σ ≠ 100 → 400 ITEM_FIBER_SUM_NOT_100 · aynı lif iki kez · kumaşa lif → YARN_ONLY ·
//      pasif lif yeni satıra giremez, kartta olan korunur · boş liste temizler · PATCH `fibers` → USE_PUT
//   §2 kompozisyon = iplik firesiz kg/m payı × lif payı (maliyet motoru, tek kaynak); örnek kumaşta doğru yüzde
//   §3 eksik veri → parts/text null (bilinmiyor): lifsiz iplik MISSING_FIBER · çözgüsüz kumaş MISSING_STRUCTURE
//   §4 elle düzeltme: `composition` doluysa `manual` döner, hesaplanan yine gelir; null → hesaplanana dönüş
//   §5 doğuşta lif bileşimi (POST /items gövdesi) aynı tx'te yazılır; geçersiz Σ kart doğurmaz
//   §6 kumaş türü + yanmazlık: yalnız KUMAŞ · pasif tür yeni seçime giremez, kartta olan korunur · enum dışı 400
//   §7 yuvarlama: tam sayı yüzdeler toplam 100 (en büyük kalan), 0'a düşen lif yazılmaz
//   §8 rotalar: lif ucu `item:write`, kompozisyon `item:read`, ikisi de `/api/items`ten ÖNCE bağlı; katalogda silme ucu yok
//
// NEGATİF SONDA — 2026-11-25 koşuldu (cp + geri alma):
//   helper'daki `!sum.eq(HUNDRED)` kapısı sökülünce → §1a ❌ · servis `includeWaste: false` sökülünce → §2b ❌ ·
//   `missing.length > 0` dalı sökülünce → §3a ❌ (tahmin üretir) · servis `manual` alanını null basınca → §4a ❌
// Koşum: npx tsx scripts/test_lif_kompozisyon.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemType, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { itemService } from "../src/routes/item.routes";
import { replaceItemFibers } from "../src/services/item-fiber.service";
import { computedCompositionForItem, roundShares } from "../src/services/fabric-composition.service";
import { upperTr } from "../src/utils/tr-case";
import { ensureTestAdmin } from "./fixture-test-user";
import { altinYapiYaz, fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const SRC = join(__dirname, "..", "src");

async function errCode(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { details?: { code?: string }; statusCode?: number; message?: string };
    return err.details?.code ?? `HTTP${err.statusCode ?? "?"}:${err.message ?? ""}`;
  }
}

let f: MaliyetFikstur | null = null;
const fiberIds: string[] = [];
const fabricTypeIds: string[] = [];
const extraItems: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== İplik lif bileşimi + kumaş kompozisyonu + kumaş türü ===\n");
  const admin = await ensureTestAdmin();
  f = await fiksturKur("TEST-LIF-");
  const mk = async (name: string, abbreviation: string | null, isActive = true) => {
    const r = await prisma.fiberType.create({ data: { name: `${f!.tag} ${name}`, abbreviation, isActive }, select: { id: true } });
    fiberIds.push(r.id);
    return r.id;
  };
  const PES = await mk("Polyester", "TPES");
  const VIS = await mk("Viskon", "TVIS");
  const CO = await mk("Pamuk", "TCO");
  const OLD = await mk("Eski", "TOLD", false);

  // §1 kapı
  check("§1a ⭐ Σ 90 → 400 ITEM_FIBER_SUM_NOT_100", (await errCode(() => replaceItemFibers(f!.weftBId, [{ fiberTypeId: PES, pct: 60 }, { fiberTypeId: CO, pct: 30 }], admin.id))) === "ITEM_FIBER_SUM_NOT_100");
  check("§1b Σ 100,01 → 400 (ondalıkta da tam 100)", (await errCode(() => replaceItemFibers(f!.weftBId, [{ fiberTypeId: PES, pct: "70.01" }, { fiberTypeId: CO, pct: 30 }], admin.id))) === "ITEM_FIBER_SUM_NOT_100");
  check("§1c aynı lif iki kez → ITEM_FIBER_DUPLICATE", (await errCode(() => replaceItemFibers(f!.weftBId, [{ fiberTypeId: PES, pct: 50 }, { fiberTypeId: PES, pct: 50 }], admin.id))) === "ITEM_FIBER_DUPLICATE");
  check("§1d kumaş kartına lif → ITEM_FIBER_YARN_ONLY", (await errCode(() => replaceItemFibers(f!.fabricId, [{ fiberTypeId: PES, pct: 100 }], admin.id))) === "ITEM_FIBER_YARN_ONLY");
  check("§1e pasif lif yeni satıra → ITEM_FIBER_TYPE_INACTIVE", (await errCode(() => replaceItemFibers(f!.weftBId, [{ fiberTypeId: OLD, pct: 100 }], admin.id))) === "ITEM_FIBER_TYPE_INACTIVE");
  await prisma.itemFiber.create({ data: { itemId: f.weftBId, fiberTypeId: OLD, pct: D(100) } });
  check("§1f kartta zaten olan pasif lif korunabilir (yeniden yazım 200)", (await errCode(() => replaceItemFibers(f!.weftBId, [{ fiberTypeId: OLD, pct: 100 }], admin.id))) === null);
  await replaceItemFibers(f.weftBId, [], admin.id);
  check("§1g boş liste temizler", (await prisma.itemFiber.count({ where: { itemId: f.weftBId } })) === 0);
  check("§1h PATCH gövdesinde `fibers` → ITEM_FIBER_USE_PUT (sessiz düşmez)", (await errCode(() => itemService.update(f!.weftBId, { fibers: [] }, admin.id))) === "ITEM_FIBER_USE_PUT");

  // §2 kompozisyon — çözgü 75 den PES, atkı A 150 den VIS, atkı B 300 den %70 PES %30 CO (1:1 atım)
  await replaceItemFibers(f.warpYarnId, [{ fiberTypeId: PES, pct: 100 }], admin.id);
  await replaceItemFibers(f.weftAId, [{ fiberTypeId: VIS, pct: "100" }], admin.id);
  await replaceItemFibers(f.weftBId, [{ fiberTypeId: PES, pct: "70" }, { fiberTypeId: CO, pct: "30.00" }], admin.id);
  // Elle: çözgü 85,106 g/m · atkı A 72,333 · B 144,667 → PES 186,373 / VIS 72,333 / CO 43,4 (Σ 302,106)
  // = %61,69 / %23,94 / %14,37 → en büyük kalan: 62 / 24 / 14
  const c = await computedCompositionForItem(f.fabricId);
  check("§2a ⭐ örnek kumaş → %62 TPES %24 TVIS %14 TCO", c.status === "OK" && c.text === "%62 TPES %24 TVIS %14 TCO", JSON.stringify(c));
  await altinYapiYaz(f);
  await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { warpWastePct: D(20), weftWastePct: D(1) } });
  const c2 = await computedCompositionForItem(f.fabricId);
  check("§2b fire payları değişince kompozisyon değişmez (firesiz net)", c2.text === c.text, `${c.text} → ${c2.text}`);

  // §3 eksik veri
  await replaceItemFibers(f.weftAId, [], admin.id);
  const m = await computedCompositionForItem(f.fabricId);
  check("§3a ⭐ lifsiz atkı ipliği → MISSING_FIBER, parts/text null (tahmin yok), eksik iplik listelenir", m.status === "MISSING_FIBER" && m.parts === null && m.text === null && m.missingYarns.length === 1 && m.missingYarns[0].id === f.weftAId, JSON.stringify(m));
  await replaceItemFibers(f.weftAId, [{ fiberTypeId: VIS, pct: 100 }], admin.id);
  const noWarp = await prisma.item.create({ data: { code: `${f.tag}-NW`, name: `${f.tag} çözgüsüz`, itemType: ItemType.FABRIC, weftSpecId: f.weftSpecId, rawWidthCm: D(300) }, select: { id: true } });
  extraItems.push(noWarp.id);
  const nw = await computedCompositionForItem(noWarp.id);
  check("§3b çözgüsüz kumaş → MISSING_STRUCTURE, text null", nw.status === "MISSING_STRUCTURE" && nw.text === null, JSON.stringify(nw));
  const y = await computedCompositionForItem(f.warpYarnId);
  check("§3c iplik kartı → NOT_FABRIC", y.status === "NOT_FABRIC" && y.text === null);

  // §4 elle düzeltme
  await itemService.update(f.fabricId, { composition: "%100 PES (elle)" }, admin.id);
  const man = await computedCompositionForItem(f.fabricId);
  check("§4a ⭐ elle düzeltme `manual`da döner, hesaplanan yine gelir", man.manual === "%100 PES (elle)" && man.text === c.text, JSON.stringify(man));
  await itemService.update(f.fabricId, { composition: null }, admin.id);
  check("§4b hesaplanana dön (null) → manual null", (await computedCompositionForItem(f.fabricId)).manual === null);

  // §5 doğuşta
  const bad = await errCode(() => itemService.create({ name: `${f!.tag} YENI KOTU`, itemType: "YARN", fibers: [{ fiberTypeId: PES, pct: 50 }] }, admin.id));
  const badRow = await prisma.item.count({ where: { name: upperTr(`${f.tag} YENI KOTU`) } });
  check("§5a doğuşta Σ 50 → 400, kart doğmaz", bad === "ITEM_FIBER_SUM_NOT_100" && badRow === 0, `${bad} / ${badRow}`);
  const res = await itemService.create({ name: `${f.tag} YENI IPLIK`, itemType: "YARN", fibers: [{ fiberTypeId: PES, pct: 80 }, { fiberTypeId: VIS, pct: 20 }] }, admin.id);
  const newId = (res.data as { id: string }).id;
  extraItems.push(newId);
  const rows = await prisma.itemFiber.findMany({ where: { itemId: newId }, orderBy: { pct: "desc" } });
  check("§5b doğuşta iki satır yazıldı (80/20)", rows.length === 2 && rows[0].pct.eq(80) && rows[1].pct.eq(20));

  // §6 kumaş türü + yanmazlık
  const ft = await prisma.fabricType.create({ data: { name: `${f.tag} Tül` }, select: { id: true } });
  const ftOld = await prisma.fabricType.create({ data: { name: `${f.tag} Eski`, isActive: false }, select: { id: true } });
  fabricTypeIds.push(ft.id, ftOld.id);
  await itemService.update(f.fabricId, { fabricTypeId: ft.id, flameRetardancy: "TREVIRA_CS" }, admin.id);
  const row = await prisma.item.findUnique({ where: { id: f.fabricId }, select: { fabricTypeId: true, flameRetardancy: true } });
  check("§6a kumaşa tür + Trevira CS yazıldı", row?.fabricTypeId === ft.id && row?.flameRetardancy === "TREVIRA_CS", JSON.stringify(row));
  check("§6b iplik kartına kumaş türü → ITEM_FABRIC_STRUCTURE_FABRIC_ONLY", (await errCode(() => itemService.update(f!.warpYarnId, { fabricTypeId: ft.id }, admin.id))) === "ITEM_FABRIC_STRUCTURE_FABRIC_ONLY");
  check("§6c pasif tür yeni seçime → FABRIC_TYPE_INACTIVE", (await errCode(() => itemService.update(f!.fabricId, { fabricTypeId: ftOld.id }, admin.id))) === "FABRIC_TYPE_INACTIVE");
  await prisma.fabricType.update({ where: { id: ft.id }, data: { isActive: false } });
  check("§6d kartta olan tür pasife alınınca yeniden yazılabilir (eski kart bozulmaz)", (await errCode(() => itemService.update(f!.fabricId, { fabricTypeId: ft.id }, admin.id))) === null);
  check("§6e yanmazlık enum dışı → FLAME_RETARDANCY_INVALID", (await errCode(() => itemService.update(f!.fabricId, { flameRetardancy: "YANMAZ" }, admin.id))) === "FLAME_RETARDANCY_INVALID");
  await itemService.update(f.fabricId, { fabricTypeId: null, flameRetardancy: null }, admin.id);

  // §7 yuvarlama
  const sh = (name: string, kg: string) => ({ fiberTypeId: name, name, abbreviation: null, kg: D(kg) });
  const r3 = roundShares([sh("A", "1"), sh("B", "1"), sh("C", "1")]);
  check("§7a 1/3 × 3 → toplam 100 (34/33/33)", r3.reduce((a, p) => a + p.pct, 0) === 100 && r3.map((p) => p.pct).join("/") === "34/33/33", JSON.stringify(r3));
  const r0 = roundShares([sh("A", "999"), sh("B", "0.4")]);
  check("§7b %0,04'lük lif yazılmaz, kalan %100", r0.length === 1 && r0[0].pct === 100, JSON.stringify(r0));

  // §8 rotalar
  const route = readFileSync(join(SRC, "routes", "item-fiber.routes.ts"), "utf8");
  const cat = readFileSync(join(SRC, "routes", "fabric-fiber-type.routes.ts"), "utf8");
  const app = readFileSync(join(SRC, "app.ts"), "utf8");
  const itemsAt = app.search(/app\.use\("\/api\/items",/);
  check("§8a lif ucu item:write, kompozisyon item:read kapılı", /router\.use\(verifyToken,\s*requirePermission\(permission\)\)/.test(route) && /itemFiberRouter = gatedRouter\("item:write"\)/.test(route) && /itemCompositionRouter = gatedRouter\("item:read"\)/.test(route));
  check("§8b iki uç da /api/items'ten ÖNCE bağlı", app.indexOf('"/api/items/:id/fibers"') >= 0 && app.indexOf('"/api/items/:id/fibers"') < itemsAt && app.indexOf('"/api/items/:id/computed-composition"') < itemsAt);
  check("§8c kumaş/lif türü kataloğunda silme ucu yok", !/router\.delete\(/.test(cat));
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    try {
      // Ad süpürgesi: servisten doğan (STK- kodlu) bekçi kartları, yarıda kalmış eski koşum dahil — ön ek bu bekçiye özgü.
      const swept = await prisma.item.findMany({ where: { name: { startsWith: "TEST-LIF-" }, code: { startsWith: "STK-" } }, select: { id: true } });
      for (const s of swept) if (!extraItems.includes(s.id)) extraItems.push(s.id);
      const ids = [...extraItems, ...(f ? [f.warpYarnId, f.weftAId, f.weftBId, f.fabricId] : [])];
      await prisma.itemFiber.deleteMany({ where: { itemId: { in: ids } } });
      if (f) await prisma.item.updateMany({ where: { id: f.fabricId }, data: { fabricTypeId: null } });
      if (extraItems.length) await prisma.item.deleteMany({ where: { id: { in: extraItems } } });
      if (f) await fiksturSil(f);
      await prisma.fiberType.deleteMany({ where: { OR: [{ id: { in: fiberIds } }, { name: { startsWith: "TEST-LIF-" }, itemFibers: { none: {} } }] } });
      await prisma.fabricType.deleteMany({ where: { OR: [{ id: { in: fabricTypeIds } }, { name: { startsWith: "TEST-LIF-" }, items: { none: {} } }] } });
    } catch (e) {
      fail++;
      console.error("❌ Temizlik hatası:", e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
