// =============================================================================
// BEKÇİ — SEVKİYAT OLAY DEFTERİ + ÇUVAL TARTI DEFTERİ (B-1 + B-2, 2026-09-11)
// Çalıştır: npx tsx scripts/run-all-tests.ts shipment_event_ledger
// =============================================================================
// NEDEN: Sevk geri alınırken `dispatchedAt`/`dispatchedById` NULL'lanıyordu —
// "sevk edildi" gerçeği siliniyor, SoD izni `shipping:undo-dispatch`ın kalıcı
// izi kalmıyordu. `Shipment`ta iptal künyesi HİÇ YOKTU (37 modelde var). Çuval
// yeniden tartıda `weightKg`in ÜSTÜNE yazılıyor, sıfırlamada dört alan birden
// siliniyordu: irsaliyeye giden BRÜT kg'ın önceki değeri hiçbir yerde kalmıyordu.
//
// ÖLÇÜLENLER
//   §1 Sevk → DISPATCHED olayı + damga yazıldı
//   §2 ⭐ Geri alma → damga SİLİNMEDİ, UNDISPATCHED olayı GEREKÇESİYLE yazıldı
//   §3 Sevk→geri al→sevk turu: defter ÜÇ satır, damga ezilmedi (tek kolon yetmezdi)
//   §4 ⭐ İptal → künye (cancelledAt/ById) doldu + CANCELLED olayı
//   §5 ⭐ Tartı: WEIGHED → REWEIGHED; ÖNCEKİ kg defterden okunabiliyor
//   §6 ⭐ İçerik değişimi → CLEARED olayı (sessiz silme değil)
//   §7 AST: `dispatchedAt: null` yazan kod KALMADI
//
// NEGATİF SONDA — ölçülen sonuçlar not edildi; bkz. arşiv 2026-09-11.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RollStatus,
  SackWeighingKind,
  ShipmentEventType,
  ShipmentStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { ShippingService } from "../src/services/shipping.service";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ts = Date.now();
const TAG = `TST-SEL-${ts}`;
const svc = new ShippingService();
const sackIds: string[] = [];
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId = "";
let itemId = "";
let adminId = "";

async function makeSack(tag: string, qty: number): Promise<string> {
  const sack = await prisma.sack.create({
    data: { sackNo: `${TAG}-${tag}`, customerId },
    select: { id: true },
  });
  sackIds.push(sack.id);
  const roll = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${tag}`,
      itemId,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.WAREHOUSE,
      sackId: sack.id,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  return sack.id;
}

async function kurVeSevkEt(tag: string): Promise<string> {
  const sackId = await makeSack(tag, 100);
  const r = await svc.createShipment({ sackIds: [sackId], customerId, orderless: true }, adminId);
  const id = (r.data as { id: string }).id;
  shipmentIds.push(id);
  // Sevk onayı KAPALIYKEN `createShipment` doğrudan DISPATCHED kurar; açıkken
  // PLANNED doğar ve ayrıca sevk edilmesi gerekir. Bekçi iki profilde de koşar.
  const st = await prisma.shipment.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (st.status === ShipmentStatus.PLANNED) await svc.dispatchShipment(id, {}, adminId);
  return id;
}

async function olaylar(shipmentId: string) {
  return prisma.shipmentEvent.findMany({
    where: { shipmentId },
    orderBy: { createdAt: "asc" },
    select: { type: true, fromStatus: true, toStatus: true, reason: true, createdById: true },
  });
}

async function main(): Promise<void> {
  console.log("\n=== Sevkiyat olay defteri + çuval tartı defteri ===\n");

  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  itemId = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  // ⚠️ Seed kullanıcı adına HAM yaslanılmaz (ortam bağımlılığı tavanı) —
  // bekçi kendi yöneticisini fixture'dan çözer.
  adminId = (await ensureTestAdmin()).id;
  // ⚠️ "herhangi bir aktif müşteri" ARAMAYIZ: temiz CI DB'sinde düşer, dolu
  // DB'de ise başkasının verisine yaslanır (ortam bağımlılığı tavanı).
  const musteri = await prisma.customer.upsert({
    where: { code: "TST-SEL-MUS" },
    update: {},
    create: { code: "TST-SEL-MUS", name: "TST-SEL Bekçi Müşterisi" },
    select: { id: true },
  });
  customerId = musteri.id;

  // ── §1 SEVK ──────────────────────────────────────────────────────────────
  const s1 = await kurVeSevkEt("A");
  const sh1 = await prisma.shipment.findUniqueOrThrow({
    where: { id: s1 },
    select: { status: true, dispatchedAt: true, dispatchedById: true },
  });
  check("§1a Sevk edildi (DISPATCHED + damga)", sh1.status === ShipmentStatus.DISPATCHED && sh1.dispatchedAt != null);
  const e1 = await olaylar(s1);
  check(
    "§1b Defterde DISPATCHED olayı var",
    e1.some((e) => e.type === ShipmentEventType.DISPATCHED && e.toStatus === ShipmentStatus.DISPATCHED),
    e1.map((e) => e.type).join(","),
  );

  // ── §2 GERİ ALMA — DAMGA SİLİNMEZ ────────────────────────────────────────
  const ilkDamga = sh1.dispatchedAt;
  await svc.undoDispatch(s1, "bekçi: yanlış kamyona yüklendi", adminId);
  const sh2 = await prisma.shipment.findUniqueOrThrow({
    where: { id: s1 },
    select: { status: true, dispatchedAt: true, dispatchedById: true },
  });
  check("§2a Durum PLANNED'a döndü", sh2.status === ShipmentStatus.PLANNED);
  check(
    "§2b ⭐ `dispatchedAt` SİLİNMEDİ (sevk edildiği gerçeği duruyor)",
    sh2.dispatchedAt != null && sh2.dispatchedAt.getTime() === ilkDamga!.getTime(),
    String(sh2.dispatchedAt),
  );
  check("§2c ⭐ `dispatchedById` SİLİNMEDİ", sh2.dispatchedById === adminId);
  const e2 = await olaylar(s1);
  const undo = e2.find((e) => e.type === ShipmentEventType.UNDISPATCHED);
  check("§2d UNDISPATCHED olayı yazıldı", undo != null && undo.toStatus === ShipmentStatus.PLANNED);
  check(
    "§2e ⭐ Geri alma GEREKÇESİ deftere yazıldı (kim/neden tek satırda)",
    undo?.reason === "bekçi: yanlış kamyona yüklendi" && undo.createdById === adminId,
    String(undo?.reason),
  );

  // ── §3 TUR: sevk → geri al → sevk ────────────────────────────────────────
  await svc.dispatchShipment(s1, {}, adminId);
  const e3 = await olaylar(s1);
  const tipler = e3.map((e) => e.type);
  check(
    "§3 ⭐ İkinci sevk defteri BÜYÜTTÜ (tek `undispatchedAt` kolonu ezilirdi)",
    tipler.filter((t) => t === ShipmentEventType.DISPATCHED).length === 2 &&
      tipler.filter((t) => t === ShipmentEventType.UNDISPATCHED).length === 1,
    tipler.join(","),
  );

  // ── §4 İPTAL — KÜNYE + OLAY ──────────────────────────────────────────────
  const sackB = await makeSack("B", 50);
  const rB = await svc.createShipment({ sackIds: [sackB], customerId, orderless: true }, adminId);
  const s2 = (rB.data as { id: string }).id;
  shipmentIds.push(s2);
  // `cancelShipment` yalnız PLANNED kabul eder — DISPATCHED iptal edilmez,
  // storno gerekir (sevkiyat kuralı: tek kaynak `cancelPlannedShipmentTx`).
  const stB = await prisma.shipment.findUniqueOrThrow({ where: { id: s2 }, select: { status: true } });
  if (stB.status === ShipmentStatus.DISPATCHED) {
    await svc.undoDispatch(s2, "bekçi: iptal öncesi storno", adminId);
  }
  await svc.cancelShipment(s2, adminId);
  const sh4 = await prisma.shipment.findUniqueOrThrow({
    where: { id: s2 },
    select: { status: true, cancelledAt: true, cancelledById: true },
  });
  check(
    "§4a ⭐ İptal KÜNYESİ doldu (eskiden kolon HİÇ YOKTU)",
    sh4.status === ShipmentStatus.CANCELLED && sh4.cancelledAt != null && sh4.cancelledById === adminId,
    `cancelledById=${sh4.cancelledById}`,
  );
  const e4 = await olaylar(s2);
  check(
    "§4b CANCELLED olayı yazıldı",
    e4.some((e) => e.type === ShipmentEventType.CANCELLED && e.toStatus === ShipmentStatus.CANCELLED),
    e4.map((e) => e.type).join(","),
  );

  // ── §5 TARTI DEFTERİ ─────────────────────────────────────────────────────
  const sackC = await makeSack("C", 40);
  await svc.weighSack({ sackId: sackC, weightKg: 12.5, source: "MANUAL" }, adminId);
  await svc.weighSack({ sackId: sackC, weightKg: 13.75, source: "MANUAL" }, adminId);
  const tartilar = await prisma.sackWeighing.findMany({
    where: { sackId: sackC },
    orderBy: { createdAt: "asc" },
    select: { kind: true, weightKg: true, weighedById: true },
  });
  check(
    "§5a İlk tartı WEIGHED, ikincisi REWEIGHED",
    tartilar.length === 2 &&
      tartilar[0]?.kind === SackWeighingKind.WEIGHED &&
      tartilar[1]?.kind === SackWeighingKind.REWEIGHED,
    tartilar.map((t) => t.kind).join(","),
  );
  check(
    "§5b ⭐ ÖNCEKİ kg defterden okunabiliyor (irsaliyeye giden rakamın geçmişi)",
    Number(tartilar[0]?.weightKg) === 12.5 && Number(tartilar[1]?.weightKg) === 13.75,
    tartilar.map((t) => String(t.weightKg)).join(" → "),
  );
  check("§5c Tartan kullanıcı defterde", tartilar.every((t) => t.weighedById === adminId));

  // ── §6 İÇERİK DEĞİŞİMİ → CLEARED ─────────────────────────────────────────
  const rollC = await prisma.roll.findFirstOrThrow({ where: { sackId: sackC }, select: { id: true } });
  await prisma.roll.update({ where: { id: rollC.id }, data: { sackId: null } });
  // Doğrudan helper yolunu tetikle: içerik değişimi kg'ı düşürür.
  await prisma.$transaction(async (tx) => {
    await (svc as unknown as {
      markSackContentChangedTx: (t: typeof tx, ids: string[]) => Promise<void>;
    }).markSackContentChangedTx(tx, [sackC]);
  });
  const temizlik = await prisma.sackWeighing.findMany({
    where: { sackId: sackC, kind: SackWeighingKind.CLEARED },
    select: { weightKg: true, notes: true },
  });
  check(
    "§6a ⭐ Sıfırlama SESSİZ SİLME değil, CLEARED OLAYI",
    temizlik.length === 1,
    `cleared=${temizlik.length}`,
  );
  check(
    "§6b CLEARED satırının sonucu 'tartı yok' (kg NULL) ve nedeni yazılı",
    temizlik[0]?.weightKg == null && (temizlik[0]?.notes ?? "").includes("önceki tartı"),
    String(temizlik[0]?.notes),
  );
  const sackSon = await prisma.sack.findUniqueOrThrow({
    where: { id: sackC },
    select: { weightKg: true },
  });
  check("§6c Çuvalın güncel kg'ı düştü (denormalize değer bugünkü davranış)", sackSon.weightKg == null);

  // ── §7 AST — damga null'lama KALMADI ─────────────────────────────────────
  {
    const src = readFileSync(join(__dirname, "..", "src", "services", "shipping.service.ts"), "utf8");
    check(
      "§7 ⭐ `dispatchedAt: null` yazan kod KALMADI (ileri damga silinmez)",
      !/dispatchedAt:\s*null/.test(src),
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.sackWeighing.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
