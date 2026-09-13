// =============================================================================
// BEKÇİ — TAMBUR GERİ ALMA DEFTERİ TERSLER (stok defteri A2-b ters yolu)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_tambur_undo
// =============================================================================
// NEDEN: A2-b finalize çocuğuna GİRİŞ satırı yazdı ama geri alma yolu deftere
// HİÇ dokunmuyordu. Somut: 300 m ebeveyn → 200 m depo çocuğu → defterde +200.
// "Geri Al" → çocuk CANCELLED/0 ama +200 ÖKSÜZ kalıyor; yeniden finalize ikinci
// bir +200 yazıyor. Her tur depoya hayalet metre ekliyordu; FULL dalında öksüz
// satır sayısı çocuk sayısı kadar olurdu (2026-08-09 saha vakasında 14 top).
//
// Kural: "deftere yazan her ileri kaynağın ters yolu olmalı" ve geri alma ileri
// satırı NE SİLER NE DEĞİŞTİRİR — bugüne bir TERS satır yazar.
//
// ÖLÇÜLENLER
//   §1 Finalize: depo çocuğuna tek PRODUCTION girişi (A2-b'nin ileri yolu)
//   §2 Geri alma ters satır yazar — bağ · yön · metraj · sebep
//   §3 ⭐ NET SIFIR: geri alınan çocuğun defter etkisi 0
//   §4 ⭐ Metraj İLERİ SATIRDAN gelir — çocuğun `currentQty`si 0'a çekilmiş
//      olmasına rağmen ters satır 200 m yazar (canlıdan okunsaydı 0 m olurdu)
//   §5 Fire (SCRAP) çocuk: ne ileri ne ters satır
//   §6 ⭐ FULL dalı İKİ depo çocuğunun İKİSİNİ de tersler (öksüz kalmaz)
//   §7 Körlük zemini: fikstür gerçekten satır üretti (0 bulgu ≠ bakılmadı)
//   §8 ⭐ SINGLE_RESTORE dalı da tersler — ayrı ölçülmemişti (sonda iki dalı
//      birlikte kaldırdığı için hangisinin ölçüldüğü belirsizdi)
//   §9 ⭐ İKİ TUR: "her tur hayalet metre ekler" iddiası tambur tarafında
//      ÖLÇÜLDÜ — 2 ileri + 2 ters, toplam net 0
//   §10 ⭐ YAPISAL değişmez: iptal edilmiş her çocuğun ileri satırı terslenmiş
//   §11 ⭐ DEPO KESİMİ (TRANSFORM çifti) geri alınınca EBEVEYNİN çıkışı da terslenir
//       — durum = defter. ⚠️ Bu ayak iki bekçinin ARASINDAKİ DİKİŞİ ölçer: §3
//       finalize yolunu (ebeveyn çıkışı YOK), `test_stock_ledger_transform` kesimin
//       İLERİ yolunu ölçüyordu; TRANSFORM çiftinin GERİ ALINMASI ikisinin arasında
//       sahipsizdi ve kusur oradaydı (2026-09-13, 82 statik okudu, 01 çalıştırdı:
//       100 m ebeveyn → kes 40 → geri al ⇒ durum 100 ↔ defter 60). İki kapının
//       yeşili, aralarındaki dikişi yeşil yapmaz.
//       ⚠️ BEŞ DAL, BEŞ FİKSTÜR (A depo-restore · B adım-restore · C kaynak-arşivde ·
//       D SINGLE_RESTORE · E FULL): ilk sürüm tek fikstürle yeşildi ve koşulsuz grup
//       terslemesi C dalında TERS ayrışma üretiyordu (durum 0 ↔ defter 40) — defter
//       durumu izler, koşul "ebeveyne metraj geri konuyorsa". Tek fikstür yasak.
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { InventoryService } from "../src/services/inventory.service";
import { roleGrade } from "./fixture-quality-grade";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLTU-${Date.now()}`;
const rollIds: string[] = [];
const stepIds: string[] = [];
const woIds: string[] = [];
const gradeIds: string[] = [];
let itemId = "";

interface Satir {
  id: string;
  eventType: WarehouseEventType;
  qty: unknown;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromStatus: RollStatus | null;
  toStatus: RollStatus | null;
  reasonCode: string | null;
  reversesMovementId: string | null;
}

async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, reversesMovementId: true,
    },
  });
}

/** Topun defter etkisi: giriş ucu +, çıkış ucu −. Transfer (iki uç) net 0. */
function net(rows: Satir[]): number {
  return rows.reduce((acc, r) => {
    const q = Number(r.qty);
    return acc + (r.toWarehouseId ? q : 0) - (r.fromWarehouseId ? q : 0);
  }, 0);
}

/** Bir tambur senaryosu kurar: WO + adım + ebeveyn top (depoda, üretimde). */
async function senaryo(ek: string, warehouseId: string, stationId: string, qty: number): Promise<string> {
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO-${ek}`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId, stepSequence: 1, status: "ACTIVE" },
    select: { id: true },
  });
  stepIds.push(step.id);
  const parent = await prisma.roll.create({
    data: {
      barcode: `${TAG}-P-${ek}`, itemId, initialQty: qty, currentQty: qty,
      status: RollStatus.IN_PRODUCTION, currentStepId: step.id,
      warehouseId, entrySource: "SUPPLIER_RECEIPT",
    },
    select: { id: true },
  });
  rollIds.push(parent.id);
  await prisma.rollMovement.create({ data: { rollId: parent.id, workOrderStepId: step.id, qtyIn: qty } });
  return parent.id;
}

async function main(): Promise<void> {
  console.log("\n=== Tambur geri alma: defter ters kaydı ===\n");
  const tambur = new TamburService();
  const undo = new TamburUndoService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  const station = await prisma.station.findUnique({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!warehouse || !station) throw new Error("Fikstür eksik: varsayılan depo / TAMBUR_1 istasyonu");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const gWh = await prisma.qualityGrade.create({ data: { code: `${TAG}-W`, name: "Test depo kalitesi", targetStatus: RollStatus.WAREHOUSE }, select: { id: true, code: true } });
  const gScrap = await prisma.qualityGrade.create({ data: { code: `${TAG}-S`, name: "Test fire kalitesi", targetStatus: RollStatus.SCRAP }, select: { id: true, code: true } });
  gradeIds.push(gWh.id, gScrap.id);

  // ── SENARYO A — tek çocuk geri alma (SINGLE / SINGLE_RESTORE) ─────────────
  const parentA = await senaryo("A", warehouse.id, station.id, 300);
  const resA = await tambur.finalize({
    rollId: parentA,
    decisions: [],
    cuts: [
      { length: 200, qualityGrade: gWh.code, relatedErrorIds: [] },
      { length: 100, qualityGrade: gScrap.code, relatedErrorIds: [] },
    ],
    confirmMismatch: true,
  });
  const cocuklarA = resA.data?.splitRolls ?? [];
  cocuklarA.forEach((c) => rollIds.push(c.id));
  const whA = cocuklarA.find((c) => c.status === RollStatus.WAREHOUSE);
  const scrapA = cocuklarA.find((c) => c.status === RollStatus.SCRAP);
  check("§0 Kurulum: iki çocuk doğdu", cocuklarA.length === 2 && !!whA && !!scrapA, `çocuk=${cocuklarA.length}`);
  if (!whA) throw new Error("Depo çocuğu doğmadı — senaryo kurulamadı");

  const ileriA = await satirlar(whA.id);
  check("§1 Finalize depo çocuğuna tek PRODUCTION girişi yazdı", ileriA.length === 1 && net(ileriA) === 200, `satır=${ileriA.length} net=${net(ileriA)}`);
  const ileriIdA = ileriA[0]?.id;

  await undo.applyUndo(whA.id, undefined, { reason: "bekçi: geri alma defter ölçümü" });

  const sonraA = await satirlar(whA.id);
  const tersA = sonraA.find((r) => r.reversesMovementId !== null);
  check("§2a Geri alma bir TERS satır yazdı (ileri satır duruyor)", sonraA.length === 2 && !!tersA, `satır=${sonraA.length}`);
  check(
    "§2b ⭐ Ters satırın bağı ileri satıra, yönü aynalanmış, sebebi TAMBUR_UNDO",
    tersA?.reversesMovementId === ileriIdA &&
      tersA?.fromWarehouseId === warehouse.id && tersA?.toWarehouseId === null &&
      tersA?.fromStatus === RollStatus.WAREHOUSE &&
      tersA?.reasonCode === STOCK_MOVE_REASON.TAMBUR_UNDO &&
      tersA?.eventType === WarehouseEventType.PRODUCTION,
    `bağ=${tersA?.reversesMovementId === ileriIdA} sebep=${String(tersA?.reasonCode)}`,
  );
  check("§3 ⭐ NET SIFIR: geri alınan çocuğun defter etkisi 0", net(sonraA) === 0, `net=${net(sonraA)}`);

  const canliA = await prisma.roll.findUnique({ where: { id: whA.id }, select: { status: true, currentQty: true } });
  check(
    "§4 ⭐ Ters metraj İLERİ SATIRDAN geldi (canlı metraj 0'a çekilmiş)",
    Number(canliA?.currentQty) === 0 && Number(tersA?.qty) === 200,
    `canlı=${String(canliA?.currentQty)} ters=${String(tersA?.qty)}`,
  );
  check("§5 Fire (SCRAP) çocuk: ne ileri ne ters satır", scrapA ? (await satirlar(scrapA.id)).length === 0 : false);

  // ── SENARYO B — FULL geri alma, İKİ depo çocuğu ───────────────────────────
  const parentB = await senaryo("B", warehouse.id, station.id, 300);
  const resB = await tambur.finalize({
    rollId: parentB,
    decisions: [],
    cuts: [
      { length: 120, qualityGrade: gWh.code, relatedErrorIds: [] },
      { length: 180, qualityGrade: gWh.code, relatedErrorIds: [] },
    ],
    confirmMismatch: true,
  });
  const cocuklarB = resB.data?.splitRolls ?? [];
  cocuklarB.forEach((c) => rollIds.push(c.id));
  const depoB = cocuklarB.filter((c) => c.status === RollStatus.WAREHOUSE);
  const ileriB = (await Promise.all(depoB.map((c) => satirlar(c.id)))).flat();
  check("§6a Kurulum: iki depo çocuğu ve iki giriş satırı", depoB.length === 2 && ileriB.length === 2, `çocuk=${depoB.length} satır=${ileriB.length}`);

  // FULL: `permissions` verilmiyor → F221 deseni, yetki kapısı atlanır (dahili çağrı).
  await undo.applyUndo(depoB[0]!.id, undefined, { mode: "FULL", reason: "bekçi: tümden geri alma" });

  const sonraB = await Promise.all(depoB.map((c) => satirlar(c.id)));
  const netler = sonraB.map(net);
  const tersSayisi = sonraB.flat().filter((r) => r.reversesMovementId !== null).length;
  check(
    "§6b ⭐ FULL İKİ çocuğun İKİSİNİ de tersledi — hiçbiri öksüz kalmadı",
    tersSayisi === 2 && netler.every((n) => n === 0),
    `ters=${tersSayisi} netler=[${netler.join(",")}]`,
  );

  // ── SENARYO C — SINGLE_RESTORE dalı + İKİ TUR ─────────────────────────────
  // ⚠️ İki eksik aynı fikstürle kapanıyor:
  //   ① `applySingleRestore` dalı ayrı ölçülmemişti — sonda iki `applySingle*`
  //      çağrısını birlikte kaldırdığı için hangi dalın ölçüldüğü belirsizdi.
  //   ② "her tur hayalet metre ekler" iddiası tambur tarafında ÖLÇÜLMEMİŞTİ;
  //      yalnız reopen bekçisinde iki tur vardı. SINGLE_RESTORE metrajı kaynağa
  //      geri koyup iş emrini dirilttiği için ikinci tur BU dalda mümkün olur.
  const parentC = await senaryo("C", warehouse.id, station.id, 200);
  const turNetleri: number[] = [];
  const turCocuklari: string[] = [];
  for (const tur of [1, 2]) {
    const res = await tambur.finalize({
      rollId: parentC,
      decisions: [],
      cuts: [{ length: 200, qualityGrade: gWh.code, relatedErrorIds: [] }],
      confirmMismatch: true,
    });
    const cocuk = (res.data?.splitRolls ?? []).find((c) => c.status === RollStatus.WAREHOUSE);
    if (!cocuk) throw new Error(`tur ${tur}: depo çocuğu doğmadı`);
    rollIds.push(cocuk.id);
    turCocuklari.push(cocuk.id);
    const ileri = await satirlar(cocuk.id);
    if (net(ileri) !== 200) throw new Error(`tur ${tur}: giriş satırı beklenen +200 değil (${net(ileri)})`);
    // SINGLE_RESTORE: parçayı iptal et, metrajı KAYNAK TOPA geri koy.
    await undo.applyUndo(cocuk.id, undefined, { mode: "SINGLE_RESTORE", reason: `bekçi: tur ${tur}` });
    turNetleri.push(net(await satirlar(cocuk.id)));
  }
  check(
    "§8 ⭐ SINGLE_RESTORE dalı da ileri satırı tersler (her iki turda net 0)",
    turNetleri.length === 2 && turNetleri.every((n) => n === 0),
    `netler=[${turNetleri.join(",")}]`,
  );
  const turSatirlari = (await Promise.all(turCocuklari.map(satirlar))).flat();
  check(
    "§9 ⭐ İKİ TUR sonunda hayalet metraj YOK: 2 ileri + 2 ters, toplam net 0",
    turSatirlari.length === 4 && net(turSatirlari) === 0 &&
      turSatirlari.filter((r) => r.reversesMovementId !== null).length === 2,
    `satır=${turSatirlari.length} net=${net(turSatirlari)}`,
  );

  // ── §7 + §10 Körlük zemini ────────────────────────────────────────────────
  // Sayı senaryo eklendikçe değişir; onun yerine YAPISAL değişmez ölçülür:
  // iptal edilmiş her çocuğun ileri satırı terslenmiş olmak zorunda (öksüz yok).
  const toplam = await prisma.warehouseMovement.count({ where: { rollId: { in: rollIds } } });
  check("§7 Körlük zemini: fikstür en az 10 defter satırı üretti", toplam >= 10, `n=${toplam}`);
  const iptalliCocuklar = await prisma.roll.findMany({
    where: { id: { in: rollIds }, status: RollStatus.CANCELLED },
    select: { id: true },
  });
  const oksuz: string[] = [];
  for (const c of iptalliCocuklar) {
    const s = await satirlar(c.id);
    const ileri = s.filter((r) => r.reversesMovementId === null);
    const terslenen = new Set(s.filter((r) => r.reversesMovementId !== null).map((r) => r.reversesMovementId));
    if (ileri.some((r) => !terslenen.has(r.id))) oksuz.push(c.id);
  }
  check(
    "§10 ⭐ İPTAL EDİLMİŞ her çocuğun ileri satırı terslenmiş (öksüz satır yok)",
    iptalliCocuklar.length >= 3 && oksuz.length === 0,
    `iptalli=${iptalliCocuklar.length} öksüz=${oksuz.length}`,
  );

  // ── §11 ⭐ DEPO KESİMİ + GERİ ALMA — grup terslemesi EBEVEYNİN DURUMUNU İZLER ──
  // Kesim bir DÖNÜŞÜMDÜR: ebeveyn OUT + çocuk IN, aynı `transformGroupId`, grup
  // neti sıfır. Geri alma yalnız ÇOCUĞU tersliyordu ⇒ ebeveynin OUT'u yetim, durum
  // 100 ↔ defter 60. Düzeltme grubu tersler — AMA yalnız metrajın ebeveyne GERİ
  // KONDUĞU dallarda: "kaynak arşivde" dalında metraj dönmez (RECORD_CORRECTION),
  // orada koşulsuz grup terslemesi TERS ayrışma üretir — ölçüldü 2026-09-13, sonda C:
  // durum 0 ↔ defter 40 (ilk sürüm tek fikstürle yeşildi). Beş dal, HER BİRİ KENDİ FİKSTÜRÜYLE:
  //   A SINGLE depo-restore · B SINGLE adım-restore · C SINGLE kaynak-arşivde ·
  //   D SINGLE_RESTORE · E FULL. Ölçüt her dalda aynı: ÇOCUK net 0 ∧ EBEVEYN durum = defter.
  {
    const inventory = new InventoryService();
    const gradeFirst = (await roleGrade("FIRST")).code;
    /** Depo ebeveyni (100 m) + 40 m kesim; istenirse kalan kapanışı. */
    async function depoKesimi(kapanis?: "discard" | "keep_1kalite"): Promise<{ ebeveyn: string; cocuk: string; kalan: string | null }> {
      const pRes = await inventory.createInitialEntry(
        { itemId, initialQty: 100 }, undefined, undefined, false, { forcedStatus: "WAREHOUSE" },
      );
      const ebeveyn = (pRes.data as { id: string }).id;
      rollIds.push(ebeveyn);
      const cRes = await tambur.cutWarehouseRoll(ebeveyn, { cutLength: 40, rawDestination: "WAREHOUSE", qualityGrade: gradeFirst });
      const cocuk = (cRes.data as { childRoll?: { id: string } }).childRoll?.id;
      if (!cocuk) throw new Error("depo kesimi çocuğu doğmadı — §11 kurulamadı");
      rollIds.push(cocuk);
      let kalan: string | null = null;
      if (kapanis) {
        const f = await tambur.finalizeWarehouseCut(ebeveyn, { remainingAction: kapanis, varianceReasonCode: null, varianceReasonText: "bekçi §11" });
        kalan = (f.data as { remainingChild: { id: string } | null }).remainingChild?.id ?? null;
        if (kalan) rollIds.push(kalan);
      }
      return { ebeveyn, cocuk, kalan };
    }
    /** Dalın ortak ölçümü: fırlatmadı · çocuk net 0 · ebeveyn durum = defter · ters satır sayısı · statüsüz yok. */
    async function dalOlc(ad: string, f: { ebeveyn: string; cocuk: string; kalan: string | null }, mode: "SINGLE" | "SINGLE_RESTORE" | "FULL", beklenenTers: number): Promise<void> {
      const grupOnce = (await satirlar(f.ebeveyn)).filter((r) => r.reasonCode === STOCK_MOVE_REASON.CUT_SPLIT).map((r) => r.id);
      let hata: unknown = null;
      try {
        await undo.applyUndo(f.cocuk, undefined, { mode, reason: `bekçi §11${ad}` });
      } catch (e) { hata = e; }
      // Aynı satırı iki kez tersleme `reversesMovementId` unique'inde P2002 verir — "sessiz başarı" değil KIRMIZI (6e).
      check(`§11${ad} geri alma fırlatmadı (${mode})`, hata === null, hata ? String((hata as Error).message).slice(0, 80) : "");
      const pe = await satirlar(f.ebeveyn);
      const ce = await satirlar(f.cocuk);
      const canli = await prisma.roll.findUnique({ where: { id: f.ebeveyn }, select: { currentQty: true, status: true } });
      const ters = pe.filter((r) => r.reversesMovementId !== null);
      check(`§11${ad} çocuğun defter neti 0`, net(ce) === 0, `net=${net(ce)}`);
      if (f.kalan) {
        const ke = await satirlar(f.kalan);
        check(`§11${ad} kalan parçanın defter neti ${mode === "FULL" ? "0 (o da geri alındı)" : "60 (dokunulmadı)"}`, net(ke) === (mode === "FULL" ? 0 : 60), `net=${net(ke)}`);
      }
      check(
        `§11${ad} ⭐ DURUM = DEFTER (ebeveyn ${canli?.status})`,
        Number(canli?.currentQty) === net(pe),
        `durum=${canli?.currentQty} defter=${net(pe)}`,
      );
      check(
        `§11${ad} ebeveynde ${beklenenTers} ters satır, hepsi TRANSFORM çıkışını hedefliyor`,
        ters.length === beklenenTers && ters.every((t) => grupOnce.includes(t.reversesMovementId!)),
        `ters=${ters.length} hedefler=${ters.map((t) => (grupOnce.includes(t.reversesMovementId!) ? "grup" : "?")).join(",") || "-"}`,
      );
      // 6e'nin şartı: TRANSFORM uçları hep statülü ⇒ `statusuzAtlanan` 0 olmalı.
      const statusuz = [...pe, ...ce].filter((r) => r.fromStatus === null && r.toStatus === null);
      check(`§11${ad} statüsüz satır yok`, statusuz.length === 0, `statüsüz=${statusuz.length}`);
    }

    // A) SINGLE, ebeveyn CANLI depoda → metraj ebeveyne döner ⇒ OUT terslenir (durum 100 ↔ defter 100).
    await dalOlc("A", await depoKesimi(), "SINGLE", 1);

    // B) SINGLE, adım-restore (finalize çocuğu, ebeveyn ÜRETİMDE): ebeveynin stok defteri YOKTUR,
    //    grup çağrısı 0 döner; ölçülebilir olan "ebeveyne satır sızmadı" — Senaryo A'nın verisi.
    const ebeveynA = await satirlar(parentA);
    check("§11B SINGLE adım-restore: üretimdeki ebeveyne stok satırı sızmadı (grup 0 döner)", ebeveynA.length === 0, `satır=${ebeveynA.length}`);

    // C) SINGLE, kaynak ARŞİVDE (kalan discard ile kapatıldı): metraj DÖNMEZ, RECORD_CORRECTION
    //    yazılır ⇒ ebeveynin OUT'u GERÇEK kalır, terslenmez (durum 0 ↔ defter 0). Koşulsuz grup
    //    terslemesi burada 0 ↔ 40 üretiyordu — bu dal o kusurun bekçisi.
    const fC = await depoKesimi("discard");
    await dalOlc("C", fC, "SINGLE", 0);
    const sapmaC = await prisma.rollVariance.findFirst({ where: { rollId: fC.cocuk, kind: "RECORD_CORRECTION", reversedAt: null }, select: { qty: true } });
    check("§11C arşiv dalı çocuğa RECORD_CORRECTION 40 yazdı (metraj deftere değil sapmaya gitti)", Number(sapmaC?.qty) === 40, `sapma=${sapmaC ? Number(sapmaC.qty) : "yok"}`);

    // D) SINGLE_RESTORE, kaynak arşivde ama "kumaş elimde": 40 m ebeveyne döner ⇒ OUT terslenir (40 ↔ 40).
    await dalOlc("D", await depoKesimi("discard"), "SINGLE_RESTORE", 1);

    // E) FULL, kalan "keep" ile ikinci çocuk olmuş: ebeveyn kapanış öncesine döner, İKİ grup da terslenir (100 ↔ 100).
    await dalOlc("E", await depoKesimi("keep_1kalite"), "FULL", 2);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (stepIds.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
    if (woIds.length) {
      await prisma.systemLog.deleteMany({ where: { recordId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    }
    if (gradeIds.length) await prisma.qualityGrade.deleteMany({ where: { id: { in: gradeIds } } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
