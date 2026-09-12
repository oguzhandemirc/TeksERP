// =============================================================================
// BEKÇİ — STOK DEFTERİ: KESİM BİR DÖNÜŞÜMDÜR (TRANSFORM çifti)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts stock_ledger_transform
//
// NEDEN: Kesim malı TAŞIMAZ, BÖLER. Defter bugüne kadar kesimde HİÇ satır
// yazmıyordu ve bu "çocuğa satır yazmak depoya gireni iki kez saydırır"
// korkusuyla savunuluyordu (`test_warehouse_ledger` §B2/§B3). Korku yalnız
// EBEVEYN ÇIKIŞI yazılmadığında geçerliydi: çift yazılınca grubun neti SIFIR
// olur ve depo toplamı kesimden etkilenmez. Satır yazmamanın bedeli ise
// sessizdir — 100 m top 40+60'a bölündüğünde defter "hiçbir şey olmadı" der,
// yani as-of kesiti çocuğun metrajını hiçbir zaman göremez.
//
// ÖLÇÜLENLER (⭐ = bu dilimin getirdiği davranış)
//   §A Normal kesim → ⭐ TRANSFORM ÇİFTİ (ebeveyn çıkışı + çocuk girişi),
//      aynı `transformGroupId`, grup neti SIFIR, uçlardaki statüler dolu
//   §B Aşımlı kesim → ⭐ devir ebeveynin GERÇEKTEN kaybettiği kadar; fazlalık
//      DEVİR değil KEŞİF: gruba girmeyen ayrı `OVERAGE` satırı, `RollVariance`a
//      bağlı. Grup neti aşımda da SIFIR kalır.
//   §B2 Sıfırdan aşım (2026-08-12 saha vakası: 0 m topta ikinci aşım kesimi
//      MEŞRU) → ⭐ devir satırı YOK (hiçbir şey devretmedi), yalnız keşif satırı
//   §C Kapanış `keep_1kalite` → ⭐ kesim çifti (kalan çocuğa devredildi)
//   §D Kapanış `discard` → ⭐ tek ÇIKIŞ satırı (`CUT_DISCARD`), grup YOK
//   §E ⭐ BİTMİŞ ebeveynde `scrap` malı stoktan ÇIKARMAZ: çocuk FIRE
//      KALİTESİYLE ama WAREHOUSE statüsünde doğar → yine ÇİFT yazılır.
//      Sapma defteri "fire kararı verildi", stok defteri "mal rafta kaldı" der;
//      sebep kodu `varianceKind`den DEĞİL çocuğun statüsünden türetilmeli.
//   §F HAM ebeveynde `scrap` malı stoktan çıkarır (çocuk SCRAP = stok dışı) →
//      tek ÇIKIŞ satırı (`SCRAP`)
//   §G Deposuz ESKİ top (ölçüldü: 4.553 kayıt) → çift HEPSİ YA HİÇ: tek başına
//      çocuk girişi karşılığı olmayan bir ARTI olurdu
//   §H MUTABAKAT — iki bağımsız kaynak: canlı stok metrajı ↔ Σdefter neti
//      (§G ailesinin sınırlı artığı ÖLÇÜLEREK raporlanır, gizlenmez)
// =============================================================================
import { RollStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { resolveTamburOverQuantityEnabled } from "../src/services/system-setting.service";
import { WAREHOUSE_STOCK_STATUSES } from "../src/services/helpers/warehouse-stock.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

// ⚠️ Sebep kodları BİLEREK düz metin: satıra yazılan DEĞER sözleşmedir. Sabiti
// import etseydik katalogdaki bir yeniden adlandırma bekçiyi de birlikte
// taşır ve panelde/raporda kırılan kırılımı görmezdik.
const CUT_SPLIT = "CUT_SPLIT";
const OVERAGE = "OVERAGE";
const SCRAP = "SCRAP";
const CUT_DISCARD = "CUT_DISCARD";
const FLAG_KEY = "tambur.overQuantityEnabled";

const inventory = new InventoryService();
const tambur = new TamburService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-TRF-${Date.now()}`;
const rollIds: string[] = [];
let itemId = "";
/** Bayrağın ÖNCEKİ hâli — `finally`de BİREBİR geri yüklenir (satır yoksa silinir). */
let flagBefore: { vardi: boolean; value: unknown } = { vardi: false, value: null };
/** §B aşım bölümü FİİLEN koştu mu — vakumen yeşile karşı körlük zemini. */
let overageRan = false;

type Row = {
  rollId: string;
  eventType: WarehouseEventType;
  qty: unknown;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromStatus: RollStatus | null;
  toStatus: RollStatus | null;
  reasonCode: string | null;
  transformGroupId: string | null;
  rollVarianceId: string | null;
};

async function rowsOf(ids: string[]): Promise<Row[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId: { in: ids } },
    select: {
      rollId: true, eventType: true, qty: true, fromWarehouseId: true, toWarehouseId: true,
      fromStatus: true, toStatus: true, reasonCode: true, transformGroupId: true, rollVarianceId: true,
    },
  });
}

/** Defter neti: giriş ucu artı, çıkış ucu eksi (yön `eventType`ten OKUNMAZ). */
function net(rows: Row[]): number {
  return rows.reduce((a, r) => {
    const q = Number(r.qty);
    return a + (r.toWarehouseId ? q : 0) - (r.fromWarehouseId ? q : 0);
  }, 0);
}

/** Canlı metraj — statüye bakmaz (korunum ölçümü için). */
async function liveQty(ids: string[]): Promise<number> {
  const rs = await prisma.roll.findMany({ where: { id: { in: ids } }, select: { currentQty: true } });
  return rs.reduce((a, r) => a + Number(r.currentQty), 0);
}

/** Canlı STOK metrajı — mutabakatın "canlı" tarafı (tek kaynak yüklem). */
async function liveStockQty(ids: string[]): Promise<number> {
  const rs = await prisma.roll.findMany({
    where: { id: { in: ids } },
    select: { currentQty: true, status: true, warehouseId: true },
  });
  return rs
    .filter((r) => r.warehouseId !== null && WAREHOUSE_STOCK_STATUSES.includes(r.status))
    .reduce((a, r) => a + Number(r.currentQty), 0);
}

async function makeParent(qty: number, forcedStatus?: "WAREHOUSE"): Promise<string> {
  const res = await inventory.createInitialEntry(
    { itemId, initialQty: qty },
    undefined,
    undefined,
    false,
    forcedStatus ? { forcedStatus } : {},
  );
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function cut(parentId: string, cutLength: number): Promise<string> {
  const res = await tambur.cutWarehouseRoll(parentId, {
    // Kalite AÇIKÇA: giriş topu gradesiz doğuyor ve `quality.gradeRequiredEnabled`
    // açıkken kesim 400 GRADE_REQUIRED'a düşer, defter hiç ölçülemezdi.
    cutLength,
    rawDestination: "WAREHOUSE",
    qualityGrade: "1.KALITE",
  });
  const childId = (res.data as { childRoll?: { id: string } }).childRoll?.id;
  if (!childId) throw new Error("kesim çocuğu doğmadı — fikstür kurulamadı");
  rollIds.push(childId);
  return childId;
}

async function main(): Promise<void> {
  console.log("=== Stok defteri: kesim TRANSFORM çifti bekçisi ===\n");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const def = await ensureDefaultWarehouse();
  itemId = (
    await prisma.item.create({
      data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" },
      select: { id: true },
    })
  ).id;

  // ── §A Normal kesim: 100 → 40 kesildi ─────────────────────────────────────
  const aParent = await makeParent(100, "WAREHOUSE");
  const aLiveBefore = await liveQty([aParent]);
  const aNetBefore = net(await rowsOf([aParent]));
  const aChild = await cut(aParent, 40);

  const aRows = (await rowsOf([aParent, aChild])).filter((r) => r.reasonCode === CUT_SPLIT);
  const aExit = aRows.find((r) => r.rollId === aParent && r.fromWarehouseId !== null);
  const aEntry = aRows.find((r) => r.rollId === aChild && r.toWarehouseId !== null);
  check(
    "§A1 Canlı metraj kesimde KORUNUYOR (ebeveyn + çocuk = kesim öncesi)",
    aLiveBefore === (await liveQty([aParent, aChild])),
    `önce=${aLiveBefore} sonra=${await liveQty([aParent, aChild])}`,
  );
  check(
    "§A2 ⭐ Kesim TRANSFORM ÇİFTİ yazar (ebeveyn çıkışı + çocuk girişi)",
    !!aExit && !!aEntry && aRows.length === 2,
    `satır=${aRows.length} çıkış=${!!aExit} giriş=${!!aEntry}`,
  );
  check(
    "§A3 ⭐ Çift AYNI `transformGroupId` altında ve grup neti SIFIR",
    !!aExit?.transformGroupId && aExit.transformGroupId === aEntry?.transformGroupId && net(aRows) === 0,
    `grup=${String(aExit?.transformGroupId).slice(0, 8)} net=${net(aRows)}`,
  );
  check(
    "§A4 ⭐ Devir metrajı kesim metresi (iki uçta da 40)",
    Number(aExit?.qty) === 40 && Number(aEntry?.qty) === 40,
    `çıkış=${String(aExit?.qty)} giriş=${String(aEntry?.qty)}`,
  );
  check(
    "§A5 Uçlardaki STATÜ dolu ve doğru (çıkış ebeveynin, giriş çocuğun statüsü)",
    aExit?.fromStatus === RollStatus.WAREHOUSE &&
      aExit?.toStatus === null &&
      aEntry?.toStatus === RollStatus.WAREHOUSE &&
      aEntry?.fromStatus === null,
    `çıkışFrom=${String(aExit?.fromStatus)} girişTo=${String(aEntry?.toStatus)}`,
  );
  check(
    "§A6 Olay tipi TRANSFORM (aynı depoda 1:N bölünme)",
    aExit?.eventType === WarehouseEventType.TRANSFORM && aEntry?.eventType === WarehouseEventType.TRANSFORM,
    `çıkış=${String(aExit?.eventType)} giriş=${String(aEntry?.eventType)}`,
  );
  check(
    "§A7 İki bağımsız kaynak TUTARLI: canlıΔ = defterΔ = 0",
    (await liveQty([aParent, aChild])) - aLiveBefore === 0 &&
      net(await rowsOf([aParent, aChild])) - aNetBefore === 0,
    `canlıΔ=${(await liveQty([aParent, aChild])) - aLiveBefore} defterΔ=${net(await rowsOf([aParent, aChild])) - aNetBefore}`,
  );

  // ── §B Aşımlı kesim: 60 kayıtlı, 100 kesildi (40 aşım) ────────────────────
  flagBefore = await prisma.systemSetting
    .findUnique({ where: { key: FLAG_KEY }, select: { value: true } })
    .then((r) => ({ vardi: r !== null, value: r?.value ?? null }));
  await prisma.systemSetting.upsert({
    where: { key: FLAG_KEY },
    update: { value: true },
    create: { key: FLAG_KEY, value: true, description: `${TAG} geçici` },
  });
  const flagEffective = await resolveTamburOverQuantityEnabled();

  const bParent = await makeParent(60, "WAREHOUSE");
  let bChild = "";
  if (flagEffective) {
    overageRan = true;
    bChild = await cut(bParent, 100);
    const bRows = await rowsOf([bParent, bChild]);
    const bPair = bRows.filter((r) => r.reasonCode === CUT_SPLIT);
    const bOver = bRows.filter((r) => r.reasonCode === OVERAGE);
    check(
      "§B1 ⭐ Aşımda DEVİR satırı ebeveynin gerçekten kaybettiği kadar (60, kesim 100 değil)",
      bPair.length === 2 && bPair.every((r) => Number(r.qty) === 60),
      `çift=${bPair.length} metraj=${bPair.map((r) => String(r.qty)).join("/")}`,
    );
    check(
      "§B2 ⭐ Grup neti aşımda da SIFIR",
      bPair.length === 2 && net(bPair) === 0,
      `grupNet=${net(bPair)}`,
    );
    check(
      "§B3 ⭐ Fazlalık DEVİR değil KEŞİF: gruba girmeyen ayrı OVERAGE satırı (40)",
      bOver.length === 1 &&
        Number(bOver[0]?.qty) === 40 &&
        bOver[0]?.transformGroupId === null &&
        bOver[0]?.rollId === bChild &&
        bOver[0]?.toWarehouseId !== null,
      `satır=${bOver.length} qty=${String(bOver[0]?.qty)} grup=${String(bOver[0]?.transformGroupId)}`,
    );
    check(
      "§B4 Keşif satırı olay tipi ADJUST ve `RollVariance`a BAĞLI (sebep orada, depo etkisi burada)",
      bOver[0]?.eventType === WarehouseEventType.ADJUST && bOver[0]?.rollVarianceId !== null,
      `tip=${String(bOver[0]?.eventType)} varyans=${String(bOver[0]?.rollVarianceId)}`,
    );
    check(
      "§B5 Çocuğun defter toplamı canlı metrajına EŞİT (60 devir + 40 keşif = 100)",
      net(bRows.filter((r) => r.rollId === bChild)) === (await liveQty([bChild])),
      `defter=${net(bRows.filter((r) => r.rollId === bChild))} canlı=${await liveQty([bChild])}`,
    );

    // ── §B6 Sıfırdan aşım — 2026-08-12 saha vakası ──────────────────────────
    // Ebeveyn aşım dalında 0'a indi ama EMEKLİ EDİLMEDİ (aşımda emeklilik yok:
    // fiziksel kumaş bitmemiştir). İkinci aşım kesimi MEŞRU ve hiçbir şey
    // DEVRETMEZ — devir satırı yazılırsa qty 0 olur ve kapı fırlatır.
    const bChild2 = await cut(bParent, 25);
    const b2Rows = await rowsOf([bChild2]);
    check(
      "§B6 ⭐ Sıfır kalanlı aşımda DEVİR satırı YOK, yalnız keşif satırı (25)",
      b2Rows.length === 1 &&
        b2Rows[0]?.reasonCode === OVERAGE &&
        Number(b2Rows[0]?.qty) === 25 &&
        b2Rows[0]?.transformGroupId === null,
      `satır=${b2Rows.length} sebep=${String(b2Rows[0]?.reasonCode)} qty=${String(b2Rows[0]?.qty)}`,
    );
  } else {
    console.error(
      "⚠️  §B ATLANDI — `tambur.overQuantityEnabled` etkin değeri KAPALI " +
        "(üretim modülü kapalı olabilir). Aşım bölümü hiç ölçülmedi.",
    );
  }
  check("§B0 Aşım bölümü FİİLEN koştu (körlük zemini)", overageRan);

  // ── §C Kapanış `keep_1kalite`: kalan çocuğa devrediliyor ──────────────────
  const cParent = await makeParent(80, "WAREHOUSE");
  const cFin = await tambur.finalizeWarehouseCut(cParent, { remainingAction: "keep_1kalite" });
  const cChild = (cFin.data as { remainingChild?: { id: string } | null }).remainingChild?.id ?? "";
  if (cChild) rollIds.push(cChild);
  const cRows = (await rowsOf([cParent, cChild])).filter((r) => r.reasonCode === CUT_SPLIT);
  check(
    "§C1 ⭐ Kapanışta kalan çocuğa devir ÇİFTİ yazıldı (80), grup neti SIFIR",
    cRows.length === 2 && net(cRows) === 0 && cRows.every((r) => Number(r.qty) === 80),
    `satır=${cRows.length} net=${net(cRows)}`,
  );
  check(
    "§C2 Çift ebeveyn ÇIKIŞI + çocuk GİRİŞİ (tek yön değil)",
    cRows.some((r) => r.rollId === cParent && r.fromWarehouseId !== null) &&
      cRows.some((r) => r.rollId === cChild && r.toWarehouseId !== null),
  );

  // ── §D Kapanış `discard`: kalan defterden düşüyor ─────────────────────────
  const dParent = await makeParent(70, "WAREHOUSE");
  await tambur.finalizeWarehouseCut(dParent, { remainingAction: "discard" });
  const dRows = await rowsOf([dParent]);
  const dExit = dRows.find((r) => r.reasonCode === CUT_DISCARD);
  check(
    "§D1 ⭐ `discard`ta TEK çıkış satırı (`CUT_DISCARD`), grup YOK",
    !!dExit && dExit.toWarehouseId === null && dExit.fromWarehouseId !== null && dExit.transformGroupId === null,
    `satır=${dRows.filter((r) => r.reasonCode === CUT_DISCARD).length} sebep=${String(dExit?.reasonCode)}`,
  );
  check(
    "§D2 Çıkış metrajı kalan kadar (70) ve sapma defterine BAĞLI",
    Number(dExit?.qty) === 70 && dExit?.rollVarianceId !== null,
    `qty=${String(dExit?.qty)} varyans=${String(dExit?.rollVarianceId)}`,
  );
  check(
    "§D3 Canlı stok düşüşü ile defter düşüşü EŞİT (iki bağımsız kaynak)",
    net(dRows) === (await liveStockQty([dParent])),
    `defterNet=${net(dRows)} canlıStok=${await liveStockQty([dParent])}`,
  );

  // ── §E ⭐ BİTMİŞ ebeveynde `scrap` malı stoktan ÇIKARMAZ ───────────────────
  const eParent = await makeParent(50, "WAREHOUSE");
  const eFin = await tambur.finalizeWarehouseCut(eParent, { remainingAction: "scrap" });
  const eChild = (eFin.data as { remainingChild?: { id: string } | null }).remainingChild?.id ?? "";
  if (eChild) rollIds.push(eChild);
  const eChildRow = eChild
    ? await prisma.roll.findUnique({ where: { id: eChild }, select: { status: true, qualityGrade: true } })
    : null;
  const eRows = await rowsOf([eParent, eChild]);
  check(
    "§E1 Bitmiş ebeveynin `scrap` çocuğu FIRE kalitesiyle ama WAREHOUSE statüsünde doğuyor (mal rafta)",
    eChildRow?.status === RollStatus.WAREHOUSE && eChildRow?.qualityGrade === "FIRE",
    `statü=${String(eChildRow?.status)} kalite=${String(eChildRow?.qualityGrade)}`,
  );
  check(
    "§E2 ⭐ Mal stokta kaldığı için ÇİFT yazılır — SCRAP çıkışı YAZILMAZ",
    eRows.filter((r) => r.reasonCode === CUT_SPLIT).length === 2 &&
      eRows.filter((r) => r.reasonCode === SCRAP).length === 0 &&
      net(eRows.filter((r) => r.reasonCode === CUT_SPLIT)) === 0,
    `çift=${eRows.filter((r) => r.reasonCode === CUT_SPLIT).length} scrap=${eRows.filter((r) => r.reasonCode === SCRAP).length}`,
  );

  // ── §F HAM ebeveynde `scrap` malı stoktan çıkarır (çocuk SCRAP) ───────────
  const fParent = await makeParent(45); // renksiz → STOCK (ham)
  const fFin = await tambur.finalizeWarehouseCut(fParent, { remainingAction: "scrap" });
  const fChild = (fFin.data as { remainingChild?: { id: string } | null }).remainingChild?.id ?? "";
  if (fChild) rollIds.push(fChild);
  const fChildRow = fChild
    ? await prisma.roll.findUnique({ where: { id: fChild }, select: { status: true } })
    : null;
  const fRows = await rowsOf([fParent, fChild]);
  check(
    "§F1 Ham ebeveynin `scrap` çocuğu SCRAP statüsünde (stok kümesi DIŞI)",
    fChildRow?.status === RollStatus.SCRAP,
    `statü=${String(fChildRow?.status)}`,
  );
  check(
    "§F2 ⭐ Mal stoktan çıktığı için TEK `SCRAP` çıkışı yazılır, çift YAZILMAZ",
    fRows.filter((r) => r.reasonCode === SCRAP).length === 1 &&
      fRows.filter((r) => r.reasonCode === CUT_SPLIT).length === 0 &&
      fRows.find((r) => r.reasonCode === SCRAP)?.toWarehouseId === null,
    `scrap=${fRows.filter((r) => r.reasonCode === SCRAP).length} çift=${fRows.filter((r) => r.reasonCode === CUT_SPLIT).length}`,
  );
  check(
    "§F3 Çıkış metrajı canlı stok düşüşüne eşit (çocuk stok dışı → canlı stok 0)",
    net(fRows) === (await liveStockQty([fParent, fChild])),
    `defterNet=${net(fRows)} canlıStok=${await liveStockQty([fParent, fChild])}`,
  );

  // ── §G Deposuz ESKİ top: çift HEPSİ YA HİÇ ────────────────────────────────
  // Fikstür GERÇEK yazma yolundan geçer, sonra depo damgası düşürülür: bu,
  // defter öncesi 4.553 kaydın (ölçüldü) bugünkü hâlidir. Kesimin kendisi
  // yine gerçek servisten geçiyor.
  const gParent = await makeParent(30, "WAREHOUSE");
  await prisma.roll.update({ where: { id: gParent }, data: { warehouseId: null } });
  // ⚠️ TABAN kesimden ÖNCE alınır: fikstür depo damgasını GERÇEK giriş satırından
  // sonra düşürdüğü için mutlak boşluk iki şeyi karıştırır (topun kendi
  // damgasızlığı + kesimin yazmadığı çift). Ölçülmek istenen İKİNCİSİ → delta.
  const gGapBefore = (await liveStockQty([gParent])) - net(await rowsOf([gParent]));
  const gChild = await cut(gParent, 10);
  const gRows = await rowsOf([gParent, gChild]);
  check(
    "§G1 ⭐ Deposuz ebeveynde çift HİÇ yazılmaz (tek başına çocuk girişi karşılıksız ARTI olurdu)",
    gRows.filter((r) => r.reasonCode === CUT_SPLIT).length === 0,
    `çift satırı=${gRows.filter((r) => r.reasonCode === CUT_SPLIT).length}`,
  );

  // ── §H MUTABAKAT — canlı stok ↔ Σdefter neti ──────────────────────────────
  // §G ailesi HARİÇ her aile için birebir tutmalı. §G'nin artığı gizlenmez,
  // ÖLÇÜLÜR: deposuz ebeveynden depolu çocuk doğduğu için canlı stok çocuk
  // kadar artar, defter artmaz. Sınırlı ve bilinen bu boşluk AÇILIŞ FOTOĞRAFI
  // dilimine aittir (defter kapsamına girmemiş malın açılışı).
  const normalFamily = rollIds.filter((id) => id !== gParent && id !== gChild);
  const liveNormal = await liveStockQty(normalFamily);
  const ledgerNormal = net(await rowsOf(normalFamily));
  check(
    "§H1 ⭐ MUTABAKAT: canlı stok metrajı = Σdefter neti (§G ailesi hariç, iki bağımsız kaynak)",
    liveNormal === ledgerNormal,
    `canlıStok=${liveNormal} defterNet=${ledgerNormal}`,
  );
  const gGapAfter = (await liveStockQty([gParent, gChild])) - net(gRows);
  check(
    "§H2 Deposuz ailede kesimin AÇTIĞI boşluk tam olarak çocuğun metrajı (10) — ölçüldü, açılış dilimine devredildi",
    gGapAfter - gGapBefore === 10,
    `boşlukΔ=${gGapAfter - gGapBefore} (önce=${gGapBefore} sonra=${gGapAfter})`,
  );
  check(
    "§H3 Defterde qty HER ZAMAN pozitif (yön uçlardan okunur)",
    (await rowsOf(rollIds)).every((r) => Number(r.qty) > 0),
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (varsayılan depo: ${def.name})`);
}

async function cleanup(): Promise<void> {
  try {
    // Bayrak BİREBİR geri: satır yoktuysa sil, vardıysa eski değerini yaz.
    if (flagBefore.vardi) {
      await prisma.systemSetting
        .update({ where: { key: FLAG_KEY }, data: { value: flagBefore.value as never } })
        .catch(() => {});
    } else {
      await prisma.systemSetting.deleteMany({ where: { key: FLAG_KEY } }).catch(() => {});
    }
    if (rollIds.length) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } }).catch(() => {});
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      // RollVariance RESTRICT FK — toplardan ÖNCE silinmeli.
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.roll
        .deleteMany({ where: { id: { in: rollIds }, parentRollId: { not: null } } })
        .catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("💥 ÇÖKTÜ:", e instanceof Error ? e.message : e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
