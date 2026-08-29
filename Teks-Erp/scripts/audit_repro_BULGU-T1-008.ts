// =============================================================================
// AUDIT REPRO — BULGU-T1-008: İçe aktarımın replay anahtarı (`ImportRun` satırı)
//   döngüden SONRA yazılıyor. Token kapısı (`importRun.findUnique`) koşumun
//   BAŞINDA okunuyor → koşum sürerken gelen ikinci istek kapıyı BOŞ bulur ve
//   dosyayı BAŞTAN yazar. `order` adaptörü create-only + doğal anahtarsız
//   (`updateOne` throw eder, `findExisting` boş döner) → AYNI DOSYADAN N KOPYA.
//
//   D-B-05'in ölçekli ve zamanlamalı sürümü:
//     §1  N=2 / 5 / 10 eşzamanlı apply, her N için 10 tekrar → bozulma sayısı
//     §2  GERÇEK SAHA SENARYOSU: 1. koşum satırları yazarken (uçuşta) 2. istek
//         gelir (istemci zaman aşımı → "Tekrar Dene") — token AYNI
//     §3  ZAMANLAMA: satır başına gerçek maliyet ölçülür → Electron'un 15 sn'lik
//         `apiClient` tavanı KAÇ SATIRDA aşılır (pencerenin fiilen açıldığı eşik)
//
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): aynı token ile N eşzamanlı apply → 1 sipariş.
// Gözlenen: çalıştırınca doldur — log audit/repro/BULGU-T1-008.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_BULGU-T1-008.ts
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
  } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db")
    throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();

import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { ItemType } from "@prisma/client";
import { ImportService } from "../src/services/import/import.service";

const STAMP = `AUDITREPRO-BULGU-T1-008-${randomUUID().slice(0, 6).toUpperCase()}`;
const FILE_STAMP = `${STAMP}.xlsx`; // import_runs temizliği bu damgadan yapılır
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

let itemCode = "";
let custId = "";

/** R kalemlik (R AYRI sipariş referanslı) sanal dosya. */
function makeRows(prefix: string, r: number, custCode: string): Array<{ rowNo: number; cells: Record<string, string> }> {
  return Array.from({ length: r }, (_, i) => ({
    rowNo: i + 2,
    cells: { ref: `${prefix}-${i}`, customerCode: custCode, itemCode, quantity: "1200" },
  }));
}

async function ordersOf(prefixLike: string): Promise<number> {
  // Sipariş referansı bizde SAKLANMAZ → sayım müşteri üzerinden yapılır.
  return prisma.order.count({ where: { customerId: custId } });
}

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO BULGU-T1-008 — içe aktarım replay anahtarı sonda (${STAMP}) ===\n`);
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  itemCode = `AT8I${STAMP.slice(-5)}`;
  const custCode = `AT8C${STAMP.slice(-5)}`;
  await prisma.item.create({ data: { code: itemCode, name: `${STAMP} KUMAS`, itemType: ItemType.FABRIC } });
  const cust = await prisma.customer.create({ data: { code: custCode, name: `${STAMP} MUSTERI` } });
  custId = cust.id;

  // ── §1  N=2 / 5 / 10 eşzamanlı apply × 10 tekrar ─────────────────────────
  console.log("── §1  Aynı token ile N eşzamanlı apply (10 tekrar) ──");
  const REPEATS = 10;
  const summary: Array<{ n: number; bozuk: number; toplamFazla: number; maxKopya: number }> = [];
  for (const N of [2, 5, 10]) {
    let bozuk = 0;
    let toplamFazla = 0;
    let maxKopya = 0;
    for (let rep = 0; rep < REPEATS; rep++) {
      const token = randomUUID();
      const pre = await ordersOf("");
      const rows = makeRows(`${STAMP}-N${N}-R${rep}`, 1, custCode);
      await Promise.allSettled(
        Array.from({ length: N }, () =>
          ImportService.apply("order", rows, { clientToken: token, mode: "upsert", fileName: FILE_STAMP }, user?.id),
        ),
      );
      // Ölçüm COMMIT SONRASI, DB'DEN.
      const post = await ordersOf("");
      const yazilan = post - pre;
      const runs = await prisma.importRun.count({ where: { clientToken: token } });
      if (yazilan > 1) { bozuk++; toplamFazla += yazilan - 1; }
      maxKopya = Math.max(maxKopya, yazilan);
      if (rep === 0) info(`N=${N} rep0: 1 satırlık dosya → ${yazilan} sipariş yazıldı, ImportRun satırı=${runs}`);
    }
    summary.push({ n: N, bozuk, toplamFazla, maxKopya });
    if (bozuk > 0) bad(`N=${N}: ${REPEATS} tekrarın ${bozuk}'inde değişmez bozuldu (fazladan ${toplamFazla} sipariş, en kötü tekrarda ${maxKopya} kopya)`);
    else ok(`N=${N}: ${REPEATS} tekrarın hiçbirinde mükerrer yazım yok`);
  }

  // ── §2  Gerçek saha senaryosu: UÇUŞTAKİ koşuma ikinci istek ──────────────
  console.log("\n── §2  1. koşum satırları yazarken 2. istek gelir (istemci 'Tekrar Dene') ──");
  {
    const token = randomUUID();
    // ⚠️ Dosya, gecikmeden UZUN sürecek kadar büyük olmalı — yoksa 2. istek
    // koşum BİTTİKTEN sonra gelir, replay dalına düşer ve sonda "koruma
    // çalıştı" gibi görünür (ilk yazımda tam bu oldu: 12 satır ≈ 60 ms < 120 ms).
    const rows = makeRows(`${STAMP}-INFLIGHT`, 150, custCode); // 150 kalem ≈ 700 ms
    const pre = await ordersOf("");
    const p1 = ImportService.apply("order", rows, { clientToken: token, mode: "upsert", fileName: FILE_STAMP }, user?.id);
    await new Promise((r) => setTimeout(r, 150)); // 1. koşum HÂLÂ döngüde
    const p2 = ImportService.apply("order", rows, { clientToken: token, mode: "upsert", fileName: FILE_STAMP }, user?.id);
    const [r1, r2] = await Promise.allSettled([p1, p2]);
    const post = await ordersOf("");
    const yazilan = post - pre;
    const say = (r: PromiseSettledResult<unknown>): string =>
      r.status === "fulfilled"
        ? `OK status=${(r.value as { status: string }).status} created=${(r.value as { created: number }).created}`
        : `REJECT ${(r.reason as { code?: string }).code ?? String((r.reason as Error).message).slice(0, 60)}`;
    info(`apply#1=${say(r1)} · apply#2=${say(r2)}`);
    // Defterin ne DEDİĞİ ile ne OLDUĞU: tek `ImportRun` satırı kalır, sayaçları
    // yalnız kendi koşumunu anlatır → "ne yazıldı" sorusu cevapsız kalır.
    const run = await prisma.importRun.findFirst({ where: { clientToken: token }, select: { status: true, created: true, rowCount: true } });
    info(`ImportRun defteri: satır=${run ? 1 : 0} status=${run?.status ?? "-"} created=${run?.created ?? "-"} rowCount=${run?.rowCount ?? "-"} · DB'de FİİLEN ${yazilan} sipariş`);
    const gordugu = r1.status === "rejected" || r2.status === "rejected" ? "HATA" : "başarı";
    if (yazilan > rows.length)
      bad(`${rows.length} satırlık dosya → ${yazilan} sipariş yazıldı (${yazilan - rows.length} fazladan); kullanıcı ${gordugu} gördü; defter ${run?.created ?? "-"} diyor`);
    else ok(`${rows.length} satırlık dosya → ${yazilan} sipariş (koruma çalıştı)`);
  }

  // ── §3  Zamanlama: 15 sn'lik istemci tavanı kaç satırda aşılır ───────────
  console.log("\n── §3  Satır başına gerçek maliyet → Electron 15 sn tavanı (apiClient.ts:44) ──");
  {
    const olcum: Array<{ r: number; ms: number }> = [];
    for (const R of [1, 5, 20]) {
      const t0 = Date.now();
      await ImportService.apply(
        "order",
        makeRows(`${STAMP}-T${R}`, R, custCode),
        { clientToken: randomUUID(), mode: "upsert", fileName: FILE_STAMP },
        user?.id,
      );
      olcum.push({ r: R, ms: Date.now() - t0 });
    }
    olcum.forEach((o) => info(`${String(o.r).padStart(2)} satır → ${o.ms} ms (${(o.ms / o.r).toFixed(1)} ms/satır)`));
    // Marjinal maliyet = (t20 - t1) / 19 → sabit gideri düşer.
    const t1 = olcum[0].ms, t20 = olcum[2].ms;
    const marjinal = (t20 - t1) / (20 - 1);
    const esik = marjinal > 0 ? Math.floor((15_000 - t1) / marjinal) : -1;
    info(`marjinal maliyet ≈ ${marjinal.toFixed(1)} ms/satır → 15.000 ms tavanı ≈ ${esik} satırda aşılır`);
    if (esik > 0 && esik < 10_000)
      bad(`pencere ULAŞILABİLİR: ${esik} satırlık bir sipariş dosyası 15 sn'yi aşar; motorun satır tavanı 10.000 (assertRowLimit)`);
    else ok(`15 sn tavanı satır tavanının (10.000) altında aşılmıyor — pencere pratikte kapalı`);
  }

  console.log("\n── ÖZET ──");
  summary.forEach((s) => info(`N=${s.n}: ${s.bozuk}/${REPEATS} tekrar bozuk · fazladan ${s.toplamFazla} sipariş · en kötü ${s.maxKopya} kopya`));
  console.log(`\n=== SONUÇ: ${fail} kırmızı ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error("REPRO HATASI:", e); process.exitCode = 2; })
  .finally(async () => {
    try {
      const items = await prisma.item.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const custs = await prisma.customer.findMany({ where: { name: { startsWith: STAMP } }, select: { id: true } });
      const itemIds = items.map((i) => i.id);
      const custIds = custs.map((c) => c.id);
      const orders = await prisma.order.findMany({ where: { customerId: { in: custIds } }, select: { id: true } });
      const orderIds = orders.map((o) => o.id);
      if (orderIds.length) {
        await prisma.orderLineRequiredProperty.deleteMany({ where: { orderLine: { orderId: { in: orderIds } } } });
        await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      const runs = await prisma.importRun.deleteMany({ where: { fileName: FILE_STAMP } });
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...custIds, ...orderIds] } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
      console.log(`temizlik tamam (${orderIds.length} sipariş, ${runs.count} import_runs, ${itemIds.length} kumaş, ${custIds.length} müşteri)`);
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
