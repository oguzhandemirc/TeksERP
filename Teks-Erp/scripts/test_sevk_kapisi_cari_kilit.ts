// =============================================================================
// Bekçi: Sevk kapısı cari kilit çipi (D4-I4, ister 4.7; tasarım DALGA4 §10.8) — GERÇEK DB
// Çalıştır: DATABASE_URL=… npx tsx scripts/test_sevk_kapisi_cari_kilit.ts
//
//   §0 statik — liste yüzeyleri kilidi `activeHoldFlagsLateralSql` ile okur (kopya SQL yüklemi yok); board'da
//      ikinci okuma (`cariHold.` / `activeHoldBy*`) yok
//   §1 listSackCustomers: kilitli müşteri held + kapsam + metin; açılmış kilit held=false; K3a eski fason bacağındaki
//      kilit de görünür (kapsamlar birleşir); SQL ikizi Prisma ikiziyle (`activeHoldByCustomer`) aynı cevap
//   §2 Sevk Kapısı board'u (tablet SevkiyatScreen'in ucu): held + kapsam + metin; toplamlar groupBy ile aynı (BRÜT);
//      emanet ayarı metne girer (EXEMPT varsayılan · ALL_HELD)
//   §3 ⭐ SORGU BÜTÇESİ — kilit alanları ek sorgu açmaz: listSackCustomers (aramalı) = 2 sorgu (origin/main 2), board =
//      4 sorgu (eski iki groupBy kilitle birlikte tek SQL'e katlandı; origin/main ölçümü 5); kilitli ve kilitsiz sayfada aynı sayı
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-31): ① board helper'ına `activeHoldByCustomer` ikinci okuması → §0b + §3b ❌ (4 → 5);
//    ② listSackCustomers'a `cariHold.count` ikinci okuması → §3a ❌ (2 → 3). İkisi geri alındı → 17/0.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de, ayar birebir geri konur.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { SackSearchService } from "../src/services/sack-search.service";
import { ShippingService } from "../src/services/shipping.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { activeHoldByCustomer, holdScopes } from "../src/services/helpers/cari-hold.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

// --- Sorgu sayacı: pg istemcisini sarmala (yalnız ölçüm penceresinde sayar) ---
let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) total++;
    return orig(...args);
  };
});
async function measure<T>(fn: () => Promise<T>): Promise<{ n: number; out: T }> {
  // Havuz bağlantısı ölçüm penceresinden ÖNCE açılsın (bağlantı kurulum sorguları sayılmasın).
  await fn();
  total = 0;
  capture = true;
  try {
    const out = await fn();
    return { n: total, out };
  } finally {
    capture = false;
  }
}

const SRC = path.resolve(__dirname, "../src");
const TAG = `TEST-I4-${process.pid}`;
const CUSTOMERS_BUDGET = 2; // readPackingGroupsEnabled + tek toplulaştırma SQL'i (aramalı → müşterisiz kovası yok)
const BOARD_BUDGET = 4; // shipment.findMany (+ customer + branch ilişki okumaları = 3) + boardTotalsWithHold; origin/main 5 ölçtü

type Item = { customerId: string | null; held?: boolean; holdScopes?: string[]; holdText?: string | null; sackCount?: number; rollCount?: number };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exitCode = 1;
    return;
  }
  console.log("=== Sevk kapısı cari kilit çipi (D4-I4) ===");

  console.log("── §0 Statik ──");
  const sack = readFileSync(path.join(SRC, "services/sack-search.service.ts"), "utf8");
  const board = readFileSync(path.join(SRC, "services/helpers/sack-store-board.helper.ts"), "utf8");
  check("§0a listSackCustomers kilidi helper'ın lateral ikiziyle okur (kopya `cari_holds` SQL'i yok)", /activeHoldFlagsLateralSql\(/.test(sack) && !/cari_holds/.test(sack));
  check("§0b board kilidi aynı lateral'le, TEK sorguda okur (ikinci okuma yok)", /activeHoldFlagsLateralSql\(/.test(board) && !/cari_holds|cariHold\.|activeHoldBy/.test(board));

  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], subs: [] as string[], shipments: [] as string[] };
  const foto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT } });
  const kart = async (suffix: string): Promise<{ customerId: string; cariId: string }> => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` }, select: { id: true } });
    ids.customers.push(c.id);
    const a = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: c.id }, select: { id: true } });
    return { customerId: c.id, cariId: a.id };
  };
  const kilit = (cariId: string, f: { i?: boolean; s?: boolean; v?: boolean }, released = false) =>
    prisma.cariHold.create({
      data: {
        cariId, blocksIntake: !!f.i, blocksShipment: !!f.s, blocksInvoice: !!f.v, reasonCode: "BORC", placedById: admin.id, clientToken: randomUUID(),
        ...(released ? { releasedAt: new Date(), releasedById: admin.id } : {}),
      },
    });
  try {
    const A = await kart("A"); // SEVK + FATURA kilitli
    const B = await kart("B"); // açılmış kilit → serbest
    const C = await kart("C"); // K3a: kart hesabında FATURA, eski fason bacağında KABUL
    await kilit(A.cariId, { s: true, v: true });
    await kilit(B.cariId, { i: true, s: true }, true);
    await kilit(C.cariId, { v: true });
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-SUBC`.slice(0, 32), name: `${TAG} eski fason`, customerId: C.customerId }, select: { id: true } });
    ids.subs.push(sub.id);
    const legacy = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub.id }, select: { id: true } });
    await kilit(legacy.id, { i: true });

    console.log("── §1 listSackCustomers ──");
    const svc = new SackSearchService();
    const page = await svc.listSackCustomers({ search: TAG, scope: "ALL" });
    const items = (page.data?.items ?? []) as Item[];
    const by = (id: string) => items.find((r) => r.customerId === id);
    const a = by(A.customerId), b = by(B.customerId), c = by(C.customerId);
    check("§1 körlük zemini: üç test carisi listede", !!a && !!b && !!c, `${items.length} satır`);
    check("§1a ⭐ kilitli cari held=true + kapsam [SHIPMENT, INVOICE]", a?.held === true && JSON.stringify(a?.holdScopes) === '["SHIPMENT","INVOICE"]', JSON.stringify(a));
    check("§1b çip metni sunucudan: kapsam + emanet (EXEMPT varsayılan)", /Cari kilitli \(sevk, fatura onayı\)/.test(a?.holdText ?? "") && /kendi emaneti sevk edilir/.test(a?.holdText ?? ""), a?.holdText ?? "");
    check("§1c açılmış kilit → held=false, kapsam boş, metin null", b?.held === false && b?.holdScopes?.length === 0 && b?.holdText === null, JSON.stringify(b));
    check("§1d ⭐ K3a eski fason bacağındaki kilit de görünür (KABUL + FATURA birleşir; sevk serbest)", c?.held === true && JSON.stringify(c?.holdScopes) === '["INTAKE","INVOICE"]' && /sevk serbest/.test(c?.holdText ?? ""), JSON.stringify(c));
    const twin = async (cid: string): Promise<string[]> => {
      const out = new Set<string>();
      for (const s of ["INTAKE", "SHIPMENT", "INVOICE"] as const) if (await activeHoldByCustomer(prisma, cid, s)) out.add(s);
      return [...out];
    };
    const prismaA = await twin(A.customerId), prismaB = await twin(B.customerId), prismaC = await twin(C.customerId);
    check(
      "§1e ⭐ SQL ikizi = Prisma ikizi (activeHoldByCustomer, kapsam başına)",
      JSON.stringify(prismaA) === JSON.stringify(a?.holdScopes) && JSON.stringify(prismaB) === JSON.stringify(b?.holdScopes) && JSON.stringify(prismaC) === JSON.stringify(c?.holdScopes),
      `${prismaA}|${prismaB}|${prismaC}`,
    );
    const anyA = await activeHoldByCustomer(prisma, A.customerId);
    check("§1f holdScopes yardımcısı Prisma satırından aynı kapsamı üretir", !!anyA && JSON.stringify(holdScopes(anyA)) === JSON.stringify(a?.holdScopes));

    console.log("── §2 Sevk Kapısı board'u ──");
    const ship = async (customerId: string, no: string): Promise<string> => {
      const s = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-${no}`, customerId }, select: { id: true } });
      ids.shipments.push(s.id);
      return s.id;
    };
    const sA = await ship(A.customerId, "SA");
    const sB = await ship(B.customerId, "SB");
    await prisma.sack.create({ data: { sackNo: `${TAG}-K1`, shipmentId: sA, customerId: A.customerId, weightKg: new Prisma.Decimal("12.500") } });
    await prisma.sack.create({ data: { sackNo: `${TAG}-K2`, shipmentId: sA, customerId: A.customerId, weightKg: new Prisma.Decimal("3.250") } });
    const shipping = new ShippingService();
    const boardPage = await shipping.listSackStoreBoard({ search: TAG, limit: 100 });
    const rows = boardPage.data as Array<Item & { id: string; totalKg: number; totalQty: number }>;
    const rA = rows.find((r) => r.id === sA), rB = rows.find((r) => r.id === sB);
    check("§2 körlük zemini: iki PLANNED sevkiyat board'da", !!rA && !!rB, `${rows.length} satır`);
    check("§2a ⭐ kilitli müşterinin sevkiyatı held + kapsam + çip metni", rA?.held === true && JSON.stringify(rA?.holdScopes) === '["SHIPMENT","INVOICE"]' && /Cari kilitli/.test(rA?.holdText ?? ""), JSON.stringify(rA));
    check("§2b açılmış kilitli müşteride çip yok", rB?.held === false && rB?.holdText === null);
    const g = await prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: sA }, _count: { _all: true }, _sum: { weightKg: true } });
    check("§2c toplamlar groupBy ile aynı (2 çuval · 15.75 kg · 0 top)", rA?.sackCount === g[0]?._count._all && rA?.totalKg === Number(g[0]?._sum.weightKg) && rA?.rollCount === 0 && rA?.totalQty === 0, JSON.stringify(rA));
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT }, create: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT, value: "ALL_HELD" }, update: { value: "ALL_HELD" } });
    const allHeld = (await shipping.listSackStoreBoard({ search: TAG, limit: 100 })).data as Array<Item & { id: string }>;
    check("§2d emanet ayarı ALL_HELD → metin 'emanet dahil sevk durur'", /emanet dahil sevk durur/.test(allHeld.find((r) => r.id === sA)?.holdText ?? ""));

    console.log("── §3 Sorgu bütçesi ──");
    const m1 = await measure(() => svc.listSackCustomers({ search: TAG, scope: "ALL" }));
    check(`§3a ⭐ listSackCustomers (aramalı) = ${CUSTOMERS_BUDGET} sorgu (kilit aynı SQL'de)`, m1.n === CUSTOMERS_BUDGET, `ölçülen=${m1.n}`);
    const m2 = await measure(() => shipping.listSackStoreBoard({ search: TAG, limit: 100 }));
    check(`§3b ⭐ board = ${BOARD_BUDGET} sorgu (toplamlar + kilit tek SQL)`, m2.n === BOARD_BUDGET, `ölçülen=${m2.n}`);
    const m3 = await measure(() => shipping.listSackStoreBoard({ search: `${TAG} B`, limit: 100 }));
    check("§3c kilitsiz sayfada da aynı sayı (kilit varlığı sorgu açmaz)", m3.n === m2.n, `${m3.n} vs ${m2.n}`);
  } finally {
    if (foto) await prisma.systemSetting.update({ where: { key: foto.key }, data: { value: foto.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_CARI_HOLD_EMANET_SHIPMENT } });
    await prisma.sack.deleteMany({ where: { shipmentId: { in: ids.shipments } } });
    await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
    const accIds = accs.map((x) => x.id);
    await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
    await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
