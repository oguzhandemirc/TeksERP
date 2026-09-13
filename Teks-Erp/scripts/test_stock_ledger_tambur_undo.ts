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
//   §12 ⭐ initialQty ŞİŞMEZ: kesim düşürmez, geri alma yalnız AŞIMDA bump + OVERAGE (6e, 2026-09-13)
//   §13–§19 ⭐ KAPANIŞIN İKİ DEFTERİ BİRLİKTE DÖNER (hüküm ① b1+b2+b3-DAR, 2026-09-14): FULL discard/
//      scrap bağlı çıkışı tersler (§13/§14) · SINGLE_RESTORE dokunmaz (§15) · arşiv-SINGLE → FULL (§18) ·
//      scrap-kalan çocuğuna yalnız FULL (§19, 409 UNDO_SCRAP_REMAINDER_FULL_ONLY)
//   §16 · §17 ⭐ GERÇEK AŞIM (hüküm ② a): keşif terminal, ebeveyne taşınır — SINGLE×3 ve FULL'de
//      durum = defter = 120, canlı OVERAGE n=1 Σ=20, taşıma satırı aynı rollVarianceId
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
  rollVarianceId: string | null;
  reversesMovementId: string | null;
}

async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, reversesMovementId: true, rollVarianceId: true,
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
  if (!warehouse) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");
  if (!station) throw new Error("TAMBUR_1 istasyonu yok (seed koşmamış)");

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

    // ── §12 ⭐ initialQty ŞİŞMEZ — kesim düşürmez, geri alma yalnız AŞIMDA bump'lar ──
    // 2026-08-29'dan beri `cutWarehouseRoll` initialQty'ye dokunmaz; undo'nun iki dalı
    // ise "kesim ikisini düşmüştü" varsayıp `+len` ekliyordu ⇒ her depo-kesimi geri
    // alması girişi şişiriyordu (100→140; okuyucular: rollWhole kapısı · WO üretilen
    // metraj · coverage · rapor · ikiz kapısı). Üç dal, ölçüt aynı: initialQty
    // DEĞİŞMEZ, yalnız yeniCurrent > initial ise fark kadar bump + OVERAGE satırı.
    const initialDurumu = async (id: string) => {
      const r = await prisma.roll.findUniqueOrThrow({ where: { id }, select: { initialQty: true, currentQty: true } });
      const asim = await prisma.rollVariance.findMany({ where: { rollId: id, kind: "OVERAGE", reversedAt: null }, select: { qty: true, source: true } });
      return { initial: Number(r.initialQty), current: Number(r.currentQty), asim };
    };
    // A) SINGLE, ebeveyn canlı depoda (tambur-undo :1268 dalı): 100 → kes 40 → geri al ⇒ 100/100, bump YOK.
    const f12a = await depoKesimi();
    await undo.applyUndo(f12a.cocuk, undefined, { mode: "SINGLE", reason: "bekçi §12a" });
    const d12a = await initialDurumu(f12a.ebeveyn);
    check("§12a ⭐ SINGLE depo geri alma initialQty'yi ŞİŞİRMEZ (100 → 100) ve currentQty 100", d12a.initial === 100 && d12a.current === 100, `initial=${d12a.initial} current=${d12a.current}`);
    check("§12a aşım YOK ⇒ OVERAGE satırı yazılmadı", d12a.asim.length === 0, `overage=${d12a.asim.length}`);
    // B) SINGLE_RESTORE, kaynak arşivde (:1465 dalı, stepId yok): 40 m ebeveyne döner ⇒ 40/100, bump YOK.
    const f12b = await depoKesimi("discard");
    await undo.applyUndo(f12b.cocuk, undefined, { mode: "SINGLE_RESTORE", reason: "bekçi §12b" });
    const d12b = await initialDurumu(f12b.ebeveyn);
    check("§12b ⭐ SINGLE_RESTORE (arşiv dalı) initialQty'yi ŞİŞİRMEZ (100 → 100), currentQty 40", d12b.initial === 100 && d12b.current === 40, `initial=${d12b.initial} current=${d12b.current}`);
    // C) AŞIM: 08-29 ÖNCESİ verinin ikizi — ebeveynin initialQty'si kesimle DÜŞÜRÜLMÜŞ
    //    (fikstür 100 → 60 = kesim sonrası current; DB CHECK `rolls_qty_le_initial` daha
    //    aşağısına izin vermez); geri alma currentQty'yi 100'e çıkarır ⇒ 100 > 60 ⇒ bump 40
    //    + OVERAGE 40 (TAMBUR_UNDO_RESTORE). `currentQty <= initialQty` korunur, fark deftere.
    const f12c = await depoKesimi();
    await prisma.roll.update({ where: { id: f12c.ebeveyn }, data: { initialQty: 60 } });
    await undo.applyUndo(f12c.cocuk, undefined, { mode: "SINGLE", reason: "bekçi §12c" });
    const d12c = await initialDurumu(f12c.ebeveyn);
    check(
      "§12c ⭐ AŞIMDA yalnız fark kadar bump (60 → 100) ve currentQty ≤ initialQty korunur",
      d12c.initial === 100 && d12c.current === 100,
      `initial=${d12c.initial} current=${d12c.current}`,
    );
    check(
      "§12c aşım DEFTERE yazıldı: tek OVERAGE 40, kaynak TAMBUR_UNDO_RESTORE",
      d12c.asim.length === 1 && Number(d12c.asim[0]!.qty) === 40 && d12c.asim[0]!.source === "TAMBUR_UNDO_RESTORE",
      JSON.stringify(d12c.asim),
    );

    // ── §13–§19 ⭐ KAPANIŞIN İKİ DEFTERİ BİRLİKTE DÖNER (hüküm ① b1+b2+b3-DAR, 2026-09-14) ──
    // Kapanış sapması (`RECORD_CORRECTION`/`SCRAP`) stok defterine `rollVarianceId` ile
    // BAĞLI bir çıkış yazar (`CUT_DISCARD`/`SCRAP`). FULL 5b sapmayı damgalıyor ama bağlı
    // çıkışı terslemiyordu ⇒ 100 ↔ 60 / 100 ↔ 0 (1c ölçtü). Ölçüt her ayakta: ebeveyn
    // DURUM = DEFTER ∧ bağlı çıkış `reversesMovementId` ile terslenmiş ∧ sapma damgalı.
    /** HAM ebeveyn (STOCK) fikstürü — `scrap` kapanışı SCRAP statülü gerçek çocuk doğurur. */
    async function hamKesimi(kapanis: "scrap" | "discard"): Promise<{ ebeveyn: string; cocuk: string; kalan: string | null }> {
      const pRes = await inventory.createInitialEntry(
        { itemId, initialQty: 100 }, undefined, undefined, false, { forcedStatus: "STOCK" },
      );
      const ebeveyn = (pRes.data as { id: string }).id;
      rollIds.push(ebeveyn);
      const cRes = await tambur.cutWarehouseRoll(ebeveyn, { cutLength: 40, rawDestination: "WAREHOUSE", qualityGrade: gradeFirst });
      const cocuk = (cRes.data as { childRoll?: { id: string } }).childRoll?.id;
      if (!cocuk) throw new Error("ham kesim çocuğu doğmadı — §14 kurulamadı");
      rollIds.push(cocuk);
      const f = await tambur.finalizeWarehouseCut(ebeveyn, { remainingAction: kapanis, varianceReasonCode: null, varianceReasonText: "bekçi §14" });
      const kalan = (f.data as { remainingChild: { id: string } | null }).remainingChild?.id ?? null;
      if (kalan) rollIds.push(kalan);
      return { ebeveyn, cocuk, kalan };
    }
    const bagliCikis = async (ebeveyn: string, kod: string) => {
      const rows = await prisma.warehouseMovement.findMany({
        where: { rollId: ebeveyn, reasonCode: kod, reversesMovementId: null },
        select: { id: true, rollVarianceId: true, reversedBy: { select: { id: true, reasonCode: true } } },
      });
      return rows[0] ?? null;
    };
    const durumDefter = async (id: string) => {
      const r = await prisma.roll.findUniqueOrThrow({ where: { id }, select: { currentQty: true, status: true } });
      return { current: Number(r.currentQty), status: r.status, net: net(await satirlar(id)) };
    };

    // §13 FULL discard: CUT_DISCARD çıkışı bağlı terslenir ⇒ 100 = 100.
    const f13 = await depoKesimi("discard");
    const c13once = await bagliCikis(f13.ebeveyn, STOCK_MOVE_REASON.CUT_DISCARD);
    check("§13z pozitif kontrol: discard kapanışı sapmaya BAĞLI CUT_DISCARD çıkışı yazdı", c13once !== null && c13once.rollVarianceId !== null && c13once.reversedBy.length === 0, JSON.stringify(c13once));
    await undo.applyUndo(f13.cocuk, undefined, { mode: "FULL", reason: "bekçi §13 discard FULL" });
    const d13 = await durumDefter(f13.ebeveyn);
    const c13 = await bagliCikis(f13.ebeveyn, STOCK_MOVE_REASON.CUT_DISCARD);
    const v13 = c13once ? await prisma.rollVariance.findUnique({ where: { id: c13once.rollVarianceId! }, select: { reversedAt: true } }) : null;
    check("§13 ⭐ FULL discard: DURUM = DEFTER (100 = 100)", d13.current === 100 && d13.net === 100, `durum=${d13.current} defter=${d13.net}`);
    check("§13b CUT_DISCARD çıkışı BAĞ üzerinden terslendi (TAMBUR_UNDO, reversesMovementId) ve sapma damgalı", c13?.reversedBy.length === 1 && c13.reversedBy[0]!.reasonCode === STOCK_MOVE_REASON.TAMBUR_UNDO && v13?.reversedAt !== null, JSON.stringify({ ters: c13?.reversedBy, sapma: v13 }));

    // §14 HAM scrap FULL: SCRAP çıkışı (bağlı) terslenir, SCRAP çocuğu iptal ⇒ 100 = 100.
    const f14 = await hamKesimi("scrap");
    const kalan14 = f14.kalan ? await prisma.roll.findUnique({ where: { id: f14.kalan }, select: { status: true } }) : null;
    check("§14z pozitif kontrol: ham scrap kapanışı SCRAP statülü kalan çocuğu doğurdu + bağlı SCRAP çıkışı", kalan14?.status === RollStatus.SCRAP && (await bagliCikis(f14.ebeveyn, STOCK_MOVE_REASON.SCRAP)) !== null, `kalan=${kalan14?.status}`);
    await undo.applyUndo(f14.cocuk, undefined, { mode: "FULL", reason: "bekçi §14 scrap FULL" });
    const d14 = await durumDefter(f14.ebeveyn);
    const c14 = await bagliCikis(f14.ebeveyn, STOCK_MOVE_REASON.SCRAP);
    check("§14 ⭐ ham scrap FULL: DURUM = DEFTER (100 = 100)", d14.current === 100 && d14.net === 100, `durum=${d14.current} defter=${d14.net}`);
    check("§14b SCRAP çıkışı BAĞ üzerinden terslendi", c14?.reversedBy.length === 1 && c14.reversedBy[0]!.reasonCode === STOCK_MOVE_REASON.TAMBUR_UNDO, JSON.stringify(c14?.reversedBy));

    // §15 SINGLE_RESTORE (discard kapanışlı): kapanış sapması ve bağlı çıkış DOKUNULMAZ ⇒ 40 = 40.
    const f15 = await depoKesimi("discard");
    await undo.applyUndo(f15.cocuk, undefined, { mode: "SINGLE_RESTORE", reason: "bekçi §15" });
    const d15 = await durumDefter(f15.ebeveyn);
    const c15 = await bagliCikis(f15.ebeveyn, STOCK_MOVE_REASON.CUT_DISCARD);
    check("§15 ⭐ SINGLE_RESTORE: kapanışın CUT_DISCARD çıkışı TERSLENMEDİ ve durum = defter (40 = 40)", c15 !== null && c15.reversedBy.length === 0 && d15.current === 40 && d15.net === 40, `durum=${d15.current} defter=${d15.net} ters=${c15?.reversedBy.length}`);

    // §18 arşiv-SINGLE → FULL (S9): ölü çocuğun grubu FULL'de terslenir ⇒ 100 = 100.
    const f18 = await depoKesimi("discard");
    await undo.applyUndo(f18.cocuk, undefined, { mode: "SINGLE", reason: "bekçi §18 arşiv-SINGLE" });
    const d18a = await durumDefter(f18.ebeveyn);
    check("§18z pozitif kontrol: arşiv-SINGLE sonrası ebeveyn 0 = 0 (metraj dönmedi, OUT gerçek)", d18a.current === 0 && d18a.net === 0, `durum=${d18a.current} defter=${d18a.net}`);
    await undo.applyUndo(f18.ebeveyn, undefined, { mode: "FULL", reason: "bekçi §18 FULL" });
    const d18 = await durumDefter(f18.ebeveyn);
    const cocuk18 = await satirlar(f18.cocuk);
    check("§18 ⭐ arşiv-SINGLE ile ölmüş çocuğun grubu FULL'de terslendi: DURUM = DEFTER (100 = 100)", d18.current === 100 && d18.net === 100, `durum=${d18.current} defter=${d18.net}`);
    check("§18b ölü çocuğun defter neti 0 (IN'i terslenmiş)", net(cocuk18) === 0, `net=${net(cocuk18)}`);

    // §19 scrap-kalan çocuğu: SINGLE/SINGLE_RESTORE SUNULMAZ (409, kod), yalnız FULL.
    const f19 = await hamKesimi("scrap");
    const kalan19 = f19.kalan!;
    const oniz = (await undo.getUndoPreview(kalan19)).data as { options: Array<{ mode: string }>; defaultMode: string };
    check("§19a ⭐ scrap-kalan çocuğuna önizleme yalnız FULL sunar (defaultMode FULL)", oniz.options.every((o) => o.mode === "FULL") && oniz.defaultMode === "FULL", JSON.stringify({ modes: oniz.options.map((o) => o.mode), def: oniz.defaultMode }));
    for (const m of ["SINGLE", "SINGLE_RESTORE"] as const) {
      const r = await undo.applyUndo(kalan19, undefined, { mode: m, reason: "bekçi §19" }).then(
        () => ({ status: 200, code: null as string | null }),
        (e: unknown) => ({ status: (e as { statusCode?: number }).statusCode ?? 0, code: String(((e as { details?: { code?: unknown } }).details?.code) ?? "") }),
      );
      check(`§19b ${m} scrap-kalan çocuğuna 409 UNDO_SCRAP_REMAINDER_FULL_ONLY`, r.status === 409 && r.code === "UNDO_SCRAP_REMAINDER_FULL_ONLY", `status=${r.status} code=${r.code}`);
    }
    const d19once = await durumDefter(f19.ebeveyn);
    check("§19c reddedilen denemeler hiçbir şey yazmadı (ebeveyn 0 = 0, sapma canlı)", d19once.current === 0 && d19once.net === 0 && (await prisma.rollVariance.count({ where: { rollId: f19.ebeveyn, kind: "SCRAP", reversedAt: null } })) === 1, `durum=${d19once.current} defter=${d19once.net}`);
    await undo.applyUndo(kalan19, undefined, { mode: "FULL", reason: "bekçi §19 FULL" });
    const d19 = await durumDefter(f19.ebeveyn);
    check("§19d scrap-kalan çocuğundan FULL: DURUM = DEFTER (100 = 100), sapma damgalı", d19.current === 100 && d19.net === 100 && (await prisma.rollVariance.count({ where: { rollId: f19.ebeveyn, kind: "SCRAP", reversedAt: null } })) === 0, `durum=${d19.current} defter=${d19.net}`);
    // Normal kesim parçası SCRAP-KALAN SAYILMAZ (kapı dar): §11A'nın çocuğuna SINGLE hâlâ sunulur.
    const f19k = await depoKesimi();
    const onizK = (await undo.getUndoPreview(f19k.cocuk)).data as { options: Array<{ mode: string }> };
    check("§19e kapı DAR: sıradan kesim parçasına SINGLE hâlâ sunuluyor", onizK.options.some((o) => o.mode === "SINGLE"), JSON.stringify(onizK.options.map((o) => o.mode)));

    // ── §16 · §17 ⭐ GERÇEK AŞIM — KEŞİF TERMİNAL, EBEVEYNE TAŞINIR (hüküm ② a, 2026-09-14) ──
    // 100 m depo topu → 40·40·40 (3.'de kesim anı keşfi: ebeveynde TAMBUR_OVERCUT 20,
    // sourceRollId = 3. çocuk; çocukta OVERAGE +20 stok satırı). Eski kod geri almada
    // bump için İKİNCİ OVERAGE yazıyor (Σ 40) ve çocuğun +20'sini tersleyip ebeveyne
    // taşımıyordu (durum 120 ↔ defter 100; 1c ölçtü). Ölçüt: durum = defter = 120 ∧
    // canlı OVERAGE n=1 Σ=20 ∧ taşıma satırı ebeveynde aynı rollVarianceId ile.
    async function asimliKesim(): Promise<{ ebeveyn: string; cocuklar: string[] }> {
      const pRes = await inventory.createInitialEntry(
        { itemId, initialQty: 100 }, undefined, undefined, false, { forcedStatus: "WAREHOUSE" },
      );
      const ebeveyn = (pRes.data as { id: string }).id;
      rollIds.push(ebeveyn);
      const cocuklar: string[] = [];
      for (let i = 0; i < 3; i++) {
        const cRes = await tambur.cutWarehouseRoll(ebeveyn, { cutLength: 40, rawDestination: "WAREHOUSE", qualityGrade: gradeFirst });
        const cocuk = (cRes.data as { childRoll?: { id: string } }).childRoll?.id;
        if (!cocuk) throw new Error(`aşımlı kesim ${i + 1}. çocuğu doğmadı`);
        cocuklar.push(cocuk); rollIds.push(cocuk);
      }
      return { ebeveyn, cocuklar };
    }
    const asimOlc = async (ebeveyn: string) => {
      const r = await prisma.roll.findUniqueOrThrow({ where: { id: ebeveyn }, select: { currentQty: true, initialQty: true } });
      const rows = await satirlar(ebeveyn);
      const asim = await prisma.rollVariance.findMany({ where: { rollId: ebeveyn, kind: "OVERAGE", reversedAt: null }, select: { id: true, qty: true, source: true, sourceRollId: true } });
      const tasima = rows.filter((x) => x.reasonCode === STOCK_MOVE_REASON.OVERAGE && x.reversesMovementId === null);
      return { current: Number(r.currentQty), initial: Number(r.initialQty), net: net(rows), asim, tasima };
    };
    // §16 SINGLE ×3 (= 6e §12d)
    const f16 = await asimliKesim();
    const kesif16 = await prisma.rollVariance.findFirst({ where: { rollId: f16.ebeveyn, source: "TAMBUR_OVERCUT" }, select: { id: true, qty: true, sourceRollId: true } });
    check("§16z pozitif kontrol: 3. kesim ebeveyne TAMBUR_OVERCUT 20 yazdı, sourceRollId = 3. çocuk", Number(kesif16?.qty) === 20 && kesif16?.sourceRollId === f16.cocuklar[2], JSON.stringify(kesif16));
    for (const c of [...f16.cocuklar].reverse()) await undo.applyUndo(c, undefined, { mode: "SINGLE", reason: "bekçi §16" });
    const d16 = await asimOlc(f16.ebeveyn);
    check("§16 ⭐ aşımlı SINGLE×3: DURUM = DEFTER = 120, initialQty 120", d16.current === 120 && d16.net === 120 && d16.initial === 120, `durum=${d16.current} defter=${d16.net} initial=${d16.initial}`);
    check("§16b canlı OVERAGE n=1 Σ=20 (bump keşifle karşılandı, ikinci satır YOK)", d16.asim.length === 1 && Number(d16.asim[0]!.qty) === 20 && d16.asim[0]!.source === "TAMBUR_OVERCUT", JSON.stringify(d16.asim.map((a) => `${a.source}:${a.qty}`)));
    check("§16c keşfin depo etkisi EBEVEYNE TAŞINDI: OVERAGE +20 satırı aynı rollVarianceId ile", d16.tasima.length === 1 && Number(d16.tasima[0]!.qty) === 20 && d16.tasima[0]!.rollVarianceId === kesif16?.id, JSON.stringify(d16.tasima.map((t) => ({ qty: t.qty, v: t.rollVarianceId === kesif16?.id }))));
    // §17 FULL (aşımlı kesimler + discard kapanışı → arşiv → FULL)
    const f17 = await asimliKesim();
    await tambur.finalizeWarehouseCut(f17.ebeveyn, { remainingAction: "discard", varianceReasonCode: null, varianceReasonText: "bekçi §17" });
    await undo.applyUndo(f17.ebeveyn, undefined, { mode: "FULL", reason: "bekçi §17 aşımlı FULL" });
    const d17 = await asimOlc(f17.ebeveyn);
    check("§17 ⭐ aşımlı FULL: DURUM = DEFTER = 120, canlı OVERAGE n=1 Σ=20, taşıma satırı ebeveynde", d17.current === 120 && d17.net === 120 && d17.asim.length === 1 && Number(d17.asim[0]!.qty) === 20 && d17.tasima.length === 1, `durum=${d17.current} defter=${d17.net} asim=${JSON.stringify(d17.asim.map((a) => `${a.source}:${a.qty}`))} taşıma=${d17.tasima.length}`);
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
