// =============================================================================
// UÇTAN UCA ÜRETİM AKIŞI — HTTP. Sipariş → KK1 → iş emri → kurşun+KK2 → tambur →
// depo → çuval → sevkiyat (PLANNED → DISPATCHED) → iade → storno.
// Çalıştır: npx tsx scripts/run-all-tests.ts production_flow_api
// =============================================================================
// SINIF: L1-app + AÇIK BOOT UZLAŞTIRMASI. Zincir TEK: her adımın ÇIKTISI bir
// sonrakinin GİRDİSİDİR (sipariş satırı → iş emri bağı → top barkodu → adım id →
// çocuk top → çuval → sevkiyat → iade). Hiçbir adımda servise kısa devre yok.
//
// ÖLÇÜT — "gerçek uçtan geçiyor mu" sorusunu "soket var mı" AYIRMAZ:
// `test_http_api` ve `test_printer_transport` İKİSİ de 127.0.0.1'de gerçek soket
// açar. Ayıran soru DİNLEYİCİYİ KİM AÇTI: burada dinleyici ürünün kendi `app`idir
// ve test istemcidir; yazıcı bekçisinde dinleyici testin sahte cihazıdır ve SUT
// istemcidir — o bir cihaz fikstürüdür, HTTP iş akışı ölçmez.
//
// İKİNCİ ÖLÇÜT — ASIL KÖR NOKTA. "İstek gerçek sürece mi gidiyor" YANLIŞ soru;
// doğrusu: İLK İDDİADAN ÖNCE BOOT UZLAŞTIRMASI BİTMİŞ Mİ? `src/server.ts`in boot
// işleri `setTimeout(..., STARTUP_DELAY_MS).unref()` arkasında (izin kataloğu
// 3 sn · VARSAYILAN DEPO 5 sn · arşiv/yedek 60 sn · offsite 90 sn), yani sunucuyu
// spawn edip hemen login olan bir bekçi uzlaştırma KOŞMAMIŞKEN ölçer: "gerçek
// süreç" etiketi taşır, boot'u yine ölçmez, üstelik ZAMANA BAĞLI olarak. Bu dosya
// bu yüzden uzlaştırıcıların `await` edilebilir GÖVDELERİNİ çağırır — zamanlayıcı
// yok, `pg_dump` yok, mDNS yok, yarış yok.
//
// ÖLÇÜLDÜ (2026-09-12): `run-all-tests.ts` hiçbir sunucu kaldırmıyor ve HTTP'ye
// ulaşan 20 bekçinin gövdesinde uzlaştırıcı çağrısı yalnız `test_module_profile`de
// var (o da sunucu yoksa beyanlı atlıyor) ⇒ varsayılan koşumda boot uzlaştırması
// koşmuş bir sistemde HTTP akışı ölçen bekçi SIFIRDI. §2 o boşluğu kapatır ve
// `default-warehouse.job.ts`in kendi uyarısını ÖLÇER: "bu satır olmadan
// `resolveTargetWarehouseId` varsayılan bulamaz ve yeni toplar DEPOSUZ doğar."
//
// ORTAM BAĞIMSIZ: zincirin her ön koşulu (ürün · müşteri · kalite · istasyon ·
// rota) bu dosyada TST- damgasıyla KURULUR. `findFirst` ile "herhangi bir kayıt"
// aranmaz — temiz bir fixture DB'sinde fabrikanın istasyonları/rotaları yoktur ve
// öyle bir bekçi ya düşer ya vakumen yeşil kalır.
//
// jest/vitest YOK (CLAUDE.md).
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { Prisma, ItemType, RollStatus, StationKind, StationType, ShipmentStatus, StepStatus } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { strictMi } from "./lib/http-bekci-kapisi";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const PRE = `TST-AKIS-${STAMP}`;
const SHIPMENT_CONFIRM_KEY = "shipping.confirmationEnabled";

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
function atla(label: string, sebep: string): void {
  // Sessiz atlama YOK: sebep basılır, sayaç özet satırında beyan edilir ve
  // TEKSERP_STRICT=1 altında atlama KIRMIZIDIR (paket kararı burada verilir).
  if (strictMi()) { fail++; console.log(`  ✗ FAIL: ${label} — ${sebep} (TEKSERP_STRICT=1 — atlama kırmızıdır.)`); return; }
  atlanan++; console.log(`  ⏭️  ${label} — ${sebep}`);
}

// ── Temizlik defteri (FK sırasına göre boşaltılır) ───────────────────────────
const olusturulan = {
  order: [] as string[], wo: [] as string[], roll: [] as string[],
  sack: [] as string[], shipment: [] as string[], ret: [] as string[],
  route: [] as string[], station: [] as string[],
  item: [] as string[], customer: [] as string[], grade: [] as string[],
  user: [] as string[],
};
let onayBayragiEski: Prisma.JsonValue | null | undefined;

interface Res { status: number; body: Record<string, unknown>; }

async function main(): Promise<void> {
  // ═══ §0 — HEDEF KAPISI ════════════════════════════════════════════════════
  // Bu bekçi GLOBAL durum yazar (`shipping.confirmationEnabled`), dolayısıyla
  // CLAUDE.md'nin "yazan bekçinin İLK adımı" kuralı burada geçerli.
  const engel = hedefDbEngeli();
  if (engel) { console.error(`\n❌ ${engel}\n`); fail++; return; }

  console.log("=== Uçtan Uca Üretim Akışı (HTTP) ===\n");

  // ═══ §1 — BOOT UZLAŞTIRMASI: KOŞTUR ve ÖLÇ (varsayma) ═════════════════════
  console.log("── §1 Boot uzlaştırması ──");
  const izin = await reconcilePermissionCatalog();
  check("§1a izin kataloğu uzlaştı", izin !== null && typeof izin === "object", `eklenen=${String((izin as { added?: unknown })?.added ?? "?")}`);
  check("§1b izin tablosu DOLU (fixture'ın ön koşulu)", (await prisma.permission.count()) > 0);

  const depo = await ensureDefaultWarehouse();
  const varsayilanDepo = await prisma.warehouse.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true, name: true } });
  check("§1c ⭐ VARSAYILAN DEPO var (yoksa yeni toplar deposuz doğar)", varsayilanDepo !== null, varsayilanDepo?.name ?? `job=${JSON.stringify(depo)}`);
  if (!varsayilanDepo) { console.error("\n❌ Varsayılan depo yok — depo adımı ölçülemez, zincir kırılır.\n"); return; }

  // ═══ §2 — ÜRÜNÜN app'i GERÇEKTEN dinliyor (dinleyici SUT'un) ══════════════
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    const r = await fetch(`${base}${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    let body: Record<string, unknown> = {};
    try { body = (await r.json()) as Record<string, unknown>; } catch { body = {}; }
    return { status: r.status, body };
  };
  const veri = (r: Res) => (r.body.data ?? {}) as Record<string, unknown>;

  try {
    // ═══ §3 — FİKSTÜR: zincirin ön koşulunu KENDİ kur ═══════════════════════
    console.log("\n── §3 Fikstür (ortamdan bağımsız) ──");
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const lg = await call("POST", "/api/auth/login", { body: { username: cred.username, password: cred.password, clientType: "electron" } });
    const token = String((veri(lg) as { token?: string }).token ?? "");
    check("§3a login → 200 + token", lg.status === 200 && token.length > 0, `status=${lg.status}`);
    if (!token) { console.error("\n❌ Token alınamadı — zincir kurulamaz.\n"); fail++; return; }

    const item = await prisma.item.create({ data: { code: `${PRE}-URN`, name: `${PRE} Kumaş`, itemType: ItemType.FABRIC }, select: { id: true } });
    olusturulan.item.push(item.id);
    const customer = await prisma.customer.create({ data: { code: `${PRE}-MUS`, name: `${PRE} Müşteri` }, select: { id: true } });
    olusturulan.customer.push(customer.id);
    // targetStatus VARSAYILANI SCRAP — açıkça WAREHOUSE yazılmazsa tambur kesimi
    // topu fireye atar ve depo adımı hiç doğmaz.
    const grade = await prisma.qualityGrade.create({
      data: { code: `${PRE}-K1`, name: `${PRE} 1.Kalite`, targetStatus: RollStatus.WAREHOUSE },
      select: { id: true, code: true, targetStatus: true },
    });
    olusturulan.grade.push(grade.id);
    check("§3b kalite kademesi targetStatus=WAREHOUSE", grade.targetStatus === RollStatus.WAREHOUSE, grade.targetStatus);

    // `appliesQuality` VARSAYILANI false — PROCESS_QC istasyonu kalite yeteneği
    // olmadan doğarsa KK2 yazamaz (kalite = istasyon yeteneği, boğaz ikiz).
    const kursunSt = await prisma.station.create({
      data: { code: `${PRE}-KRS`, name: `${PRE} Kurşun+KK2`, type: StationType.INTERNAL, kind: StationKind.PROCESS_QC, appliesQuality: true },
      select: { id: true },
    });
    olusturulan.station.push(kursunSt.id);
    const tamburSt = await prisma.station.create({
      data: { code: `${PRE}-TMB`, name: `${PRE} Tambur`, type: StationType.INTERNAL, kind: StationKind.TAMBUR, appliesQuality: true },
      select: { id: true },
    });
    olusturulan.station.push(tamburSt.id);
    const route = await prisma.route.create({
      data: { name: `${PRE} Rota`, steps: { create: [{ stationId: kursunSt.id, sequence: 1 }, { stationId: tamburSt.id, sequence: 2 }] } },
      select: { id: true },
    });
    olusturulan.route.push(route.id);
    check("§3c rota kuruldu (PROCESS_QC → TAMBUR)", true, `route=${route.id.slice(0, 8)}`);

    // Sevk onayı AÇIK: kapalıyken `POST /shipments` tek adımda DISPATCHED eder ve
    // PLANNED → DISPATCHED geçişi HİÇ ölçülmez. Eski değer `finally`de BİREBİR geri yüklenir.
    const eski = await prisma.systemSetting.findUnique({ where: { key: SHIPMENT_CONFIRM_KEY }, select: { value: true } });
    onayBayragiEski = eski ? eski.value : null;
    await prisma.systemSetting.upsert({
      where: { key: SHIPMENT_CONFIRM_KEY },
      create: { key: SHIPMENT_CONFIRM_KEY, value: true, description: "TEST — sevk onayı (akış bekçisi)" },
      update: { value: true },
    });

    // ═══ §4 — ZİNCİR ════════════════════════════════════════════════════════
    console.log("\n── §4 Zincir ──");

    // HOP1: Sipariş (satırlar gövdede)
    const siparis = await call("POST", "/api/orders", {
      token,
      body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: item.id, quantity: 100, width: 180 }] },
    });
    check("HOP1 POST /api/orders → 201", siparis.status === 201, `status=${siparis.status} ${JSON.stringify(siparis.body.details ?? siparis.body.message ?? "")}`);
    const orderId = String((veri(siparis) as { id?: string }).id ?? "");
    if (!orderId) { console.error("\n❌ Sipariş kurulamadı — zincir burada durur.\n"); fail++; return; }
    olusturulan.order.push(orderId);
    const lineId = (await prisma.orderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } })).id;
    check("HOP1 sipariş satırı doğdu, shippedQty=0", Number((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { shippedQty: true } })).shippedQty) === 0);

    // HOP2: KK1 — ham giriş (kalite ZORUNLU, yalnız bu HTTP yolunda)
    // Kalite zorunluluğu BAYRAĞA bağlı (`quality.gradeRequiredEnabled` +
    // `opts.gradeRequired`, inventory.service.ts:978). Bekçi bayrağı DEĞİŞTİRMEZ —
    // ölçtüğü rejimi OKUR ve o rejimin doğru cevabını iddia eder; aksi hâlde
    // "400 bekliyorum" cümlesi bayrağı kapalı bir kurulumda yalan olurdu.
    const gradeFlag = await prisma.systemSetting.findUnique({ where: { key: "quality.gradeRequiredEnabled" }, select: { value: true } });
    const gradeZorunlu = gradeFlag?.value === true;
    const kaliteSiz = await call("POST", "/api/rolls/initial-entry", { token, body: { itemId: item.id, initialQty: 100 } });
    const kaliteSizId = String((veri(kaliteSiz) as { id?: string }).id ?? "");
    if (kaliteSizId) olusturulan.roll.push(kaliteSizId);
    check(
      gradeZorunlu ? "HOP2 negatif: kalite zorunlu rejimi → qualityGrade yok → 400" : "HOP2 kalite serbest rejimi → qualityGrade yok → 201",
      gradeZorunlu ? kaliteSiz.status === 400 : kaliteSiz.status === 201,
      `rejim=${gradeZorunlu ? "zorunlu" : "serbest"} status=${kaliteSiz.status}`,
    );
    const kk1 = await call("POST", "/api/rolls/initial-entry", {
      token,
      body: { clientToken: randomUUID(), itemId: item.id, initialQty: 100, width: 180, qualityGrade: grade.code },
    });
    check("HOP2 POST /api/rolls/initial-entry → 201", kk1.status === 201, `status=${kk1.status} ${JSON.stringify(kk1.body.details ?? kk1.body.message ?? "")}`);
    const rollId = String((veri(kk1) as { id?: string }).id ?? "");
    const barcode = String((veri(kk1) as { barcode?: string }).barcode ?? "");
    if (!rollId || !barcode) { console.error("\n❌ KK1 topu doğmadı — zincir burada durur.\n"); fail++; return; }
    olusturulan.roll.push(rollId);
    check("HOP2 top STOCK statüsünde", (await prisma.roll.findUniqueOrThrow({ where: { id: rollId }, select: { status: true } })).status === RollStatus.STOCK);

    // HOP3: İş emri + topu bağla (TEK HTTP yolu quick-start)
    const wo = await call("POST", "/api/work-orders/quick-start", {
      token,
      body: { clientToken: randomUUID(), routeTemplateId: route.id, rollBarcodes: [barcode], orderLineIds: [lineId], targetItemId: item.id, width: 180 },
    });
    check("HOP3 POST /api/work-orders/quick-start → 201", wo.status === 201, `status=${wo.status} ${JSON.stringify(wo.body.details ?? wo.body.message ?? "")}`);
    // Yanıt şekli `data: { workOrder, attached, errors, dispatch, batch }`
    // (workorder.service.ts:245) — `data.id` DEĞİL.
    const woId = String(((veri(wo) as { workOrder?: { id?: string } }).workOrder ?? {}).id ?? "");
    if (!woId) { console.error("\n❌ İş emri kurulamadı — zincir burada durur.\n"); fail++; return; }
    olusturulan.wo.push(woId);
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true, station: { select: { kind: true } } } });
    // Bu bir YETENEK sorusu değil ROTA TOPOLOJİSİ iddiasıdır: fikstürün kurduğu
    // rotanın iş emrine hangi istasyon TÜRLERİ olarak klonlandığını kilitler.
    // `stepCanApplyQuality` burada yanlış cevap verirdi — yeteneği okur, türü değil.
    // eslint-disable-next-line no-restricted-syntax
    const rotaDogru = steps.length === 2 && steps[0].station.kind === StationKind.PROCESS_QC && steps[1].station.kind === StationKind.TAMBUR;
    check("HOP3 rota klonlandı: 1.adım PROCESS_QC, 2.adım TAMBUR", rotaDogru, steps.map((s) => s.station.kind).join("→"));
    check("HOP3 WO sipariş satırına bağlandı", (await prisma.workOrderToOrderLine.count({ where: { workOrderId: woId, orderLineId: lineId } })) === 1);
    if (steps.length !== 2) { console.error("\n❌ Rota beklenen iki adımı üretmedi.\n"); fail++; return; }
    const kursunStep = steps[0].id;

    // HOP4: Kurşun + KK2
    const qc2 = await call("POST", "/api/kursun-qc/complete-qc2", { token, body: { rollId, stepId: kursunStep } });
    check("HOP4 POST /api/kursun-qc/complete-qc2 → 201", qc2.status === 201, `status=${qc2.status} ${JSON.stringify(qc2.body.details ?? qc2.body.message ?? "")}`);

    // HOP5: PROCESS_QC adımını kapat → top Tambur adımına taşınır
    const finish = await call("POST", "/api/kursun-qc/finish-step", { token, body: { stepId: kursunStep } });
    check("HOP5 POST /api/kursun-qc/finish-step → 200", finish.status === 200, `status=${finish.status} ${JSON.stringify(finish.body.details ?? finish.body.message ?? "")}`);
    check("HOP5 kurşun adımı COMPLETED", (await prisma.workOrderStep.findUniqueOrThrow({ where: { id: kursunStep }, select: { status: true } })).status === StepStatus.COMPLETED);

    // HOP6: Tambur finalize — rotanın SON adımı topu finalize eder
    const fin = await call("POST", "/api/tambur/finalize", {
      token,
      body: { rollId, cuts: [{ length: 60, qualityGrade: grade.code }, { length: 40, qualityGrade: grade.code }] },
    });
    check("HOP6 POST /api/tambur/finalize → 200", fin.status === 200, `status=${fin.status} ${JSON.stringify(fin.body.details ?? fin.body.message ?? "")}`);
    const cocuklar = await prisma.roll.findMany({ where: { parentRollId: rollId }, select: { id: true, status: true, warehouseId: true, barcode: true } });
    for (const c of cocuklar) olusturulan.roll.push(c.id);
    check("HOP6 iki çocuk top doğdu", cocuklar.length === 2, `${cocuklar.length} adet`);

    // HOP7: DEPO — bu, §1c'de koşturduğumuz boot işinin KARŞILIĞIDIR
    check("HOP7 ⭐ çocuk toplar WAREHOUSE statüsünde", cocuklar.length > 0 && cocuklar.every((c) => c.status === RollStatus.WAREHOUSE), cocuklar.map((c) => c.status).join(","));
    check("HOP7 ⭐ çocuk topların warehouseId DOLU (boot uzlaştırmasının ölçümü)",
      cocuklar.length > 0 && cocuklar.every((c) => c.warehouseId !== null),
      cocuklar.every((c) => c.warehouseId === varsayilanDepo.id) ? "hepsi varsayılan depoda" : cocuklar.map((c) => String(c.warehouseId)).join(","));
    if (cocuklar.length === 0) { console.error("\n❌ Tambur çocuk top üretmedi — sevkiyat adımı ölçülemez.\n"); fail++; return; }

    // HOP8-10: Çuval aç → topu okut → tart
    const cuval = await call("POST", "/api/shipping/sacks", { token, body: { clientToken: randomUUID(), customerId: customer.id } });
    check("HOP8 POST /api/shipping/sacks → 201", cuval.status === 201, `status=${cuval.status} ${JSON.stringify(cuval.body.details ?? cuval.body.message ?? "")}`);
    const sackId = String((veri(cuval) as { id?: string }).id ?? "");
    if (!sackId) { console.error("\n❌ Çuval açılamadı.\n"); fail++; return; }
    olusturulan.sack.push(sackId);
    for (const c of cocuklar) {
      const okut = await call("POST", `/api/shipping/sacks/${sackId}/scan`, { token, body: { barcode: c.barcode } });
      check(`HOP9 çuvala okut (${c.barcode}) → 200`, okut.status === 200, `status=${okut.status} ${JSON.stringify(okut.body.details ?? okut.body.message ?? "")}`);
    }
    check("HOP9 iki top çuvalda", (await prisma.roll.count({ where: { sackId } })) === 2);
    const tarti = await call("POST", `/api/shipping/sacks/${sackId}/weigh`, { token, body: { weightKg: 42.5, source: "MANUAL" } });
    check("HOP10 POST /api/shipping/sacks/:id/weigh → 200", tarti.status === 200, `status=${tarti.status}`);

    // HOP11: Sevkiyat (PLANNED — onay bayrağı açık)
    const sevk = await call("POST", "/api/shipping/shipments", {
      token,
      body: { clientToken: randomUUID(), sackIds: [sackId], customerId: customer.id, orderIds: [orderId] },
    });
    check("HOP11 POST /api/shipping/shipments → 201", sevk.status === 201, `status=${sevk.status} ${JSON.stringify(sevk.body.details ?? sevk.body.message ?? "")}`);
    const shipmentId = String((veri(sevk) as { id?: string }).id ?? "");
    if (!shipmentId) { console.error("\n❌ Sevkiyat kurulamadı.\n"); fail++; return; }
    olusturulan.shipment.push(shipmentId);
    const durum1 = (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { status: true } })).status;
    check("HOP11 sevkiyat PLANNED (onay bayrağı açık)", durum1 === ShipmentStatus.PLANNED, durum1);
    check("HOP11 PLANNED'de shippedQty hâlâ 0 (düşüş sevkte)", Number((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { shippedQty: true } })).shippedQty) === 0);

    // HOP12: Sevk et → DISPATCHED
    const dispatch = await call("POST", `/api/shipping/shipments/${shipmentId}/dispatch`, { token, body: { plateNumber: "34TST123", driverName: `${PRE} Şoför` } });
    check("HOP12 POST /api/shipping/shipments/:id/dispatch → 200", dispatch.status === 200, `status=${dispatch.status} ${JSON.stringify(dispatch.body.details ?? dispatch.body.message ?? "")}`);
    const durum2 = (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { status: true } })).status;
    check("HOP12 sevkiyat DISPATCHED", durum2 === ShipmentStatus.DISPATCHED, durum2);
    check("HOP12 toplar SHIPPED", (await prisma.roll.count({ where: { id: { in: cocuklar.map((c) => c.id) }, status: RollStatus.SHIPPED } })) === cocuklar.length);
    const sevkEdilen = Number((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { shippedQty: true } })).shippedQty);
    check("HOP12 ⭐ shippedQty terfi etti (tahsis sevk anında)", sevkEdilen > 0, `shippedQty=${sevkEdilen}`);

    // HOP13-14: İade → storno. Sevk rakamı BRÜT kalır; iade ayrı belgeyle kapanır.
    const iade = await call("POST", "/api/returns", { token, body: { rollIds: [cocuklar[0].id], orderId, reasonText: `${PRE} iade` } });
    check("HOP13 POST /api/returns → 201", iade.status === 201, `status=${iade.status} ${JSON.stringify(iade.body.details ?? iade.body.message ?? "")}`);
    const returnId = String((veri(iade) as { id?: string }).id ?? "");
    if (returnId) {
      olusturulan.ret.push(returnId);
      const brut = Number((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { shippedQty: true } })).shippedQty);
      check("HOP13 ⭐ sevk rakamı BRÜT kaldı (iade çıkış belgesini düzeltmez)", brut === sevkEdilen, `${sevkEdilen} → ${brut}`);
      const storno = await call("POST", `/api/returns/${returnId}/cancel`, { token, body: { reason: `${PRE} storno gerekçesi` } });
      check("HOP14 POST /api/returns/:id/cancel → 200", storno.status === 200, `status=${storno.status} ${JSON.stringify(storno.body.details ?? storno.body.message ?? "")}`);
    } else {
      atla("HOP13/14 iade + storno", `iade kurulamadı (status=${iade.status})`);
    }

    // HOP15: SoD — `shipping:write` sevk stornosunu KAPSAMAZ (ayrı izin)
    const izinSatir = await prisma.permission.findFirst({ where: { code: "shipping:write" }, select: { id: true } });
    if (!izinSatir) {
      atla("HOP15 SoD negatifi", "`shipping:write` izin satırı katalogda yok");
    } else {
      const parola = kosumaOzguParola();
      const bcrypt = await import("bcryptjs");
      const dar = await prisma.user.create({
        data: {
          username: `${PRE}-DAR`, passwordHash: await bcrypt.hash(parola, 10), fullName: `${PRE} Dar Yetki`, isActive: true,
          permissions: { create: { permissionId: izinSatir.id, grantedById: cred.id } },
        }, select: { id: true, username: true },
      });
      olusturulan.user.push(dar.id);
      const darLg = await call("POST", "/api/auth/login", { body: { username: dar.username, password: parola, clientType: "electron" } });
      const darToken = String((veri(darLg) as { token?: string }).token ?? "");
      check("HOP15 dar yetkili kullanıcı login → 200", darLg.status === 200 && darToken.length > 0, `status=${darLg.status}`);
      if (darToken) {
        const red = await call("POST", `/api/shipping/shipments/${shipmentId}/undo-dispatch`, { token: darToken, body: { reason: `${PRE} yetkisiz storno denemesi` } });
        check("HOP15 ⭐ shipping:write ile sevk stornosu → 403 (SoD ayrı izin)", red.status === 403, `status=${red.status}`);
      } else {
        atla("HOP15 SoD negatifi", "dar yetkili token alınamadı");
      }
    }

    // ═══ §5 — İDEMPOTENCY REPLAY: dört durum + "kesin 4xx'te token YAPIŞMAZ" ═
    // `token-replay.helper.ts` sözleşmesi bugüne kadar HTTP'den hiç ölçülmedi.
    // Dördüncü durum saha vakasıdır: çevrimdışı kuyruk aynı token'ı saklar, bu
    // arada süpervizör topu iptal eder; "cached başarı" dönmek 100 m kumaşı
    // sistemde yok eder ve hiçbir ekranda hata görünmez.
    console.log("\n── §5 clientToken replay (dört durum) ──");
    const rt = randomUUID();
    const rp1 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: rt, itemId: item.id, initialQty: 40, width: 180, qualityGrade: grade.code } });
    const rpId = String((veri(rp1) as { id?: string }).id ?? "");
    if (rpId) olusturulan.roll.push(rpId);
    const rp2 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: rt, itemId: item.id, initialQty: 40, width: 180, qualityGrade: grade.code } });
    check("§5② aynı token + AYNI yük → cached AYNI top (yeni top DOĞMAZ)",
      rp2.status === 201 && String((veri(rp2) as { id?: string }).id ?? "") === rpId, `status=${rp2.status}`);
    const rp3 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: rt, itemId: item.id, initialQty: 999, width: 180, qualityGrade: grade.code } });
    check("§5③ aynı token + BAŞKA yük → 409 CLIENT_TOKEN_COLLISION",
      rp3.status === 409 && ((rp3.body.details ?? {}) as { code?: string }).code === "CLIENT_TOKEN_COLLISION",
      `status=${rp3.status} code=${String(((rp3.body.details ?? {}) as { code?: string }).code)}`);
    await call("DELETE", `/api/rolls/${rpId}?reason=${encodeURIComponent(`${PRE} replay sondası`)}&confirmActive=true`, { token });
    const rp4 = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: rt, itemId: item.id, initialQty: 40, width: 180, qualityGrade: grade.code } });
    check("§5④ ⭐ token'lı top İPTAL edildikten sonra aynı token → 409 ENTRY_CANCELLED (cached BAŞARI değil)",
      rp4.status === 409 && ((rp4.body.details ?? {}) as { code?: string }).code === "ENTRY_CANCELLED",
      `status=${rp4.status} code=${String(((rp4.body.details ?? {}) as { code?: string }).code)}`);
    // AYRIM: token yalnız sonucu BELİRSİZ bırakan hatada yapışır. Kesin 4xx'te
    // hiçbir şey yazılmamıştır; token yapışsaydı istemci o denemeyi bir daha
    // gönderemez ve giriş kalıcı olarak kaybolurdu.
    const kt = randomUUID();
    const kesin4xx = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: kt, itemId: item.id, initialQty: -5, qualityGrade: grade.code } });
    const tekrar = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: kt, itemId: item.id, initialQty: 40, width: 180, qualityGrade: grade.code } });
    const tekrarId = String((veri(tekrar) as { id?: string }).id ?? "");
    if (tekrarId) olusturulan.roll.push(tekrarId);
    check("§5⭐ kesin 4xx (Zod 400) token'ı YAPIŞTIRMAZ — aynı token tekrar kullanılabilir",
      kesin4xx.status === 400 && tekrar.status === 201, `400=${kesin4xx.status} tekrar=${tekrar.status}`);

    // ═══ §6 — ATOMİK CLAIM YARIŞI (HTTP üzerinden) ══════════════════════════
    // `updateMany WHERE {id, beklenen-durum}` + `count===0 → 409` kalıbı bugüne
    // kadar yalnız servis katmanından sınandı. İki EŞZAMANLI HTTP isteğinden tam
    // biri geçmeli; ikisi de geçerse claim kalıbı kırılmış demektir.
    console.log("\n── §6 atomik claim (eşzamanlı iki istek) ──");
    const yr = await call("POST", "/api/rolls/initial-entry", { token, body: { clientToken: randomUUID(), itemId: item.id, initialQty: 30, width: 180, qualityGrade: grade.code } });
    const yrId = String((veri(yr) as { id?: string }).id ?? "");
    if (yrId) olusturulan.roll.push(yrId);
    const [y1, y2] = await Promise.all([
      call("POST", `/api/rolls/${yrId}/prepare-for-sale`, { token }),
      call("POST", `/api/rolls/${yrId}/prepare-for-sale`, { token }),
    ]);
    const statuler = [y1.status, y2.status].sort((a, b) => a - b);
    check("§6 ⭐ aynı topa eşzamanlı iki geçiş → tam biri 200, diğeri 409",
      statuler[0] === 200 && statuler[1] === 409, `statüler=${statuler.join("/")}`);
    check("§6 top tek kez terfi etti (WAREHOUSE)",
      (await prisma.roll.findUniqueOrThrow({ where: { id: yrId }, select: { status: true } })).status === RollStatus.WAREHOUSE);

    // ═══ §7 — SEVK STORNOSU: brütü DÜŞÜRÜR (iadeden farkı) ══════════════════
    // HOP13 iadenin brütü DEĞİŞTİRMEDİĞİNİ ölçtü. Storno ters yönde çalışır ve
    // farkın tamamı budur: iade "mal geri geldi" (çıkış belgesi durur), storno
    // "çıkış hiç olmadı" (belge iptal, karşılama geri alınır). Aynı sayının iki
    // farklı cevabı olduğu yer burasıdır.
    console.log("\n── §7 sevk stornosu ≠ iade ──");
    const undo = await call("POST", `/api/shipping/shipments/${shipmentId}/undo-dispatch`, { token, body: { reason: `${PRE} sevk stornosu` } });
    check("§7 POST /api/shipping/shipments/:id/undo-dispatch → 200", undo.status === 200, `status=${undo.status} ${JSON.stringify(undo.body.details ?? undo.body.message ?? "")}`);
    const durum3 = (await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { status: true } })).status;
    check("§7 sevkiyat PLANNED'a döndü (iptal değil — çuvallar serbest)", durum3 === ShipmentStatus.PLANNED, durum3);
    const sonBrut = Number((await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId }, select: { shippedQty: true } })).shippedQty);
    check("§7 ⭐ storno shippedQty'yi GERİ ALDI (iade almazdı)", sonBrut === 0, `${sevkEdilen} → ${sonBrut}`);
  } finally {
    server.close();
  }
}

async function temizlik(): Promise<void> {
  console.log("\n🧹 Temizlik...");
  const y = <T>(p: Promise<T>) => p.catch(() => undefined);
  // Global bayrak BİREBİR eski hâline (yoksa satırı sil) — "varsayılana çek" DEĞİL.
  if (onayBayragiEski !== undefined) {
    if (onayBayragiEski === null) await y(prisma.systemSetting.delete({ where: { key: SHIPMENT_CONFIRM_KEY } }));
    else await y(prisma.systemSetting.update({ where: { key: SHIPMENT_CONFIRM_KEY }, data: { value: onayBayragiEski as Prisma.InputJsonValue } }));
  }
  const { route, station, item, customer, grade, user } = olusturulan;
  // ⚠️ KİMLİK YAKALAMASINA GÜVENME. Zincirin bir adımı beklenmedik bir yanıt
  // şekli döndürürse (ölçüldü: quick-start `data.workOrder.id` verir, `data.id`
  // DEĞİL) o kaydın id'si defterimize hiç girmez ve kayıt ARKADA KALIR — üstelik
  // kendi fikstürümüzü de kilitler (yetim WO → `workOrderToOrderLine` RESTRICT →
  // sipariş silinemez; yetim adım → istasyon silinemez). Bu yüzden silinecek
  // küme, HER ZAMAN yakalanan FİKSTÜR id'lerinden TÜRETİLİR: bu koşumun ürünü,
  // müşterisi ve istasyonları neyi doğurduysa o gider.
  const bul = async <T>(kosul: boolean, f: () => Promise<T[]>): Promise<T[]> => (kosul ? f().catch(() => [] as T[]) : []);
  const teklestir = (...gruplar: string[][]) => [...new Set(gruplar.flat())];

  const woTuretilen = (await bul(station.length > 0, () =>
    prisma.workOrder.findMany({ where: { steps: { some: { stationId: { in: station } } } }, select: { id: true } }))).map((x) => x.id);
  const wo = teklestir(olusturulan.wo, woTuretilen);
  const rollTuretilen = (await bul(item.length > 0, () =>
    prisma.roll.findMany({ where: { itemId: { in: item } }, select: { id: true } }))).map((x) => x.id);
  const roll = teklestir(olusturulan.roll, rollTuretilen);
  const orderTuretilen = (await bul(customer.length > 0, () =>
    prisma.order.findMany({ where: { customerId: { in: customer } }, select: { id: true } }))).map((x) => x.id);
  const order = teklestir(olusturulan.order, orderTuretilen);
  const sackTuretilen = (await bul(customer.length > 0, () =>
    prisma.sack.findMany({ where: { customerId: { in: customer } }, select: { id: true } }))).map((x) => x.id);
  const sack = teklestir(olusturulan.sack, sackTuretilen);
  const shipmentTuretilen = (await bul(customer.length > 0, () =>
    prisma.shipment.findMany({ where: { customerId: { in: customer } }, select: { id: true } }))).map((x) => x.id);
  const shipment = teklestir(olusturulan.shipment, shipmentTuretilen);
  const retTuretilen = (await bul(roll.length > 0, () =>
    prisma.rollReturn.findMany({ where: { rollId: { in: roll } }, select: { id: true } }))).map((x) => x.id);
  const ret = teklestir(olusturulan.ret, retTuretilen);
  // İade defteri → tahsis (Restrict) → çuval/sevkiyat bağı → çuval → sevkiyat
  await y(prisma.rollReturn.deleteMany({ where: { id: { in: ret } } }));
  await y(prisma.sackAllocation.deleteMany({ where: { sackId: { in: sack } } }));
  await y(prisma.roll.updateMany({ where: { id: { in: roll } }, data: { sackId: null, shipmentId: null } }));
  await y(prisma.sack.deleteMany({ where: { id: { in: sack } } }));
  await y(prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipment } } }));
  await y(prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...shipment, ...sack] } } }));
  await y(prisma.shipment.deleteMany({ where: { id: { in: shipment } } }));
  // Top defterleri → çocuk (self-FK) → ebeveyn
  await y(prisma.rollVariance.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.rollOperation.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.rollMovement.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.rollProperty.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.rollError.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.warehouseMovement.deleteMany({ where: { rollId: { in: roll } } }));
  await y(prisma.roll.deleteMany({ where: { id: { in: roll }, parentRollId: { not: null } } }));
  await y(prisma.roll.deleteMany({ where: { id: { in: roll } } }));
  // İş emri ağacı
  for (const id of wo) {
    await y(prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }));
    await y(prisma.travelerCard.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.batch.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }));
    await y(prisma.workOrder.delete({ where: { id } }));
  }
  for (const id of order) {
    await y(prisma.orderLine.deleteMany({ where: { orderId: id } }));
    await y(prisma.order.delete({ where: { id } }));
  }
  // Fikstür master data
  await y(prisma.routeStep.deleteMany({ where: { routeId: { in: route } } }));
  await y(prisma.route.deleteMany({ where: { id: { in: route } } }));
  await y(prisma.station.deleteMany({ where: { id: { in: station } } }));
  await y(prisma.qualityGrade.deleteMany({ where: { id: { in: grade } } }));
  await y(prisma.item.deleteMany({ where: { id: { in: item } } }));
  await y(prisma.customer.deleteMany({ where: { id: { in: customer } } }));
  // Bekçinin yarattığı kullanıcı: `system_logs.userId` RESTRICT → önce oturum+log
  for (const id of user) {
    await y(prisma.session.deleteMany({ where: { userId: id } }));
    await y(prisma.systemLog.deleteMany({ where: { userId: id } }));
    await y(prisma.userPermission.deleteMany({ where: { userId: id } }));
    await y(prisma.user.delete({ where: { id } }));
  }
  // Audit satırları en son (recordId ile bağlı değil, FK yok)
  await y(prisma.systemLog.deleteMany({ where: { recordId: { in: [...roll, ...wo, ...order, ...sack, ...shipment, ...ret] } } }));
  console.log("🧹 Temizlik tamam.");
}

main()
  .catch((e) => { console.error("HATA:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await temizlik().catch((e) => console.error("temizlik hatası:", e instanceof Error ? e.message : e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan ? `, ${atlanan} atlandı` : ""} ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
