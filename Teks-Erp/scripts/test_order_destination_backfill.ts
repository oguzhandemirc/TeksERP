// =============================================================================
// BEKÇİ — SİPARİŞ YÖNÜ GERİ DOLDURMA SCRIPT'İ (`backfill_order_destination.ts`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts order_destination_backfill
//
// ⭐ NEDEN (2026-09-23): script fabrika verisinde KULLANICI tarafından bir kez koşulacak; geri
//    alınamaz eşiğe gelmeden davranışı fikstürde ölçülür. Script gerçekten ÇOCUK SÜREÇ olarak
//    koşulur (kapılar, argümanlar, çıktı dahil) ve kapsam `--musteri=` ile bu koşumun carilerine daralır.
//
// NE ÖLÇER:
//   ① kuru koşum HİÇBİR ŞEY yazmaz ve etkilenecek her siparişi numarasıyla listeler
//   ② --apply: cari EXPORT → EXPORT · şube EXPORT (yurtiçi carinin) → EXPORT · zincir boş → NULL kalır
//   ③ ⭐ dolu satıra DOKUNMAZ (doğuşta DOMESTIC yazılmış sipariş, cari EXPORT olsa da DOMESTIC kalır)
//   ④ ikinci --apply 0 değişiklik (idempotent)
//
// NEGATİF SONDA (2026-09-23, ölçüldü): adaylardan `destination: null` süzgeci kaldırılınca ③ KIRMIZI
//    (dolu satır EXPORT'a çevrildi); geri alınınca yeşil.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { spawnSync } from "child_process";
import path from "path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-OYB-${process.pid}`;
const ids = { customers: [] as string[], branches: [] as string[], orders: [] as string[], items: [] as string[] };

function kos(...args: string[]): string {
  const r = spawnSync("npx", ["tsx", path.join(__dirname, "backfill_order_destination.ts"), ...args], { encoding: "utf-8", env: process.env, cwd: path.join(__dirname, "..") });
  return `${r.stdout}\n${r.stderr}`;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(2); }
  try {
    const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } });
    ids.items.push(item.id);
    const cari = async (n: string, d: "DOMESTIC" | "EXPORT" | null) => {
      const c = await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} ${n}`, defaultDestination: d }, select: { id: true } });
      ids.customers.push(c.id);
      return c.id;
    };
    const cE = await cari("CE", "EXPORT");
    const cD = await cari("CD", "DOMESTIC");
    const cN = await cari("CN", null);
    const bE = await prisma.customerBranch.create({ data: { customerId: cD, name: `${TAG} BE`, defaultDestination: "EXPORT" }, select: { id: true } });
    ids.branches.push(bE.id);
    // Eski siparişler: doğrudan kurulur (kolon NULL) — geri doldurmanın adayları.
    const siparis = async (no: string, customerId: string, branchId: string | null, destination: "DOMESTIC" | "EXPORT" | null = null) => {
      const o = await prisma.order.create({ data: { orderNumber: `${TAG}-${no}`, customerId, branchId, destination, status: "APPROVED", lines: { create: [{ itemId: item.id, quantity: 1 }] } }, select: { id: true } });
      ids.orders.push(o.id);
      return o.id;
    };
    const o1 = await siparis("O1", cE, null);
    const o2 = await siparis("O2", cD, bE.id);
    const o3 = await siparis("O3", cN, null);
    const o4 = await siparis("O4", cE, null, "DOMESTIC"); // doğuşta yazılmış — dokunulmamalı
    const yon = async (id: string) => (await prisma.order.findUnique({ where: { id }, select: { destination: true } }))?.destination ?? null;
    const kapsam = `--musteri=${ids.customers.join(",")}`;

    // ① kuru koşum
    const kuru = kos(kapsam);
    check("① kuru koşum yazmaz", (await yon(o1)) === null && (await yon(o2)) === null);
    check("① etkilenecek siparişler numarasıyla listelenir", kuru.includes(`${TAG}-O1`) && kuru.includes(`${TAG}-O2`) && !kuru.includes(`${TAG}-O4`), kuru.split("\n").filter((l) => l.includes("Yazılacak") || l.includes("NULL kalır")).join(" · "));

    // ② ③ uygula
    const uygula = kos("--apply", kapsam);
    check("② cari EXPORT → EXPORT", (await yon(o1)) === "EXPORT", String(await yon(o1)));
    check("② yurtiçi carinin EXPORT şubesi → EXPORT (şube önce)", (await yon(o2)) === "EXPORT", String(await yon(o2)));
    check("② zincir boş → NULL kalır", (await yon(o3)) === null, String(await yon(o3)));
    check("③ ⭐ dolu satır DEĞİŞMEZ (DOMESTIC kalır, cari EXPORT olsa da)", (await yon(o4)) === "DOMESTIC", String(await yon(o4)));
    check("② özet satırı 2 güncellendi der", /✔ 2 sipariş güncellendi/.test(uygula), uygula.split("\n").find((l) => l.includes("✔")) ?? "(özet yok)");

    // ④ idempotent
    const ikinci = kos("--apply", kapsam);
    check("④ ikinci koşum 0 değişiklik", /✔ 0 sipariş güncellendi/.test(ikinci), ikinci.split("\n").find((l) => l.includes("✔")) ?? "(özet yok)");
  } finally {
    await temizlik();
  }
}

/** Teardown: bu koşumun satırları. */
async function temizlik(): Promise<void> {
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } }).catch(() => undefined);
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } }).catch(() => undefined);
  await prisma.customerBranch.deleteMany({ where: { id: { in: ids.branches } } }).catch(() => undefined);
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }).catch(() => undefined);
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } }).catch(() => undefined);
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`); })
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
