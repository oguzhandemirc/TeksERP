// =============================================================================
// AUDIT REPRO — D-B-05: İçe aktarım `clientToken` idempotency'si YALNIZ
//   TAMAMLANMIŞ koşumu korur. `ImportRun` satırı döngüden SONRA yazıldığı için
//   UÇUŞTAKİ bir tekrar (istemci zaman aşımı → yeniden gönder) ikinci koşumu da
//   başlatır; ikisi de yazar. `order` adaptörü create-only + doğal anahtarsız →
//   AYNI DOSYADAN İKİ SİPARİŞ.
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER.
// Beklenen (sağlıklı sistem): aynı token ile 2 eşzamanlı apply → 1 sipariş.
// Gözlenen: çalıştırınca doldur — log audit/repro/D-B-05.log
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_D-B-05.ts
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

const STAMP = `AUDITREPRO-D-B-05-${randomUUID().slice(0, 6).toUpperCase()}`;
let fail = 0;
const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => { fail++; console.log(`❌ ${m}`); };
const info = (m: string) => console.log(`   ${m}`);

async function main(): Promise<void> {
  console.log(`\n=== AUDIT REPRO D-B-05 — import token'ı uçuştaki tekrarı kapatmıyor (${STAMP}) ===\n`);
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const itemCode = `AR5I${STAMP.slice(-5)}`;
  const custCode = `AR5C${STAMP.slice(-5)}`;
  await prisma.item.create({ data: { code: itemCode, name: `${STAMP} KUMAS`, itemType: ItemType.FABRIC } });
  await prisma.customer.create({ data: { code: custCode, name: `${STAMP} MUSTERI` } });

  const rows = [
    { rowNo: 2, cells: { ref: `${STAMP}-REF1`, customerCode: custCode, itemCode, quantity: "1200" } },
  ];
  const token = randomUUID();

  // İKİ EŞZAMANLI apply — aynı token (istemci zaman aşımı sonrası yeniden gönderim).
  const res = await Promise.allSettled([
    ImportService.apply("order", rows, { clientToken: token, mode: "upsert" }, user?.id),
    ImportService.apply("order", rows, { clientToken: token, mode: "upsert" }, user?.id),
  ]);
  res.forEach((r, i) => {
    if (r.status === "fulfilled") {
      const v = r.value as { runId: string; created: number; status: string };
      info(`apply#${i}: status=${v.status} created=${v.created} runId=${v.runId.slice(0, 8)}`);
    } else {
      const e = r.reason as { code?: string; statusCode?: number; message?: string };
      info(`apply#${i}: REJECT code=${e.code ?? "-"} status=${e.statusCode ?? "-"} msg=${String(e.message).replace(/\n/g, " ").slice(0, 140)}`);
    }
  });

  // Ölçüm COMMIT SONRASI, DB'DEN.
  const cust = await prisma.customer.findUnique({ where: { code: custCode }, select: { id: true } });
  const orders = await prisma.order.findMany({
    where: { customerId: cust!.id },
    select: { id: true, orderNumber: true, lines: { select: { quantity: true } } },
  });
  const runs = await prisma.importRun.count({ where: { clientToken: token } });
  if (orders.length > 1) {
    bad(`aynı token ile 2 eşzamanlı apply → ${orders.length} SİPARİŞ: ${orders.map((o) => o.orderNumber).join(", ")}`);
    info(`ImportRun satırı: ${runs} (ikinci koşumun izi yok — audit'te de yok)`);
  } else {
    ok(`aynı token ile 2 eşzamanlı apply → ${orders.length} sipariş (koruma çalıştı)`);
  }

  // ── §2 Sıralı (uçuş bitmiş) tekrar: token gerçekten koruyor mu? ──────────
  console.log("");
  const rows2 = [{ rowNo: 2, cells: { ref: `${STAMP}-REF2`, customerCode: custCode, itemCode, quantity: "999" } }];
  const token2 = randomUUID();
  await ImportService.apply("order", rows2, { clientToken: token2, mode: "upsert" }, user?.id);
  const before = await prisma.order.count({ where: { customerId: cust!.id } });
  // AYNI token, FARKLI gövde (başka dosya) — sözleşme: 409 beklenir mi, yoksa
  // önceki koşumun sonucu mu döner ("yeni veri yutulur", beceri §8 4. durum)?
  const rows3 = [{ rowNo: 2, cells: { ref: `${STAMP}-REF3`, customerCode: custCode, itemCode, quantity: "77" } }];
  const r3 = await ImportService.apply("order", rows3, { clientToken: token2, mode: "upsert" }, user?.id);
  const after = await prisma.order.count({ where: { customerId: cust!.id } });
  if (after === before && (r3 as { created: number }).created > 0) {
    bad(`aynı token FARKLI gövde → yanıt "created=${(r3 as { created: number }).created}" ama DB'ye HİÇBİR ŞEY yazılmadı (sessiz yutma)`);
  } else {
    ok(`aynı token farklı gövde → sipariş sayısı ${before}→${after}, yanıt created=${(r3 as { created: number }).created}`);
  }

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
      await prisma.importRun.deleteMany({ where: { fileName: null, userId: { in: [] } } }); // no-op guard
      await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: itemIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...custIds, ...orderIds] } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
      console.log("temizlik tamam (import_runs damgasız — elle bakılabilir)");
    } catch (e) {
      console.error("TEMİZLİK HATASI (elle bak):", (e as Error).message, "damga:", STAMP);
    }
    await prisma.$disconnect();
  });
