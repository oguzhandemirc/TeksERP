// =============================================================================
// BEKÇİ — BAYAT VERİ KORUMASI: sipariş + cari PATCH'inde isteğe bağlı `expectedUpdatedAt` (V4a, 2026-11-13)
// =============================================================================
// Koşum: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_bayat_veri_korumasi.ts
//
//   §1 ⭐ alan YOKKEN eski davranış: başlık + kalem güncellemesi geçer, alan DB'ye sızmaz; bozuk ISO 400
//   §2 doğru sürümle geçer (sipariş başlık · sipariş kalem · kısmi sevkli sipariş termini · cari)
//   §3 bayat sürümle 409 `details.code = STALE_RECORD`, kayıt değişmez (sipariş · kısmi sevkli · cari)
//   §4 ⭐ kalem değişikliği sürümü ilerletir: kalem-yalnız yazım (renk/ad düzeltmesi yolu) eski sürümü bayatlatır;
//      sürüm = başlık + kalemlerin en büyük updatedAt'i (`contentUpdatedAt`), başlık updatedAt'i tek başına bayattır
//   §5 ⭐ eşzamanlı iki yazım: aynı sürümle yalnız biri geçer (Promise.all) + kilit tutan elle açık tx
//      arkasında bekleyen yazım, tx sürümü ilerletince STALE alır (sipariş · cari)
//   §6 mikro saniyeli DB değeri ms'ye kesilmiş sürümle eşleşir; cari `isActive:false` + sürüm 400
//
// ⭐ NEGATİF SONDA (2026-11-13, ölçüldü): `claimOrderVersionTx` çağrısı kaldırıldı → 8 ❌ (§3a §3b §4b §4c §4d §4f
//    §5a §5b); `orderContentVersionWhere`den `lines.none` çıkarıldı → 4 ❌ (§4b–§4e); caride `updateCore`a
//    versionWhere geçirilmedi → 4 ❌ (§3c §3d §5c §5d). Geri alındı.
// =============================================================================
import { ItemUnit, OrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import { customerService } from "../src/routes/customer.routes";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";

const TAG = `TST-BAYAT-${process.pid}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
/** "geçti" | "409:STALE_RECORD" | "400:VALIDATION_ERROR" | "<status>" */
async function sonuc(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
    if (!err.statusCode) return String(err.message).slice(0, 120);
    return err.details?.code ? `${err.statusCode}:${err.details.code}` : String(err.statusCode);
  }
}
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Elle açık tx'in satır kilidinde BEKLEYEN bir oturum görülene dek yokla (en çok 5 sn). */
async function kilitteBekleyen(): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const r = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(r[0]?.n ?? 0) > 0) return true;
    await bekle(100);
  }
  return false;
}

const orderIds: string[] = [];
const customerIds: string[] = [];

async function cleanup(): Promise<void> {
  const ids = [...orderIds, ...customerIds];
  if (ids.length) await prisma.systemLog.deleteMany({ where: { recordId: { in: ids } } });
  if (orderIds.length) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
}

type OrderDto = { id: string; updatedAt: Date; contentUpdatedAt?: Date; deadline: Date | null; lines: Array<{ id: string; itemId: string; quantity: unknown; updatedAt: Date }> };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== BAYAT VERİ KORUMASI BEKÇİSİ ===\n");
  const admin = await ensureTestAdmin();
  try {
    const customer = await prisma.customer.create({ data: { code: `${TAG}-CUS`, name: `${TAG} müşteri` }, select: { id: true } });
    customerIds.push(customer.id);
    const mt = await prisma.item.create({ data: { code: `${TAG}-MT`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: ItemUnit.MT }, select: { id: true } });
    const yarat = async (): Promise<string> => {
      const r = (await orderService.create({ customerId: customer.id, lines: [{ itemId: mt.id, quantity: 100 }, { itemId: mt.id, quantity: 50 }] }, admin.id)) as { data: { id: string } };
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const detay = async (id: string) => ((await orderService.findById(id)) as unknown as { data: OrderDto }).data;
    const surum = async (id: string) => (await detay(id)).contentUpdatedAt!.toISOString();
    const kalemler = (o: OrderDto, q0: number, q1: number) => [
      { id: o.lines[0]!.id, itemId: mt.id, quantity: q0 },
      { id: o.lines[1]!.id, itemId: mt.id, quantity: q1 },
    ];
    const termin = (gun: number) => new Date(Date.now() + gun * 86_400_000).toISOString();

    // ── §1 alan yokken ──
    console.log("── §1 alan yokken eski davranış ──");
    const o1 = await yarat();
    const d1 = await detay(o1);
    check("§1a detay yanıtı `contentUpdatedAt` taşır (Date)", d1.contentUpdatedAt instanceof Date);
    check("§1b sürümsüz başlık güncellemesi geçer", (await sonuc(() => orderService.update(o1, { deadline: termin(10) }, admin.id))) === "geçti");
    check("§1c sürümsüz kalem güncellemesi geçer", (await sonuc(async () => orderService.update(o1, { lines: kalemler(await detay(o1), 120, 50) }, admin.id))) === "geçti");
    check("§1d `expectedUpdatedAt: null` = gönderilmemiş (geçer)", (await sonuc(() => orderService.update(o1, { deadline: termin(11), expectedUpdatedAt: null }, admin.id))) === "geçti");
    check("§1e bozuk ISO 400 VALIDATION_ERROR", (await sonuc(() => orderService.update(o1, { deadline: termin(12), expectedUpdatedAt: "dün" }, admin.id))) === "400:VALIDATION_ERROR");
    check("§1f cari: sürümsüz güncelleme geçer", (await sonuc(() => customerService.update(customer.id, { contactName: "A" }, admin.id))) === "geçti");

    // ── §2 doğru sürüm ──
    console.log("\n── §2 doğru sürümle geçer ──");
    const v2 = await surum(o1);
    const r2 = (await orderService.update(o1, { deadline: termin(13), expectedUpdatedAt: v2 }, admin.id)) as unknown as { data: OrderDto };
    check("§2a sipariş başlığı doğru sürümle geçer, yanıt yeni sürüm verir", r2.data.contentUpdatedAt instanceof Date && r2.data.contentUpdatedAt.toISOString() > v2);
    const r2b = (await orderService.update(o1, { lines: kalemler(await detay(o1), 130, 50), expectedUpdatedAt: r2.data.contentUpdatedAt!.toISOString() }, admin.id)) as unknown as { data: OrderDto };
    check("§2b yanıttaki sürümle zincir: kalem güncellemesi geçer", Number((await detay(o1)).lines.find((l) => l.id === r2b.data.lines[0]!.id)?.quantity) === 130);
    const cust0 = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
    const rc = (await customerService.update(customer.id, { contactName: "B", expectedUpdatedAt: cust0.updatedAt.toISOString() }, admin.id)) as { data: { contactName: string; updatedAt: Date } };
    check("§2c cari doğru sürümle geçer, yanıt yeni updatedAt verir", rc.data.contactName === "B" && rc.data.updatedAt.getTime() > cust0.updatedAt.getTime());

    const oP = await yarat();
    await prisma.order.update({ where: { id: oP }, data: { status: OrderStatus.PARTIAL_SHIPPED } });
    const vP = await surum(oP);
    check("§2d kısmi sevkli sipariş termini doğru sürümle geçer", (await sonuc(() => orderService.update(oP, { deadline: termin(20), expectedUpdatedAt: vP }, admin.id))) === "geçti");

    // ── §3 bayat sürüm ──
    console.log("\n── §3 bayat sürümle 409 STALE_RECORD ──");
    const o3 = await yarat();
    const v3 = await surum(o3);
    await orderService.update(o3, { deadline: termin(30) }, admin.id); // arada fabrikadan biri termini değiştirdi
    const once3 = await detay(o3);
    check("§3a sipariş: bayat sürüm 409 STALE_RECORD", (await sonuc(() => orderService.update(o3, { deadline: termin(31), expectedUpdatedAt: v3 }, admin.id))) === "409:STALE_RECORD");
    check("§3b reddedilen yazım kaydı değiştirmez (termin + sürüm aynı)", (await detay(o3)).deadline?.getTime() === once3.deadline?.getTime() && (await surum(o3)) === once3.contentUpdatedAt!.toISOString());
    check("§3c cari: bayat sürüm 409 STALE_RECORD", (await sonuc(() => customerService.update(customer.id, { contactName: "C", expectedUpdatedAt: cust0.updatedAt.toISOString() }, admin.id))) === "409:STALE_RECORD");
    check("§3d cari değişmedi", (await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).contactName === "B");
    await orderService.update(oP, { deadline: termin(21) }, admin.id);
    check("§3e kısmi sevkli: bayat sürüm 409 STALE_RECORD", (await sonuc(() => orderService.update(oP, { deadline: termin(22), expectedUpdatedAt: vP }, admin.id))) === "409:STALE_RECORD");

    // ── §4 kalem sürümü ──
    console.log("\n── §4 kalem değişikliği sürümü ilerletir ──");
    const o4 = await yarat();
    const v4 = await surum(o4);
    const r4 = (await orderService.update(o4, { lines: kalemler(await detay(o4), 110, 50) }, admin.id)) as unknown as { data: OrderDto };
    check("§4a kalem güncellemesi sürümü ilerletir", r4.data.contentUpdatedAt!.toISOString() > v4);
    const v4b = await surum(o4);
    await bekle(5);
    // Kalem-yalnız yazım (renk düzeltmesi / müşteri adı yolu başlığa dokunmaz):
    await prisma.orderLine.update({ where: { id: r4.data.lines[0]!.id }, data: { customerItemName: "DÜZELTME" } });
    check("§4b kalem-yalnız yazım eski sürümü bayatlatır (409 STALE_RECORD)", (await sonuc(() => orderService.update(o4, { deadline: termin(40), expectedUpdatedAt: v4b }, admin.id))) === "409:STALE_RECORD");
    const d4 = await detay(o4);
    const maxLine = Math.max(...d4.lines.map((l) => l.updatedAt.getTime()));
    check("§4c `contentUpdatedAt` = max(başlık, kalemler) ve kalem başlıktan yeni", d4.contentUpdatedAt!.getTime() === Math.max(d4.updatedAt.getTime(), maxLine) && maxLine > d4.updatedAt.getTime());
    check("§4d başlık updatedAt'i tek başına bayattır (409)", (await sonuc(() => orderService.update(o4, { deadline: termin(41), expectedUpdatedAt: d4.updatedAt.toISOString() }, admin.id))) === "409:STALE_RECORD");
    check("§4e `contentUpdatedAt` ile geçer", (await sonuc(() => orderService.update(o4, { deadline: termin(42), expectedUpdatedAt: d4.contentUpdatedAt!.toISOString() }, admin.id))) === "geçti");
    const gelecek = new Date(Date.now() + 3_600_000).toISOString();
    check("§4f var olmamış (gelecek) sürüm 409", (await sonuc(() => orderService.update(o4, { deadline: termin(43), expectedUpdatedAt: gelecek }, admin.id))) === "409:STALE_RECORD");

    // ── §5 eşzamanlı ──
    console.log("\n── §5 eşzamanlı iki yazım ──");
    const o5 = await yarat();
    const v5 = await surum(o5);
    const ikili = await Promise.all([
      sonuc(() => orderService.update(o5, { deadline: termin(50), expectedUpdatedAt: v5 }, admin.id)),
      sonuc(() => orderService.update(o5, { deadline: termin(51), expectedUpdatedAt: v5 }, admin.id)),
    ]);
    check("§5a sipariş: aynı sürümle iki paralel yazımdan yalnız biri geçer", ikili.filter((x) => x === "geçti").length === 1 && ikili.filter((x) => x === "409:STALE_RECORD").length === 1, ikili.join(" · "));

    const o5b = await yarat();
    const v5b = await surum(o5b);
    let bekleyen: Promise<string> | null = null;
    let kilitteO = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${o5b}::uuid FOR UPDATE`;
      bekleyen = sonuc(async () => orderService.update(o5b, { lines: kalemler(await detay(o5b), 77, 50), expectedUpdatedAt: v5b }, admin.id));
      kilitteO = await kilitteBekleyen(); // bekleyen yazım ön okumaları bitirip kilide takılsın
      await tx.order.update({ where: { id: o5b }, data: { deadline: new Date(termin(52)) } });
    });
    const sonB = await bekleyen!;
    const q5b = Number((await detay(o5b)).lines[0]?.quantity);
    check("§5b sipariş: kilidin arkasında bekleyen yazım, tx sürümü ilerletince STALE alır ve kalem yazılmaz", kilitteO && sonB === "409:STALE_RECORD" && q5b === 100, `kilitte=${kilitteO} · ${sonB} · q=${q5b}`);

    const c5 = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
    const ikiliC = await Promise.all([
      sonuc(() => customerService.update(customer.id, { contactName: "D1", expectedUpdatedAt: c5.updatedAt.toISOString() }, admin.id)),
      sonuc(() => customerService.update(customer.id, { contactName: "D2", expectedUpdatedAt: c5.updatedAt.toISOString() }, admin.id)),
    ]);
    check("§5c cari: aynı sürümle iki paralel yazımdan yalnız biri geçer", ikiliC.filter((x) => x === "geçti").length === 1 && ikiliC.filter((x) => x === "409:STALE_RECORD").length === 1, ikiliC.join(" · "));
    const c5b = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
    let bekleyenC: Promise<string> | null = null;
    let kilitteC = false;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id}::uuid FOR UPDATE`;
      bekleyenC = sonuc(() => customerService.update(customer.id, { contactName: "E", expectedUpdatedAt: c5b.updatedAt.toISOString() }, admin.id));
      kilitteC = await kilitteBekleyen();
      await tx.customer.update({ where: { id: customer.id }, data: { notes: "araya giren" } });
    });
    const sonC = await bekleyenC!;
    const cE = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    check("§5d cari: kilidin arkasında bekleyen yazım STALE alır, ad yazılmaz", kilitteC && sonC === "409:STALE_RECORD" && cE.contactName !== "E", `kilitte=${kilitteC} · ${sonC} · ${cE.contactName}`);

    // ── §6 kenarlar ──
    console.log("\n── §6 kenarlar ──");
    const o6 = await yarat();
    await prisma.$executeRaw`UPDATE orders SET "updatedAt" = now() + interval '1 hour' + interval '123 microseconds' WHERE id = ${o6}::uuid`; // tz-ok: bekçi fikstürü
    const v6 = await surum(o6);
    check("§6a mikro saniyeli DB değeri ms'ye kesilmiş sürümle eşleşir", (await sonuc(() => orderService.update(o6, { deadline: termin(60), expectedUpdatedAt: v6 }, admin.id))) === "geçti");
    const c6 = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { updatedAt: true } });
    check("§6b cari: `isActive:false` + sürüm 400 (pasife alma DELETE ucundan)", (await sonuc(() => customerService.update(customer.id, { isActive: false, expectedUpdatedAt: c6.updatedAt.toISOString() }, admin.id))) === "400:VALIDATION_ERROR");
    check("§6c cari aktif kaldı", (await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).isActive === true);
  } finally {
    await cleanup().catch((e) => {
      fail++;
      console.log(`❌ temizlik — ${String(e).slice(0, 300)}`);
    });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
