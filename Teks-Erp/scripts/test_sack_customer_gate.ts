// =============================================================================
// Bekçi: Cari kapısı (Paketleme/Çuvallar giriş adımı) + "müşterisiz" süzgeci
// Çalıştır: DATABASE_URL=… npx tsx scripts/test_sack_customer_gate.ts
//
// NEDEN VAR (ölçüm, tekserp_demo 2026-09-04): fabrikada 43 aktif cari, depoda
// çuvalı olan 4 cari; depodaki 9 çuvalın 4'ü MÜŞTERİSİZ. Yani cari kapısı
// katalogdan beslenirse operatör 39 boş seçenek arasında dolaşır, müşterisiz
// kova da hiçbir yüzeyden süzülemediği için (%44) sessizce kaybolur.
//
// Ölçülenler:
//   §1 Kapı yalnız KAPSAMDA ÇUVALI OLAN carileri döner (katalog değil).
//   §2 Müşterisiz kovası AYRI SATIR, İLK sırada, doğru sayıyla.
//   §3 Arama ada/koda vurur; müşterisiz satır arama varken DÖNMEZ.
//   §4 `filter[customerId]=none` → yalnız müşterisiz çuvallar (P2007 YOK).
//   §5 `none,<uuid>` → aynı alan içinde VEYA.
//   §6 Kapı sayısı ile liste satır sayısı AYNI (tek kaynak `resolveScopeOr`).
//   §7 Varsayılan kapsam DISPATCHED çuvalı iki yüzeyde de dışlar.
// =============================================================================
import prisma from "../src/lib/prisma";
import { SackSearchService, CUSTOMERLESS_FILTER_VALUE } from "../src/services/sack-search.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

type Row = { id: string; customer: { id: string; name: string } | null };

async function main() {
  const ts = Date.now();
  const svc = new SackSearchService();

  // A cari: 2 depo çuvalı · B cari: 1 depo çuvalı · C cari: HİÇ çuvalı yok
  // (katalogda var — kapıda GÖRÜNMEMELİ) · müşterisiz: 3 depo çuvalı
  // · A carinin 1 çuvalı DISPATCHED sevkiyatta (varsayılan kapsam dışı).
  const [cA, cB, cC] = await Promise.all([
    prisma.customer.create({ data: { code: `TST-GATE-A-${ts}`, name: `ZZKAPI ALFA ${ts}` }, select: { id: true, name: true } }),
    prisma.customer.create({ data: { code: `TST-GATE-B-${ts}`, name: `ZZKAPI BETA ${ts}` }, select: { id: true, name: true } }),
    prisma.customer.create({ data: { code: `TST-GATE-C-${ts}`, name: `ZZKAPI CEVIZ ${ts}` }, select: { id: true, name: true } }),
  ]);
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `TEST-GATE-${ts}`, customerId: cA.id, status: "DISPATCHED" },
    select: { id: true },
  });

  const mkSack = (n: number, customerId: string | null, shipmentId: string | null = null, seq: number | null = null) =>
    prisma.sack.create({
      data: { sackNo: `TEST-GATE-SK${n}-${ts}`, customerId, shipmentId, seq },
      select: { id: true },
    });

  const sacks = await Promise.all([
    mkSack(1, cA.id),
    mkSack(2, cA.id),
    mkSack(3, cB.id),
    mkSack(4, null),
    mkSack(5, null),
    mkSack(6, null),
    mkSack(7, cA.id, shipment.id, 1), // sevk edilmiş → varsayılan kapsam dışı
  ]);
  const sackIds = sacks.map((s) => s.id);
  const mine = new Set(sackIds);

  try {
    // ── §1 Kapı: yalnız çuvalı olan cariler ────────────────────────────────
    const gate = (await svc.listSackCustomers({})).data.filter(
      (r) => r.customerId === null || [cA.id, cB.id, cC.id].includes(r.customerId),
    );
    const gA = gate.find((r) => r.customerId === cA.id);
    const gB = gate.find((r) => r.customerId === cB.id);
    const gC = gate.find((r) => r.customerId === cC.id);
    check("§1 Çuvalı olan cari kapıda var (A)", !!gA, `sackCount=${gA?.sackCount}`);
    check("§1 Çuvalı olan cari kapıda var (B)", !!gB, `sackCount=${gB?.sackCount}`);
    check("⭐ §1 ÇUVALI OLMAYAN cari kapıda YOK (katalog değil)", !gC);
    check("§1 A carisinin sayısı sevk edilmişi SAYMAZ (2, 3 değil)", gA?.sackCount === 2, String(gA?.sackCount));

    // ── §2 Müşterisiz kovası ───────────────────────────────────────────────
    const full = (await svc.listSackCustomers({})).data;
    const none = full.find((r) => r.customerId === null);
    check("⭐ §2 Müşterisiz kovası AYRI SATIR olarak dönüyor", !!none);
    check("§2 Müşterisiz satırı İLK sırada", full[0]?.customerId === null, full[0]?.name);
    check(
      "§2 Müşterisiz sayısı bu koşumun 3 çuvalını içeriyor",
      (none?.sackCount ?? 0) >= 3,
      String(none?.sackCount),
    );
    check("§2 Müşterisiz satırın adı Türkçe ve açık", none?.name === "Müşterisiz (genel stok)", none?.name);

    // ── §3 Arama ───────────────────────────────────────────────────────────
    const searched = (await svc.listSackCustomers({ search: `ZZKAPI ALFA ${ts}` })).data;
    check("§3 Arama cariye vuruyor", searched.some((r) => r.customerId === cA.id), `${searched.length} satır`);
    check("§3 Arama diğer cariyi eliyor", !searched.some((r) => r.customerId === cB.id));
    check("⭐ §3 Arama varken müşterisiz satır DÖNMEZ (adı yok, eşleşmiyor)", !searched.some((r) => r.customerId === null));
    const byCode = (await svc.listSackCustomers({ search: `TST-GATE-B-${ts}` })).data;
    check("§3 Arama KODA da vuruyor", byCode.some((r) => r.customerId === cB.id));

    // ── §4 "none" sentineli ────────────────────────────────────────────────
    let p2007 = "";
    let noneRows: Row[] = [];
    try {
      noneRows = ((await svc.searchSacks({ customerId: CUSTOMERLESS_FILTER_VALUE, limit: 100 })).data as Row[])
        .filter((r) => mine.has(r.id));
    } catch (e) {
      p2007 = String((e as { code?: string }).code ?? (e as Error).message);
    }
    check("⭐ §4 `none` süzgeci Prisma P2007 ÜRETMİYOR", p2007 === "", p2007);
    check("§4 `none` yalnız müşterisiz çuvalları döner", noneRows.length === 3 && noneRows.every((r) => r.customer === null), `${noneRows.length} satır`);

    // ── §5 none + uuid → VEYA ──────────────────────────────────────────────
    const mixed = ((await svc.searchSacks({ customerId: `${CUSTOMERLESS_FILTER_VALUE},${cB.id}`, limit: 100 })).data as Row[])
      .filter((r) => mine.has(r.id));
    check(
      "⭐ §5 `none,<uuid>` aynı alan içinde VEYA (3 müşterisiz + 1 B)",
      mixed.length === 4 && mixed.some((r) => r.customer?.id === cB.id) && mixed.filter((r) => r.customer === null).length === 3,
      `${mixed.length} satır`,
    );

    // ── §6 Kapı sayısı ↔ liste satır sayısı ────────────────────────────────
    const listA = ((await svc.searchSacks({ customerId: cA.id, limit: 100 })).data as Row[]).filter((r) => mine.has(r.id));
    check(
      "⭐ §6 Kapıdaki sayı ile listedeki satır sayısı AYNI (tek kaynak kapsam)",
      listA.length === gA?.sackCount,
      `liste=${listA.length} kapı=${gA?.sackCount}`,
    );

    // ── §7 Varsayılan kapsam DISPATCHED'i iki yüzeyde de dışlar ────────────
    check("§7 Liste sevk edilmiş çuvalı varsayılan kapsamda göstermiyor", !listA.some((r) => r.id === sacks[6]!.id));
    const gateAll = (await svc.listSackCustomers({ scope: "ALL" })).data.find((r) => r.customerId === cA.id);
    check("§7 scope=ALL verilince sevk edilmiş de sayılıyor (3)", gateAll?.sackCount === 3, String(gateAll?.sackCount));
  } finally {
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.delete({ where: { id: shipment.id } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: [cA.id, cB.id, cC.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
