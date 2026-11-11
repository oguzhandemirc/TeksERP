// =============================================================================
// Test: Açılış panosu (`GET /api/dashboard/pano` + `/pano/hareketler`) servis bekçisi
// Çalıştır: npx tsx scripts/test_pano_ozet.ts
// =============================================================================
// §1 BOŞ PENCERE (2099-01): her KPI 0, yüzde null, eğilim nokta sayısı dönem başına doğru, hata yok.
// §2 VERİ: biten kumaş · brüt sevk · sipariş fikstürü 2099-03-15'e kurulur (`now` parametresiyle;
//    seed/komşu veri sızmaz). Beklenen sayılar elle hesaplı; ölü top (CANCELLED) dışlanır.
// §3 DÖNEM SINIRI FABRİKA DİLİMİNDE: 2099-03-14T21:30Z = yerel 15 Mart 00:30 → BUGÜN, saat "00".
//    UTC kesimi bu topu düne yazardı (negatif sonda: `bucketKeySql`/pencere UTC'ye çevrilince KIRMIZI).
// §4 KAPI: yalnız `report:sales` → üretim/stok/finans null, sevk/sipariş dolu; finans izinsiz null;
//    kapalı modül kutusu null (modülün bugünkü durumu ölçülerek beklenti kurulur).
// §5 ANLIK kutular (stok, sevke hazır, üretime gönderilmemiş) fikstür DELTASIYLA (körlük zemini).
// §6 HAREKETLER: fikstür sipariş/sevk akışta, miktar brüt; izinsiz kullanıcıda tür listesi boş.
// §7 ÖLÇÜM: tek `pano` çağrısının süresi ve sorgu sayısı basılır; sorgu bütçesi tavanı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getPanoSummary, type PanoSummary } from "../src/services/dashboard/pano.service";
import { getPanoHareketler } from "../src/services/dashboard/pano-hareketler.service";
import { resolvePanoPencere } from "../src/services/dashboard/pano-donem";
import { systemSettingService } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// --- sorgu sayacı (yalnız ölçüm penceresinde) ---
let queries = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) queries++;
    return orig(...args);
  };
});

const ALL = { userId: "test-pano", permissions: ["*"] };
const TAG = `TEST-PANO-${Date.now()}`;
const EMPTY_NOW = new Date("2099-01-10T09:00:00.000Z"); // yerel 12:00
const NOW = new Date("2099-03-15T12:00:00.000Z"); // yerel 15:00 (Europe/Istanbul +3)
/** Sorgu bütçesi — her kutu tek kaynağını bir kez okur; aşım yeni N+1 ya da kopya sorgu demektir. */
const QUERY_BUDGET = 60;

const ids = { rolls: [] as string[], shipments: [] as string[], orders: [] as string[], items: [] as string[], customers: [] as string[] };

async function roll(itemId: string, qty: number, status: "WAREHOUSE" | "CANCELLED" | "SHIPPED", finalizedAt: Date | null, shipmentId: string | null = null): Promise<void> {
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-R${ids.rolls.length}`, itemId, initialQty: qty, currentQty: qty, status, entrySource: "SUPPLIER_RECEIPT", shipmentId },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  // Damga trigger'la doğar (now()); bekçi penceresine statüye dokunmadan ham UPDATE ile taşınır.
  await prisma.$executeRaw`UPDATE "rolls" SET "finalizedAt" = ${finalizedAt} WHERE "id" = ${r.id}::uuid`;
}

async function cleanup(): Promise<void> {
  await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
}

function allNullOrZero(o: PanoSummary): boolean {
  const k = o.kpi;
  const zero = (x: { deger: number; onceki: number; degisimYuzde: number | null } | undefined) => !x || (x.deger === 0 && x.onceki === 0 && x.degisimYuzde === null);
  return zero(k.uretim?.metre) && zero(k.uretim?.top) && zero(k.sevk?.metre) && zero(k.sevk?.irsaliye) && zero(k.siparis?.adet) && zero(k.siparis?.metre) && zero(k.fason?.gidenMetre);
}

async function main(): Promise<void> {
  console.log("\n=== Açılış panosu bekçisi ===\n");
  const flags = (await systemSettingService.getFeatureFlags()).data!;

  // ── §1 boş pencere ──────────────────────────────────────────────────────────
  console.log("── §1 boş pencere ──");
  const expectPoints = { bugun: 13, hafta: 7, ay: 30, yil: 12 } as const; // 12:00 yerel → saat 00..12
  for (const d of ["bugun", "hafta", "ay", "yil"] as const) {
    const o = await getPanoSummary(d, ALL, EMPTY_NOW);
    check(`§1 ${d}: KPI'lar 0 ve yüzde null`, allNullOrZero(o));
    check(`§1 ${d}: eğilim ${expectPoints[d]} nokta, hepsi 0`, o.egilim.noktalar.length === expectPoints[d] && o.egilim.noktalar.every((p) => (p.uretimMetre ?? 0) === 0 && (p.sevkMetre ?? 0) === 0), `n=${o.egilim.noktalar.length}`);
    check(`§1 ${d}: dağılım ve en çok listeleri boş`, (o.dagilim?.dilimler.length ?? 0) === 0 && (o.enCok.uretilen?.length ?? 0) === 0 && (o.enCok.sevkEdilen?.length ?? 0) === 0);
    check(`§1 ${d}: düşük stok tanımı yok → null`, o.stokOzeti?.dusukStokKalem === null);
  }
  const yil = resolvePanoPencere("yil", NOW);
  check("§1 yıl penceresi 12 fabrika ayı (2098-04 … 2099-03)", yil.anahtarlar[0] === "2098-04" && yil.anahtarlar[11] === "2099-03", yil.anahtarlar.join(","));

  // Anlık kutuların tabanı (fikstürden önce).
  const base = await getPanoSummary("bugun", ALL, NOW);

  // ── fikstür ────────────────────────────────────────────────────────────────
  const item = await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} KUMAŞ`, itemType: "FABRIC" }, select: { id: true, code: true } });
  ids.items.push(item.id);
  const cust = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} MÜŞTERİ` }, select: { id: true } });
  ids.customers.push(cust.id);

  await roll(item.id, 100, "WAREHOUSE", new Date("2099-03-15T08:00:00.000Z")); // bugün 11:00
  await roll(item.id, 30, "WAREHOUSE", new Date("2099-03-14T21:30:00.000Z")); // bugün 00:30 (UTC'de dün!)
  await roll(item.id, 20, "WAREHOUSE", new Date("2099-03-14T20:30:00.000Z")); // dün 23:30 — önceki pencere dışı (15:00'e kadar)
  await roll(item.id, 50, "WAREHOUSE", new Date("2099-03-14T08:00:00.000Z")); // dün 11:00 — önceki pencere
  await roll(item.id, 400, "CANCELLED", new Date("2099-03-15T09:00:00.000Z")); // ölü top: sayılmaz

  const sh = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S1`, customerId: cust.id, status: "DISPATCHED", dispatchedAt: new Date("2099-03-15T09:00:00.000Z") }, select: { id: true } });
  ids.shipments.push(sh.id);
  await roll(item.id, 70, "SHIPPED", null, sh.id);
  const planned = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S2`, customerId: cust.id, status: "PLANNED" }, select: { id: true } });
  ids.shipments.push(planned.id);
  await roll(item.id, 40, "SHIPPED", null, planned.id);

  const order = await prisma.order.create({
    data: { orderNumber: `${TAG}-O1`, customerId: cust.id, orderDate: new Date("2099-03-15T07:00:00.000Z"), status: "APPROVED", lines: { create: [{ itemId: item.id, quantity: 200 }] } },
    select: { id: true },
  });
  ids.orders.push(order.id);

  // ── §2/§3 veri + dilim ──────────────────────────────────────────────────────
  console.log("── §2 veri · §3 dönem sınırı ──");
  capture = true;
  queries = 0;
  const t0 = Date.now();
  const o = await getPanoSummary("bugun", ALL, NOW);
  const ms = Date.now() - t0;
  capture = false;
  const q = queries;

  check("§2 üretim bugün 130 m / 2 top (ölü top dışı)", o.kpi.uretim?.metre.deger === 130 && o.kpi.uretim?.top.deger === 2, JSON.stringify(o.kpi.uretim));
  check("§2 üretim önceki (dün 15:00'e kadar) 50 m, değişim %160", o.kpi.uretim?.metre.onceki === 50 && o.kpi.uretim?.metre.degisimYuzde === 160);
  check("§2 sevk BRÜT 70 m / 1 irsaliye (planlı sayılmaz)", o.kpi.sevk?.metre.deger === 70 && o.kpi.sevk?.irsaliye.deger === 1, JSON.stringify(o.kpi.sevk));
  check("§2 sevk önceki 0 → yüzde null", o.kpi.sevk?.metre.degisimYuzde === null);
  check("§2 yeni sipariş 1 adet / 200 m", o.kpi.siparis?.adet.deger === 1 && o.kpi.siparis?.metre.deger === 200, JSON.stringify(o.kpi.siparis));
  const h = (k: string) => o.egilim.noktalar.find((p) => p.anahtar === k);
  check("§3 00:30 yerel top BUGÜN saat 00 kovasında (fabrika dilimi)", h("00")?.uretimMetre === 30, JSON.stringify(h("00")));
  check("§3 11:00 kovası 100 m, 12:00 kovası sevk 70 m", h("11")?.uretimMetre === 100 && h("12")?.sevkMetre === 70);
  check("§2 dağılım tek dilim, %100 bu kumaş", o.dagilim?.dilimler.length === 1 && o.dagilim.dilimler[0]!.itemId === item.id && o.dagilim.dilimler[0]!.yuzde === 100);
  check("§2 en çok üretilen/sevk edilen bu kumaş", o.enCok.uretilen?.[0]?.kod === item.code && o.enCok.sevkEdilen?.[0]?.metre === 70);

  const w = await getPanoSummary("hafta", ALL, NOW);
  check("§2 hafta üretim 200 m (dün 23:30 dahil)", w.kpi.uretim?.metre.deger === 200, String(w.kpi.uretim?.metre.deger));
  const dayKey = (k: string) => w.egilim.noktalar.find((p) => p.anahtar === k)?.uretimMetre;
  check("§3 hafta gün kovaları: 15 Mart 130 m, 14 Mart 70 m", dayKey("2099-03-15") === 130 && dayKey("2099-03-14") === 70, `${dayKey("2099-03-15")} / ${dayKey("2099-03-14")}`);

  // ── §5 anlık kutular (delta) ────────────────────────────────────────────────
  console.log("── §5 anlık kutular ──");
  if (base.stokOzeti && o.stokOzeti) {
    check("§5 mamul stok +4 top / +200 m (WAREHOUSE fikstürü)", o.stokOzeti.mamul.top - base.stokOzeti.mamul.top === 4 && Math.abs(o.stokOzeti.mamul.metre - base.stokOzeti.mamul.metre - 200) < 0.05,
      `${base.stokOzeti.mamul.top} → ${o.stokOzeti.mamul.top}`);
  } else check("§5 stok kutusu '*' izinle dolu", false);
  check("§5 sevke hazır +1 sevkiyat / +40 m", (o.bekleyen.sevkeHazir?.sevkiyat ?? -1) - (base.bekleyen.sevkeHazir?.sevkiyat ?? 0) === 1 && Math.abs((o.bekleyen.sevkeHazir?.metre ?? 0) - (base.bekleyen.sevkeHazir?.metre ?? 0) - 40) < 0.05);
  if (flags.productionEnabled) check("§5 üretime gönderilmemiş sipariş +1", (o.bekleyen.uretimeGonderilmemisSiparis ?? -99) - (base.bekleyen.uretimeGonderilmemisSiparis ?? 0) === 1);
  else check("§5 üretim kapalı → üretime gönderilmemiş sipariş null", o.bekleyen.uretimeGonderilmemisSiparis === null);

  // ── §4 kapılar ─────────────────────────────────────────────────────────────
  console.log("── §4 kapılar ──");
  const sales = await getPanoSummary("bugun", { userId: "test-pano", permissions: ["report:sales"] }, NOW);
  check("§4 yalnız report:sales → sevk/sipariş dolu", sales.kpi.sevk !== null && sales.kpi.siparis !== null);
  check("§4 yalnız report:sales → üretim/stok/fason/eğilim üretim null", sales.kpi.uretim === null && sales.kpi.stok === null && sales.stokOzeti === null && sales.kpi.fason === null && sales.egilim.noktalar.every((p) => p.uretimMetre === null));
  check("§4 izinsiz finans null", sales.finans === null);
  check("§4 izinsiz bekleyen kutular null", sales.bekleyen.sevkeHazir === null && sales.bekleyen.onayBekleyenBelge === null && sales.bekleyen.uretimeGonderilmemisSiparis === null);
  const finOpen = flags.financeEnabled && !(flags.license?.kapaliModuller ?? []).some((m) => m.anahtar === "finance.enabled");
  check(`§4 finans '*' izinle: modül ${finOpen ? "açık → dizi" : "kapalı → null"}`, finOpen ? Array.isArray(o.finans?.alacaklar) : o.finans === null);
  check(`§4 tezgah: modül ${flags.tezgahEnabled ? "açık → dolu" : "kapalı → null"}`, flags.tezgahEnabled ? o.tezgah !== null : o.tezgah === null);
  check(`§4 gelen belge: modül ${flags.gelenBelgeEnabled ? "açık → dolu" : "kapalı → null"}`, flags.gelenBelgeEnabled ? o.bekleyen.onayBekleyenBelge !== null : o.bekleyen.onayBekleyenBelge === null);
  check(`§4 emanet: modül ${flags.emanetEnabled ? "açık" : "kapalı → null"}`, flags.emanetEnabled ? true : o.emanet === null);

  // ── §6 hareketler ──────────────────────────────────────────────────────────
  console.log("── §6 hareketler ──");
  const hr = await getPanoHareketler(ALL, NOW);
  const sevkRow = hr.hareketler.find((x) => x.hedef.id === sh.id);
  check("§6 fikstür sevk akışta, BRÜT 70 m, tür SEVK", sevkRow?.tur === "SEVK" && sevkRow.miktar === 70 && sevkRow.birim === "m", JSON.stringify(sevkRow));
  const ordRow = hr.hareketler.find((x) => x.hedef.id === order.id);
  check("§6 fikstür sipariş akışta, 200 m", ordRow?.tur === "SIPARIS" && ordRow.miktar === 200, JSON.stringify(ordRow));
  check("§6 en fazla 8 satır, zaman azalan", hr.hareketler.length <= 8 && hr.hareketler.every((x, i, a) => i === 0 || a[i - 1]!.zaman >= x.zaman));
  check("§6 planlı sevkiyat akışa girmez", !hr.hareketler.some((x) => x.hedef.id === planned.id));
  const none = await getPanoHareketler({ userId: "test-pano", permissions: ["report:sales"] }, NOW);
  check("§6 izinsiz kullanıcı: tür listesi ve akış boş", none.turler.length === 0 && none.hareketler.length === 0);

  // ── §7 ölçüm ───────────────────────────────────────────────────────────────
  console.log("── §7 ölçüm ──");
  console.log(`   pano(bugun, '*') süre=${ms} ms · sorgu=${q}`);
  check(`§7 sorgu bütçesi ≤ ${QUERY_BUDGET}`, q > 0 && q <= QUERY_BUDGET, `sorgu=${q}`);
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    try { await cleanup(); } catch (e) { fail++; console.error("temizlik:", e); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
