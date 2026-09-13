// =============================================================================
// SONDA — SİSTEM-TÜRETİMLİ KALİTE KODU: katalogda karşılığı yoksa ne olur?
// =============================================================================
// ⚠️ BU DOSYA ROLSÜZ/LİTERALSİZ KATALOGDA BUGÜN KIRMIZI VERİR. Yeşile çeviren
// `ea`nın CAKILI-VARSAYIM-KARAR.md **①** uygulamasıdır.
//
// İDDİA ①'İN KENDİ CÜMLESİ: "Rol damgası olmayan kurulum (ikinci müşteri,
// katalogu kendi kurar): rol atanmadan tambur kesimi ve tablet kesimi **400**
// 'kalite kataloğunda 1. kalite rolü atanmamış' (bugün sessiz WAREHOUSE'tu) —
// fail-closed." Sonda **400** diyor; "ya hata ya çocuk doğmasın" DEMİYOR.
//
// BUGÜNKÜ DAVRANIŞ (ölçüldü 2026-09-13, `tekserp_e2e_temiz_test` — katalogunda
// `1.KALITE`/`A1`/`FIRE` satırlarının HİÇBİRİ yok, ağaç `8ce92cb3`):
//   `POST /api/tambur/:id/cut` `{lengthMeters, status:"WAREHOUSE"}` (operatör
//   kodu YOK) → **201**. Servis `statusToQuality["WAREHOUSE"]` = `"1.KALITE"`
//   literaline düşüyor (`tambur.service.ts:3093`) ve LENIENT çözüyor
//   (`quality-grade.helper.ts:16` — katalogda yoksa `null` döner, fırlatmaz).
//   Sonuç: çocuk top `WAREHOUSE` doğdu, `qualityGrade="1.KALITE"` STRING'i
//   yazıldı, `qualityGradeId` **NULL** kaldı = katalogda karşılığı olmayan
//   YETİM KOD. `warnings` boş. Fabrika "1. kaliteye ayırdım" sanıyor, katalogda
//   öyle bir şey yok ve FIRE süzgeçleri bu topu hiçbir kovada bulamıyor.
//   Kontrol (`tekserp_e2e_test`, katalogda üç literal VAR): aynı çağrı → FK DOLU.
//
// ⚠️ İKİ REJİM, İKİ YÜKLEM — hiçbiri vakumen değil. Sonda hangi rejimde
// olduğunu ÖLÇER ve BASAR:
//   · rolsüz/literalsiz katalog → §3: kesim 400 vermeli, çocuk DOĞMAMALI.
//   · rollü/literalli katalog   → §4: kesim geçebilir ama çocuğun FK'sı DOLU
//     olmalı — yetim kod hiçbir rejimde meşru değildir.
// `ea` indikten sonra rejim sorusu kendiliğinden `role` kolonuna kayar (§1
// kolonu yoklar); sonda o gün DÜZENLENMEZ.
//
// ÖLÇÜLMEDİ / BEKÇİYE BAĞLANMADI AYRIMI: paket varsayılan hedefte
// (`tekserp_e2e_test`, katalogunda literaller VAR) §3 bugün KOŞMAZ — §4 koşar.
// Bu bir KAPSAM eksiğidir, bilgi eksiği değil: rolsüz rejim ÖLÇÜLDÜ (yukarıda),
// yalnız paketin varsayılan hedefinde tetiklenmiyor. Rolsüz rejimi paket içinde
// koşturmak katalogu değiştirmeyi gerektirir (kimlik alanı — `code` asla
// değişmez) ve bilinçli olarak YAPILMAZ; onun yerine temiz fikstür hedefi
// (`tekserp_e2e_temiz_test`) ile koşulur.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "node:crypto";
import { ItemType, RollStatus, StationKind, StationType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";

const STAMP = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
const PRE = `TST-KROL-${STAMP}`;

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}

const yarat = { order: [] as string[], wo: [] as string[], roll: [] as string[], route: [] as string[], station: [] as string[], item: [] as string[], customer: [] as string[], grade: [] as string[] };
interface Res { status: number; body: Record<string, unknown>; }

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`\n❌ ${engel}\n`); fail++; return; }
  console.log("=== SONDA: sistem-türetimli kalite kodu, katalogda karşılığı yoksa ===\n");

  await reconcilePermissionCatalog();
  await ensureDefaultWarehouse();

  // ═══ §1 — REJİM ÖLÇÜMÜ: "1. kalite" katalogda tanımlı mı? ═════════════════
  // `ea` sonrası soru `role = 'FIRST'` satırı var mı olur; öncesinde literal.
  // Kolon yoksa sorgu düşer ve literale geri düşeriz — sonda iki dünyada da koşar.
  let rolKolonuVar = false;
  let rolluSatir = 0;
  try {
    const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM quality_grades WHERE role = 'FIRST' AND "isActive" = true`,
    );
    rolKolonuVar = true;
    rolluSatir = Number(r[0]?.n ?? 0);
  } catch {
    rolKolonuVar = false;
  }
  const literalSatir = await prisma.qualityGrade.count({ where: { code: "1.KALITE" } });
  const birinciKaliteTanimli = rolKolonuVar ? rolluSatir > 0 : literalSatir > 0;
  console.log(`  ℹ️  rejim: ${rolKolonuVar ? `role kolonu VAR (FIRST rollü aktif satır=${rolluSatir})` : `role kolonu YOK (literal "1.KALITE" satırı=${literalSatir})`}`);
  console.log(`  ℹ️  "1. kalite" katalogda ${birinciKaliteTanimli ? "TANIMLI → §4 (kontrol) koşar" : "TANIMSIZ → §3 (asıl sonda) koşar"}`);

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

  try {
    const cred = await ensureTestAdmin({ password: kosumaOzguParola() });
    const lg = await call("POST", "/api/auth/login", { body: { username: cred.username, password: cred.password, clientType: "electron" } });
    const token = String((veri(lg) as { token?: string }).token ?? "");
    check("§1 login → token", token.length > 0, `status=${lg.status}`);
    if (!token) return;

    // ═══ §2 — FİKSTÜR + POZİTİF KONTROL ══════════════════════════════════════
    // Fikstürün KENDİ kalite kodu katalogda VARDIR: "kesim ucu çalışıyor mu"
    // sorusu, "sistem-türetimli kod çözülüyor mu" sorusundan AYRI ölçülür.
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

    /** Topu TAMBUR adımına kadar getirir. */
    const tamburaGetir = async (etiket: string) => {
      const sip = await call("POST", "/api/orders", { token, body: { clientToken: randomUUID(), customerId: customer.id, lines: [{ itemId: item.id, quantity: 100, width: 180 }] } });
      const orderId = String((veri(sip) as { id?: string }).id ?? "");
      if (!orderId) throw new Error(`sipariş kurulamadı (${etiket}): ${sip.status} ${mesaj(sip)}`);
      yarat.order.push(orderId);
      const lineId = (await prisma.orderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } })).id;
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
      return rollId;
    };

    console.log("\n── §2 Pozitif kontrol: OPERATÖR kodu verilen kesim ──");
    const kontrolRoll = await tamburaGetir("kontrol");
    const kontrolKes = await call("POST", `/api/tambur/${kontrolRoll}/cut`, { token, body: { clientToken: randomUUID(), lengthMeters: 40, status: "WAREHOUSE", qualityGrade: grade.code } });
    check("§2a katalogdaki kodla kesim → 201 (kesim ucu çalışıyor, kapı buraya ULAŞIYOR)", kontrolKes.status === 201, `status=${kontrolKes.status} ${mesaj(kontrolKes)}`);
    const kontrolCocuk = await prisma.roll.findMany({ where: { parentRollId: kontrolRoll }, select: { id: true, qualityGrade: true, qualityGradeId: true, status: true } });
    for (const c of kontrolCocuk) yarat.roll.push(c.id);
    check("§2b kontrol çocuğunun kalite FK'sı DOLU", kontrolCocuk.length === 1 && kontrolCocuk[0].qualityGradeId === grade.id, kontrolCocuk.map((c) => `${c.qualityGrade}/${c.qualityGradeId ? "FK" : "NULL"}`).join(","));

    // ═══ §3/§4 — SİSTEM-TÜRETİMLİ KOD: operatör kodu YOK ═════════════════════
    console.log(`\n── ${birinciKaliteTanimli ? "§4" : "§3"} Sistem-türetimli kod (qualityGrade GÖNDERİLMİYOR) ──`);
    const sondaRoll = await tamburaGetir("sonda");
    const kes = await call("POST", `/api/tambur/${sondaRoll}/cut`, { token, body: { clientToken: randomUUID(), lengthMeters: 40, status: "WAREHOUSE" } });
    const cocuk = await prisma.roll.findMany({ where: { parentRollId: sondaRoll }, select: { id: true, status: true, qualityGrade: true, qualityGradeId: true } });
    for (const c of cocuk) yarat.roll.push(c.id);
    console.log(`  ℹ️  kesim → ${kes.status}; doğan çocuk: ${cocuk.length === 0 ? "YOK" : cocuk.map((c) => `${c.status} qualityGrade="${c.qualityGrade}" FK=${c.qualityGradeId ? "DOLU" : "NULL"}`).join(" · ")}`);

    if (!birinciKaliteTanimli) {
      // ── §3: ASIL SONDA (rolsüz/literalsiz katalog) ──
      check("§3a ⭐ '1. kalite' tanımsızken kesim 400 verir (①: fail-closed)",
        kes.status === 400,
        kes.status === 201
          ? "201 döndü — `statusToQuality` literali LENIENT çözülüyor (tambur.service.ts:3093 → quality-grade.helper.ts:16). ① rol çözümü + strict resolve ile kapanır."
          : `status=${kes.status} ${mesaj(kes)}`);
      check("§3b ⭐ hata mesajı EKSİĞİ SÖYLÜYOR (rol/kalite tanımı yok), genel 'bulunamadı' değil",
        // ⚠️ `\brol` KELİME SINIRIYLA: çıplak `rol` deseni "kont**rol**" içinde de
        // eşleşir ve alakasız bir 400 mesajı bu yüklemi sahte yeşile düşürürdü.
        kes.status === 400 && /\brol|1\.\s?kalite|kalite kataloğ/i.test(mesaj(kes)),
        mesaj(kes).slice(0, 160));
      check("§3c ⭐ çocuk top DOĞMADI (fail-closed: yarım kayıt bırakmaz)",
        cocuk.length === 0,
        cocuk.length === 0 ? "" : `${cocuk.length} çocuk doğdu — ${cocuk.map((c) => c.status).join(",")}`);
    } else {
      // ── §4: KONTROL (rollü/literalli katalog) ──
      check("§4a '1. kalite' tanımlıyken kesim geçer", kes.status === 201, `status=${kes.status} ${mesaj(kes)}`);
      check("§4b ⭐ doğan çocuğun kalite FK'sı DOLU — YETİM KOD hiçbir rejimde meşru değil",
        cocuk.length === 1 && cocuk[0].qualityGradeId !== null,
        cocuk.map((c) => `qualityGrade="${c.qualityGrade}" FK=${c.qualityGradeId ? "DOLU" : "NULL(yetim)"}`).join(","));
    }

    // ═══ §5 — HER REJİMDE: yetim kod fabrikaya sızmasın ══════════════════════
    // Bu yüklem rejimden BAĞIMSIZ ve bu sondanın ürettiği toplarla sınırlı
    // (körlük zemini: sonda kendi topu yoksa 0 bulgu "bakılmadı" demektir).
    console.log("\n── §5 Yetim kod (rejimden bağımsız) ──");
    const kendiToplar = await prisma.roll.findMany({ where: { id: { in: yarat.roll } }, select: { barcode: true, qualityGrade: true, qualityGradeId: true } });
    check("§5a körlük zemini: sonda en az iki top üretti", kendiToplar.length >= 2, `${kendiToplar.length} top`);
    const yetim = kendiToplar.filter((r) => r.qualityGrade !== null && r.qualityGradeId === null);
    check("§5b ⭐ sondanın ürettiği hiçbir topta YETİM kalite kodu yok (string var, FK yok)",
      yetim.length === 0,
      yetim.length === 0 ? `${kendiToplar.length} top denetlendi` : yetim.map((r) => `${r.barcode}:"${r.qualityGrade}"`).join(" · "));
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: sonda çöktü — ${e instanceof Error ? e.message.split("\n").slice(0, 3).join(" ") : String(e)}`);
  } finally {
    console.log("\n🧹 Temizlik...");
    try {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.rollError.deleteMany({ where: { rollId: { in: yarat.roll } } });
      await prisma.roll.updateMany({ where: { id: { in: yarat.roll } }, data: { sackId: null, shipmentId: null, currentStepId: null, parentRollId: null, batchId: null } });
      await prisma.roll.deleteMany({ where: { id: { in: yarat.roll } } });
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
