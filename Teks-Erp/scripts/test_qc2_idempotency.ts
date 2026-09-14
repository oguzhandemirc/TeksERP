// =============================================================================
// KK2 (QC2_COMPLETED) İDEMPOTENCY — roll_operations_active_triple_uq (rollId, workOrderStepId, operationType) WHERE revokedAt IS NULL
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts qc2_idempotency
//
// NE ÖLÇER: Kurşun+KK2 tamamlama kaydı aynı top + aynı adım için İKİ KEZ yazılamaz —
// düz create P2002 fırlatır (DB seddi); geri alınmış (revokedAt dolu) kayıt yeni
// kaydı ENGELLEMEZ (sed PARTIAL: geri alınan KK2 yeniden tamamlanabilir). Tablette
// çift dokunuş / ağ tekrarı senaryosunun DB seddi.
//
// ⚠️ "5 UPSERT → TEK SATIR" KONTROLÜ SEDDİ ÖLÇMEZ ve bu SONDAYLA bulundu: test
// DB'sinde index düşürülünce o kontrol YEŞİL kaldı (satır=1) — Prisma upsert'i
// bileşik anahtarla önce bulur sonra günceller, DB'ye ikinci satır hiç gitmez.
// Seddi yalnız düz `create` kontrolü ölçer. Kontrol tutuldu (uygulama yolu bu),
// etiketi "sed" iddiasından arındırıldı; ⭐ yalnız gerçekten sed ölçen ikisinde.
//
// ⚠️ FİKSTÜR KENDİ KENDİNE — ortamdaki veriye BAĞIMLI DEĞİL (2026-09-13):
// eski sürüm `findFirst` ile "herhangi bir PROCESS_QC adımı + herhangi bir top"
// arıyordu; CI'nın taze `_test` klonunda (migrate deploy sonrası, seed'siz) ikisi de
// yok ⇒ ⏭ beyanla dönüyor, HİÇBİR ŞEY ölçmüyordu (d9 sessizliği beyana çevirdi,
// `923addc7`; bu sürüm beyanı ölçüme çevirir). Şimdi test kendi Item + Station
// (PROCESS_QC) + WorkOrder + WorkOrderStep + Roll zincirini `TEST-QC2-` damgasıyla
// kurar ve `finally`de FK sırasıyla söker. Seed'e, istasyon kataloğuna, admin'e
// ihtiyaç yok — boş DB'de de aynı iki kontrol koşar.
//
// SONDALAR (2026-09-13, taze seed'siz `_test` klonu + dolu yerel `_test`; geri alma
// cp + sha256 / index için saklanan indexdef):
//   · pozitif kontrol: seed'siz taze DB'de 7/0 (fikstür 2 + ölçüm 4 + temizlik 1),
//     dolu DB'de de 7/0
//   · negatif (DB): `roll_operations_active_triple_uq` DROP → P2002 kontrolü KIRMIZI,
//     upsert kontrolü YEŞİL KALDI (yukarıdaki bulgu); index indexdef'ten geri kuruldu
//   · negatif (kod): P2002 beklentisi "P2003" → KIRMIZI
//   · negatif (DB): partial index TAM unique'e çevrildi (WHERE kaldırıldı) →
//     "geri alınmış engellemez" KIRMIZI (P2002); indexdef'ten geri kuruldu
//   · yarım fikstür: station'dan sonra kasıtlı throw → finally 0·0·0 kalıntı ✓
// =============================================================================
import { RollOperationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ozetBasildi = false;
/** Özet satırı HER çıkış yolunda basılır — beklenmeyen hata dâhil. */
function ozetBas(): void {
  if (ozetBasildi) return;
  ozetBasildi = true;
  // ⛔ SIFIR ÖLÇÜM YEŞİL OLAMAZ: gövde hiç kontrol koşturmadan düştüyse kırmızı.
  if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı — fikstür kurulamadı ya da gövde erken düştü"); }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

type Fikstur = { itemId: string; stationId: string; woId: string; stepId: string; rollId: string };

/**
 * TEST-QC2- damgalı zincir: Item → Station(PROCESS_QC) → WorkOrder → WorkOrderStep → Roll.
 * `f` ADIM ADIM doldurulur: zincir ortada düşerse (ölçüldü: CHECK ihlali) o ana kadar
 * yaratılanlar `finally`de yine sökülür — döndürerek doldurmak yarım kalıntı bırakıyordu.
 */
async function fiksturKur(damga: string, f: Partial<Fikstur>): Promise<void> {
  const item = await prisma.item.create({
    data: { code: `TEST-QC2-${damga}`, name: `TEST QC2 kumaş ${damga}`, itemType: "FABRIC" },
    select: { id: true },
  });
  f.itemId = item.id;
  const station = await prisma.station.create({
    data: { code: `TEST-QC2-${damga}`, name: `TEST KK2 ${damga}`, type: "INTERNAL", kind: "PROCESS_QC" },
    select: { id: true },
  });
  f.stationId = station.id;
  const wo = await prisma.workOrder.create({
    // CHECK work_orders_stockprod_targetItem: STOCK_PRODUCTION hedef kalem ister.
    data: { workOrderNumber: `TEST-QC2-${damga}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: item.id },
    select: { id: true },
  });
  f.woId = wo.id;
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  f.stepId = step.id;
  const roll = await prisma.roll.create({
    data: { itemId: item.id, barcode: `TEST-QC2-${damga}`, initialQty: 10, currentQty: 10, status: "IN_PRODUCTION", currentStepId: step.id },
    select: { id: true },
  });
  f.rollId = roll.id;
}

/** FK sırasıyla söker; her adım kendi hatasını yutar ki bir kalıntı diğerlerini bırakmasın. */
async function temizleFikstur(f: Partial<Fikstur>): Promise<void> {
  const adimlar: Array<[string, () => Promise<unknown>]> = [
    // Kimlik yoksa adım YOK — `?? ""` gibi bir literal düşüşü yüklemi kimlikten koparır (§10b).
    ["rollOperation", () => (f.rollId ? prisma.rollOperation.deleteMany({ where: { rollId: f.rollId } }) : Promise.resolve())],
    ["roll", () => prisma.roll.deleteMany({ where: { id: f.rollId ?? "" } })],
    ["workOrderStep", () => prisma.workOrderStep.deleteMany({ where: { id: f.stepId ?? "" } })],
    ["workOrder", () => prisma.workOrder.deleteMany({ where: { id: f.woId ?? "" } })],
    ["station", () => prisma.station.deleteMany({ where: { id: f.stationId ?? "" } })],
    ["item", () => prisma.item.deleteMany({ where: { id: f.itemId ?? "" } })],
  ];
  for (const [ad, sil] of adimlar) {
    try { await sil(); } catch (e) { console.log(`   ⚠️ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  }
}

async function main(): Promise<void> {
  console.log("=== KK2 idempotency — RollOperation @@unique ===\n");
  const damga = `${process.pid}-${Date.now().toString(36)}`;
  const f: Partial<Fikstur> = {};
  try {
    await fiksturKur(damga, f);
    check("fikstür: PROCESS_QC istasyonu + iş emri adımı kuruldu", Boolean(f.stepId));
    check("fikstür: üretimdeki top adıma bağlı", Boolean(f.rollId));
    const { rollId, stepId } = f as Fikstur;

    const ops = 5;
    for (let i = 0; i < ops; i++) {
      await prisma.rollOperation.upsert({
        where: { rollId_workOrderStepId_operationType: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED } },
        create: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED, metadata: { idempotencyTest: true, attempt: i + 1 } },
        update: {},
      });
    }
    const count = await prisma.rollOperation.count({
      where: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED },
    });
    check("uygulama yolu: 5 upsert → tek satır (bul-güncelle; seddi ÖLÇMEZ)", count === 1, `satır=${count}`);

    let p2002 = false;
    let baskaHata = "";
    try {
      await prisma.rollOperation.create({
        data: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED, metadata: { p2002Test: true } },
      });
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "P2002") p2002 = true;
      else baskaHata = err.code ?? err.message?.split("\n")[0] ?? String(e);
    }
    check("⭐ Düz create P2002 fırlattı (aktif üçlü seddi DB'de)", p2002, baskaHata ? `başka hata: ${baskaHata}` : "");

    // Sed PARTIAL (revokedAt IS NULL): geri alınmış KK2 yeni tamamlamayı engellemez.
    await prisma.rollOperation.updateMany({
      where: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    let yenidenOk = true;
    let yenidenHata = "";
    try {
      await prisma.rollOperation.create({ data: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED } });
    } catch (e) { yenidenOk = false; yenidenHata = (e as { code?: string }).code ?? String(e); }
    check("⭐ geri alınmış kayıt yeni KK2'yi engellemez (sed yalnız AKTİF satırda)", yenidenOk, yenidenHata);

    // Körlük zemini: sed gerçekten BU satırı korudu — ikinci top aynı adımda serbest.
    const roll2 = await prisma.roll.create({
      data: { itemId: f.itemId!, barcode: `TEST-QC2-${damga}-2`, initialQty: 10, currentQty: 10, status: "IN_PRODUCTION", currentStepId: stepId },
      select: { id: true },
    });
    try {
      await prisma.rollOperation.create({ data: { rollId: roll2.id, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED } });
      check("kontrol: farklı top aynı adımda serbest (sed top+adım çiftine, adıma değil)", true);
    } catch (e) {
      check("kontrol: farklı top aynı adımda serbest (sed top+adım çiftine, adıma değil)", false, (e as Error).message.split("\n")[0]);
    } finally {
      await prisma.rollOperation.deleteMany({ where: { rollId: roll2.id } });
      await prisma.roll.deleteMany({ where: { id: roll2.id } });
    }
  } finally {
    await temizleFikstur(f);
    const [top, ist, kalem] = await Promise.all([
      prisma.roll.count({ where: { barcode: { startsWith: `TEST-QC2-${damga}` } } }),
      prisma.station.count({ where: { code: `TEST-QC2-${damga}` } }),
      prisma.item.count({ where: { code: `TEST-QC2-${damga}` } }),
    ]);
    check("temizlik: TEST-QC2 kalıntısı yok (top · istasyon · kalem)", top + ist + kalem === 0, `${top} · ${ist} · ${kalem}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  // `pool.end()` ŞART — `$disconnect` tek başına havuzu 10 dk açık tutar (180 sn koşucu zaman aşımı).
  .finally(async () => {
    ozetBas();
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
