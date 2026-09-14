// =============================================================================
// SONDA — DEPOSUZ TOP STOK KÜMESİNDEN ÇIKARKEN: sessiz atlama mı, 409 mu?
// =============================================================================
// ⚠️ BU DOSYA BUGÜN KIRMIZI VERMEK İÇİN YAZILDI. Yeşile çeviren `6e`nin
// SEVK-STOK-DEFTERI-BAGLAMA-TASARIM.md **K6** uygulamasıdır.
//
// İDDİA DAR DEĞİL, K6'NIN KENDİ CÜMLESİ: "Stok kümesinden çıkan her yazar
// (sevk · transfer · kartela · iptal) `warehouseId` NULL top görürse **409 +
// barkod listesi**; eski kapının `hasWarehouseEnd` süzgeci yeni kapıya TAŞINMAZ."
// Bu yüzden sonda "ya 4xx ya yazmaz" DEMİYOR — **409** diyor ve **barkodu**
// arıyor. 400 dönen bir düzeltme de burada KIRMIZI verir; bu bilinçlidir
// (`test_warehouse_fail_open` dersi: gevşek iddia üçüncü yolu sessizce kabul eder).
//
// BUGÜNKÜ DAVRANIŞ (ölçüldü 2026-09-13, `tekserp_e2e_test` + `tekserp_e2e_temiz_test`,
// ağaç `8ce92cb3`, ikisinde de birebir aynı):
//   · `warehouseId=NULL` + `status=WAREHOUSE` top çuvala OKUNUR (200),
//     sevkiyata GİRER (201) ve DISPATCH **200** verir — hiçbir uyarı yok.
//   · Sevk sonrası iki topun ikisi de `SHIPPED`; ama defterde **tek** `SHIPMENT`
//     satırı var: depolu topunki. DEPOSUZ topun satırı `warehouse-ledger.helper.ts:88`
//     `hasWarehouseEnd()` süzgecinde SESSİZCE düştü (`:101` `return false`, `:153`
//     `.filter(...)`) — dönen "yazılmadı" değeri bir yüzeye basılmıyor.
//   · Yani top fabrikadan ÇIKTI, defter çıkışı GÖRMEDİ. "İki gerçek tek çıktıya
//     iniyor" sınıfının sevk ucundaki hâli budur.
//
// ⚠️ NE ÖLÇMÜYOR: stok kümesine GİREN yön (K6'nın ilk maddesi, 400 "varsayılan
// depo tanımlı değil"). O `test_warehouse_fail_open` sondasının konusudur ve
// burada TEKRARLANMAZ — iki sonda iki yönü ölçer.
//
// ⚠️ §4a DÜZELTME SONRASI VAKUMEN YEŞİLDİR — ölçüldü (2026-09-13,
// `6e-stok-defteri-bag` @ `ac428cd3`: 16 geçti / 0 başarısız). Kapı topu
// sevkten ÖNCE durdurduğu için o top hiç `SHIPPED` olmuyor ⇒ "SHIPPED olan her
// topun SHIPMENT satırı vardır" yüklemi bu yoldan ARTIK HİÇ BASILMIYOR ve
// sonda bunu çıktısında kendisi beyan ediyor ("yüklem vakumen doğru").
// **Basılmayan dalın yeşili kapsam değildir**: §4a'nın bugünkü değeri yalnız
// ileriye dönüktür — kapı bir gün kalkarsa yeniden basılır ve o gün ısırır.
// Kapsamı ölçen satır §3'tür, §4a değil.
//
// POZİTİF KONTROL ÖNCE: §2 aynı zincirin DEPOLU topunu sevk eder ve onun
// `SHIPMENT` satırını arar. O kontrol kırmızıysa §3'ün yeşili de kırmızısı da
// anlamsızdır — girdinin kapıya ULAŞTIĞI ayrıca ölçülür ("kapı tetiklenmedi ≠
// kapı yok").
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { ItemType, RollStatus, StationKind, StationType, ShipmentStatus } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { writeWarehouseMovement } from "../src/services/helpers/warehouse-ledger.helper";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { strictMi } from "./lib/http-bekci-kapisi";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { atlamaDefteri } from "./lib/atlama";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const PRE = `TST-DPSZ-${STAMP}`;
const SHIPMENT_CONFIRM_KEY = "shipping.confirmationEnabled";

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}
/**
 * ATLANAN ≠ GEÇEN. Vakumen doğru bir yüklemi `check(..., true)` ile saymak,
 * yarın kapı gevşediğinde onu GERÇEK bir yeşil gibi gösterirdi (yüklem yine
 * vakumen doğru olurdu ama artık YANLIŞ sebeple). Atlama AYRI satır basar,
 * AYRI sayılır ve `TEKSERP_STRICT=1` altında KIRMIZIDIR.
 */
/**
 * ⚠️ ATLAMA DEFTERİ ORTAK ALTYAPIDIR — yerel kopya AÇILMAZ. Kopya `"?"`
 * (sayılamayan atlama) sınıfını temsil EDEMEZ ve sayıyı elle düzeltmeye zorlar.
 */
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

function atla(l: string, sebep: string, adet: number | "?" = 1): void {
  ATLAMA.atla(l, sebep, adet);
}

const yarat = { order: [] as string[], wo: [] as string[], roll: [] as string[], sack: [] as string[], shipment: [] as string[], route: [] as string[], station: [] as string[], item: [] as string[], customer: [] as string[], grade: [] as string[] };
interface Res { status: number; body: Record<string, unknown>; }

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`\n❌ ${engel}\n`); fail++; return; }
  console.log("=== SONDA: deposuz top stok kümesinden çıkarken ===\n");

  await reconcilePermissionCatalog();
  await ensureDefaultWarehouse();
  const varsayilan = await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
  check("§0 varsayılan depo var (zincirin ön koşulu)", varsayilan !== null);
  if (!varsayilan) { console.error("\n❌ Varsayılan depo yok — bu sonda ölçemez.\n"); return; }

  const server: Server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (m: string, p: string, o: { token?: string; body?: unknown } = {}): Promise<Res> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (o.token) h.Authorization = `Bearer ${o.token}`;
    const r = await fetch(`${base}${p}`, { method: m, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    let body: Record<string, unknown> = {};
    try { body = (await r.json()) as Record<string, unknown>; } catch { body = {}; }
    return { status: r.status, body };
  };
  const veri = (r: Res) => (r.body.data ?? {}) as Record<string, unknown>;
  const mesaj = (r: Res) => JSON.stringify(r.body.details ?? r.body.message ?? "");

  let onayEski: unknown;
  try {
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const lg = await call("POST", "/api/auth/login", { body: { username: cred.username, password: cred.password, clientType: "electron" } });
    const token = String((veri(lg) as { token?: string }).token ?? "");
    check("§0 login → token", token.length > 0, `status=${lg.status}`);
    if (!token) { console.error("\n❌ Token yok.\n"); return; }

    const eski = await prisma.systemSetting.findUnique({ where: { key: SHIPMENT_CONFIRM_KEY }, select: { value: true } });
    onayEski = eski ? eski.value : null;
    await prisma.systemSetting.upsert({ where: { key: SHIPMENT_CONFIRM_KEY }, create: { key: SHIPMENT_CONFIRM_KEY, value: true, description: "TEST — sevk onayı (deposuz top sondası)" }, update: { value: true } });

    // ═══ §1 — FİKSTÜR: zincir ortamdan bağımsız kurulur ══════════════════════
    const item = await prisma.item.create({ data: { code: `${PRE}-URN`, name: `${PRE} Kumaş`, itemType: ItemType.FABRIC }, select: { id: true } });
    yarat.item.push(item.id);
    const customer = await prisma.customer.create({ data: { code: `${PRE}-MUS`, name: `${PRE} Müşteri` }, select: { id: true } });
    yarat.customer.push(customer.id);
    const grade = await prisma.qualityGrade.create({ data: { code: `${PRE}-K1`, name: `${PRE} 1.Kalite`, targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
    yarat.grade.push(grade.id);
    const kursunSt = await prisma.station.create({ data: { code: `${PRE}-KRS`, name: `${PRE} Kurşun`, type: StationType.INTERNAL, kind: StationKind.PROCESS_QC, appliesQuality: true }, select: { id: true } });
    yarat.station.push(kursunSt.id);
    const tamburSt = await prisma.station.create({ data: { code: `${PRE}-TMB`, name: `${PRE} Tambur`, type: StationType.INTERNAL, kind: StationKind.TAMBUR, appliesQuality: true }, select: { id: true } });
    yarat.station.push(tamburSt.id);
    const route = await prisma.route.create({ data: { name: `${PRE} Rota`, steps: { create: [{ stationId: kursunSt.id, sequence: 1 }, { stationId: tamburSt.id, sequence: 2 }] } }, select: { id: true } });
    yarat.route.push(route.id);

    const sip = await call("POST", "/api/orders", { token, body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: item.id, quantity: 100, width: 180 }] } });
    const orderId = String((veri(sip) as { id?: string }).id ?? "");
    check("§1 sipariş kuruldu", sip.status === 201, `status=${sip.status} ${mesaj(sip)}`);
    if (!orderId) return;
    yarat.order.push(orderId);
    const lineId = (await prisma.orderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } })).id;

    const kk1 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: randomUUID(), itemId: item.id, initialQty: 100, width: 180, qualityGrade: grade.code } });
    const rollId = String((veri(kk1) as { id?: string }).id ?? "");
    const barcode = String((veri(kk1) as { barcode?: string }).barcode ?? "");
    check("§1 KK1 topu doğdu", kk1.status === 201 && Boolean(rollId), `status=${kk1.status} ${mesaj(kk1)}`);
    if (!rollId) return;
    yarat.roll.push(rollId);

    const wo = await call("POST", "/api/work-orders/quick-start", { token, body: { clientToken: randomUUID(), routeTemplateId: route.id, rollBarcodes: [barcode], orderLineIds: [lineId], targetItemId: item.id, width: 180 } });
    const woId = String(((veri(wo) as { workOrder?: { id?: string } }).workOrder ?? {}).id ?? "");
    check("§1 iş emri kuruldu", wo.status === 201 && Boolean(woId), `status=${wo.status} ${mesaj(wo)}`);
    if (!woId) return;
    yarat.wo.push(woId);
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true } });
    await call("POST", "/api/kursun-qc/complete-qc2", { token, body: { rollId, stepId: steps[0].id } });
    await call("POST", "/api/kursun-qc/finish-step", { token, body: { stepId: steps[0].id } });
    const fin = await call("POST", "/api/tambur/finalize", { token, body: { rollId, cuts: [{ length: 60, qualityGrade: grade.code }, { length: 40, qualityGrade: grade.code }] } });
    check("§1 tambur finalize → iki çocuk top", fin.status === 200, `status=${fin.status} ${mesaj(fin)}`);
    const cocuk = await prisma.roll.findMany({ where: { parentRollId: rollId }, orderBy: { barcode: "asc" }, select: { id: true, barcode: true, status: true, warehouseId: true } });
    for (const c of cocuk) yarat.roll.push(c.id);
    check("§1 iki çocuk DEPOLU doğdu (deposuzluk sondanın KENDİ kurduğu durum)", cocuk.length === 2 && cocuk.every((c) => c.warehouseId !== null), cocuk.map((c) => `${c.barcode}:${c.warehouseId ? "depolu" : "DEPOSUZ"}`).join(" "));
    if (cocuk.length !== 2) return;

    // ═══ §2 — POZİTİF KONTROL: depolu top sevk edilir ve defterde satırı VAR ══
    // Bu bölüm kırmızıysa §3'ün sonucu YORUMLANAMAZ: zincir kapıya ulaşmıyordur.
    console.log("\n── §2 Pozitif kontrol: DEPOLU top ──");
    const depolu = cocuk[1];
    const cuval2 = await call("POST", "/api/shipping/sacks", { token, body: { clientToken: randomUUID(), customerId: customer.id } });
    const sack2 = String((veri(cuval2) as { id?: string }).id ?? "");
    yarat.sack.push(sack2);
    await call("POST", `/api/shipping/sacks/${sack2}/scan`, { token, body: { barcode: depolu.barcode } });
    await call("POST", `/api/shipping/sacks/${sack2}/weigh`, { token, body: { weightKg: 20, source: "MANUAL" } });
    const sevk2 = await call("POST", "/api/shipping/shipments", { token, body: { clientToken: randomUUID(), sackIds: [sack2], customerId: customer.id, orderIds: [orderId] } });
    const ship2 = String((veri(sevk2) as { id?: string }).id ?? "");
    if (ship2) yarat.shipment.push(ship2);
    const dsp2 = ship2 ? await call("POST", `/api/shipping/shipments/${ship2}/dispatch`, { token, body: { plateNumber: "34TST200", driverName: `${PRE}` } }) : { status: -1, body: {} };
    check("§2a depolu top DISPATCH → 200 (zincir kapıya ulaşıyor)", dsp2.status === 200, `status=${dsp2.status} ${mesaj(dsp2 as Res)}`);
    check("§2b depolu top SHIPPED", (await prisma.roll.findUniqueOrThrow({ where: { id: depolu.id }, select: { status: true } })).status === RollStatus.SHIPPED);
    const hrk2 = await prisma.warehouseMovement.findMany({ where: { rollId: depolu.id }, select: { eventType: true, fromWarehouseId: true, toWarehouseId: true, shipmentId: true } });
    check("§2c ⭐ depolu topun SHIPMENT defter satırı VAR (from dolu, to boş)",
      hrk2.some((h) => h.eventType === "SHIPMENT" && h.fromWarehouseId !== null && h.toWarehouseId === null && h.shipmentId === ship2),
      hrk2.map((h) => h.eventType).join(",") || "satır yok");

    // ═══ §3 — ASIL SONDA: DEPOSUZ top sevk edilemez (K6) ═════════════════════
    console.log("\n── §3 Sonda: DEPOSUZ top ──");
    const deposuz = cocuk[0];
    // Deposuzluk DURUMUNU sonda kendi kurar: statü stok kümesinde kalır, depo düşer.
    // (Sahada bu durum backfill öncesi 721 satırlık geçmişin ve varsayılan depo
    // yokken doğmuş toplarin hâlidir — `backfill_roll_warehouse` bunun içindir.)
    // ⚠️ İLERİ UYUMLULUK: K6'nın DB seddi (`rolls_stock_requires_warehouse_ck`)
    // indiğinde bu UPDATE'i VERİTABANI reddeder. O bir ÇÖKME DEĞİL, KANITTIR:
    // "deposuz stok topu" durumu artık kurulamıyor demektir ve §3b-d'nin ölçtüğü
    // uygulama kapısı YAPISAL OLARAK gereksizleşir. Sonda o gün düzenlenmeden
    // doğru cevabı verir; çökerse cevap veremezdi.
    // ⚠️ ÇIPLAK `catch` YOK — d5'in ölçümü (2026-09-13): bir yokluğa mekanizma
    // atfetmek o mekanizmayı ÖLÇMEK DEĞİLDİR. Bağlantı koptuğunda, fixture'da
    // yazım hatası olduğunda ya da alakasız bir hata düştüğünde çıplak `catch`
    // hepsini "sed engelledi" sayar ve yeşil basar. Bu yüzden hata KODU okunur:
    // CHECK ihlali PostgreSQL'de `23514`tür ve sed ADIYLA doğrulanır.
    const SED_ADI = "rolls_stock_requires_warehouse_ck";
    let seddeTakildi: string | null = null;
    let beklenmedikHata: string | null = null;
    try {
      await prisma.$executeRawUnsafe(`UPDATE rolls SET "warehouseId" = NULL WHERE id = $1::uuid`, deposuz.id);
    } catch (e) {
      const ham = JSON.stringify(e instanceof Error ? { m: e.message, ...(e as unknown as Record<string, unknown>) } : e);
      if (ham.includes("23514") && ham.includes(SED_ADI)) {
        seddeTakildi = `${SED_ADI} (23514)`;
      } else {
        // Sed DEĞİL: yazım hatası · bağlantı · alakasız kısıt. Sessizce "sed" sayma.
        beklenmedikHata = (e instanceof Error ? e.message : String(e)).split("\n").slice(-2).join(" ").trim();
      }
    }
    if (beklenmedikHata !== null) {
      check("§3a ön koşul: deposuz top kurulabildi ya da SED engelledi", false,
        `BEKLENMEDİK hata — ne başarı ne de \`${SED_ADI}\` (23514): ${beklenmedikHata.slice(0, 140)}`);
      return;
    }
    const taze = await prisma.roll.findUniqueOrThrow({ where: { id: deposuz.id }, select: { status: true, warehouseId: true } });

    if (seddeTakildi !== null) {
      check("§3a ⭐ DB SEDDİ deposuz stok topunu kurdurmadı — uygulama kapısından ÖNCE durdu",
        taze.warehouseId !== null, `sed: ${seddeTakildi.slice(0, 140)}`);
      console.log("  ℹ️  §3b-§3d ve §4 ATLANDI: ölçtükleri durum (deposuz + stok statüsü) artık KURULAMIYOR.");
      console.log("     Bu bir kapsam beyanıdır — uygulama kapısı ölçülmedi, çünkü sed onun önüne geçti.");
      return;
    }
    check("§3a sonda deposuz topu kurdu (status stok kümesinde, warehouseId NULL)",
      taze.warehouseId === null && taze.status === RollStatus.WAREHOUSE, `${taze.status} warehouseId=${taze.warehouseId ?? "NULL"}`);

    const cuval3 = await call("POST", "/api/shipping/sacks", { token, body: { clientToken: randomUUID(), customerId: customer.id } });
    const sack3 = String((veri(cuval3) as { id?: string }).id ?? "");
    yarat.sack.push(sack3);
    const okut3 = await call("POST", `/api/shipping/sacks/${sack3}/scan`, { token, body: { barcode: deposuz.barcode } });
    console.log(`  ℹ️  deposuz topu çuvala okutma: ${okut3.status} (çuval bir DEPO nesnesidir; kapı sevkte de olabilir, burada da)`);
    await call("POST", `/api/shipping/sacks/${sack3}/weigh`, { token, body: { weightKg: 20, source: "MANUAL" } });
    const sevk3 = await call("POST", "/api/shipping/shipments", { token, body: { clientToken: randomUUID(), sackIds: [sack3], customerId: customer.id, orderIds: [orderId] } });
    const ship3 = String((veri(sevk3) as { id?: string }).id ?? "");
    if (ship3) yarat.shipment.push(ship3);
    const dsp3 = ship3 ? await call("POST", `/api/shipping/shipments/${ship3}/dispatch`, { token, body: { plateNumber: "34TST300", driverName: `${PRE}` } }) : { status: -1, body: {} };

    // ⚠️ Kapı ZİNCİRİN HERHANGİ BİR HALKASINDA durabilir (okut · sevkiyat kur ·
    // dispatch) — K6 "stok kümesinden çıkan yazar" der, uç adını vermez. Sonda
    // üçünü de kabul eder ama KODU sabit tutar: 409.
    const durduranlar = [
      { ad: "çuvala okut", r: okut3 },
      { ad: "sevkiyat kur", r: sevk3 },
      { ad: "dispatch", r: dsp3 as Res },
    ].filter((x) => x.r.status >= 400);
    const durduran = durduranlar[0];
    check("§3b ⭐ deposuz top stok kümesinden ÇIKAMADI (bir kapı durdurdu)",
      durduranlar.length > 0,
      durduran ? `${durduran.ad} → ${durduran.r.status}` : "hiçbir kapı durdurmadı — okut=200 sevkiyat=201 dispatch=200");
    check("§3c ⭐ durduran kapının kodu 409 (K6: '409 + barkod listesi')",
      durduran !== undefined && durduran.r.status === 409,
      durduran ? `${durduran.ad} → ${durduran.r.status}` : "durduran kapı yok");
    // ⚠️ `Roll.barcode` NULLABLE: boş barkodla `includes("")` HER ZAMAN true döner
    // ve bu yüklem sahte yeşile düşerdi. Barkodsuzluk burada bir FAIL'dir.
    const deposuzBarkod = deposuz.barcode;
    // ⚠️ §3d NEDEN AYRI BİR YÜKLEM: "durdu" ile "DOĞRU KATMAN durdurdu" farklı
    // şeyler. Defter helper'ının uç doğrulaması (`assertEndShape`) yalnız STATÜYÜ
    // ve depo ucunu bilir — TOPU tanımaz, dolayısıyla mesajında barkod OLAMAZ.
    // Barkod listesi ancak topları TARAYAN kapıdan çıkabilir. Yani bu satır
    // "kapı mı durdurdu, son ağ mı" sorusunu ayırt eder; §3b ikisine de yeşil der.
    check("§3d ⭐ hata mesajı TOPUN BARKODUNU sayıyor (soyut sayı yetmez)",
      durduran !== undefined && deposuzBarkod !== null && JSON.stringify(durduran.r.body).includes(deposuzBarkod),
      deposuzBarkod === null
        ? "top barkodsuz doğdu — yüklem ölçülemez (boş dizgeyle `includes` sahte yeşil verirdi)"
        : durduran ? mesaj(durduran.r).slice(0, 160) : "durduran kapı yok");

    // ═══ §4 — SESSİZ ATLAMA: sevk olduysa defter satırı da olmalı ════════════
    // Bu bölüm §3'ten BAĞIMSIZ bir yüklemdir: kapı bir gün 400'e çevrilse bile
    // "SHIPPED olan topun SHIPMENT satırı vardır" cümlesi ayakta kalmalıdır.
    console.log("\n── §4 Sessiz atlama ──");
    const deposuzSon = await prisma.roll.findUniqueOrThrow({ where: { id: deposuz.id }, select: { status: true } });
    const hrk3 = await prisma.warehouseMovement.findMany({ where: { rollId: deposuz.id }, select: { eventType: true } });
    const sevkEdildi = deposuzSon.status === RollStatus.SHIPPED;
    // ⚠️ İKİ DURUM, İKİ FARKLI SATIR (1e hükmü 2026-09-13): yüklem yalnız top
    // GERÇEKTEN sevk edildiyse basılır. Kapı onu durdurduysa yüklem KOŞMAMIŞTIR
    // ve bunu "geçti" diye saymak, kapı yarın gevşediğinde aynı yeşili GERÇEK
    // gibi gösterirdi. Atlama sebebini ve beklenip beklenmediğini de basar.
    if (!sevkEdildi) {
      atla("§4a SHIPPED topun SHIPMENT defter satırı",
        `top sevk EDİLMEDİ (${deposuzSon.status}) — kapı §3b'de durdurdu; yüklem basılmadı (BEKLENEN: kapı varken bu daldan geçilmez)`);
    } else {
      check("§4a ⭐ SHIPPED olan her topun SHIPMENT defter satırı VAR (sessiz atlama yok)",
        hrk3.some((h) => h.eventType === "SHIPMENT"),
        `top SHIPPED ama defter satırları: ${hrk3.map((h) => h.eventType).join(",") || "HİÇ"} — hasWarehouseEnd() süzgeci yuttu (warehouse-ledger.helper.ts:88)`);
    }
    // ═══ §5 — §4a'nın MEKANİZMASI, akış OLMADAN ══════════════════════════════
    // ⭐ NEDEN VAR: §4a kapı yüzünden YAPISAL olarak basılamıyor (deposuz bir top
    // SHIPPED olamıyor) ve bunu beyan ediyor. Ama **beyan, kapsamın yerine geçmez**:
    // §4a'nın koruduğu MEKANİZMA — `onUnwritable: "throw"`, yani deposuz satırın
    // SESSİZCE atlanmasının yerine geçen politika — bir katman ALTTA ölçülebilir.
    // Ölçüldü 2026-09-13: gerçek top, gerçek sevkiyat, kapı atlatma GEREKMİYOR;
    // fırlatma insert'ten ÖNCE oluyor.
    // ⇒ Akışın ölçülemezliği KALICI bir gerçektir; mekanizmanınki DEĞİLDİ.
    console.log("\n── §5 Yazılamaz satır politikası (birim) ──");
    let firlatti: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        await writeWarehouseMovement(
          tx as never,
          { rollId: deposuz.id, eventType: "SHIPMENT", qty: 10, fromWarehouseId: null, toWarehouseId: null },
          { onUnwritable: "throw" },
        );
      });
    } catch (e) {
      firlatti = e instanceof Error ? e.message : String(e);
    }
    check("§5a ⭐ iki depo ucu da boşken `throw` politikası FIRLATIYOR (eski sessiz atlama geri gelmedi)",
      firlatti !== null && /iki depo ucu da boş/.test(firlatti),
      firlatti ? firlatti.slice(0, 110) : "FIRLATMADI — satır sessizce atlandı");

    let skipDonus: boolean | null = null;
    let skipHata: string | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        skipDonus = await writeWarehouseMovement(
          tx as never,
          { rollId: deposuz.id, eventType: "SHIPMENT", qty: 10, fromWarehouseId: null, toWarehouseId: null },
          { onUnwritable: "skip" },
        );
      });
    } catch (e) {
      skipHata = e instanceof Error ? e.message.slice(0, 60) : String(e);
    }
    check("§5b `skip` politikası hâlâ sessizce false dönüyor (iki politika AYRI durmalı)",
      skipHata === null && skipDonus === false,
      skipHata ? `hata: ${skipHata}` : `döndü: ${String(skipDonus)}`);

    if (ship3) {
      const s3 = await prisma.shipment.findUnique({ where: { id: ship3 }, select: { status: true } });
      check("§4b deposuz topla kurulan sevkiyat DISPATCHED olmadı",
        s3?.status !== ShipmentStatus.DISPATCHED, `sevkiyat=${s3?.status ?? "yok"}`);
    }
  } catch (e) {
    // Çöken sonda sonda değildir: çökme bir FAIL satırıdır ve özete girer.
    fail++;
    console.log(`  ✗ FAIL: sonda çöktü — ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e)}`);
  } finally {
    console.log("\n🧹 Temizlik...");
    try {
      if (onayEski === null) await prisma.systemSetting.deleteMany({ where: { key: SHIPMENT_CONFIRM_KEY } });
      else if (onayEski !== undefined) await prisma.systemSetting.update({ where: { key: SHIPMENT_CONFIRM_KEY }, data: { value: onayEski as never } });
      await prisma.sackAllocation.deleteMany({ where: { sackId: { in: yarat.sack } } });
      // Defter satırı sapmaya Restrict ile bağlı → warehouseMovement ÖNCE.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollError.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.roll.updateMany({ where: { id: { in: yarat.roll } }, data: { sackId: null, shipmentId: null, currentStepId: null, parentRollId: null, batchId: null } });
      await prisma.roll.deleteMany({ where: { id: { in: yarat.roll } } });
      await prisma.sack.updateMany({ where: { id: { in: yarat.sack } }, data: { shipmentId: null } });
      await prisma.sack.deleteMany({ where: { id: { in: yarat.sack } } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: yarat.shipment } } });
      await prisma.shipment.deleteMany({ where: { id: { in: yarat.shipment } } });
      await prisma.batch.deleteMany({ where: { workOrderId: { in: yarat.wo } } });
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: yarat.wo } } } });
      await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: yarat.wo } } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: yarat.wo } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: yarat.wo } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: yarat.wo } } });
      await prisma.shipmentOrder.deleteMany({ where: { orderId: { in: yarat.order } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: yarat.order } } });
      await prisma.order.deleteMany({ where: { id: { in: yarat.order } } });
      await prisma.routeStep.deleteMany({ where: { routeId: { in: yarat.route } } });
      await prisma.route.deleteMany({ where: { id: { in: yarat.route } } });
      await prisma.station.deleteMany({ where: { id: { in: yarat.station } } });
      await prisma.item.deleteMany({ where: { id: { in: yarat.item } } });
      await prisma.customer.deleteMany({ where: { id: { in: yarat.customer } } });
      await prisma.qualityGrade.deleteMany({ where: { id: { in: yarat.grade } } });
      console.log("🧹 Temizlik tamam.");
    } catch (e) {
      fail++;
      console.log(`  ✗ FAIL: temizlik eksik (fikstür DB'sinde artık kaldı) — ${e instanceof Error ? e.message.split("\n").slice(-2).join(" ") : String(e)}`);
    }
  }
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===\n`);
    await prisma.$disconnect(); await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
