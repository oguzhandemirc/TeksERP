// =============================================================================
// AUDIT REPRO — D-A-01: "Düzelt" (applyManualProperties) metraj yazımı, eşzamanlı
// Tambur kesimini (cutWarehouseRoll) SESSİZCE EZİYOR (lost update).
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): kesim commit olduktan sonra gelen metraj düzeltmesi
//   409 ile reddedilmeli (claim `currentQty`/`initialQty`'yi pin'lemeli) — ya da
//   en azından `parent.currentQty + Σ çocuk` fiziksel gerçeği aşmamalı.
// Gözlenen: çalıştırınca doldur — log audit/repro/D-A-01.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-A-01.ts
// =============================================================================
// MEKANİZMA (inventory.service.ts:3685 okuma → :3916 claim):
//   • `roll` TX DIŞINDA okunur (:3685); `rollWhole = initialQty.equals(currentQty)`
//     guard'ı o bayat okumadan hesaplanır (:3782).
//   • tx içi claim `where: { id, shipmentId: null, sackId: cur.sackId }` (:3931) —
//     `status` da `currentQty`/`initialQty` da PİN'LENMEZ.
//   • Yazım MUTLAK: `currentQty = m; initialQty = m` (:3866-3868) — decrement değil.
//   • `cutWarehouseRoll` (tambur.service.ts:2242) parent'ın İKİSİNİ DE decrement
//     eder → kesimden sonra da `initialQty == currentQty` olur, yani `rollWhole`
//     guard'ı TX İÇİNE TAŞINSA BİLE bu yarışı yakalayamaz. Tek çözüm pin'lemektir.
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { ItemType, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";

const RAND = Math.random().toString(36).slice(2, 8);
const STAMP = `AUDITREPRO-D-A-01-${RAND}`;

let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { console.log(`❌ ${m}`); fail++; };
const info = (m: string) => console.log(`   ${m}`);

const inventory = new InventoryService();
const tambur = new TamburService();

const createdRollIds: string[] = [];
let itemId = "";

async function makeRoll(tag: string, qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-${tag}`.slice(0, 60),
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
    },
    select: { id: true },
  });
  createdRollIds.push(r.id);
  return r.id;
}

async function readState(parentId: string) {
  const p = await prisma.roll.findUniqueOrThrow({
    where: { id: parentId },
    select: { currentQty: true, initialQty: true },
  });
  const kids = await prisma.roll.findMany({
    where: { parentRollId: parentId, status: { not: RollStatus.CANCELLED } },
    select: { id: true, currentQty: true },
  });
  const kidSum = kids.reduce((s, k) => s + Number(k.currentQty), 0);
  return {
    parentCur: Number(p.currentQty),
    parentInit: Number(p.initialQty),
    kidCount: kids.length,
    kidSum,
    total: Number(p.currentQty) + kidSum,
  };
}

async function main(): Promise<void> {
  console.log(`\n=== ${STAMP} — metraj düzeltmesi ∥ depo kesimi ===\n`);

  const item = await prisma.item.create({
    data: { code: `ARDA01${RAND}`.slice(0, 32), name: `${STAMP} kumaş`, itemType: ItemType.FABRIC },
    select: { id: true },
  });
  itemId = item.id;
  info(`fixture item: ${item.id}`);

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // FAZ 1 — DETERMİNİSTİK: kesim ÖNCE commit olur, düzeltme SONRA gelir.
    // Operatörün ekranı kesimden ÖNCE yüklenmiştir (100 m görür, "aslında 100,5"
    // yazar). Sunucu bayat metrajı sorgusuz kabul ediyor mu?
    // ─────────────────────────────────────────────────────────────────────────
    {
      const rollId = await makeRoll("F1", 100);
      // Operatörün ekranında gördüğü hâl (kesimden ÖNCE): 100/100.
      await tambur.cutWarehouseRoll(rollId, { cutLength: 40 }, undefined, null, null);
      const afterCut = await readState(rollId);
      info(`kesim sonrası: parent ${afterCut.parentCur}/${afterCut.parentInit}, çocuk ${afterCut.kidSum} m, TOPLAM ${afterCut.total}`);

      let editRejected = false;
      try {
        await inventory.applyManualProperties(
          rollId,
          { colorId: null, propertyIds: [], currentQty: 100.5, reason: `${STAMP} ölçüm düzeltmesi` },
          undefined,
        );
      } catch (e) {
        editRejected = true;
        info(`düzeltme reddedildi: ${(e as Error).message}`);
      }

      const st = await readState(rollId);
      info(`düzeltme sonrası: parent ${st.parentCur}/${st.parentInit}, çocuk ${st.kidSum} m, TOPLAM ${st.total}`);
      if (editRejected) {
        ok("FAZ1: bayat metraj düzeltmesi REDDEDİLDİ (koruma var)");
      } else if (st.total > 101) {
        bad(
          `FAZ1: bayat düzeltme KABUL EDİLDİ → 100 m'lik fiziksel top için sistemde ${st.total} m ` +
          `(parent ${st.parentCur} + çocuk ${st.kidSum}); kesimin aritmetiği silindi`,
        );
      } else {
        ok(`FAZ1: toplam ${st.total} — beklenmedik ama ihlal yok`);
      }
      // `rollWhole` guard'ı kesimden SONRA da TRUE kalıyor mu? (guard'ı tx içine
      // taşımanın neden yetmeyeceğinin kanıtı)
      if (afterCut.parentCur === afterCut.parentInit) {
        ok("FAZ1b: kesim `initialQty`'yi de düşürdüğü için `rollWhole` guard'ı kesimden SONRA da TRUE — guard bu yarışı tx içinde de yakalayamaz");
      } else {
        info(`FAZ1b: kesim sonrası initial(${afterCut.parentInit}) ≠ current(${afterCut.parentCur})`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FAZ 2 — GERÇEK PARALEL: aynı topa aynı anda kesim + metraj düzeltmesi.
    // N tekrar; kaç turda değişmez bozuldu say.
    // ─────────────────────────────────────────────────────────────────────────
    for (const N of [2, 5, 10]) {
      let violated = 0;
      let bothOk = 0;
      for (let i = 0; i < N; i++) {
        const rollId = await makeRoll(`F2-${N}-${i}`, 100);
        const res = await Promise.allSettled([
          tambur.cutWarehouseRoll(rollId, { cutLength: 40 }, undefined, null, null),
          (async () => {
            await new Promise((r) => setTimeout(r, 4)); // kesimin tx'i açılsın
            return inventory.applyManualProperties(
              rollId,
              { colorId: null, propertyIds: [], currentQty: 100.5, reason: `${STAMP} paralel` },
              undefined,
            );
          })(),
        ]);
        const cutOk = res[0].status === "fulfilled";
        const editOk = res[1].status === "fulfilled";
        if (cutOk && editOk) bothOk++;
        const st = await readState(rollId);
        if (st.total > 101) violated++;
      }
      if (violated > 0) {
        bad(`FAZ2 (N=${N}): ${violated}/${N} turda TOPLAM > 100 m — iki yazım da başarılı sayıldı (${bothOk}/${N})`);
      } else {
        ok(`FAZ2 (N=${N}): ihlal yok (iki-taraf-başarılı ${bothOk}/${N}) — zamanlamaya bağlı, FAZ1 kanıtı geçerli`);
      }
    }
  } finally {
    // ── Temizlik (FK sırası) — YALNIZ kendi damgamız ─────────────────────────
    const mine = await prisma.roll.findMany({
      where: { OR: [{ id: { in: createdRollIds } }, { parentRollId: { in: createdRollIds } }] },
      select: { id: true },
    });
    const ids = mine.map((r) => r.id);
    if (ids.length > 0) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
      await prisma.roll.deleteMany({ where: { parentRollId: { in: createdRollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } });
    }
    if (itemId) {
      await prisma.systemLog.deleteMany({ where: { tableName: "ROLL_MANUAL_OVERRIDE", recordId: { in: createdRollIds } } });
      await prisma.item.deleteMany({ where: { id: itemId } });
    }
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  }

  console.log(`\n=== SONUÇ: ${fail === 0 ? "değişmez korundu" : `${fail} kırmızı`} ===\n`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("REPRO ÇÖKTÜ:", e);
  process.exitCode = 1;
});
