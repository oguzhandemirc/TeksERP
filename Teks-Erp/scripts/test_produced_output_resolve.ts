// TEST: ÜRETİM ÇIKTISI KÜMESİ — hızlı yol (`resolveProducedOutputWhere`) ↔ tanım
// (`producedOutputWhere`) BOĞAZ-İKİZ.
//
// 2026-11-07: tanımdaki parent LEFT JOIN'i liste hacminde `rolls`u baştan sona
// tarıyordu; servisler artık adayları index'ten, parent'ları PK'dan okuyup a)
// dışlamasını BELLEKTE (`isSameWoSplitParent`) uygular. İki yüklem ayrışırsa
// liste/detay/künye sessizce farklı sayı basar — bu bekçi ikisini kilitler.
//
//   §1 İKİZ: aynı adım kümeleri için iki yol AYNI id kümesini verir
//   §2 BEKLENEN KÜME: re-cut torunu YOK · başka İE parent'ının çocuğu VAR ·
//      producedInStepId NULL SPLIT parent'ın çocuğu YOK (SQL NULL kuralı) · b) dalı
//   §3 UÇTAN UCA: liste ÇIKAN == detay totalMeters; fire dışarıda, NULL kalite sayılır
//   §4 bellek yüklemi birim durumları + boş adım listesi
//   §5 STATİK: servisler `producedOutputWhere`ı doğrudan çağırmaz (tarama planı geri gelmesin)
//
// Çalıştır: npx tsx scripts/test_produced_output_resolve.ts
import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import {
  isSameWoSplitParent,
  producedOutputWhere,
  resolveProducedOutputWhere,
} from "../src/services/helpers/produced-output.helper";
import { testActorId } from "./fixture-test-user";
import { WorkOrderService } from "../src/services/workorder.service";
import { RollEntrySource as E, RollStatus as S } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TS = `${Date.now()}`.slice(-8);
const CODE_FIRE = `TEST-POR-FIRE-${TS}`;
const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
let bc = 0;

async function ids(where: Promise<object> | object): Promise<string[]> {
  const rows = await prisma.roll.findMany({ where: await where, select: { id: true } });
  return rows.map((r) => r.id).sort();
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = { id: await testActorId() };
  const station = await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!item || !station) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  await prisma.qualityGrade.create({ data: { code: CODE_FIRE, name: `TEST ${CODE_FIRE}`, targetStatus: S.SCRAP, sortOrder: 901 } });

  const mkWo = async (suffix: string) => {
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-POR-${TS}-${suffix}`,
        type: "STOCK_PRODUCTION",
        status: "IN_PROGRESS",
        targetItemId: item.id,
        steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" }] },
      },
      include: { steps: true },
    });
    createdWoIds.push(wo.id);
    return { id: wo.id, num: wo.workOrderNumber, stepId: wo.steps[0]!.id };
  };
  const mkRoll = async (o: { qty: number; status: S; source: E; step: string | null; parent?: string; grade?: string | null }) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-POR-${TS}-${++bc}`,
        itemId: item.id,
        initialQty: o.qty,
        currentQty: o.qty,
        status: o.status,
        width: 250,
        createdById: admin.id,
        producedInStepId: o.step,
        entrySource: o.source,
        parentRollId: o.parent ?? null,
        qualityGrade: o.grade ?? null,
      },
      select: { id: true },
    });
    createdRollIds.push(r.id);
    return r.id;
  };

  const A = await mkWo("A");
  const B = await mkWo("B");
  // Girdi kökü (WO dışı) → A'nın Tambur'unda kesilir.
  const root = await mkRoll({ qty: 300, status: S.TAMBUR_CONSUMED, source: E.MANUAL_ENTRY, step: null });
  const c1 = await mkRoll({ qty: 100, status: S.TAMBUR_CONSUMED, source: E.TAMBUR_SPLIT, step: A.stepId, parent: root });
  const c2 = await mkRoll({ qty: 40, status: S.SCRAP, source: E.TAMBUR_SPLIT, step: A.stepId, parent: root, grade: CODE_FIRE });
  // Re-cut: c1 AYNI İE'de yeniden kesildi → torun çift sayılmaz.
  const gc1 = await mkRoll({ qty: 100, status: S.WAREHOUSE, source: E.TAMBUR_SPLIT, step: A.stepId, parent: c1 });
  // B'nin Tambur çıktısı A'da tüketildi → A'nın meşru çıktısı.
  const fp = await mkRoll({ qty: 70, status: S.TAMBUR_CONSUMED, source: E.TAMBUR_SPLIT, step: B.stepId, parent: root });
  const fc = await mkRoll({ qty: 70, status: S.WAREHOUSE, source: E.TAMBUR_SPLIT, step: A.stepId, parent: fp });
  // Adımsız SPLIT parent → çocuğu SQL NULL kuralıyla dışarıda (iki ikiz de).
  const np = await mkRoll({ qty: 20, status: S.TAMBUR_CONSUMED, source: E.TAMBUR_SPLIT, step: null });
  const nc = await mkRoll({ qty: 20, status: S.WAREHOUSE, source: E.TAMBUR_SPLIT, step: A.stepId, parent: np });
  // b) dalı: finalize çıktısı sayılır, canlı üretim sayılmaz.
  const b1 = await mkRoll({ qty: 30, status: S.WAREHOUSE, source: E.MANUAL_ENTRY, step: A.stepId });
  const b2 = await mkRoll({ qty: 15, status: S.IN_PRODUCTION, source: E.MANUAL_ENTRY, step: A.stepId });

  console.log("\n=== §1 İKİZ: hızlı yol == tanım ===");
  for (const [label, steps] of [
    ["A", [A.stepId]],
    ["B", [B.stepId]],
    ["A+B", [A.stepId, B.stepId]],
  ] as const) {
    const fast = await ids(resolveProducedOutputWhere(prisma, [...steps]));
    const def = await ids(producedOutputWhere([...steps]));
    check(`§1 ${label}: aynı id kümesi`, JSON.stringify(fast) === JSON.stringify(def), `hızlı ${fast.length} · tanım ${def.length}`);
  }

  console.log("\n=== §2 BEKLENEN KÜME ===");
  const setA = new Set(await ids(resolveProducedOutputWhere(prisma, [A.stepId])));
  check("§2a re-cut torunu (aynı İE SPLIT parent) SAYILMAZ", !setA.has(gc1));
  check("§2b birinci nesil çocuklar sayılır (fire'lı dahil — kova süzgeci ayrı)", setA.has(c1) && setA.has(c2));
  check("§2c başka İE deposundan tüketilen parent'ın çocuğu SAYILIR", setA.has(fc));
  check("§2d adımsız SPLIT parent'ın çocuğu SAYILMAZ (SQL NULL kuralı korunur)", !setA.has(nc));
  check("§2e b) finalize çıktısı sayılır, canlı üretim sayılmaz", setA.has(b1) && !setA.has(b2));
  check("§2f küme tam olarak {c1,c2,fc,b1}", setA.size === 4, `${setA.size}`);
  const setAB = new Set(await ids(resolveProducedOutputWhere(prisma, [A.stepId, B.stepId])));
  check("§2g A+B birlikte: fp parent'ı kapsamda → fc artık re-cut sayılır", setAB.has(fp) && !setAB.has(fc));

  console.log("\n=== §3 UÇTAN UCA: liste ↔ detay ===");
  const wos = new WorkOrderService();
  const detail = (await wos.findById(A.id)).data as { producedRolls: { totalMeters: unknown; fire: { totalMeters: unknown } } };
  const detTotal = Number(detail.producedRolls.totalMeters);
  const list = (await wos.findAll({ query: { search: A.num, limit: "20" } } as unknown as Request)) as {
    data: Array<{ workOrderNumber?: string; producedMeters?: number }>;
  };
  const row = list.data.find((r) => r.workOrderNumber === A.num);
  check("§3a detay totalMeters 200 (100 NULL kalite + 70 + 30; fire 40 hariç)", detTotal === 200, `${detTotal}`);
  check("§3b detay fire kovası 40", Number(detail.producedRolls.fire.totalMeters) === 40);
  check("§3c liste ÇIKAN == detay", row?.producedMeters === detTotal, `liste ${row?.producedMeters}`);

  console.log("\n=== §4 bellek yüklemi ===");
  const st = new Set([A.stepId]);
  check("§4a aynı İE SPLIT parent → dışla", isSameWoSplitParent({ entrySource: E.TAMBUR_SPLIT, producedInStepId: A.stepId }, st));
  check("§4b başka İE SPLIT parent → dışlama", !isSameWoSplitParent({ entrySource: E.TAMBUR_SPLIT, producedInStepId: B.stepId }, st));
  check("§4c SPLIT olmayan parent → dışlama", !isSameWoSplitParent({ entrySource: E.MANUAL_ENTRY, producedInStepId: A.stepId }, st));
  check("§4d adımsız SPLIT parent → dışla", isSameWoSplitParent({ entrySource: E.TAMBUR_SPLIT, producedInStepId: null }, st));
  check("§4e boş adım listesi → boş küme", (await ids(resolveProducedOutputWhere(prisma, []))).length === 0);

  console.log("\n=== §5 STATİK: servisler tanımı doğrudan sorgulamaz ===");
  const srcDir = path.join(__dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.ts$/.test(e.name) && !f.endsWith(path.join("helpers", "produced-output.helper.ts"))) {
        const code = fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
        if (/\bproducedOutputWhere\s*\(/.test(code)) offenders.push(path.relative(srcDir, f));
      }
    }
  };
  walk(srcDir);
  check("§5 `producedOutputWhere(` çağrısı yalnız helper'da", offenders.length === 0, offenders.join(", "));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    // Lineage FK: çocuklar önce (oluşturma sırasının tersi).
    for (const id of [...createdRollIds].reverse()) {
      await prisma.rollMovement.deleteMany({ where: { rollId: id } });
      await prisma.rollOperation.deleteMany({ where: { rollId: id } });
      await prisma.rollVariance.deleteMany({ where: { rollId: id } });
      await prisma.roll.deleteMany({ where: { id } });
    }
    if (createdWoIds.length > 0) {
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...createdRollIds, ...createdWoIds] } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    }
    await prisma.qualityGrade.deleteMany({ where: { code: CODE_FIRE } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
