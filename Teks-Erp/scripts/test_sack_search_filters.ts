// =============================================================================
// Bekçi: Çuval listesi DETAYLI FİLTRELER (2026-09-04 saha turu)
// Çalıştır: npx tsx scripts/test_sack_search_filters.ts
//
// Saha şikâyeti: *"Paketleme/Çuvallar ekranında çuvalları süzecek filtre yok."*
// Listede basılan HER olgu kolonunun (Şube · Kg · Not · Tarih) süzgeci eklendi.
//
// Bölümler:
//   §1 Şube (çoklu = VEYA)
//   §2 Tartı durumu (weightKg NULL / NOT NULL) — üç durumlu (filtre yoksa daralma YOK)
//   §3 Not (hasNote) — liste satırındaki `hasNote` ile birebir küme
//   §4 Boş / Dolu — ⭐ HAYALET TOP: "Top: 0" basan çuval "Boş" filtresinde ÇIKMALI
//      (tek kaynak PRESENT_ROLL_WHERE; ayrışırsa liste ile filtre farklı küme der)
//   §5 Tarih aralığı (createdAt | weighedAt) + allowlist dışı alan aralığı DÜŞÜRÜR
//   §6 ⭐ Controller `dateField` YOKKEN createdAt'e düşer (sessiz düşme tuzağı)
//   §7 ⭐ Electron aynası: panelin gönderdiği HER filtre anahtarı controller'da
//      okunuyor mu (okunmayan anahtar = filtre sessizce düşer, YANLIŞ liste)
// =============================================================================
import { readFileSync } from "fs";
import { resolve } from "path";
import prisma from "../src/lib/prisma";
import { SackSearchService, SACK_DATE_FIELDS } from "../src/services/sack-search.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

interface Row {
  id: string;
  rollCount: number;
  hasNote: boolean;
}

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new SackSearchService();

  const customer = await prisma.customer.create({
    data: { code: `TST-FLT-${ts}`, name: `TEST FILTRE MUSTERI ${ts}` },
    select: { id: true },
  });
  const branchA = await prisma.customerBranch.create({
    data: { customerId: customer.id, name: `TEST SUBE A ${ts}`, code: `TSA${ts}` },
    select: { id: true },
  });
  const branchB = await prisma.customerBranch.create({
    data: { customerId: customer.id, name: `TEST SUBE B ${ts}`, code: `TSB${ts}` },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-FLT-I-${ts}`, name: `TEST FILTRE URUN ${ts}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });

  // Beş çuval — hepsi HAVUZDA (varsayılan kapsam), hepsi aynı müşteride.
  const mkSack = (n: number, data: Record<string, unknown>) =>
    prisma.sack.create({
      data: { sackNo: `TEST-FLT-SK${n}-${ts}`, customerId: customer.id, ...data },
      select: { id: true },
    });

  const eski = new Date(Date.now() - 40 * 24 * 3600 * 1000); // 40 gün önce
  const s1 = await mkSack(1, { branchId: branchA.id, weightKg: 25.5, weighedAt: new Date() }); // dolu, tartılı, şubeA
  const s2 = await mkSack(2, { branchId: branchB.id, notes: "ölçü şüpheli" }); // dolu, tartısız, notlu, şubeB
  const s3 = await mkSack(3, {}); // BOŞ (hiç top yok)
  const s4 = await mkSack(4, {}); // yalnız HAYALET top taşır → listede "0 top"
  const s5 = await mkSack(5, { createdAt: eski }); // dolu, ESKİ tarihli
  const sackIds = [s1.id, s2.id, s3.id, s4.id, s5.id];

  const mkRoll = (n: number, sackId: string, status: "WAREHOUSE" | "TAMBUR_CONSUMED") =>
    prisma.roll.create({
      data: {
        barcode: `TEST-FLT-R${n}-${ts}`,
        itemId: item.id,
        status,
        currentQty: 10,
        initialQty: 10,
        width: 150,
        entrySource: "SUPPLIER_RECEIPT",
        sackId,
      },
      select: { id: true },
    });

  const r1 = await mkRoll(1, s1.id, "WAREHOUSE");
  const r2 = await mkRoll(2, s2.id, "WAREHOUSE");
  const r3 = await mkRoll(3, s4.id, "TAMBUR_CONSUMED"); // HAYALET
  const r4 = await mkRoll(4, s5.id, "WAREHOUSE");
  const rollIds = [r1.id, r2.id, r3.id, r4.id];

  const mine = new Set(sackIds);
  const list = async (params: Parameters<SackSearchService["searchSacks"]>[0]): Promise<Row[]> =>
    ((await svc.searchSacks({ customerId: customer.id, limit: 100, ...params })).data as Row[]).filter((r) =>
      mine.has(r.id),
    );
  const idsOf = (rows: Row[]) => rows.map((r) => r.id).sort();
  const same = (rows: Row[], expected: string[]) =>
    JSON.stringify(idsOf(rows)) === JSON.stringify([...expected].sort());

  try {
    // ── §0 Zemin: filtresiz beş çuvalın hepsi geliyor ───────────────────────
    check("§0 Filtresiz liste beş test çuvalını da döndürdü", same(await list({}), sackIds));

    // ── §1 Şube ──────────────────────────────────────────────────────────────
    check("§1 branchId tek değer → yalnız o şubenin çuvalı", same(await list({ branchId: branchA.id }), [s1.id]));
    check(
      "§1 branchId çoklu (VEYA) → iki şube birden",
      same(await list({ branchId: [branchA.id, branchB.id] }), [s1.id, s2.id]),
    );

    // ── §2 Tartı ─────────────────────────────────────────────────────────────
    check("§2 weighed=true → yalnız tartılı çuval", same(await list({ weighed: true }), [s1.id]));
    check(
      "§2 weighed=false → tartısız dördü",
      same(await list({ weighed: false }), [s2.id, s3.id, s4.id, s5.id]),
    );
    check("§2 weighed verilmezse daralma YOK (üç durumlu)", same(await list({ weighed: undefined }), sackIds));

    // ── §3 Not ───────────────────────────────────────────────────────────────
    const notlu = await list({ hasNote: true });
    check("§3 hasNote=true → yalnız notlu çuval", same(notlu, [s2.id]));
    check("§3 Filtre kümesi liste satırındaki hasNote ile birebir", notlu.every((r) => r.hasNote === true));
    check("§3 hasNote=false → notsuz dördü", same(await list({ hasNote: false }), [s1.id, s3.id, s4.id, s5.id]));

    // ── §4 Boş / Dolu (hayalet top) ─────────────────────────────────────────
    const bos = await list({ empty: true });
    check("⭐ §4 empty=true → gerçekten boş ÇUVAL + yalnız hayalet taşıyan çuval", same(bos, [s3.id, s4.id]));
    check(
      "⭐ §4 'Boş' kümesi listedeki rollCount=0 kümesiyle AYNI (tek kaynak PRESENT_ROLL_WHERE)",
      bos.every((r) => r.rollCount === 0) &&
        (await list({})).filter((r) => r.rollCount === 0).length === bos.length,
    );
    check("§4 empty=false → içinde fiziksel top olan üçü", same(await list({ empty: false }), [s1.id, s2.id, s5.id]));

    // ── §5 Tarih aralığı ─────────────────────────────────────────────────────
    const son7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    check(
      "§5 createdAt aralığı eski çuvalı DIŞLADI",
      same(await list({ dateField: "createdAt", dateFrom: son7 }), [s1.id, s2.id, s3.id, s4.id]),
    );
    check(
      "§5 weighedAt aralığı yalnız tartılanı döndürdü (tartısızlar tanım gereği düşer)",
      same(await list({ dateField: "weighedAt", dateFrom: son7 }), [s1.id]),
    );
    check(
      "§5 Allowlist dışı dateField aralığı UYGULAMAZ (fail-open: liste daralmaz)",
      same(await list({ dateField: "updatedAt", dateFrom: son7 }), sackIds),
    );
    check("§5 SACK_DATE_FIELDS allowlist'i iki alan taşıyor", SACK_DATE_FIELDS.join(",") === "createdAt,weighedAt");

    // ── §6 Controller varsayılanı (metin sondası) ───────────────────────────
    // ⚠️ METİN TARAR (bilinçli): `applyDateRange` alan adı olmadan aralığı SESSİZCE
    // yok sayar; uçtan doğrudan `?dateFrom=` gönderen istemcinin filtresi hiç
    // uygulanmadan "sonuç" dönerdi. Varsayılan controller'da yaşar.
    const ctrl = readFileSync(resolve(__dirname, "../src/controllers/shipping.controller.ts"), "utf-8");
    const searchBlock = ctrl.slice(ctrl.indexOf("searchSacks = async"), ctrl.indexOf("listSackCustomers = async"));
    check("⭐ §6 Controller dateField yokken createdAt'e düşüyor", /dateField:[\s\S]{0,240}?"createdAt"/.test(searchBlock));

    // ── §7 Electron aynası: panelin gönderdiği anahtarlar okunuyor mu ────────
    const panelPath = resolve(__dirname, "../../Electron/src/pages/Operations/SackContentEdit/SacksListView.tsx");
    let panel = "";
    try {
      panel = readFileSync(panelPath, "utf-8");
    } catch {
      /* Electron yoksa aşağıda kırmızı */
    }
    const filtersBlock = panel.slice(panel.indexOf("const SACK_FILTERS"), panel.indexOf("interface Props"));
    const panelKeys = [...filtersBlock.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1] as string);
    check("§7 Panel filtre bloğu okundu (en az 8 anahtar)", panelKeys.length >= 8, panelKeys.join(","));
    // numberRange `width` URL'e widthMin/widthMax yazar → controller'da o adlarla aranır.
    const readByController = (k: string) =>
      k === "width"
        ? searchBlock.includes('filt("widthMin")')
        : new RegExp(`filt(Ids)?\\("${k}"\\)`).test(searchBlock);
    const unread = panelKeys.filter((k) => !readByController(k));
    check(
      "⭐ §7 Paneldeki HER filtre anahtarı controller'da okunuyor (okunmayan = sessizce düşen filtre)",
      unread.length === 0,
      unread.length ? `okunmayan: ${unread.join(",")}` : `${panelKeys.length} anahtar`,
    );
    check(
      "§7 Panel tarih aralığı süzgecini de taşıyor (dateRange)",
      /kind:\s*"dateRange"/.test(filtersBlock) && /"weighedAt"/.test(filtersBlock),
    );
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.customerBranch.deleteMany({ where: { id: { in: [branchA.id, branchB.id] } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: customer.id } }).catch(() => {});
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
