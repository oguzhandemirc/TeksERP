// =============================================================================
// TOP AŞAMASI — GERİ DOLDURMA (2026-11-10, plan "Top aşaması")
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_asama_geri_doldurma
// =============================================================================
// NEDEN: Migration `Roll.stage`i tohumla (renkli → FINISHED, renksiz → RAW) doldurur; renksiz bitmiş
// (Gülkesim fason malı) ve renkli ham toplar yanlış etiket basmaya devam ederdi. `backfill_roll_stage.ts`
// geçmişten aşamayı çıkarır (`scripts/lib/roll-stage-backfill.ts`). Bu bekçi kuralları, kovaları,
// kesimi ve idempotentliği ölçer — sentetik kesimle, yalnız kendi fixture'ı üzerinde (`idler`).
//
// ÖLÇÜLENLER
//   §1 kural satırları: K1 depo kesimi atadan · K2 tambur üretim çocuğu · K3 bitmiş statü (renksiz depo →
//      FINISHED) · K4 yarı mamul STOCK · K5 renksiz STOCK değişmez · K6 yarı mamul / kaynak / ham ·
//      ölü ata: ölüm öncesi statüden (defter) · K7 defteri olmayan ölü → tohum
//   §2 ⭐ belirsiz kova: renkli STOCK varsayılan KORU (yazılmaz, listelenir); `renkliStok` verilince yazılır
//   §3 kesim: kesimden sonra güncellenmiş top ATLANIR (listede ayrı kova); kesimden sonra doğan aday değil
//   §4 uygula: plan ile yazım arasında güncellenen top claim'e takılır; DB değerleri; ikinci koşum 0
// Negatif sondalar (2026-11-10, cp ile geri; temel 19/0):
//   · KORU kaldırıldı (renkli STOCK → RAW) → §2a/§4a/§4b ❌ (16/3)
//   · plandaki kesim süzgeci kaldırıldı → §3a/§4a/§4c ❌ (16/3)
//   · ölü topun ölüm öncesi statüsü okunmadı → ölü ata/çocuğu/K7/§4a ❌ (15/4)
//   · uygula claim'inden `stage`+`updatedAt < kesim` kaldırıldı → §4a/§4d ❌ (17/2)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { RollEntrySource, RollStage, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { planla, uygula, type Plan } from "./lib/roll-stage-backfill";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-ASG-${Date.now()}`;
const rollIds: string[] = [];
let itemId: string | null = null;
let colorId: string | null = null;
let woId: string | null = null;
const GECMIS = new Date(Date.now() - 3600_000);
const KESIM = new Date(Date.now() - 60_000);

interface RollCfg {
  status: RollStatus; renkli: boolean; entrySource?: RollEntrySource; parentRollId?: string;
  producedInStepId?: string; olumOncesi?: RollStatus; kesimSonrasiDokun?: boolean; kesimSonrasiDogum?: boolean;
}

async function mk(ad: string, cfg: RollCfg): Promise<string> {
  const seed = cfg.renkli ? RollStage.FINISHED : RollStage.RAW; // migration tohumu
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${ad}`, itemId: itemId!, colorId: cfg.renkli ? colorId : null, stage: seed,
      status: cfg.olumOncesi ?? cfg.status, entrySource: cfg.entrySource ?? RollEntrySource.SUPPLIER_RECEIPT,
      parentRollId: cfg.parentRollId ?? null, producedInStepId: cfg.producedInStepId ?? null,
      currentQty: 30, initialQty: 30, width: 150,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  // Ölüm: statü güncellemesi `rolls_write_status_event` trigger'ıyla defter satırı yazar (fromStatus = ölüm öncesi).
  if (cfg.olumOncesi) await prisma.roll.update({ where: { id: r.id }, data: { status: cfg.status } });
  const created = cfg.kesimSonrasiDogum ? new Date() : GECMIS;
  const updated = cfg.kesimSonrasiDokun || cfg.kesimSonrasiDogum ? new Date() : GECMIS;
  await prisma.$executeRaw`UPDATE "rolls" SET "createdAt" = ${created}, "updatedAt" = ${updated} WHERE "id" = ${r.id}::uuid`;
  return r.id;
}

const ids: Record<string, string> = {};
const satir = (p: Plan, id: string) => p.yazilacak.find((s) => s.id === id) ?? p.belirsiz.find((s) => s.id === id) ?? p.atlananKesimSonrasi.find((s) => s.id === id);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazmaya uygun", false, engel); return; }

  itemId = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Ürün`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  colorId = (await prisma.color.create({ data: { code: `${TAG}-C`, name: `${TAG} Renk`, hex: "#663399" }, select: { id: true } })).id;
  const station = await prisma.station.findFirstOrThrow({ where: { code: "TAMBUR_1" }, select: { id: true } });
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: itemId, steps: { create: [{ stationId: station.id, stepSequence: 1 }] } },
    include: { steps: true },
  });
  woId = wo.id;
  const stepId = wo.steps[0].id;

  // Fixture — her satır migration tohumuyla (renkli FINISHED / renksiz RAW).
  ids.k3 = await mk("K3", { status: RollStatus.WAREHOUSE, renkli: false, entrySource: RollEntrySource.MANUAL_ENTRY });
  ids.k1 = await mk("K1", { status: RollStatus.WAREHOUSE, renkli: false, entrySource: RollEntrySource.TAMBUR_SPLIT, parentRollId: ids.k3 });
  ids.k2 = await mk("K2", { status: RollStatus.STOCK, renkli: false, entrySource: RollEntrySource.TAMBUR_SPLIT, producedInStepId: stepId });
  ids.k4 = await mk("K4", { status: RollStatus.STOCK, renkli: true, entrySource: RollEntrySource.SEMI_FINISHED });
  ids.k5r = await mk("K5R", { status: RollStatus.STOCK, renkli: false });
  ids.k5b = await mk("K5B", { status: RollStatus.STOCK, renkli: true });
  ids.k6y = await mk("K6Y", { status: RollStatus.IN_PRODUCTION, renkli: true, entrySource: RollEntrySource.SEMI_FINISHED });
  ids.k6k = await mk("K6K", { status: RollStatus.IN_PRODUCTION, renkli: true, entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, parentRollId: ids.k4 });
  ids.k6h = await mk("K6H", { status: RollStatus.AT_SUBCONTRACTOR, renkli: true });
  ids.olu = await mk("OLU", { status: RollStatus.TAMBUR_CONSUMED, renkli: false, olumOncesi: RollStatus.WAREHOUSE });
  ids.oluCocuk = await mk("OLUC", { status: RollStatus.STOCK, renkli: false, entrySource: RollEntrySource.TAMBUR_SPLIT, parentRollId: ids.olu });
  ids.k7 = await mk("K7", { status: RollStatus.SCRAP, renkli: true });
  // K7: doğuşta ölü statüde yaratılan topun defter satırı fromStatus=NULL → ölüm öncesi bilinmez (preEpoch benzeri).
  ids.dokunulmus = await mk("DOK", { status: RollStatus.WAREHOUSE, renkli: false, kesimSonrasiDokun: true });
  ids.yeni = await mk("YENI", { status: RollStatus.WAREHOUSE, renkli: false, kesimSonrasiDogum: true });

  const p = await planla(prisma, { kesim: KESIM, idler: Object.values(ids) });
  const bekle = (ad: string, id: string, yeni: RollStage, kural: string, yazilir: boolean): void => {
    const s = satir(p, id);
    const yazilacakMi = p.yazilacak.some((x) => x.id === id);
    check(`§1 ${ad} → ${yeni} (${kural})${yazilir ? "" : " — değişmez"}`,
      yazilir ? yazilacakMi && s?.yeni === yeni && s?.kural === kural : !yazilacakMi,
      s ? `${s.eski}→${s.yeni} ${s.kural}` : "planda yok");
  };
  bekle("K1 depo kesimi çocuğu atadan (renksiz depo atası FINISHED)", ids.k1, RollStage.FINISHED, "K1_KESIM_ATA", true);
  bekle("K2 tambur üretim çocuğu STOCK'ta", ids.k2, RollStage.FINISHED, "K2_TAMBUR_URETIM", true);
  bekle("K3 ⭐ renksiz bitmiş depo topu", ids.k3, RollStage.FINISHED, "K3_BITMIS_STATU", true);
  bekle("K4 renkli yarı mamul STOCK", ids.k4, RollStage.SEMI_FINISHED, "K4_YARI_MAMUL_STOK", true);
  bekle("K5 renksiz STOCK", ids.k5r, RollStage.RAW, "K5_STOK_RENKSIZ", false);
  bekle("K6 üretimde yarı mamul", ids.k6y, RollStage.SEMI_FINISHED, "K6_URETIM_YARI_MAMUL", true);
  bekle("K6 fason dönüşü kaynaktan (yarı mamul ata)", ids.k6k, RollStage.SEMI_FINISHED, "K6_URETIM_KAYNAK", true);
  bekle("K6 fasonda renkli ham", ids.k6h, RollStage.RAW, "K6_URETIM_HAM", true);
  bekle("ölü ata ölüm öncesi statüden (WAREHOUSE → FINISHED)", ids.olu, RollStage.FINISHED, "K3_BITMIS_STATU", true);
  bekle("ölü atanın depo kesimi çocuğu atadan", ids.oluCocuk, RollStage.FINISHED, "K1_KESIM_ATA", true);
  bekle("K7 defteri olmayan ölü → tohum", ids.k7, RollStage.FINISHED, "K7_OLU_TOHUM", false);

  check("§2a ⭐ renkli STOCK belirsiz kovada, yazılmıyor (KORU)", p.belirsiz.some((s) => s.id === ids.k5b) && !p.yazilacak.some((s) => s.id === ids.k5b));
  const pR = await planla(prisma, { kesim: KESIM, idler: Object.values(ids), renkliStok: RollStage.RAW });
  check("§2b renkliStok=RAW verilince renkli STOCK yazılacaklara girer", pR.yazilacak.some((s) => s.id === ids.k5b && s.yeni === RollStage.RAW) && pR.belirsiz.length === 0);

  check("§3a kesimden sonra güncellenmiş top atlanır (ayrı kova)", p.atlananKesimSonrasi.some((s) => s.id === ids.dokunulmus) && !p.yazilacak.some((s) => s.id === ids.dokunulmus));
  check("§3b kesimden sonra doğan top aday değil", !satir(p, ids.yeni));

  // Plan ile yazım arasında bir top güncellenir (kod aşamayı yazmış olabilir) → claim onu yazmaz.
  await prisma.$executeRaw`UPDATE "rolls" SET "updatedAt" = ${new Date()} WHERE "id" = ${ids.k6h}::uuid`;
  const yazilan = await uygula(prisma, p);
  check("§4a yazılan = plan − araya giren (claim updatedAt < kesim)", p.yazilacak.length === 9 && yazilan === 8, `yazılan=${yazilan} plan=${p.yazilacak.length}`);
  const db = new Map((await prisma.roll.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true, stage: true } })).map((r) => [r.id, r.stage]));
  check("§4b DB: renksiz depo topu FINISHED, renkli STOCK tohumda (FINISHED), dokunulmuş top RAW kaldı",
    db.get(ids.k3) === RollStage.FINISHED && db.get(ids.k5b) === RollStage.FINISHED && db.get(ids.dokunulmus) === RollStage.RAW);
  check("§4d araya giren top yazılmadı (tohumda kaldı)", db.get(ids.k6h) === RollStage.FINISHED);
  // uygula updatedAt'i tazeler; ikinci koşum aynı kesimle yeniden planlanır.
  const p2 = await planla(prisma, { kesim: KESIM, idler: Object.values(ids) });
  check("§4c ⭐ ikinci koşum 0 yazar (idempotent)", p2.yazilacak.length === 0, `yazılacak=${p2.yazilacak.length}`);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    try {
      if (rollIds.length) {
        await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { parentRollId: null } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (woId) {
        await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
        await prisma.workOrder.deleteMany({ where: { id: woId } });
      }
      if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
      if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    } catch (e) {
      fail++;
      console.error("TEMİZLİK HATASI:", e instanceof Error ? e.message : e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
