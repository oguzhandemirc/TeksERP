// =============================================================================
// AUDIT REPRO — KYY-2-32: `applyManualProperties` metraj yazımı statü/metraj PİNLEMİYOR
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): "bütün top" (initialQty == currentQty) guard'ı, eşzamanlı
//   bir kesim araya girdiğinde de tutmalı → metraj düzeltmesi ya 409 vermeli ya da
//   kesimden SONRAKİ gerçek kalanı temel almalı. Değişmez:
//   `parent.currentQty + Σ child.initialQty ≤ parent.initialQty` (metraj yoktan var olmaz).
// Gözlenen: (çalıştırınca doldur — log audit/repro/KYY-2-32.log)
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_KYY-2-32.ts
//
// Mekanizma: `inventory.service.ts`
//   • `rollWhole` guard'ı (:3783) ve metraj kararı (:3866-3868) tx DIŞINDA, BAYAT
//     `roll` satırından hesaplanır (`currentQty`/`initialQty` mutlak olarak yazılır).
//   • tx içindeki atomik claim (:3932) yalnız `{id, shipmentId:null, sackId: cur.sackId}`
//     pinler — **status ve currentQty WHERE'de YOK** → araya giren kesim claim'i
//     düşürmez, yazım geçer.
// Migration/flag/ayar DEĞİŞTİRİLMEZ.
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
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";

const inv = new InventoryService();
const tambur = new TamburService();
const STAMP = `AUDITREPRO-KYY-2-32-${Math.random().toString(36).slice(2, 8)}`;

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
let itemId = "";

async function makeRoll(qty: number): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: `${STAMP}-R${Date.now()}${Math.floor(Math.random() * 1e6)}`.toUpperCase(),
      itemId,
      colorId: null,
      width: 77777,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true },
  });
  createdRolls.push(roll.id);
  return roll.id;
}

const short = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 70);

/** Commit SONRASI, DB'DEN oku: parent + çocukları. */
async function measure(parentId: string): Promise<{
  init: number;
  cur: number;
  children: number[];
}> {
  const p = await prisma.roll.findUnique({
    where: { id: parentId },
    select: { initialQty: true, currentQty: true },
  });
  const ch = await prisma.roll.findMany({
    where: { parentRollId: parentId },
    select: { id: true, initialQty: true },
  });
  for (const c of ch) if (!createdRolls.includes(c.id)) createdRolls.push(c.id);
  return {
    init: Number(p!.initialQty),
    cur: Number(p!.currentQty),
    children: ch.map((c) => Number(c.initialQty)),
  };
}

/** Bir tur: 700 m bütün top; aynı anda 100 m kes + metrajı 720'ye "düzelt". */
async function round(label: string, parallel: boolean): Promise<boolean> {
  const rollId = await makeRoll(700);

  const doCut = () =>
    tambur
      .cutWarehouseRoll(rollId, { cutLength: 100 })
      .then(() => ({ ok: true as const, who: "KESİM" }))
      .catch((e: unknown) => ({ ok: false as const, who: "KESİM", err: short(e) }));

  const doEdit = () =>
    inv
      // FREE_STOCK kapsamı (WAREHOUSE) → sebep opsiyonel, ek yetki aranmaz.
      .applyManualProperties(rollId, { colorId: null, propertyIds: [], currentQty: 720 })
      .then(() => ({ ok: true as const, who: "DÜZELT" }))
      .catch((e: unknown) => ({ ok: false as const, who: "DÜZELT", err: short(e) }));

  let res: Array<{ ok: boolean; who: string; err?: string }>;
  if (parallel) {
    res = await Promise.all([doCut(), doEdit()]);
  } else {
    res = [await doCut(), await doEdit()];
  }
  const m = await measure(rollId);
  const toplam = m.cur + m.children.reduce((a, b) => a + b, 0);
  const bozuk = toplam > m.init + 0.0001;
  console.log(
    `   [${label}] ${res.map((r) => `${r.who}:${r.ok ? "OK" : `ERR(${r.err})`}`).join(" | ")}` +
      ` → parent init=${m.init} cur=${m.cur} · çocuk=[${m.children.join(",")}]` +
      ` · TOPLAM=${toplam} ${bozuk ? "⚠️ init'i AŞIYOR" : ""}`,
  );
  return bozuk;
}

async function main(): Promise<void> {
  console.log(`=== AUDIT REPRO KYY-2-32 — elle metraj düzeltmesi ‖ depo kesimi (${STAMP}) ===\n`);

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz (Item yok — npm run seed).");
  itemId = item.id;

  console.log("--- KOL 1: SIRALI (önce kesim, sonra düzeltme) — referans davranış ---");
  const seqBroken = await round("SIRALI", false);
  check(
    "S1 sıralı: kesimden sonra metraj düzeltmesi REDDEDİLİYOR (bütün-top guard'ı)",
    !seqBroken,
    seqBroken ? "toplam init'i aştı" : "guard tuttu",
  );

  console.log("\n--- KOL 2: PARALEL × 10 tur (kesim ‖ düzeltme, aynı top) ---");
  let broke = 0;
  for (let i = 0; i < 10; i++) if (await round(`P#${i + 1}`, true)) broke++;
  console.log(`\n10 paralel turun ${broke} tanesinde parent+çocuk toplamı initialQty'yi AŞTI.`);
  check("P1 10 turun hiçbirinde metraj yoktan var olmadı", broke === 0, `bozulan=${broke}/10`);

  // Mutabakat: dev DB'de bu koşumun ürettiği ihlaller (test_consistency §8 sınıfı)
  const drift = await prisma.$queryRaw<Array<{ id: string; init: string; toplam: string }>>`
    SELECT p."id",
           p."initialQty"::text AS init,
           (p."currentQty" + COALESCE(SUM(c."initialQty"), 0))::text AS toplam
    FROM "rolls" p
    LEFT JOIN "rolls" c ON c."parentRollId" = p."id"
    WHERE p."barcode" LIKE ${STAMP.toUpperCase() + "%"}
    GROUP BY p."id", p."initialQty", p."currentQty"
    HAVING p."currentQty" + COALESCE(SUM(c."initialQty"), 0) > p."initialQty"
  `;
  console.log(`\nMutabakat: metraj yoktan var olan top sayısı = ${drift.length}`);
  check("C1 mutabakat temiz (parent.cur + Σ child.init ≤ parent.init)", drift.length === 0, `drift=${drift.length}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  const PREFIX = "AUDITREPRO-KYY-2-32-";
  try {
    const olds = await prisma.roll.findMany({
      where: { barcode: { startsWith: PREFIX.toUpperCase() } },
      select: { id: true },
    });
    let ids = [...new Set([...createdRolls, ...olds.map((r) => r.id)])];
    const kids = await prisma.roll.findMany({
      where: { parentRollId: { in: ids } },
      select: { id: true },
    });
    ids = [...new Set([...ids, ...kids.map((k) => k.id)])];
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: ids } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } });
    // Önce çocuklar (parentRollId FK), sonra parent.
    await prisma.roll.deleteMany({ where: { id: { in: ids }, parentRollId: { not: null } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
    console.log(`\n[temizlik] ${ids.length} top silindi.`);
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
