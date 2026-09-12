// =============================================================================
// BEKÇİ — BİRLEŞTİRMEYİ GERİ ALMA (unmerge, defter ④)
// Çalıştır: npx tsx scripts/run-all-tests.ts master_data_merge_revert
// =============================================================================
// NEDEN: birleştirme "EN YIKICI ve geri alınamaz" diye yazılıydı; geri
// alınamazlığın sebebi karar değil EKSİK DEFTERdi (taşınan satırın kimliği
// hiçbir yerde durmuyordu). Defter geldiğine göre ölçülmesi gereken üç şey var:
// defter GERÇEKTEN yazılıyor mu, geri alma onu doğru okuyor mu, ve geri alınamaz
// durumlar SESSİZ kalmıyor mu.
//
// ÖLÇÜLENLER
//   §1 Defter yazılıyor: operasyon + kaynak künyesi (tombstone ÖNCESİ ad/aktiflik)
//      + referans kalemleri (MOVED satır id'leriyle)
//   §2 ⭐ Geri alma: referanslar KAYNAĞINA döner, tombstone kalkar, ad/aktiflik
//      defterden yazılır, operasyon satırı DEĞİŞMEZ + `revertedAt` damgası
//   §3 İkinci geri alma 409 (atomik claim)
//   §4 ⭐ LIFO: aynı kayıtlar yeniden birleştirildiyse eski operasyon 409 ve
//      damga geri sarılır; yeni olan geri alınınca eski de geri alınabilir
//   §5 ⭐ AD ÇAKIŞMASI: tombstone kalkınca `nameFold` seddi ihlal olacaksa 409
//      `UNMERGE_NEEDS_RENAME` ve önizleme hangi kaynağın ad istediğini söyler;
//      yeni adla geri alma GEÇER
//   §6 Referansı olmayan birleştirme de geri alınır (yalnız tombstone kalkar —
//      "kalemsiz" ile "defter öncesi" AYNI ŞEY DEĞİL); mükerrer kuyruğu
//      MERGED → DEFERRED'e döner
//   §7 ⭐ KİLİT SIRASI (ES değişmezi): `MERGE_MAP`te `swatch_stock_reductions`
//      kuralı `swatches` kuralından ÖNCE gelir — kartela storno yolu da aynı
//      sırada ilerliyor; ters sıra 40P01 üretirdi
// =============================================================================
import { CompanyType, MergeRefKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { MERGE_MAP } from "../src/constants/merge-map";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { MasterDataUnmergeService } from "../src/services/master-data-unmerge.service";
import { AppError } from "../src/utils/app-error";
import { ensureTestAdmin } from "./fixture-test-user";

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

const TAG = `TEST-UNMRG-${Date.now().toString().slice(-8)}`;
const customerIds: string[] = [];
const orderIds: string[] = [];
let ADMIN = "";

function errOf(e: unknown): { status?: number; code?: string; message: string } {
  if (e instanceof AppError) {
    return { status: e.statusCode, code: (e.details as { code?: string } | undefined)?.code, message: e.message };
  }
  return { message: (e as Error).message };
}
async function expectErr(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    return errOf(e);
  }
}

async function makeCustomer(suffix: string, name: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`, name, type: CompanyType.CUSTOMER },
    select: { id: true },
  });
  customerIds.push(c.id);
  return c.id;
}

async function makeOrder(customerId: string, suffix: string): Promise<string> {
  const o = await prisma.order.create({
    data: { orderNumber: `${TAG}-SIP-${suffix}`, customerId, status: "APPROVED" },
    select: { id: true },
  });
  orderIds.push(o.id);
  return o.id;
}

async function mergeOnce(
  survivorId: string,
  sourceIds: string[],
  reason: string,
  fieldPicks?: Record<string, string>,
): Promise<void> {
  await MasterDataMergeService.merge("customer", {
    survivorId,
    sourceIds,
    reason,
    acknowledgedConflicts: 0,
    fieldPicks,
    userId: ADMIN,
  });
}

async function latestOperation(survivorId: string): Promise<string> {
  const op = await prisma.mergeOperation.findFirstOrThrow({
    where: { survivorId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return op.id;
}

async function main(): Promise<void> {
  console.log("\n=== Birleştirmeyi geri alma ===\n");
  ADMIN = (await ensureTestAdmin()).id;

  // §1 — defter yazılıyor
  const survivor = await makeCustomer("HEDEF", `${TAG} Hedef Müşteri`);
  const source = await makeCustomer("KAYNAK", `${TAG} Kaynak Müşteri`);
  const orderId = await makeOrder(source, "1");
  await mergeOnce(survivor, [source], "iki kayıt aynı müşteri, birleştiriliyor");
  const opId = await latestOperation(survivor);
  const op = await prisma.mergeOperation.findUniqueOrThrow({
    where: { id: opId },
    include: { sources: true, refs: true },
  });
  const movedRef = op.refs.find((r) => r.tableName === "orders" && r.kind === MergeRefKind.MOVED);
  check("§1a Operasyon satırı yazıldı (varlık + hedef + gerekçe + aktör)", op.entity === "customer" && op.survivorId === survivor && op.createdById === ADMIN);
  check(
    "§1b Kaynak künyesi tombstone ÖNCESİ hâli taşıyor (ad + aktiflik)",
    op.sources.length === 1 && op.sources[0]!.nameBefore === `${TAG} Kaynak Müşteri` && op.sources[0]!.isActiveBefore === true,
  );
  check("§1c Taşınan sipariş satırının KİMLİĞİ defterde", Boolean(movedRef) && movedRef!.rowIds.includes(orderId), JSON.stringify(movedRef?.rowIds));
  const movedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true } });
  check("§1d Sipariş gerçekten hedefe taşındı", movedOrder.customerId === survivor);

  // §2 — geri alma
  const res = await MasterDataUnmergeService.revert(opId, { reason: "yanlış birleştirme, geri alınıyor", userId: ADMIN });
  const afterOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true } });
  const afterSource = await prisma.customer.findUniqueOrThrow({
    where: { id: source },
    select: { mergedIntoId: true, mergedAt: true, isActive: true, name: true },
  });
  const afterOp = await prisma.mergeOperation.findUniqueOrThrow({ where: { id: opId }, include: { refs: true } });
  check("§2a ⭐ Sipariş KAYNAĞINA döndü", afterOrder.customerId === source);
  check(
    "§2b ⭐ Tombstone kalktı; ad ve aktiflik defterden yazıldı",
    afterSource.mergedIntoId === null && afterSource.mergedAt === null && afterSource.isActive === true && afterSource.name === `${TAG} Kaynak Müşteri`,
  );
  check("§2c Operasyon satırı DEĞİŞMEDİ + ters damga (tarih + aktör + gerekçe)", afterOp.revertedAt != null && afterOp.revertedById === ADMIN && afterOp.revertReason === "yanlış birleştirme, geri alınıyor" && afterOp.refs.length === op.refs.length);
  check("§2d Yanıt geri yazılan satırı sayıyor, atlananı ayrı tutuyor", res.repointedRows >= 1 && res.skippedRows === 0, JSON.stringify(res));

  // §3 — ikinci geri alma
  const second = await expectErr(() => MasterDataUnmergeService.revert(opId, { reason: "ikinci kez denenen geri alma", userId: ADMIN }));
  check("§3 İkinci geri alma 409", second?.status === 409, JSON.stringify(second));

  // §4 — LIFO: op2 kaynağı yeniden birleştirir, op3 AYNI HEDEFE İKİNCİ bir kaynak
  // katar (aynı kaydı ilgilendiren DAHA SONRAKİ operasyon). Aynı kaynağı iki kez
  // birleştirmek mümkün değil — tombstone guard'ı reddeder (doğru davranış).
  await mergeOnce(survivor, [source], "aynı kayıtlar yeniden birleştiriliyor (LIFO sondası)");
  const op2 = await latestOperation(survivor);
  const source2 = await makeCustomer("KAYNAK2", `${TAG} İkinci Kaynak`);
  await makeOrder(source2, "2");
  await mergeOnce(survivor, [source2], "LIFO: en yenisi önce geri alınmalı");
  const op3 = await latestOperation(survivor);
  const lifo = await expectErr(() => MasterDataUnmergeService.revert(op2, { reason: "eski operasyon geri alınmaya çalışılıyor", userId: ADMIN }));
  const op2Fresh = await prisma.mergeOperation.findUniqueOrThrow({ where: { id: op2 }, select: { revertedAt: true } });
  check("§4a ⭐ Sonraki birleştirme varken eskisi 409 UNMERGE_BLOCKED", lifo?.status === 409 && lifo.code === "UNMERGE_BLOCKED", JSON.stringify(lifo));
  check("§4b Damga geri sarıldı", op2Fresh.revertedAt === null);
  await MasterDataUnmergeService.revert(op3, { reason: "en yeni operasyon geri alınıyor (LIFO)", userId: ADMIN });
  await MasterDataUnmergeService.revert(op2, { reason: "sonra eski operasyon geri alınıyor", userId: ADMIN });
  const sourceAfterLifo = await prisma.customer.findUniqueOrThrow({ where: { id: source }, select: { mergedIntoId: true } });
  const source2AfterLifo = await prisma.customer.findUniqueOrThrow({ where: { id: source2 }, select: { mergedIntoId: true } });
  check(
    "§4c LIFO sırasıyla ikisi de geri alındı (iki kaynağın tombstone'u kalktı)",
    sourceAfterLifo.mergedIntoId === null && source2AfterLifo.mergedIntoId === null,
  );

  // §5 — ad çakışması. İKİ CANLI KAYIT AYNI ADI TAŞIYAMAZ (`customers_nameFold_key`
  // partial unique, 2026-08-21) — gerçek çakışma şöyle doğar: birleştirmede
  // survivor KAYNAĞIN ADINI alır (`fieldPicks.name`), kaynak tombstone olduğu için
  // sed onu dışlar; geri alma tombstone'u dirilttiği an ad survivor'la çakışır.
  const twinA = await makeCustomer("TWIN-A", `${TAG} İkiz A`);
  const twinB = await makeCustomer("TWIN-B", `${TAG} İkiz B`);
  await mergeOnce(twinA, [twinB], "ad kaynaktan alınarak birleştiriliyor (ad sondası)", { name: twinB });
  const twinOp = await latestOperation(twinA);
  const plan = await MasterDataUnmergeService.preview(twinOp);
  const needs = plan.sources.filter((s) => s.needsRename);
  check("§5a ⭐ Önizleme ad çakışmasını ve çakıştığı kaydı söylüyor", needs.length === 1 && needs[0]!.collidesWith === `${TAG} İkiz B`, JSON.stringify(needs));
  const noRename = await expectErr(() => MasterDataUnmergeService.revert(twinOp, { reason: "adsız geri alma denemesi", userId: ADMIN }));
  check("§5b Adsız geri alma 409 UNMERGE_NEEDS_RENAME", noRename?.status === 409 && noRename.code === "UNMERGE_NEEDS_RENAME", JSON.stringify(noRename));
  await MasterDataUnmergeService.revert(twinOp, {
    reason: "yeni adla geri alınıyor (çakışma çözüldü)",
    renames: { [twinB]: `${TAG} İkiz B2` },
    userId: ADMIN,
  });
  const twinBFresh = await prisma.customer.findUniqueOrThrow({ where: { id: twinB }, select: { mergedIntoId: true, name: true } });
  check("§5c ⭐ Yeni adla geri alma geçti ve ad defterden DEĞİL istekten yazıldı", twinBFresh.mergedIntoId === null && twinBFresh.name === `${TAG} İkiz B2`);

  // §6 — REFERANSSIZ birleştirme: hiçbir satır taşınmaz, defter boş kalır ve geri
  // alma yalnız tombstone'u kaldırır. (Bu kümeyi "defter öncesi" ile karıştırmak
  // meşru birleştirmeleri geri alınamaz yapıyordu — ölçüldü ve düzeltildi.)
  const bareSurvivor = await makeCustomer("YALIN-H", `${TAG} Yalın Hedef`);
  const bareSource = await makeCustomer("YALIN-K", `${TAG} Yalın Kaynak`);
  await mergeOnce(bareSurvivor, [bareSource], "referansı olmayan iki kayıt birleştiriliyor");
  const bareOp = await latestOperation(bareSurvivor);
  const bareRefs = await prisma.mergeOperationRef.count({ where: { operationId: bareOp } });
  const bareRes = await MasterDataUnmergeService.revert(bareOp, { reason: "referanssız birleştirme geri alınıyor", userId: ADMIN });
  const bareFresh = await prisma.customer.findUniqueOrThrow({ where: { id: bareSource }, select: { mergedIntoId: true, isActive: true } });
  check("§6a Körlük zemini: referanssız birleştirmede defter kalemi YOK", bareRefs === 0, String(bareRefs));
  check(
    "§6a2 ⭐ Kalemsiz birleştirme GERİ ALINIR (yalnız tombstone kalkar)",
    bareFresh.mergedIntoId === null && bareFresh.isActive === true && bareRes.repointedRows === 0 && bareRes.skippedRows === 0,
    JSON.stringify(bareRes),
  );
  const review = await prisma.duplicateReview.findFirst({
    where: { entity: "CUSTOMER", aId: { in: [survivor, source] }, bId: { in: [survivor, source] } },
    select: { decision: true },
  });
  check("§6b Mükerrer kuyruğu MERGED → DEFERRED'e döndü", review?.decision === "DEFERRED", String(review?.decision));

  // §7 — kilit sırası değişmezi
  for (const entity of ["item", "color"] as const) {
    const tables = MERGE_MAP[entity].map((r) => r.table);
    const red = tables.indexOf("swatch_stock_reductions");
    const swa = tables.indexOf("swatches");
    check(
      `§7 ⭐ ${entity}: kilit sırası değişmezi — düşüm defteri kartelalardan ÖNCE (ES kuralı)`,
      red >= 0 && swa >= 0 && red < swa,
      `düşüm=${red} kartela=${swa}`,
    );
  }
}

async function cleanup(): Promise<void> {
  try {
    if (customerIds.length) {
      const ops = await prisma.mergeOperation.findMany({
        where: { OR: [{ survivorId: { in: customerIds } }, { sources: { some: { sourceId: { in: customerIds } } } }] },
        select: { id: true },
      });
      const opIds = ops.map((o) => o.id);
      if (opIds.length) {
        await prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } });
      }
      await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: customerIds } }, { bId: { in: customerIds } }] } });
    }
    if (orderIds.length) {
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (customerIds.length) {
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
  } catch (e) {
    console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
