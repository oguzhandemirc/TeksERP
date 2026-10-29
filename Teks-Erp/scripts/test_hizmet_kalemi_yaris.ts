// =============================================================================
// BEKÇİ — Hizmet kalemi pasife alma ↔ canlı referans yazımı YARIŞI (K3c, 2026-10-29)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_kalemi_yaris.ts
//
// NEDEN: Müşterili hizmet fiyatı ve özellik/değer → hizmet kalemi eşlemesi D1 CANLI REFERANSIDIR
// (`ITEM_LIVE_REF_KINDS` SERVICE_*). Yazarları kartı yalnız tx DIŞINDA okuyordu: sayım ile yazım
// arasında doğan bağ görünmez, "Pasif kalemde canlı fiyat/eşleme" oluşurdu (TOCTOU). Emsal:
// `test_item_lifecycle_race` (top girişi). Kilit sırası her yolda: 8030 SHARED → kart FOR SHARE.
//
// ÖLÇÜLENLER (yol başına, kademeli gecikmeli eşzamanlı tur):
//   §1 müşterili hizmet fiyatı (`itemPriceService.upsert`)
//   §2 özelliğin kendi eşlemesi (`fabricPropertyService.update {serviceItemId}`)
//   §3 değer eşlemesi (`fabricPropertyService.update {values[].serviceItemId}`)
//   §4 eşlemeli YENİ özellik (`fabricPropertyService.create {serviceItemId}`)
//   her yolda: Pasif + canlı referans HİÇ oluşmaz · 5xx/kilitlenme yok · her tur tam bir kazanan ·
//   iki kazanan türü de görüldü (pencere gerçekten denendi)
// Negatif sonda (2026-10-29): fiyat tx'inden `assertItemUsableTx` kaldırılınca §1 ihlal > 0;
// `withServiceItemLocks` kilitsiz `write()`a indirilince §2/§3/§4 ihlal > 0.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Currency, ItemLifecycleStatus, ItemType, PriceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { itemPriceService } from "../src/services/item-price.service";
import { countItemLiveRefs, totalLiveRefs } from "../src/services/helpers/item-lifecycle.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const outcome = (r: PromiseSettledResult<unknown>): string => {
  if (r.status === "fulfilled") return "OK";
  const e = r.reason as { statusCode?: number; details?: { code?: string } };
  return `${e.statusCode ?? 500}:${e.details?.code ?? "?"}`;
};

const STAMP = randomUUID().slice(0, 8);
const P = `TST-HKY-${STAMP}`;
const TURLAR = 24;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fx = { itemIds: [] as string[], propIds: [] as string[], customerIds: [] as string[], stationIds: [] as string[] };

type Write = (itemId: string) => Promise<unknown>;

async function race(label: string, tag: string, write: Write, adminId: string): Promise<void> {
  const tally = new Map<string, number>();
  let ihlal = 0;
  let sunucuHatasi = 0;
  for (let i = 0; i < TURLAR; i++) {
    const it = await prisma.item.create({ data: { code: `${P}-${tag}${i}`, name: `TEST HKY ${tag} ${i} ${STAMP}`, itemType: ItemType.SERVICE, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    // Kademeli gecikme: pasife alma yazımın ön kontrolünden SONRA da gelsin; iki sıra da denenir.
    const gecikmePasif = i % 2 === 0 ? (i % 8) * 3 : 0;
    const gecikmeYazim = i % 2 === 1 ? (i % 8) * 3 : 0;
    const [pasif, yazim] = await Promise.allSettled([
      sleep(gecikmePasif).then(() => itemService.transitionLifecycle(it.id, ItemLifecycleStatus.ARCHIVED, null, adminId)),
      sleep(gecikmeYazim).then(() => write(it.id)),
    ]);
    const key = `pasif=${outcome(pasif)} yazım=${outcome(yazim)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if ([pasif, yazim].some((x) => x.status === "rejected" && ((x.reason as { statusCode?: number }).statusCode ?? 500) >= 500)) {
      sunucuHatasi++;
      for (const x of [pasif, yazim]) if (x.status === "rejected") console.log(`   ! ${(x.reason as Error).message?.split("\n")[0]}`);
    }
    const row = await prisma.item.findUniqueOrThrow({ where: { id: it.id }, select: { lifecycleStatus: true } });
    const live = totalLiveRefs(await countItemLiveRefs(prisma, it.id));
    if (row.lifecycleStatus === ItemLifecycleStatus.ARCHIVED && live > 0) ihlal++;
  }
  for (const [k, n] of tally) console.log(`   · ${n} tur: ${k}`);
  check(`${label}: ${TURLAR} turda D1 hiç çiğnenmedi (Pasif kalemde canlı referans 0)`, ihlal === 0, `ihlal ${ihlal}`);
  check(`${label}: 5xx / kilitlenme yok`, sunucuHatasi === 0, String(sunucuHatasi));
  const legal = [...tally.keys()].every(
    (k) => k === "pasif=OK yazım=409:ITEM_INACTIVE" || k === "pasif=409:ITEM_HAS_LIVE_REFERENCES yazım=OK",
  );
  check(`${label}: her tur TAM bir kazanan (iki meşru sonuçtan biri)`, legal, [...tally.keys()].join(" | "));
  check(`${label}: iki kazanan türü de gerçekleşti (pencere gerçekten denendi)`, tally.size >= 2, [...tally.keys()].join(" | "));
}

async function main(): Promise<void> {
  console.log("=== Hizmet kalemi pasife alma ↔ fiyat/eşleme yarışı (K3c) ===");
  const admin = await ensureTestAdmin();
  const cust = await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HKY müşteri ${STAMP}` }, select: { id: true } });
  fx.customerIds.push(cust.id);
  const flag = await prisma.fabricProperty.create({ data: { code: `${P}-F`.slice(0, 32), name: `TEST HKY bayrak ${STAMP}`, valueType: "FLAG" }, select: { id: true } });
  fx.propIds.push(flag.id);
  const choice = await prisma.fabricProperty.create({
    data: { code: `${P}-S`.slice(0, 32), name: `TEST HKY seçim ${STAMP}`, valueType: "CHOICE", values: { create: [{ code: `HKY-${STAMP}`.toUpperCase(), name: "HKY değer", sortOrder: 0 }] } },
    select: { id: true, values: { select: { code: true, name: true } } },
  });
  fx.propIds.push(choice.id);
  const val = choice.values[0]!;

  console.log("\n── §1 müşterili hizmet fiyatı ──");
  await race("§1 fiyat", "P", (itemId) => itemPriceService.upsert({ itemId, customerId: cust.id, kind: PriceKind.SALE, currency: Currency.TRY, price: 12.5 }, admin.id), admin.id);
  console.log("\n── §2 özelliğin hizmet eşlemesi ──");
  await race("§2 özellik eşlemesi", "O", (itemId) => fabricPropertyService.update(flag.id, { serviceItemId: itemId }, admin.id), admin.id);
  console.log("\n── §3 değerin hizmet eşlemesi ──");
  await race("§3 değer eşlemesi", "D", (itemId) => fabricPropertyService.update(choice.id, { values: [{ code: val.code, name: val.name, serviceItemId: itemId }] }, admin.id), admin.id);
  console.log("\n── §4 eşlemeli yeni özellik (create) ──");
  const st = await prisma.station.create({ data: { code: `${P}-ST`.slice(0, 32), name: `TEST HKY istasyon ${STAMP}`, type: "INTERNAL", kind: "TAMBUR", appliesProperty: true }, select: { id: true } });
  fx.stationIds.push(st.id);
  await race("§4 özellik create eşlemesi", "Y", async (itemId) => {
    const r = await fabricPropertyService.create({ name: `TEST HKY yeni ${itemId.slice(0, 8)}`, valueType: "FLAG", stationIds: [st.id], serviceItemId: itemId }, admin.id);
    fx.propIds.push((r.data as { id: string }).id);
    return r;
  }, admin.id);
}

async function cleanup(): Promise<void> {
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: fx.propIds } } });
  await prisma.stationProperty.deleteMany({ where: { OR: [{ propertyId: { in: fx.propIds } }, { stationId: { in: fx.stationIds } }] } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } });
  await prisma.itemPrice.deleteMany({ where: { itemId: { in: fx.itemIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...fx.itemIds, ...fx.propIds, ...fx.customerIds] } } });
  await prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } });
  await prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } });
}

main()
  .catch((e) => { fail++; console.error("\n💥 ÇÖKTÜ:", e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error("temizlik:", (e as Error).message); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
