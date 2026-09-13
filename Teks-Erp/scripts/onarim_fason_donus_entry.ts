// =============================================================================
// ONARIM — fason dönüşünde depoya GİRMEMİŞ malın "depoya girdi" (ENTRY) satırları
// =============================================================================
//   npx tsx scripts/onarim_fason_donus_entry.ts                                   → KURU KOŞUM (varsayılan)
//   npx tsx scripts/onarim_fason_donus_entry.ts --apply --onay=<N> --hedef=<db>   → ters kayıt yazar
//
// NEDEN: fason dönüşünde ara adımda doğan top üretime doğar (IN_PRODUCTION) ama
// defter koşulsuz ENTRY + toWarehouseId yazıyordu — mal rafa hiç girmediği hâlde
// depoda görünüyordu. Kod tarafı cb1d0304 ile İLERİYE dönük kapandı (yalnız
// bornStatus = WAREHOUSE ise satır yazılır). Geçmişteki yanlış satırlar
// DÜZELTİLMEZ (defter satırı UPDATE/DELETE edilmez): her biri bugüne yazılan,
// `reversesMovementId` ile orijinaline bağlı bir TERS KAYITLA kapanır
// (tasarım: docs/design/DEPO-STOK-DEFTERI-TASARIM.md §D2a, §3.1 GO/NO-GO #1).
//
// ⚠️ bb709bd9 ("516 topluk delik") BU ONARIMLA İLGİSİZ ve BACKFILL DEĞİLDİR:
// o commit tambur finalize çocuğunun doğumunda PRODUCTION satırını İLERİYE
// dönük yazar; 516 sayısı deliğin ölçüsüdür, onarılmaz. Geçmiş 516 top açılış
// fotoğrafına kalır (`scripts/acilis_fotografi_stok_defteri.ts`).
//
// KAPSAM (tek kaynak = ADAY_WHERE, İKİ bağımsız sinyal birlikte):
//   eventType = ENTRY · notes 'Fason dönüşü (…)' · topun entrySource = SUBCONTRACTOR_RETURN ·
//   kendisi ters kayıt değil · henüz terslenmemiş (reversesMovementId = id olan satır yok).
//   Sigorta: ön ek bugün src/ içinde TEK yazıcıdan çıkar (subcontractor.service.ts,
//   `Fason dönüşü (${receiptNo})`, ölçüm 2026-09-12: 1 site). Ön eki taşıyıp entrySource'u
//   farklı olan satır KAPSAM DIŞI sayılır ve dökümde ayrıca listelenir — ileride ikinci bir
//   yazıcı aynı metni kullanırsa sayı büyür ve fark edilir.
//
// SINIFLANDIRMA — DOĞUM STATÜSÜ KANITIYLA (bugünkü statüyle DEĞİL):
//   Kodun kuralı: `bornStatus = nextStep ? IN_PRODUCTION : WAREHOUSE`. Yani top depoya
//   girmemişse bunun kanıtı, doğduğu fason adımından SONRA aynı iş emrinde bir adım daha
//   olmasıdır (`producedInStep.stepSequence < max(stepSequence)`). Bugünkü statü kanıt
//   DEĞİLDİR: depoya meşru giren, sonra tambura tüketilen/sevk edilen top da bugün stok
//   dışındadır ve onun girişi terslenirse append-only defterde bir daha kapanmaz.
//   Kovalar: TERSLENECEK (kanıt: sonraki adım VAR — doğuş IN_PRODUCTION) ·
//   DOĞRU GİRİŞ (kanıt: fason SON adım — doğuş WAREHOUSE, dokunulmaz) ·
//   KANIT YOK (producedInStep yok — dokunulmaz, elle incelenir) ·
//   TEST ARTIĞI (`TEST-`/`TST-` iş emri/barkod — bekçi fixture'ı, clean_test_residue kapsamı) ·
//   ATLANAN 0 m (ileri satır 0 metraj — kapı 0'ı yazmaz; tek satır tüm tx'i düşürmesin).
//   İkinci kanıt (bilgi): `finalizedAt` — doğuşta WAREHOUSE ise trigger doğum anında damgalar;
//   IN_PRODUCTION doğan topta NULL ya da doğumdan sonradır. Dökümde her satıra basılır.
//   Ölçüm (fabrikanın canlı yedeğinde, 2026-09-12): 69 aday, 12'si TST- test artığı → gerçek 57 / 32.044 m.
//
// TERS KAYIT BİÇİMİ: tek yazma kapısından (`postStockMove`) — `reverseStockMove`
//   kullanılmaz çünkü tarihsel satırlarda fromStatus/toStatus NULL'dur ve o helper
//   ucu statüsüz satırı reddeder. Ters satır: from = {ENTRY'nin toWarehouseId'si,
//   WAREHOUSE} (ENTRY'nin "depoya girdi" beyanının aynası), to = yok, qty İLERİ
//   SATIRDAN kopyalanır (canlı currentQty DEĞİL — §D2a), eventType ENTRY kopyalanır
//   (ters kayıt tespiti enum değil `reversesMovementId`), reasonCode FASON_RECEIPT.
//   Aynı satır iki kez terslenemez: DB unique (reversesMovementId).
//
// GÜVENLİK: dry-run varsayılan · `--apply` iki kapı ister: `--onay=<N>` (N = kuru koşumdaki
//   TERSLENECEK sayısı, birebir) ve `--hedef=<db-adı>` (DATABASE_URL'den çözülen ad ile
//   birebir; başlık her koşumda DB adı + host basar) — biri tutmazsa geri alınamaz yazma YOK ·
//   tek transaction, hep-ya-hiç, `timeout: 120_000` (57 satır tek tek gidiş-dönüş; varsayılan
//   etkileşimli bütçe yüklü makinede P2028 verirdi) · audit tx DIŞINDA (best-effort).
//   İdempotent: ikinci koşum 0 aday görür. `--apply` KULLANICI KARARIDIR — onaysız koşulmaz.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma, RollEntrySource, RollStatus, WarehouseEventType } from "@prisma/client";
import { postStockMove } from "../src/services/helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { AuditService } from "../src/services/audit.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);
const HEDEF = (argv.find((a) => a.startsWith("--hedef=")) ?? "").split("=")[1] ?? "";
const ON_EK = "Fason dönüşü (";
const TEST_DAMGALARI = ["TEST-", "TST-"];

/** Tek kaynak — kuru koşum ve uygulama AYNI kümeyi görür. İki sinyal: ön ek ∧ entrySource. */
const ADAY_WHERE: Prisma.WarehouseMovementWhereInput = {
  eventType: WarehouseEventType.ENTRY,
  notes: { startsWith: ON_EK },
  reversesMovementId: null,
  reversedBy: { none: {} },
  roll: { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
};

type Aday = {
  id: string;
  qty: Prisma.Decimal;
  toWarehouseId: string | null;
  notes: string | null;
  createdAt: Date;
  roll: {
    id: string;
    barcode: string | null;
    status: RollStatus;
    createdAt: Date;
    finalizedAt: Date | null;
    producedInStep: {
      stepSequence: number;
      workOrder: { workOrderNumber: string; steps: { stepSequence: number; createdAt: Date }[] } | null;
    } | null;
  };
};
type Kova = "TERS" | "DOGRU_GIRIS" | "KANIT_YOK" | "TEST" | "SIFIR";

function fmt(d: Prisma.Decimal | number): string {
  return new Prisma.Decimal(d).toFixed(3);
}
function dbHost(): string {
  try { const u = new URL(process.env.DATABASE_URL ?? ""); return `${u.hostname}:${u.port || "5432"}`; } catch { return "(okunamadı)"; }
}
function testArtigi(a: Aday): boolean {
  const wo = a.roll.producedInStep?.workOrder?.workOrderNumber ?? "";
  return TEST_DAMGALARI.some((p) => wo.startsWith(p) || (a.roll.barcode ?? "").startsWith(p));
}
/**
 * Rota sonradan değişmiş mi: iş emrine topun DOĞUMUNDAN SONRA adım eklendiyse
 * (`workorder.service.ts replace()` yolu VAR) bugünkü adım kümesi doğum anını
 * anlatmaz — kanıt yoktur, satır terslenmez (fail-safe). Silinen adım görülemez;
 * o yön de fail-safe'tir (top "son adım" görünür → DOĞRU GİRİŞ, dokunulmaz).
 */
function adimSonradanEklendi(a: Aday): boolean {
  const steps = a.roll.producedInStep?.workOrder?.steps ?? [];
  return steps.some((x) => x.createdAt.getTime() > a.roll.createdAt.getTime());
}
/** Doğuş kanıtı: DOĞUM ANINDAKİ adım kümesinde fason adımından SONRA adım var mı (kodun bornStatus kuralı). */
function sonrakiAdimVar(a: Aday): boolean | null {
  const s = a.roll.producedInStep;
  if (!s || !s.workOrder) return null;
  if (adimSonradanEklendi(a)) return null;
  const son = Math.max(...s.workOrder.steps.map((x) => x.stepSequence));
  return s.stepSequence < son;
}
function sinifla(a: Aday): Kova {
  if (testArtigi(a)) return "TEST";
  if (!new Prisma.Decimal(a.qty).greaterThan(0)) return "SIFIR";
  const k = sonrakiAdimVar(a);
  if (k === null) return "KANIT_YOK";
  return k ? "TERS" : "DOGRU_GIRIS";
}
function kanit2(a: Aday): string {
  const f = a.roll.finalizedAt;
  if (!f) return "finalizedAt=NULL (üretimde doğdu)";
  return f.getTime() > a.roll.createdAt.getTime() + 60_000 ? "finalizedAt doğumdan SONRA (üretimde doğdu)" : "finalizedAt≈doğum (DEPOYA doğmuş olabilir!)";
}

async function main(): Promise<void> {
  const db = hedefDbAdi();
  console.log(`=== Fason dönüşü ENTRY onarımı — ${APPLY ? `UYGULAMA (onay=${ONAY}, hedef=${HEDEF})` : "KURU KOŞUM (hiçbir şey yazılmaz)"} ===`);
  console.log(`HEDEF VERİTABANI: ${db} @ ${dbHost()}\n`);

  const adaylar = (await prisma.warehouseMovement.findMany({
    where: ADAY_WHERE,
    orderBy: { createdAt: "asc" },
    select: {
      id: true, qty: true, toWarehouseId: true, notes: true, createdAt: true,
      roll: {
        select: {
          id: true, barcode: true, status: true, createdAt: true, finalizedAt: true,
          producedInStep: {
            select: {
              stepSequence: true,
              workOrder: { select: { workOrderNumber: true, steps: { select: { stepSequence: true, createdAt: true } } } },
            },
          },
        },
      },
    },
  })) as Aday[];
  // Sigorta 6: ön eki taşıyıp kapsam dışı kalan satırlar (başka yazıcı / başka doğum kaynağı).
  const kapsamDisi = await prisma.warehouseMovement.count({
    where: { eventType: WarehouseEventType.ENTRY, notes: { startsWith: ON_EK }, roll: { entrySource: { not: RollEntrySource.SUBCONTRACTOR_RETURN } } },
  });

  const kova = (k: Kova) => adaylar.filter((a) => sinifla(a) === k);
  const ters = kova("TERS"), dogru = kova("DOGRU_GIRIS"), kanitYok = kova("KANIT_YOK"), test = kova("TEST"), sifir = kova("SIFIR");
  const toplamM = ters.reduce((s, a) => s.plus(a.qty), new Prisma.Decimal(0));

  const gercek = adaylar.filter((a) => !testArtigi(a));
  const rotaDegismemis = gercek.filter((a) => !adimSonradanEklendi(a)).length;
  console.log(
    `Aday: ${adaylar.length} · TERSLENECEK: ${ters.length} (${fmt(toplamM)} m) · DOĞRU GİRİŞ: ${dogru.length} · ` +
      `KANIT YOK: ${kanitYok.length} · TEST ARTIĞI: ${test.length} · ATLANAN 0 m: ${sifir.length} · ön ekli KAPSAM DIŞI: ${kapsamDisi}`,
  );
  console.log(`Adım kümesi topun doğumundan beri değişmemiş: ${rotaDegismemis}/${gercek.length} (sonradan adım eklenen iş emri → KANIT YOK, terslenmez)\n`);
  // Yıkıcı işlem kuralı: etkilenen HER kayıt listelenir; doğuş kanıtı her satırda.
  console.log("hareketId                             | tarih      | top             | iş emri        | makbuz         | metre     | bugün         | kova        | doğuş kanıtı");
  for (const a of adaylar) {
    const k = sinifla(a);
    const makbuz = (a.notes ?? "").replace(/^Fason dönüşü \(/, "").replace(/\)$/, "");
    const k1 = sonrakiAdimVar(a);
    const kanit = k1 === null ? "producedInStep YOK" : k1 ? `sonraki adım VAR (seq ${a.roll.producedInStep?.stepSequence})` : "fason SON adım (WAREHOUSE doğdu)";
    console.log(
      `${a.id} | ${a.createdAt.toISOString().slice(0, 10)} | ${(a.roll.barcode ?? a.roll.id).padEnd(15)} | ` +
        `${(a.roll.producedInStep?.workOrder?.workOrderNumber ?? "-").padEnd(14)} | ${makbuz.padEnd(14)} | ${fmt(a.qty).padStart(9)} | ` +
        `${a.roll.status.padEnd(13)} | ${k.padEnd(11)} | ${kanit}; ${kanit2(a)}`,
    );
  }

  const bozuk = ters.filter((a) => !a.toWarehouseId);
  if (bozuk.length > 0) {
    console.log(`\n❌ ${bozuk.length} ENTRY satırında toWarehouseId YOK — ters ucu kurulamaz, elle inceleme gerekir.`);
    process.exitCode = 1;
    return;
  }
  if (!APPLY) {
    console.log(
      `\nKURU KOŞUM bitti. Uygulamak için (kullanıcı onayıyla, HEDEF adı birebir):\n` +
        `  npx tsx scripts/onarim_fason_donus_entry.ts --apply --onay=${ters.length} --hedef=${db}\n` +
        `DOĞRU GİRİŞ (${dogru.length}) · KANIT YOK (${kanitYok.length}) · TEST ARTIĞI (${test.length}) · 0 m (${sifir.length}) satırları HİÇBİR ZAMAN terslenmez.`,
    );
    return;
  }
  if (!HEDEF || HEDEF !== db) { console.error(`❌ --hedef=${HEDEF || "(yok)"} ≠ çözülen veritabanı "${db}". Yazma YOK.`); process.exitCode = 1; return; }
  if (!Number.isFinite(ONAY) || ONAY !== ters.length) { console.error(`❌ ONAY UYUŞMUYOR: kuru koşum ${ters.length}, --onay=${ONAY}. Yazma YOK.`); process.exitCode = 1; return; }
  if (ters.length === 0) { console.log("\nYapılacak iş yok."); return; }

  const yazilan = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const a of ters) {
      ids.push(await postStockMove(tx, {
        rollId: a.roll.id,
        eventType: WarehouseEventType.ENTRY,
        qty: a.qty,
        from: { warehouseId: a.toWarehouseId as string, status: RollStatus.WAREHOUSE },
        reasonCode: STOCK_MOVE_REASON.FASON_RECEIPT,
        reversesMovementId: a.id,
        userId: null,
        notes: `ONARIM: fason dönüşü girişinin tersi — mal depoya girmemişti (${a.notes ?? ""})`,
      }));
    }
    return ids;
  }, { timeout: 120_000 });

  console.log(`\n✅ ${yazilan.length} ters kayıt yazıldı (${fmt(toplamM)} m) — hedef ${db}. Dokunulmayan: DOĞRU GİRİŞ ${dogru.length} · KANIT YOK ${kanitYok.length} · TEST ${test.length} · 0 m ${sifir.length}.`);

  // Audit tx DIŞINDA, best-effort (fix_fire_rolls_to_scrap emsali); yük sır taşımaz.
  try {
    await AuditService.logMany(
      yazilan.map((id, i) => ({
        userId: undefined,
        action: "CREATE" as const,
        tableName: "WAREHOUSE_MOVEMENT",
        recordId: id,
        newData: { source: "onarim_fason_donus_entry", event: "FASON_ENTRY_REVERSAL", reversesMovementId: ters[i]?.id, rollId: ters[i]?.roll.id, qty: fmt(ters[i]?.qty ?? 0), db },
      })),
    );
  } catch (e) {
    console.warn("audit yazılamadı (best-effort):", (e as Error).message);
  }
}

main()
  .catch((e) => { console.error("Beklenmeyen hata:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
