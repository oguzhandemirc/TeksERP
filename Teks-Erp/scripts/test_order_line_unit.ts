// =============================================================================
// SONDA — KG/ADET BİRİMLİ SİPARİŞ SATIRI METRE SEVKİYLE KAPANIYOR MU?
// =============================================================================
// ⚠️ BU DOSYA BUGÜN KIRMIZI VERMEK İÇİN YAZILDI. Yeşile çeviren `9b`nin
// CAKILI-VARSAYIM-KARAR.md **②** uygulamasıdır.
//
// İDDİA ②'NİN KENDİ CÜMLESİ: "`unit ∈ {KG, ADET}` → karşılama **ÖLÇÜLMEZ**:
// `shippedQty` 0 kalır, satır `fulfillmentMeasured:false` + `ApiResponse.warnings`
// 'birim kg — metre defteri karşılamayı ölçemez'; sipariş otomatik KAPANMAZ
// (bugün ~1000 m'de kapanıyordu = sessiz yanlış)." Ayrıca: "`OrderLine.unit`
// satır yaratılırken **kalem kartından kopyalanır**."
//
// BUGÜNKÜ DAVRANIŞ (ölçüldü 2026-09-13, `tekserp_e2e_test` + `tekserp_e2e_temiz_test`,
// ağaç `8ce92cb3`, ikisinde de birebir aynı):
//   `Item.unit = KG` kalem · sipariş satırı `quantity = 100` (fabrikanın kafasında
//   100 KG) · zincirden 100 **METRE** üretilip sevk edildi →
//   `OrderLine.shippedQty = 100`, `Order.status = COMPLETED`, `warnings` BOŞ.
//   MT kontrol satırı ile SONUÇ BİREBİR AYNI: birim bugün hiçbir yerde okunmuyor.
//   Yani metre defteri kilo talebini "karşıladım" diye kapatıyor ve bunu kimseye
//   söylemiyor. `OrderLine`da `unit` kolonu YOK (`InvoiceLine.unit` var, o ayrı).
//
// ⚠️ POZİTİF KONTROL ŞART: §2 (MT satır) bugün de `9b` sonrası da YEŞİL kalmalı.
// O kırmızıya dönerse `9b` MT davranışını da değiştirmiş demektir — ②'nin
// "2. Bugün korunur" maddesinin ihlali. Yani bu sonda tek yönlü değil: bir yanı
// değişmesi gerekeni, öbür yanı DEĞİŞMEMESİ gerekeni kilitler.
//
// ⚠️ NE ÖLÇMÜYOR: kilo karşılamanın KENDİSİ (top başına net kg) ②'nin DIŞINDA
// ("örme dilimi", ayrı tasarım). Bu sonda yalnız SESSİZ YANLIŞIN durduğunu ölçer;
// "kilo siparişi artık doğru karşılanıyor" DEMEZ ve dememelidir.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { ItemType, RollStatus, StationKind, StationType, OrderStatus, ItemUnit } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const PRE = `TST-BRM-${STAMP}`;
const SHIPMENT_CONFIRM_KEY = "shipping.confirmationEnabled";

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}

const yarat = { order: [] as string[], wo: [] as string[], roll: [] as string[], sack: [] as string[], shipment: [] as string[], route: [] as string[], station: [] as string[], item: [] as string[], customer: [] as string[], grade: [] as string[] };
interface Res { status: number; body: Record<string, unknown>; }

/** `order_lines.unit` — kolon yoksa `null` döner (kolonun YOKLUĞU da bir ölçümdür). */
async function satirBirimi(lineId: string): Promise<string | null> {
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ unit: string | null }>>(
      `SELECT unit::text AS unit FROM order_lines WHERE id = $1::uuid`, lineId,
    );
    return r[0]?.unit ?? null;
  } catch {
    return null; // kolon yok
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`\n❌ ${engel}\n`); fail++; return; }
  console.log("=== SONDA: KG/ADET birimli sipariş satırı metre sevkiyle kapanır mı ===\n");

  await reconcilePermissionCatalog();
  await ensureDefaultWarehouse();
  const varsayilan = await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
  check("§0 varsayılan depo var (zincirin ön koşulu)", varsayilan !== null);
  if (!varsayilan) return;

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
    if (!token) return;

    const eski = await prisma.systemSetting.findUnique({ where: { key: SHIPMENT_CONFIRM_KEY }, select: { value: true } });
    onayEski = eski ? eski.value : null;
    await prisma.systemSetting.upsert({ where: { key: SHIPMENT_CONFIRM_KEY }, create: { key: SHIPMENT_CONFIRM_KEY, value: true, description: "TEST — sevk onayı (birim sondası)" }, update: { value: true } });

    // ── FİKSTÜR ──────────────────────────────────────────────────────────────
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

    /**
     * Kalem → sipariş → 100 m top → sevk. Dönen: satır/sipariş son hâli + yanıt gövdeleri.
     * Metraj HER İKİ dalda 100 m: değişen TEK değişken kalemin BİRİMİ.
     */
    const kosu = async (etiket: string, unit: ItemUnit) => {
      const item = await prisma.item.create({ data: { code: `${PRE}-${etiket}`, name: `${PRE} ${etiket}`, itemType: ItemType.FABRIC, unit }, select: { id: true, unit: true } });
      yarat.item.push(item.id);
      const sip = await call("POST", "/api/orders", { token, body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: item.id, quantity: 100, width: 180 }] } });
      const orderId = String((veri(sip) as { id?: string }).id ?? "");
      if (!orderId) throw new Error(`sipariş kurulamadı (${etiket}): ${sip.status} ${mesaj(sip)}`);
      yarat.order.push(orderId);
      const lineId = (await prisma.orderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } })).id;
      const birim = await satirBirimi(lineId);

      const kk1 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: randomUUID(), itemId: item.id, initialQty: 100, width: 180, qualityGrade: grade.code } });
      const rollId = String((veri(kk1) as { id?: string }).id ?? "");
      const barcode = String((veri(kk1) as { barcode?: string }).barcode ?? "");
      if (!rollId) throw new Error(`KK1 topu doğmadı (${etiket}): ${kk1.status} ${mesaj(kk1)}`);
      yarat.roll.push(rollId);
      const wo = await call("POST", "/api/work-orders/quick-start", { token, body: { clientToken: randomUUID(), routeTemplateId: route.id, rollBarcodes: [barcode], orderLineIds: [lineId], targetItemId: item.id, width: 180 } });
      const woId = String(((veri(wo) as { workOrder?: { id?: string } }).workOrder ?? {}).id ?? "");
      if (!woId) throw new Error(`WO kurulamadı (${etiket}): ${wo.status} ${mesaj(wo)}`);
      yarat.wo.push(woId);
      const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true } });
      await call("POST", "/api/kursun-qc/complete-qc2", { token, body: { rollId, stepId: steps[0].id } });
      await call("POST", "/api/kursun-qc/finish-step", { token, body: { stepId: steps[0].id } });
      const fin = await call("POST", "/api/tambur/finalize", { token, body: { rollId, cuts: [{ length: 100, qualityGrade: grade.code }] } });
      if (fin.status !== 200) throw new Error(`finalize (${etiket}): ${fin.status} ${mesaj(fin)}`);
      const cocuk = await prisma.roll.findMany({ where: { parentRollId: rollId }, select: { id: true, barcode: true } });
      for (const c of cocuk) yarat.roll.push(c.id);

      const cuval = await call("POST", "/api/shipping/sacks", { token, body: { clientToken: randomUUID(), customerId: customer.id } });
      const sackId = String((veri(cuval) as { id?: string }).id ?? "");
      yarat.sack.push(sackId);
      for (const c of cocuk) await call("POST", `/api/shipping/sacks/${sackId}/scan`, { token, body: { barcode: c.barcode } });
      await call("POST", `/api/shipping/sacks/${sackId}/weigh`, { token, body: { weightKg: 40, source: "MANUAL" } });
      const sevk = await call("POST", "/api/shipping/shipments", { token, body: { clientToken: randomUUID(), sackIds: [sackId], customerId: customer.id, orderIds: [orderId] } });
      const shipmentId = String((veri(sevk) as { id?: string }).id ?? "");
      if (!shipmentId) throw new Error(`sevkiyat (${etiket}): ${sevk.status} ${mesaj(sevk)}`);
      yarat.shipment.push(shipmentId);
      const dsp = await call("POST", `/api/shipping/shipments/${shipmentId}/dispatch`, { token, body: { plateNumber: "34TST900", driverName: `${PRE}` } });

      const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { quantity: true, shippedQty: true } });
      const ord = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, shippedQty: true } });
      const uyarilar = JSON.stringify([(sip.body as { warnings?: unknown }).warnings, (dsp.body as { warnings?: unknown }).warnings].filter(Boolean));
      return { itemUnit: item.unit, birim, dsp, line, ord, uyarilar, orderId, lineId };
    };

    // ═══ §1 — SÖZLEŞME: birim SATIRDA ve kalemden kopyalanıyor ═══════════════
    console.log("── §1 Satır birimi ──");
    const kg = await kosu("KG", ItemUnit.KG);
    check("§1a ⭐ `OrderLine.unit` kolonu VAR (②: birim SATIRIN özelliği, kurulum anahtarı çöker)",
      kg.birim !== null,
      kg.birim === null ? "kolon yok — `order_lines.unit` okunamadı" : `unit=${kg.birim}`);
    check("§1b ⭐ satır birimi KALEM KARTINDAN kopyalandı (KG kalem → KG satır)",
      kg.birim === "KG", `kalem=${kg.itemUnit} satır=${kg.birim ?? "YOK"}`);

    // ═══ §1c/§1d — SÖZLEŞMENİN HTTP UCU (9b'nin ①d/①e'sinin route ikizi) ═════
    // 9b'nin servis bekçisi (`test_order_line_unit_ledger` ①d/①e) bu iki dalı
    // SERVİS düzeyinde ölçüyor. Burada ölçülen AYRI bir soru: alan HTTP ucundan
    // servise ULAŞIYOR MU ve statusCode taşınıyor mu — servis kapısı yeşilken
    // uç sessizce kabul ediyor olabilir.
    //
    // MEKANİZMA ÖLÇÜLDÜ (9b, 2026-09-13): `POST /api/orders`ta Zod YOK; bugünkü
    // 201'i `ORDER_LINE_WRITABLE` **allowlist'i** üretiyordu — listede olmayan
    // alan sessizce düşüyordu. Yani sessiz-allowlist sınıfının Zod DEĞİL elle
    // yazılmış hâli (CLAUDE.md ikisini de sayar: "istek gövdesini elle kuran
    // istemci katmanı sessiz bir allowlist'tir; Zod tanımadığı anahtarı sessizce
    // siler"). Düzeltme allowlist'e `unit` + enum doğrulaması ekliyor (`b334a09e`).
    console.log("\n── §1c/§1d Sözleşmenin HTTP ucu ──");
    const ezmeItem = await prisma.item.create({ data: { code: `${PRE}-EZME`, name: `${PRE} Ezme`, itemType: ItemType.FABRIC, unit: ItemUnit.MT }, select: { id: true } });
    yarat.item.push(ezmeItem.id);
    const ezme = await call("POST", "/api/orders", { token, body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: ezmeItem.id, quantity: 50, width: 180, unit: "KG" }] } });
    const ezmeId = String((veri(ezme) as { id?: string }).id ?? "");
    if (ezmeId) yarat.order.push(ezmeId);
    const ezmeBirim = ezmeId ? await satirBirimi((await prisma.orderLine.findFirstOrThrow({ where: { orderId: ezmeId }, select: { id: true } })).id) : null;
    check("§1c ⭐ satırda AÇIKÇA verilen `unit` kalemi EZER (kalem MT + satır KG → KG)",
      ezme.status === 201 && ezmeBirim === "KG",
      `status=${ezme.status} satır birimi=${ezmeBirim ?? "YOK"}${ezmeBirim === "MT" ? " — Zod alanı SESSİZCE SİLMİŞ olabilir (sessiz allowlist)" : ""}`);

    const gecersiz = await call("POST", "/api/orders", { token, body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: ezmeItem.id, quantity: 50, width: 180, unit: "LB" }] } });
    const gecersizId = String((veri(gecersiz) as { id?: string }).id ?? "");
    if (gecersizId) yarat.order.push(gecersizId);
    check("§1d ⭐ enum-dışı birim HTTP'den de 400 (route statusCode'u taşıyor)",
      gecersiz.status === 400,
      `status=${gecersiz.status} ${gecersiz.status === 201 ? "— sipariş KURULDU: geçersiz birim sessizce kabul edildi" : mesaj(gecersiz).slice(0, 120)}`);

    // ═══ §2 — POZİTİF KONTROL: MT satır bugünkü davranışı KORUR ══════════════
    // Bu bölüm bugün YEŞİL ve `9b` sonrası da YEŞİL kalmalı ("2. Bugün korunur").
    console.log("\n── §2 Pozitif kontrol: MT satır ──");
    const mt = await kosu("MT", ItemUnit.MT);
    check("§2a MT dalı sevk edildi (zincir kapıya ulaşıyor)", mt.dsp.status === 200, `status=${mt.dsp.status} ${mesaj(mt.dsp)}`);
    check("§2b ⭐ MT satırda karşılama METRE defterinden ÖLÇÜLÜR (shippedQty=100)",
      Number(mt.line.shippedQty) === 100, `shippedQty=${mt.line.shippedQty}`);
    check("§2c ⭐ MT siparişi otomatik KAPANIR (bugünkü davranış korunur)",
      mt.ord.status === OrderStatus.COMPLETED, `status=${mt.ord.status}`);

    // ═══ §3 — ASIL SONDA: KG satır metre sevkiyle KAPANMAZ ═══════════════════
    console.log("\n── §3 Sonda: KG satır ──");
    console.log(`  ℹ️  KG dalı: dispatch=${kg.dsp.status} · satır quantity=${kg.line.quantity} shippedQty=${kg.line.shippedQty} · sipariş=${kg.ord.status}`);
    check("§3a KG dalı da sevk edildi (kapı sevkte DEĞİL, karşılama hesabında)",
      kg.dsp.status === 200, `status=${kg.dsp.status} ${mesaj(kg.dsp)}`);
    check("§3b ⭐ KG satırda `shippedQty` 0 kalır (metre defteri kiloyu ÖLÇEMEZ)",
      Number(kg.line.shippedQty) === 0,
      Number(kg.line.shippedQty) === 100
        ? "shippedQty=100 — 100 METRE, 100 KG talebe 'karşılandı' diye yazıldı (order-status.helper.ts:132 Σ SackAllocation.qty, hepsi metre)"
        : `shippedQty=${kg.line.shippedQty}`);
    check("§3c ⭐ KG siparişi otomatik KAPANMAZ (②: sessiz-yanlış yerine görünür-ölçülmemiş)",
      kg.ord.status !== OrderStatus.COMPLETED,
      kg.ord.status === OrderStatus.COMPLETED
        ? "COMPLETED — 100 m sevk, 100 kg sipariş kapandı; bu SESSİZ YANLIŞTIR"
        : `status=${kg.ord.status}`);
    // ⚠️ İKİ KOŞUL, tek token DEĞİL: yalnız "kg" arayan bir desen alakasız bir
    // uyarıya ("çuval brüt kg…") takılıp sahte yeşil verirdi. Uyarı hem BİRİMİ
    // adlandırmalı hem de KARŞILAMANIN ÖLÇÜLEMEDİĞİNİ söylemeli — 9b'nin
    // kesinleşen metni ikisini de taşıyor ("…kg birimli — … ölçemez…").
    const birimAdi = /\bkg\b|\badet\b|birim/i.test(kg.uyarilar);
    const olculemez = /ölçemez|ölçülemez|ölçülmez|ölçülmedi/i.test(kg.uyarilar);
    check("§3d ⭐ ölçülemeyen karşılama GÖRÜNÜR: yanıtta birim uyarısı var (fail-closed ≠ sessiz)",
      birimAdi && olculemez,
      kg.uyarilar === "[]" ? "warnings BOŞ — kullanıcı karşılamanın ölçülmediğini hiçbir yerden öğrenemiyor" : kg.uyarilar.slice(0, 200));

    // ═══ §4 — İKİ DAL AYRIŞIYOR MU (tek değişken: birim) ═════════════════════
    // "Basılmayan dalın yeşili kapsam değildir": iki dal AYNI metrajla koşuyor;
    // sonuçları AYNIYSA birim hiçbir yerde okunmuyor demektir.
    console.log("\n── §4 İki dal ──");
    check("§4a ⭐ MT ve KG dalları AYNI metrajda FARKLI sonuç veriyor (birim OKUNUYOR)",
      !(Number(mt.line.shippedQty) === Number(kg.line.shippedQty) && mt.ord.status === kg.ord.status),
      `MT: shippedQty=${mt.line.shippedQty} ${mt.ord.status} · KG: shippedQty=${kg.line.shippedQty} ${kg.ord.status} — birebir aynıysa birim hiçbir yerde okunmuyor`);
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: sonda çöktü — ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e)}`);
  } finally {
    console.log("\n🧹 Temizlik...");
    try {
      if (onayEski === null) await prisma.systemSetting.deleteMany({ where: { key: SHIPMENT_CONFIRM_KEY } });
      else if (onayEski !== undefined) await prisma.systemSetting.update({ where: { key: SHIPMENT_CONFIRM_KEY }, data: { value: onayEski as never } });
      await prisma.sackAllocation.deleteMany({ where: { sackId: { in: yarat.sack } } });
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
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===\n`);
    await prisma.$disconnect(); await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
