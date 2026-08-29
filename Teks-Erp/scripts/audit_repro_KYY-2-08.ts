// =============================================================================
// AUDIT REPRO — KYY-2-08: `moveRollToSack` çuval kilit sırası İSTEMCİDEN gelir → ABBA deadlock
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): iki depo çuvalı arasında ters yönde eşzamanlı taşıma
//   ya sırayla tamamlanır ya da anlaşılır bir 409 verir; PostgreSQL deadlock'ı
//   (SQLSTATE 40P01 → istemciye 500) OLUŞMAMALI.
// Gözlenen: (çalıştırınca doldur — log audit/repro/KYY-2-08.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-2-08.ts
//
// Mekanizma: `shipping.service.ts:690-692`
//     await touchWarehouseSackTx(tx, fromSackId);   // kilit 1 = KAYNAK
//     await touchWarehouseSackTx(tx, data.sackId);  // kilit 2 = HEDEF
//   Sıra kanonik DEĞİL (id ASC değil), isteğin from/to'sundan doğar. A→B ile B→A
//   aynı anda koşarsa T1 A'yı, T2 B'yi tutar ve karşılıklı beklerler.
//   `moveRollToSack`ta `withBarcodeRetry` YOK → deadlock kullanıcıya kadar çıkar.
// Yan etki sınırı: yalnız kendi ürettiği çuval/topa dokunur; dış dünya çağrısı yok.
// =============================================================================
import "dotenv/config";

function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production")
    throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "",
    db = "";
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

import { RollStatus, RollEntrySource } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";

const ship = new ShippingService();
const STAMP = `AUDITREPRO-KYY-2-08-${Math.random().toString(36).slice(2, 8)}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const createdRolls: string[] = [];
const createdSacks: string[] = [];
let itemId = "";
let customerId = "";

async function makeRoll(): Promise<{ id: string; barcode: string }> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R${Date.now()}${Math.floor(Math.random() * 1e6)}`.toUpperCase(),
      itemId,
      colorId: null,
      width: 88888,
      initialQty: 50,
      currentQty: 50,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);
  return { id: roll.id, barcode: roll.barcode! };
}

async function openSack(): Promise<string> {
  const opened = (await ship.openSack({ customerId })) as { data: { id: string } };
  createdSacks.push(opened.data.id);
  return opened.data.id;
}

function classify(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/deadlock/i.test(msg) || /40P01/.test(msg)) return "DEADLOCK";
  if (/bu sırada|yenileyin|tekrar deneyin/i.test(msg)) return "409-CONFLICT";
  return `DIGER: ${msg.slice(0, 90).replace(/\s+/g, " ")}`;
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-2-08 — çuval taşıma ABBA kilit sırası (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cust = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !cust) throw new Error("Test verisi yetersiz (Item/Customer yok — npm run seed).");
  itemId = item.id;
  customerId = cust.id;

  const sackA = await openSack();
  const sackB = await openSack();
  const rolls: Array<{ id: string; barcode: string }> = [];
  for (let i = 0; i < 6; i++) rolls.push(await makeRoll());
  // A'ya 3, B'ye 3 top
  for (let i = 0; i < 3; i++) await ship.scanIntoSack({ sackId: sackA, barcode: rolls[i]!.barcode });
  for (let i = 3; i < 6; i++) await ship.scanIntoSack({ sackId: sackB, barcode: rolls[i]!.barcode });

  console.log(`Çuval A=${sackA.slice(0, 8)} · Çuval B=${sackB.slice(0, 8)} (her birinde 3 top)\n`);
  console.log("--- Ters yönde eşzamanlı taşıma × 40 tur (A→B ‖ B→A) ---");

  const tally = new Map<string, number>();
  const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
  let deadlocks = 0;

  for (let round = 0; round < 40; round++) {
    // Her turda A'da ve B'de en az bir top olduğundan emin ol (yoksa taşıyacak şey yok).
    const inA = await prisma.roll.findFirst({ where: { sackId: sackA }, select: { id: true } });
    const inB = await prisma.roll.findFirst({ where: { sackId: sackB }, select: { id: true } });
    if (!inA || !inB) {
      // Dengele: yarısını A'ya, yarısını B'ye geri koy.
      await prisma.roll.updateMany({
        where: { id: { in: createdRolls.slice(0, 3) } },
        data: { sackId: sackA },
      });
      await prisma.roll.updateMany({
        where: { id: { in: createdRolls.slice(3) } },
        data: { sackId: sackB },
      });
      continue;
    }

    const res = await Promise.allSettled([
      ship.moveRollToSack({ rollId: inA.id, sackId: sackB }), // kilit sırası A → B
      ship.moveRollToSack({ rollId: inB.id, sackId: sackA }), // kilit sırası B → A
    ]);
    for (const r of res) {
      if (r.status === "fulfilled") bump("OK");
      else {
        const k = classify(r.reason);
        bump(k.startsWith("DIGER") ? "DIGER" : k);
        if (k === "DEADLOCK") {
          deadlocks++;
          if (deadlocks <= 2) {
            const err = r.reason as { constructor: { name: string }; code?: string; message: string };
            console.log(
              `   tur ${round}: sınıf=${err.constructor.name} · code=${err.code ?? "(yok)"} · ` +
                String(err.message).replace(/\s+/g, " ").slice(0, 200),
            );
          }
        }
      }
    }
  }

  console.log("\nSonuç dağılımı:");
  for (const [k, v] of [...tally.entries()].sort()) console.log(`   ${k}: ${v}`);

  check(
    "D1 40 turluk ters yönde eşzamanlı taşımada PostgreSQL deadlock'ı OLUŞMADI",
    deadlocks === 0,
    `deadlock=${deadlocks}`,
  );

  // Envanter bütünlüğü: hiçbir top kaybolmamalı (çuvalsız kalmamalı, çift sayılmamalı).
  const stillInSacks = await prisma.roll.count({
    where: { id: { in: createdRolls }, sackId: { in: [sackA, sackB] } },
  });
  check(
    "D2 6 topun tamamı hâlâ iki çuvaldan birinde (kayıp/çuvalsız yok)",
    stillInSacks === 6,
    `çuvalda=${stillInSacks}/6`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  const PREFIX = "AUDITREPRO-KYY-2-08-";
  try {
    const olds = await prisma.roll.findMany({
      where: { barcode: { startsWith: PREFIX } },
      select: { id: true, sackId: true },
    });
    const rollIds = [...new Set([...createdRolls, ...olds.map((r) => r.id)])];
    const sackIds = [
      ...new Set([...createdSacks, ...olds.map((r) => r.sackId).filter((x): x is string => !!x)]),
    ];
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...sackIds] } } });
    console.log(`\n[temizlik] ${rollIds.length} top / ${sackIds.length} çuval silindi.`);
  } catch (e) {
    console.error("Temizlik hatası:", e);
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
