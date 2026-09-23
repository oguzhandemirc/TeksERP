// =============================================================================
// GERİ DOLDURMA — `Order.destination` (sipariş yönü, 2026-09-23)
// =============================================================================
// Kolon yalnız BUNDAN SONRA açılan siparişlerde doğuşta dolar (`OrderService.create`). Bu script
// mevcut siparişlere BİR KEZ, BUGÜNKÜ kart zincirinden (şube → cari) değer yazar.
//
//   npx tsx scripts/backfill_order_destination.ts                          # KURU KOŞUM (yazmaz)
//   npx tsx scripts/backfill_order_destination.ts --apply                  # fixture DB'de yazar
//   npx tsx scripts/backfill_order_destination.ts --apply --canli-onay     # fabrika DB'sinde yazar
//   … --musteri=<uuid,uuid>                                                # kapsamı carilere daraltır
//
// ⚠️ YAZILAN DEĞER "DOĞUŞTAKİ YÖN" DEĞİL, KOŞUM GÜNÜNÜN KART YÖNÜDÜR: geçmişte kart değiştiyse
//    siparişin açıldığı günkü yön artık bilinemez (hiçbir yerde kaydı yok). Arşive böyle beyanlıdır.
// ⚠️ Yalnız `destination IS NULL` satırlar: dolu satır (doğuşta yazılmış ya da önceki koşum) ASLA
//    değişmez — ikinci koşum 0 değişiklik yapar. Zincir boşsa NULL kalır ("yön belirsiz").
// ⚠️ Zincir KOPYALANMAZ: `pickShipmentDestination` (sevkiyat ve sipariş yazarıyla aynı saf çözücü).
// ⚠️ Kapılar `migrate_partner_roles` emsali: hedef adıyla basılır · fixture dışı hedefte `--apply`
//    `--canli-onay` ister · üretim adlarına (`YAZILMASI_YASAK_DB`) hiç yazılmaz.
// =============================================================================
import type { ShipmentDestination } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { pickShipmentDestination } from "../src/services/helpers/shipment-destination.helper";
import { fixtureHedefEngeli, hedefDbAdi, YAZILMASI_YASAK_DB } from "./lib/hedef-db-kapisi";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");
const MUSTERI = process.argv.find((a) => a.startsWith("--musteri="))?.slice("--musteri=".length).split(",").filter(Boolean) ?? null;
const BATCH = 500;
const LISTE_TAVANI = 200;

async function main(): Promise<void> {
  console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  if (YAZILMASI_YASAK_DB.has(hedefDbAdi())) {
    console.error(`\n⛔ DURDURULDU — '${hedefDbAdi()}' üretim adı; bu betik oraya YAZMAZ.\n`);
    process.exitCode = 1;
    return;
  }
  const fixtureDisi = fixtureHedefEngeli();
  if (APPLY && fixtureDisi && !CANLI_ONAY) {
    console.error(`\n⛔ --apply DURDURULDU — hedef fixture kalıbında değil.\n   ${fixtureDisi}\n   Fabrika verisinde bilerek koşuyorsan: --apply --canli-onay\n`);
    process.exitCode = 1;
    return;
  }
  console.log(APPLY ? "▶ UYGULAMA MODU (yazacak)" : "▶ KURU KOŞUM (hiçbir şey yazılmaz)");
  if (MUSTERI) console.log(`   kapsam: ${MUSTERI.length} cari`);

  const adaylar = await prisma.order.findMany({
    where: { destination: null, ...(MUSTERI ? { customerId: { in: MUSTERI } } : {}) },
    select: { id: true, orderNumber: true, status: true, customerId: true, branchId: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Aday (yönü boş sipariş): ${adaylar.length}`);

  const cariler = await prisma.customer.findMany({
    where: { id: { in: [...new Set(adaylar.map((o) => o.customerId))] } },
    select: { id: true, name: true, defaultDestination: true },
  });
  const subeler = await prisma.customerBranch.findMany({
    where: { id: { in: [...new Set(adaylar.map((o) => o.branchId).filter((x): x is string => !!x))] } },
    select: { id: true, customerId: true, name: true, defaultDestination: true },
  });
  const cariMap = new Map(cariler.map((c) => [c.id, c]));
  const subeMap = new Map(subeler.map((b) => [b.id, b]));

  const plan: Array<{ id: string; orderNumber: string; status: string; cari: string; sube: string | null; yon: ShipmentDestination; kaynak: string }> = [];
  let belirsiz = 0;
  let tutarsizSube = 0;
  for (const o of adaylar) {
    const cari = cariMap.get(o.customerId);
    const sube = o.branchId ? subeMap.get(o.branchId) : undefined;
    // Başka carinin şubesi (tutarsız veri) yön vermez — `resolveShipmentDestination`ın 400'üyle aynı sınır.
    if (sube && sube.customerId !== o.customerId) { tutarsizSube++; continue; }
    const r = pickShipmentDestination({ branchDestination: sube?.defaultDestination, customerDestination: cari?.defaultDestination });
    if (!r.destination) { belirsiz++; continue; }
    plan.push({ id: o.id, orderNumber: o.orderNumber, status: o.status, cari: cari?.name ?? o.customerId, sube: sube?.name ?? null, yon: r.destination, kaynak: r.source === "BRANCH" ? "şube" : "cari" });
  }

  const say = (d: ShipmentDestination) => plan.filter((p) => p.yon === d).length;
  console.log(`\nYazılacak            : ${plan.length}  (Yurtiçi ${say("DOMESTIC")} · Yurtdışı ${say("EXPORT")})`);
  console.log(`NULL kalır (belirsiz): ${belirsiz}  (şube ve cari kartında yön yok)`);
  if (tutarsizSube) console.log(`Atlanan — tutarsız şube: ${tutarsizSube}  (şube başka cariye ait)`);

  console.log("\n── Etkilenecek kayıtlar ──");
  for (const p of plan.slice(0, LISTE_TAVANI)) {
    console.log(`  ${p.orderNumber}  [${p.status}]  ${p.cari}${p.sube ? ` / ${p.sube}` : ""}  → ${p.yon === "EXPORT" ? "Yurtdışı" : "Yurtiçi"} (${p.kaynak})`);
  }
  if (plan.length > LISTE_TAVANI) console.log(`  … ve ${plan.length - LISTE_TAVANI} kayıt daha`);

  if (!APPLY) {
    console.log("\n⚠️ KURU KOŞUM — hiçbir şey yazılmadı. Yazmak için: --apply (fabrika verisinde --apply --canli-onay)");
    return;
  }
  if (fixtureDisi) console.warn(`\n⚠️  CANLI HEDEFTE GERİ DOLDURMA — ${hedefDbAdi()} (--canli-onay ile)`);

  let yazilan = 0;
  for (const d of ["DOMESTIC", "EXPORT"] as const) {
    const ids = plan.filter((p) => p.yon === d).map((p) => p.id);
    for (let i = 0; i < ids.length; i += BATCH) {
      // `destination: null` koşulu KORUNUR: koşum sırasında açık bir taşıma (`update`) kolonu
      // doldurmuş olabilir ve o değer daha doğrudur.
      const res = await prisma.order.updateMany({ where: { id: { in: ids.slice(i, i + BATCH) }, destination: null }, data: { destination: d } });
      yazilan += res.count;
    }
  }
  console.log(`\n✔ ${yazilan} sipariş güncellendi (planlanan ${plan.length}).`);

  const SCRIPT = "scripts/backfill_order_destination.ts";
  const iz = await onarimIziYaz({
    script: SCRIPT,
    action: "ORDER_DESTINATION_BACKFILL",
    tableName: "ORDER",
    olcum: { guncellenen: yazilan, planlanan: plan.length, belirsizKalan: belirsiz, tutarsizSube, kapsam: MUSTERI ? MUSTERI.length : "tümü", deger: "koşum gününün kart yönü (doğuştaki yön değil)" },
  });
  if (!iz) {
    console.error(izDustuUyarisi(SCRIPT, false));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
