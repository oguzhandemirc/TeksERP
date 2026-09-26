// =============================================================================
// TEST: KARTELA OLAY DEFTERİ — tek yazar, DB seddi, mühür, durum backfill'i (K1)
// Çalıştır: npx tsx scripts/test_swatch_event_ledger.ts
// =============================================================================
// Tasarım: docs/design/KARTELA-HAREKET-DEFTERI.md §5. Bütün fikstür TEK bir tx'te
// kurulur ve tx sonunda GERİ ALINIR — kalıntı bırakmaz, teardown gerekmez.
//   §1 doğuş: createSwatchesTx → IN_STOCK + BORN (fromStatus null, kabul no satırda)
//   §2 çuval: SACKED/UNSACKED — çuval no donar, çuvallar arası taşıma iki satır tek grup
//   §3 sevkiyat: SHIPMENT_ADDED → SHIPPED → SHIP_UNDONE (bağlı ters) → SHIPMENT_REMOVED
//   §4 düşüm: REDUCED → REDUCTION_REVERSED (bağlı ters, durum kolonu boşalır)
//   §5 atomik claim: beklenen durumda olmayan kartela GEÇMEZ ve satır yazılmaz
//   §6 kabul iptali: VOIDED, BORN'a bağlı
//   §7 kanal: tablet isteği → TABLET + cihaz kimliği
//   §8 boğaz-ikiz: DB CHECK'inin kabul ettiği (tip, from, to) kümesi = SWATCH_TRANSITIONS
//   §9 DB seddi: belgesiz satır, ileri tipte ters bağ, çift ters REDDEDİLİR
//   §10 mühür: UPDATE ve doğrudan DELETE reddedilir; kartela silinince kaskat geçer
//   §11 backfill: K1 türetmesi ve K2'nin yeniden türetmesi yedi kolon hâlinde doğru durumu
//       verir; K2 statüsü değişen satırın anını NULL'lar; iki migration'ın türetmesi AYNI
//   §13 durum seddi (K2): durumla çelişen kolon yazımı 23514
// =============================================================================

import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Request } from "express";
import { Prisma, ShipmentStatus, SwatchEventType, SwatchStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { runWithRequestContext } from "../src/lib/request-context";
import {
  SWATCH_TRANSITIONS,
  createSwatchesTx,
  transitionSwatchesTx,
} from "../src/services/helpers/swatch-event.helper";
import { ensureTestAdmin } from "./fixture-test-user";

type Tx = Prisma.TransactionClient;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

class GeriAl extends Error {}

const MIGRATION = join(__dirname, "..", "prisma", "migrations", "20260926100000_kartela_olay_defteri", "migration.sql");
const MIGRATION_K2 = join(__dirname, "..", "prisma", "migrations", "20260926110000_kartela_durum_seddi", "migration.sql");

/** Migration'daki türetme ifadesi (CASE … END), takma ad ve boşluk normalize. */
function turetme(sql: string): string {
  const bas = sql.indexOf("(CASE");
  const son = sql.indexOf('END)::"SwatchStatus"', bas);
  return sql.slice(bas, son).replace(/\bsw?\."/g, 'X."').replace(/\s+/g, " ").trim();
}

/** Savepoint içinde dener; DB hatası SQLSTATE'iyle döner, başarı null. */
async function dene(tx: Tx, fn: () => Promise<unknown>): Promise<string | null> {
  await tx.$executeRawUnsafe("SAVEPOINT sp_kdef");
  try {
    await fn();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT sp_kdef");
    return null;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT sp_kdef");
    const m = e instanceof Error ? e.message : String(e);
    const kod = /\b(23\d{3}|42501|P0001)\b/.exec(m)?.[1];
    return kod ?? m.slice(0, 120);
  }
}

function tabletIstegi<T>(adminId: string, fn: () => Promise<T>): Promise<T> {
  const req = {
    device: { id: "d-row", deviceId: "TST-KDEF-TABLET", name: "tablet", machineId: null, kind: "TABLET" },
    user: { userId: adminId },
    ip: "127.0.0.1",
  } as unknown as Request;
  return new Promise<T>((resolve, reject) => {
    runWithRequestContext(req, () => { fn().then(resolve, reject); });
  });
}

async function main(): Promise<void> {
  console.log("=== Kartela olay defteri — tek yazar ve DB seddi ===");
  const ts = Date.now();
  const admin = await ensureTestAdmin();
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!item) throw new Error("Seed fixture eksik: Item PATOS (önce 'npm run seed')");

  const govde = async (tx: Tx): Promise<void> => {
    const sub = await tx.subcontractor.create({ data: { code: `TST-KDEF-${ts}`.slice(0, 32), name: `TEST KDEF FASON ${ts}` } });
    const receipt = await tx.kartelaReceipt.create({ data: { receiptNo: `TST-KR-${ts}`, subcontractorId: sub.id } });
    const customer = await tx.customer.create({ data: { code: `TST-KDEF-${ts}`.slice(0, 32), name: `TEST KDEF MÜŞTERİ ${ts}` } });
    const sackA = await tx.sack.create({ data: { sackNo: `TST-CVA-${ts}` } });
    const sackB = await tx.sack.create({ data: { sackNo: `TST-CVB-${ts}` } });
    const shipment = await tx.shipment.create({ data: { shipmentNo: `TST-SV-${ts}`, customerId: customer.id } });
    const olaylar = (swatchId: string) =>
      tx.swatchEvent.findMany({ where: { swatchId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const durum = async (id: string) => tx.swatch.findUniqueOrThrow({ where: { id } });

    // §1 doğuş
    const dogan = await createSwatchesTx(
      tx,
      [0, 1, 2, 3].map((i) => ({
        cardNumber: `TST-KDEF-${ts}-${i}`, barcode: `TST-KDEFB-${ts}-${i}`,
        itemId: item.id, parentReceiptId: receipt.id,
      })),
      { trigger: "TEST_BORN", userId: admin.id },
    );
    const [a, b, c, d] = dogan.map((s) => s.id);
    const bornA = await olaylar(a);
    const hepsi = await tx.swatchEvent.findMany({ where: { swatchId: { in: [a, b, c, d] } } });
    check("§1 doğuş: dört kartela IN_STOCK, her birine BORN satırı",
      (await durum(a)).status === SwatchStatus.IN_STOCK && hepsi.length === 4 && hepsi.every((e) => e.type === SwatchEventType.BORN));
    check("§1b BORN: fromStatus null, kabul kimliği satırda, tek grup, aktör verilen",
      bornA[0]?.fromStatus === null && bornA[0]?.receiptId === receipt.id
        && new Set(hepsi.map((e) => e.groupId)).size === 1 && bornA[0]?.createdById === admin.id);
    check("§1c bağlamsız çağrı → kanal SYSTEM", bornA[0]?.channel === "SYSTEM", `${bornA[0]?.channel}`);

    // §8 boğaz-ikiz (yazıcılardan ÖNCE: tablo ayrışırsa yazıcı CHECK'e çarpmadan fark adlanır) — DB'nin kabul ettiği her (tip, from, to) üçlüsü tablodaki geçiştir.
    const durumlar: (SwatchStatus | null)[] = [null, ...Object.values(SwatchStatus)];
    const kabul: string[] = [];
    for (const tip of Object.values(SwatchEventType)) {
      for (const from of durumlar) {
        for (const to of Object.values(SwatchStatus)) {
          const hata = await dene(tx, () => tx.$executeRaw`
            INSERT INTO "swatch_events" ("id","swatchId","type","fromStatus","toStatus","groupId","trigger","channel",
              "sackId","shipmentId","receiptId","reductionId")
            VALUES (${randomUUID()}::uuid, ${c}::uuid, ${tip}::"SwatchEventType", ${from}::"SwatchStatus", ${to}::"SwatchStatus",
              ${randomUUID()}::uuid, 'TEST_TWIN', 'SYSTEM', ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid)`);
          if (hata === null) kabul.push(`${tip}:${from ?? "-"}>${to}`);
        }
      }
    }
    const beklenen = Object.entries(SWATCH_TRANSITIONS).map(([t, g]) => `${t}:${g.from ?? "-"}>${g.to}`).sort();
    check("§8 DB CHECK ↔ SWATCH_TRANSITIONS boğaz-ikiz (420 üçlü denendi)",
      JSON.stringify(kabul.sort()) === JSON.stringify(beklenen),
      (() => {
        const yalnizDb = kabul.filter((k) => !beklenen.includes(k));
        const yalnizTablo = beklenen.filter((k) => !kabul.includes(k));
        return `DB ${kabul.length} kabul · tablo ${beklenen.length}`
          + (yalnizDb.length ? ` · yalnız DB: ${yalnizDb.join(", ")}` : "")
          + (yalnizTablo.length ? ` · yalnız tablo: ${yalnizTablo.join(", ")}` : "");
      })());

    // §2 çuval
    await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [a] }, sack: { id: sackA.id, sackNo: sackA.sackNo }, ctx: { trigger: "TEST_SACK" } });
    const grup = randomUUID();
    await transitionSwatchesTx(tx, SwatchEventType.UNSACKED, { scope: { ids: [a] }, sack: { id: sackA.id, sackNo: sackA.sackNo }, ctx: { trigger: "TEST_MOVE", groupId: grup } });
    await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [a] }, sack: { id: sackB.id, sackNo: sackB.sackNo }, ctx: { trigger: "TEST_MOVE", groupId: grup } });
    const evA = await olaylar(a);
    const tasima = evA.filter((e) => e.groupId === grup);
    check("§2 çuvala giriş: IN_SACK, sackId kolonda, çuval no satırda",
      (await durum(a)).sackId === sackB.id && evA[1]?.type === SwatchEventType.SACKED && evA[1]?.sackNo === sackA.sackNo);
    check("§2b çuvallar arası taşıma: UNSACKED(A) + SACKED(B), tek grup, zincir kopmaz",
      tasima.length === 2 && tasima[0].type === SwatchEventType.UNSACKED && tasima[0].sackId === sackA.id
        && tasima[1].type === SwatchEventType.SACKED && tasima[1].sackId === sackB.id
        && evA.every((e, i) => i === 0 || e.fromStatus === evA[i - 1].toStatus));

    // §3 sevkiyat
    const sv = { id: shipment.id, shipmentNo: shipment.shipmentNo };
    await tx.sack.update({ where: { id: sackB.id }, data: { shipmentId: shipment.id } });
    const eklendi = await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_ADDED, { scope: { sackIds: [sackB.id] }, shipment: sv, ctx: { trigger: "TEST_SHIP_ADD" } });
    await transitionSwatchesTx(tx, SwatchEventType.SHIPPED, { scope: { shipmentId: shipment.id }, shipment: sv, ctx: { trigger: "TEST_DISPATCH" } });
    await transitionSwatchesTx(tx, SwatchEventType.SHIP_UNDONE, { scope: { shipmentId: shipment.id }, shipment: sv, ctx: { trigger: "TEST_UNDO", reason: "yanlış araç" } });
    await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_REMOVED, { scope: { shipmentId: shipment.id }, shipment: sv, ctx: { trigger: "TEST_SHIP_CANCEL" } });
    const evA2 = await olaylar(a);
    const shipped = evA2.find((e) => e.type === SwatchEventType.SHIPPED);
    const undone = evA2.find((e) => e.type === SwatchEventType.SHIP_UNDONE);
    check("§3 çuval kapsamıyla sevkiyata: yalnız o çuvalın kartelası geçer", eklendi.length === 1 && eklendi[0].id === a);
    check("§3b sevkiyat satırında çuval + sevkiyat numarası donar",
      shipped?.shipmentNo === shipment.shipmentNo && shipped?.sackNo === sackB.sackNo);
    check("§3c SHIP_UNDONE, SHIPPED satırına BAĞLI ve sebep satırda",
      !!undone && undone.reversesEventId === shipped?.id && undone.reason === "yanlış araç");
    check("§3d sevkiyattan çıkınca çuvalda kalır (IN_SACK, shipmentId boş)",
      (await durum(a)).status === SwatchStatus.IN_SACK && (await durum(a)).shipmentId === null && (await durum(a)).sackId === sackB.id);

    // §4 düşüm
    const R1 = randomUUID();
    const dus = await transitionSwatchesTx(tx, SwatchEventType.REDUCED, { scope: { ids: [b, c] }, reductionId: R1, ctx: { trigger: "TEST_REDUCE", reason: "numune verildi" } });
    const bDus = await durum(b);
    check("§4 düşüm: REDUCED, iptal kolonu dolu, sebep kolonda",
      dus.length === 2 && bDus.status === SwatchStatus.REDUCED && bDus.cancelledAt !== null && bDus.cancelReason === "numune verildi");
    await transitionSwatchesTx(tx, SwatchEventType.REDUCTION_REVERSED, { scope: { ids: [b] }, reductionId: R1, ctx: { trigger: "TEST_REVERSE", reason: "yanlış düşüm" } });
    const bGeri = await durum(b);
    const evB = await olaylar(b);
    const reduced = evB.find((e) => e.type === SwatchEventType.REDUCED);
    const reversed = evB.find((e) => e.type === SwatchEventType.REDUCTION_REVERSED);
    check("§4b storno: IN_STOCK, durum kolonu boşalır, ileri satır DURUR",
      bGeri.status === SwatchStatus.IN_STOCK && bGeri.cancelledAt === null && bGeri.cancelReason === null && !!reduced);
    check("§4c REDUCTION_REVERSED, REDUCED satırına BAĞLI, belge no satırda",
      reversed?.reversesEventId === reduced?.id && reversed?.reductionId === R1);

    // §5 atomik claim
    const once = await tx.swatchEvent.count();
    const tekrarDus = await transitionSwatchesTx(tx, SwatchEventType.REDUCED, { scope: { ids: [c] }, reductionId: randomUUID(), ctx: { trigger: "TEST_REDUCE" } });
    const cuvaldakiDus = await transitionSwatchesTx(tx, SwatchEventType.REDUCED, { scope: { ids: [a] }, reductionId: randomUUID(), ctx: { trigger: "TEST_REDUCE" } });
    const tekrarStorno = await transitionSwatchesTx(tx, SwatchEventType.REDUCTION_REVERSED, { scope: { ids: [b] }, reductionId: R1, ctx: { trigger: "TEST_REVERSE" } });
    check("§5 zaten düşülmüş / çuvaldaki / stornolu kartela geçmez, satır yazılmaz",
      tekrarDus.length === 0 && cuvaldakiDus.length === 0 && tekrarStorno.length === 0 && (await tx.swatchEvent.count()) === once);

    // §6 kabul iptali
    await transitionSwatchesTx(tx, SwatchEventType.VOIDED, { scope: { ids: [d] }, where: { parentReceiptId: receipt.id }, ctx: { trigger: "TEST_VOID", reason: "kabul hatalı" } });
    const evD = await olaylar(d);
    const voided = evD.find((e) => e.type === SwatchEventType.VOIDED);
    check("§6 kabul iptali: VOIDED, BORN'a bağlı, kabul kimliği satırda",
      (await durum(d)).status === SwatchStatus.VOIDED && voided?.reversesEventId === evD[0].id && voided?.receiptId === receipt.id);

    // §7 kanal
    await tabletIstegi(admin.id, () => transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [b] }, sack: { id: sackA.id, sackNo: sackA.sackNo }, ctx: { trigger: "TEST_TABLET" } }));
    const tab = (await olaylar(b)).find((e) => e.trigger === "TEST_TABLET");
    check("§7 tablet isteği → kanal TABLET, cihaz ve aktör bağlamdan",
      tab?.channel === "TABLET" && tab?.deviceId === "TST-KDEF-TABLET" && tab?.createdById === admin.id, `${tab?.channel}`);

    // §9 DB seddi
    const belgesiz = await dene(tx, () => tx.$executeRaw`
      INSERT INTO "swatch_events" ("id","swatchId","type","fromStatus","toStatus","groupId","trigger","channel")
      VALUES (${randomUUID()}::uuid, ${c}::uuid, 'SACKED', 'IN_STOCK', 'IN_SACK', ${randomUUID()}::uuid, 'TEST', 'SYSTEM')`);
    const ileriyeBag = await dene(tx, () => tx.$executeRaw`
      INSERT INTO "swatch_events" ("id","swatchId","type","fromStatus","toStatus","groupId","trigger","channel","sackId","reversesEventId")
      VALUES (${randomUUID()}::uuid, ${c}::uuid, 'SACKED', 'IN_STOCK', 'IN_SACK', ${randomUUID()}::uuid, 'TEST', 'SYSTEM', ${randomUUID()}::uuid, ${bornA[0].id}::uuid)`);
    const ciftTers = await dene(tx, () => tx.$executeRaw`
      INSERT INTO "swatch_events" ("id","swatchId","type","fromStatus","toStatus","groupId","trigger","channel","reductionId","reversesEventId")
      VALUES (${randomUUID()}::uuid, ${b}::uuid, 'REDUCTION_REVERSED', 'REDUCED', 'IN_STOCK', ${randomUUID()}::uuid, 'TEST', 'SYSTEM', ${R1}::uuid, ${reduced!.id}::uuid)`);
    const kanal = await dene(tx, () => tx.$executeRaw`
      INSERT INTO "swatch_events" ("id","swatchId","type","fromStatus","toStatus","groupId","trigger","channel","receiptId")
      VALUES (${randomUUID()}::uuid, ${c}::uuid, 'BORN', NULL, 'IN_STOCK', ${randomUUID()}::uuid, 'TEST', 'WEB', ${receipt.id}::uuid)`);
    check("§9 belgesiz çuval satırı reddedilir (23514)", belgesiz === "23514", `${belgesiz}`);
    check("§9b ileri tipte ters bağ reddedilir (23514)", ileriyeBag === "23514", `${ileriyeBag}`);
    check("§9c aynı ileri satır ikinci kez terslenemez (23505)", ciftTers === "23505", `${ciftTers}`);
    check("§9d tanınmayan kanal reddedilir (23514)", kanal === "23514", `${kanal}`);

    // §10 mühür + kaskat
    const hedef = bornA[0].id;
    const guncelle = await dene(tx, () => tx.$executeRaw`UPDATE "swatch_events" SET "reason" = 'kurcalama' WHERE "id" = ${hedef}::uuid`);
    const sil = await dene(tx, () => tx.$executeRaw`DELETE FROM "swatch_events" WHERE "id" = ${hedef}::uuid`);
    check("§10 defter satırı UPDATE edilemez (42501)", guncelle === "42501", `${guncelle}`);
    check("§10b defter satırı doğrudan DELETE edilemez (42501)", sil === "42501", `${sil}`);
    // Kaskat: kartelayı silen ifade olay satırlarını götürür (mühür yalnız doğrudan DELETE'i reddeder).
    const kaskat = await dene(tx, () => tx.$executeRaw`DELETE FROM "swatches" WHERE "id" = ${c}::uuid`);
    const kalan = await tx.swatchEvent.count({ where: { swatchId: c } });
    check("§10c kartela silinince olay satırları kaskatla gider", kaskat === null && kalan === 0, `${kaskat} · ${kalan}`);

    // §13 durum seddi — tek yazarı atlayan kolon yazımı durumla çelişirse DB reddeder.
    const seddeCarp = await dene(tx, () => tx.$executeRaw`UPDATE "swatches" SET "cancelledAt" = now() WHERE "id" = ${a}::uuid`);
    const voidedaCuval = await dene(tx, () => tx.$executeRaw`UPDATE "swatches" SET "sackId" = ${sackA.id}::uuid WHERE "id" = ${d}::uuid`);
    check("§13 durum seddi: IN_SACK kartelaya iptal damgası ve VOIDED kartelaya çuval → 23514",
      seddeCarp === "23514" && voidedaCuval === "23514", `${seddeCarp} · ${voidedaCuval}`);

    // §11 backfill — kolon hâlleri elle kurulur; sed bu tx'te geçici kaldırılır (tx geri alınır).
    // Ertelenmiş bileşik FK olayları bekliyorken ALTER TABLE reddedilir (55006): önce işlet.
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.$executeRawUnsafe(`ALTER TABLE "swatches" DROP CONSTRAINT "swatches_status_shape"`);
    const k1 = readFileSync(MIGRATION, "utf8");
    const k2 = readFileSync(MIGRATION_K2, "utf8");
    const ifade = (sql: string) => { const b = sql.indexOf('UPDATE "swatches" sw'); return b < 0 ? "" : sql.slice(b, sql.indexOf(";", b) + 1); };
    const liveRed = await tx.swatchStockReduction.create({ data: { itemId: item.id, count: 1, reason: "test" } });
    const deadRed = await tx.swatchStockReduction.create({ data: { itemId: item.id, count: 1, reason: "test", reversedAt: new Date() } });
    const cikan = await tx.shipment.create({ data: { shipmentNo: `TST-SV2-${ts}`, customerId: customer.id, status: ShipmentStatus.DISPATCHED } });
    const sackC = await tx.sack.create({ data: { sackNo: `TST-CVC-${ts}`, shipmentId: cikan.id } });
    const hal = async (n: number, data: Partial<Prisma.SwatchUncheckedCreateInput>) =>
      (await tx.swatch.create({ data: { cardNumber: `TST-KBF-${ts}-${n}`, barcode: `TST-KBFB-${ts}-${n}`, itemId: item.id, ...data } })).id;
    const simdi = new Date();
    const hallar: Array<[string, SwatchStatus]> = [
      [await hal(1, { cancelledAt: simdi }), SwatchStatus.REDUCED],
      [await hal(2, { cancelledAt: simdi }), SwatchStatus.VOIDED],
      [await hal(3, { cancelledAt: simdi }), SwatchStatus.VOIDED],
      [await hal(4, { sackId: sackA.id }), SwatchStatus.IN_SACK],
      [await hal(5, { sackId: sackB.id, shipmentId: shipment.id }), SwatchStatus.IN_SHIPMENT],
      [await hal(6, { sackId: sackC.id, shipmentId: cikan.id }), SwatchStatus.SHIPPED],
      [await hal(7, {}), SwatchStatus.IN_STOCK],
    ];
    await tx.swatchStockReductionItem.create({ data: { reductionId: liveRed.id, swatchId: hallar[0][0] } });
    await tx.swatchStockReductionItem.create({ data: { reductionId: deadRed.id, swatchId: hallar[1][0] } });
    const ids = hallar.map((h) => h[0]);
    const olc = async () => {
      const sonuc = await tx.swatch.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, statusChangedAt: true } });
      return {
        sonuc,
        yanlis: hallar.filter(([id, bek]) => sonuc.find((x) => x.id === id)?.status !== bek)
          .map(([id, bek]) => `${ids.indexOf(id) + 1}: ${sonuc.find((x) => x.id === id)?.status} ≠ ${bek}`),
      };
    };
    await tx.$executeRawUnsafe(ifade(k1));
    const r1 = await olc();
    check("§11 K1 backfill yedi kolon hâlinde doğru durumu türetir (düşüm · stornolu düşüm · iptal · çuval · sevkiyat · çıkmış · stok)",
      ifade(k1) !== "" && r1.yanlis.length === 0, r1.yanlis.length ? r1.yanlis.join(" · ") : "7/7");
    // K1→K2 sapması: eski yazar durumu güncellemeden kolon yazmış → K2 yeniden türetir.
    await tx.swatch.updateMany({ where: { id: { in: ids } }, data: { status: SwatchStatus.IN_STOCK, statusChangedAt: simdi } });
    await tx.$executeRawUnsafe(ifade(k2));
    const r2 = await olc();
    const anSifir = r2.sonuc.filter((x) => x.status !== SwatchStatus.IN_STOCK).every((x) => x.statusChangedAt === null)
      && r2.sonuc.find((x) => x.id === hallar[6][0])?.statusChangedAt?.getTime() === simdi.getTime();
    check("§11b K2 yeniden türetmesi aynı sonucu verir; statüsü değişen satırın anı NULL, değişmeyene dokunulmaz",
      ifade(k2) !== "" && r2.yanlis.length === 0 && anSifir, r2.yanlis.length ? r2.yanlis.join(" · ") : `7/7 · an ${anSifir ? "doğru" : "YANLIŞ"}`);
    check("§11c K1 ve K2 türetme ifadesi birebir aynı (boğaz-ikiz)", turetme(k1) !== "" && turetme(k1) === turetme(k2));

    throw new GeriAl("fikstür geri alınır");
  };

  try {
    await prisma.$transaction(govde, { timeout: 120_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof GeriAl)) throw e;
  }
  const kalinti = await prisma.swatch.count({ where: { cardNumber: { startsWith: `TST-KDEF-${ts}` } } });
  check("§12 tx geri alındı — kalıntı yok", kalinti === 0, `${kalinti}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await prisma.$disconnect();
  process.exit(1);
});
