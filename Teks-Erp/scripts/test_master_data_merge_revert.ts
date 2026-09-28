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
//   §8 ⭐ YENİ TABLO (customer_item_color_aliases, SKIP): çok kaynaklı birleştirme
//      (survivor çakışması + kaynaklar arası çakışma + taşınan satır) geri alınınca
//      her satır kendi kaynağına BİREBİR döner — üretilmiş kolon olmadığı için
//      jenerik fotoğraflı geri yazım yeter (MUSTERI-KUMAS-RENK-ADI §4 "Geri alma").
//   §9–§11 ⭐ ÜRETİLMİŞ KOLONLU TABLO: müşteri adı tabloları (`aliasFold`
//      GENERATED ALWAYS … STORED) SKIP ile SİLİNEN ve MERGE_FIELDS ile
//      ZENGİNLEŞEN satırı fotoğraftan geri yazar — müşteri, ürün, renk
//      birleştirmesinin üçünde de (PG üretilmiş kolona değer yazılmasını reddeder)
//   §12 ⭐ İKİ KAYNAK AYNI ANAHTARDA: ikinci kaynağın satırı ilkinin TAŞINMIŞ
//      satırıyla çakışır (silinir/zenginleştirir); hedefin satırı iki kez
//      zenginleşir. Geri alma, kalemlerin okunma sırasından bağımsız olarak
//      üç kaydı da birleştirme öncesi hâline döndürür
// =============================================================================
import { CompanyType, MergeRefKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { MERGE_MAP } from "../src/constants/merge-map";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { MasterDataUnmergeService } from "../src/services/master-data-unmerge.service";
import { AppError } from "../src/utils/app-error";
import { newPkCache, restoreSnapshotRowsTx } from "../src/services/helpers/merge-ledger.helper";
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
const itemIds: string[] = [];
const colorIds: string[] = [];
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

async function makeItem(suffix: string): Promise<string> {
  const i = await prisma.item.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} Kumaş ${suffix}`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemIds.push(i.id);
  return i.id;
}

async function makeColor(suffix: string): Promise<string> {
  const c = await prisma.color.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} Renk ${suffix}` },
    select: { id: true },
  });
  colorIds.push(c.id);
  return c.id;
}

async function mergeEntity(
  entity: "customer" | "item" | "color",
  survivorId: string,
  sourceIds: string[],
  acknowledgedConflicts: number,
  reason: string,
): Promise<string> {
  await MasterDataMergeService.merge(entity, { survivorId, sourceIds, reason, acknowledgedConflicts, userId: ADMIN });
  return latestOperation(survivorId);
}

/** Geri almayı dener; hata metnini döner (kırmızı sondada PG mesajı görünsün). */
async function tryRevert(opId: string, reason: string): Promise<string | null> {
  try {
    await MasterDataUnmergeService.revert(opId, { reason, userId: ADMIN });
    return null;
  } catch (e) {
    return (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

async function itemAliasRow(customerId: string, itemId: string) {
  return prisma.customerItemAlias.findUnique({
    where: { customerId_itemId: { customerId, itemId } },
    select: { alias: true, aliasFold: true },
  });
}

async function colorAliasRow(customerId: string, colorId: string) {
  return prisma.customerColorAlias.findUnique({
    where: { customerId_colorId: { customerId, colorId } },
    select: { alias: true, assigned: true, aliasFold: true },
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

  console.log("\n§8 Kumaşa özel renk adı: çok kaynaklı birleştir → geri al");
  await kumasaOzelRenkAdiGeriAlma();
  await aliasRevertCases();

  console.log("\n§13 Kardeş alias tabloları (GENERATED aliasFold): birleştir → geri al");
  await kardesAliasGeriAlma();
}

/**
 * §13 — D6 (MUSTERI-KUMAS-RENK-ADI §11 karar 7): kardeş iki alias tablosunun `aliasFold`u
 * GENERATED; fotoğraftan geri yazım (`INSERT … SELECT *` / `SET "aliasFold"`) PG'de
 * reddedilmemeli. SKIP (customer_item_aliases) silinen satırı, MERGE_FIELDS
 * (customer_color_aliases) iki kez zenginleşen survivor satırını (K: üç tarafta) ve
 * kaynaklar arası aynı rengi (K2: iki kaynakta, hedefte yok) birlikte ölçer.
 */
async function kardesAliasGeriAlma(): Promise<void> {
  const X = (await prisma.item.create({ data: { code: `${TAG}-AX`, name: `${TAG} KARDES X`, itemType: "FABRIC" }, select: { id: true } })).id;
  const Y = (await prisma.item.create({ data: { code: `${TAG}-AY`, name: `${TAG} KARDES Y`, itemType: "FABRIC" }, select: { id: true } })).id;
  const K = (await prisma.color.create({ data: { code: `${TAG}-AK`, name: `${TAG} KARDES EKRU` }, select: { id: true } })).id;
  const K2 = (await prisma.color.create({ data: { code: `${TAG}-AK2`, name: `${TAG} KARDES BEJ` }, select: { id: true } })).id;
  itemIds.push(X, Y);
  colorIds.push(K, K2);
  const s = await makeCustomer("KA-H", `${TAG} KA Hedef`);
  const k1 = await makeCustomer("KA-K1", `${TAG} KA Kaynak 1`);
  const k2 = await makeCustomer("KA-K2", `${TAG} KA Kaynak 2`);
  for (const [c, i, alias] of [[s, X, "S-X"], [k1, X, "K1-X"], [k1, Y, "K1-Y"], [k2, Y, "K2-Y"]] as const) {
    await prisma.customerItemAlias.create({ data: { customerId: c, itemId: i, alias } });
  }
  const renkler: Array<[string, string, string | null, boolean]> = [
    [s, K, "S-K", false],
    [k1, K, "K1-K", true],
    [k1, K2, null, true],
    [k2, K, "K2-K", true],
    [k2, K2, "K2-K2", false],
  ];
  for (const [c, colorId, alias, assigned] of renkler) {
    await prisma.customerColorAlias.create({ data: { customerId: c, colorId, alias, assigned } });
  }
  const who = [s, k1, k2];
  const fotograf = async (): Promise<string> => {
    const ia = await prisma.customerItemAlias.findMany({ where: { customerId: { in: who } }, orderBy: { id: "asc" } });
    const ca = await prisma.customerColorAlias.findMany({ where: { customerId: { in: who } }, orderBy: { id: "asc" } });
    return [
      ...ia.map((r) => `IA ${r.id}|${r.customerId}|${r.itemId}|${r.alias}|${r.createdAt.toISOString()}`),
      ...ca.map((r) => `CA ${r.id}|${r.customerId}|${r.colorId}|${r.alias}|${r.assigned}|${r.createdAt.toISOString()}`),
    ].join("\n");
  };
  const once = await fotograf();
  const pv = await MasterDataMergeService.preview("customer", s, [k1, k2]);
  const merged = await expectErr(() =>
    MasterDataMergeService.merge("customer", { survivorId: s, sourceIds: [k1, k2], reason: "kardes alias geri alma sondasi", acknowledgedConflicts: pv.conflicts.length, userId: ADMIN }),
  );
  check("§13a birleştirme geçti (iki kaynakta aynı renk P2002 vermez)", merged === null, JSON.stringify(merged));
  if (merged !== null) return;
  const ca = await prisma.customerColorAlias.findMany({ where: { customerId: s }, include: { color: { select: { code: true } } }, orderBy: { color: { code: "asc" } } });
  check(
    "§13b MERGE_FIELDS: hedefte K (ad korunur, atama OR) + K2 (K1'in ataması + K2'nin adı)",
    ca.map((r) => `${r.alias}:${r.assigned}`).join(",") === "S-K:true,K2-K2:true",
    ca.map((r) => `${r.alias}:${r.assigned}`).join(","),
  );
  const opId = await latestOperation(s);
  const geri = await expectErr(() => MasterDataUnmergeService.revert(opId, { reason: "kardes alias geri alma sondasi", userId: ADMIN }));
  check("§13c ⭐ geri alma PG'de reddedilmedi (GENERATED aliasFold fotoğraftan yazılmaz)", geri === null, JSON.stringify(geri));
  const sonra = await fotograf();
  check("§13d ⭐ geri alma: dokuz satır kendi kaynağına BİREBİR döndü (id + anahtar + ad + atama + tarih)", once === sonra, once === sonra ? "" : `\nönce:\n${once}\nsonra:\n${sonra}`);
}

/** §8 — kumaşa özel renk adı: çok kaynaklı birleştir → geri al, her satır kendi kaynağına. */
async function kumasaOzelRenkAdiGeriAlma(): Promise<void> {
  const X = (await prisma.item.create({ data: { code: `${TAG}-IX`, name: `${TAG} KUMAS X`, itemType: "FABRIC" }, select: { id: true } })).id;
  const Y = (await prisma.item.create({ data: { code: `${TAG}-IY`, name: `${TAG} KUMAS Y`, itemType: "FABRIC" }, select: { id: true } })).id;
  const K = (await prisma.color.create({ data: { code: `${TAG}-K`, name: `${TAG} EKRU` }, select: { id: true } })).id;
  itemIds.push(X, Y);
  colorIds.push(K);
  const s = await makeCustomer("ICA-H", `${TAG} ICA Hedef`);
  const k1 = await makeCustomer("ICA-K1", `${TAG} ICA Kaynak 1`);
  const k2 = await makeCustomer("ICA-K2", `${TAG} ICA Kaynak 2`);
  const satirlar: Array<[string, string, string]> = [[s, X, "S-X"], [k1, X, "K1-X"], [k1, Y, "K1-Y"], [k2, Y, "K2-Y"]];
  for (const [c, i, alias] of satirlar) await prisma.customerItemColorAlias.create({ data: { customerId: c, itemId: i, colorId: K, alias } });
  const once = await prisma.customerItemColorAlias.findMany({ where: { customerId: { in: [s, k1, k2] } }, orderBy: { alias: "asc" } });
  const pv = await MasterDataMergeService.preview("customer", s, [k1, k2]);
  await MasterDataMergeService.merge("customer", { survivorId: s, sourceIds: [k1, k2], reason: "kumasa ozel ad geri alma sondasi", acknowledgedConflicts: pv.conflicts.length, userId: ADMIN });
  const ara = await prisma.customerItemColorAlias.findMany({ where: { customerId: s }, select: { alias: true }, orderBy: { alias: "asc" } });
  check("§8a birleştirme: survivor'da S-X (korundu) + K1-Y (taşındı), K2-Y atıldı", ara.map((r) => r.alias).join(",") === "K1-Y,S-X", ara.map((r) => r.alias).join(","));
  await MasterDataUnmergeService.revert(await latestOperation(s), { reason: "kumasa ozel ad geri alma sondasi", userId: ADMIN });
  const sonra = await prisma.customerItemColorAlias.findMany({ where: { customerId: { in: [s, k1, k2] } }, orderBy: { alias: "asc" } });
  const iz = (rs: typeof once) => rs.map((r) => `${r.id}|${r.customerId}|${r.itemId}|${r.alias}|${r.createdAt.toISOString()}`).join("\n");
  check("§8b ⭐ geri alma: dört satır kendi kaynağına BİREBİR döndü (id + anahtar + ad + tarih)", iz(once) === iz(sonra), `${once.length} → ${sonra.length}`);
}

/**
 * §9–§11 — müşteri adı tabloları (`aliasFold` üretilmiş kolon). Kaynak ve hedefte
 * aynı anahtar varsa SKIP (ürün adı) kaynağınkini SİLER, MERGE_FIELDS (renk adı)
 * hedefinkini ZENGİNLEŞTİRİP kaynağınkini siler; geri alma ikisini de fotoğraftan yazar.
 */
async function aliasRevertCases(): Promise<void> {
  // §9 — MÜŞTERİ birleştirmesi: iki alias tablosu, çakışan + çakışmayan satır
  const custS = await makeCustomer("AL-H", `${TAG} Adlı Hedef`);
  const custK = await makeCustomer("AL-K", `${TAG} Adlı Kaynak`);
  const i1 = await makeItem("AL-I1");
  const i2 = await makeItem("AL-I2");
  const c1 = await makeColor("AL-C1");
  const c2 = await makeColor("AL-C2");
  await prisma.customerItemAlias.createMany({
    data: [
      { customerId: custS, itemId: i1, alias: "HEDEF KUMAŞ ADI" },
      { customerId: custK, itemId: i1, alias: "Kaynak Şile" },
      { customerId: custK, itemId: i2, alias: "Kaynak Çözgü" },
    ],
  });
  await prisma.customerColorAlias.createMany({
    data: [
      { customerId: custS, colorId: c1, assigned: false, alias: null },
      { customerId: custK, colorId: c1, assigned: true, alias: "Kaynak Işık" },
      { customerId: custK, colorId: c2, assigned: true, alias: "Kaynak Gök" },
    ],
  });
  const foldBefore = (await itemAliasRow(custK, i1))?.aliasFold ?? null;
  const custOp = await mergeEntity("customer", custS, [custK], 2, "müşteri adlı iki kayıt birleştiriliyor (alias sondası)");
  const merged = await colorAliasRow(custS, c1);
  check(
    "§9a Zemin: birleştirme SKIP silmesi + MERGE_FIELDS zenginleştirmesi yaptı",
    (await itemAliasRow(custK, i1)) === null && merged?.assigned === true && merged.alias === "Kaynak Işık",
    JSON.stringify(merged),
  );
  const custErr = await tryRevert(custOp, "müşteri adlı birleştirme geri alınıyor");
  check("§9b ⭐ Üretilmiş kolonlu tablolarla müşteri birleştirmesi GERİ ALINIYOR", custErr === null, custErr ?? "");
  const kI1 = await itemAliasRow(custK, i1);
  const kI2 = await itemAliasRow(custK, i2);
  const sI1 = await itemAliasRow(custS, i1);
  check(
    "§9c ⭐ SKIP ile silinen ürün adı fotoğraftan döndü, aliasFold DB'ce yeniden üretildi",
    kI1?.alias === "Kaynak Şile" && kI1.aliasFold != null && kI1.aliasFold === foldBefore && sI1?.alias === "HEDEF KUMAŞ ADI",
    JSON.stringify({ kI1, sI1, foldBefore }),
  );
  check("§9d Taşınan (çakışmasız) ürün adı kaynağına döndü", kI2?.alias === "Kaynak Çözgü", JSON.stringify(kI2));
  const sC1 = await colorAliasRow(custS, c1);
  const kC1 = await colorAliasRow(custK, c1);
  const kC2 = await colorAliasRow(custK, c2);
  check(
    "§9e ⭐ MERGE_FIELDS zenginleştirmesi fotoğrafa döndü (hedef: atanmamış + adsız, aliasFold NULL)",
    sC1?.assigned === false && sC1.alias === null && sC1.aliasFold === null,
    JSON.stringify(sC1),
  );
  check(
    "§9f ⭐ MERGE_FIELDS ile silinen kaynak renk adı döndü (aliasFold dolu)",
    kC1?.assigned === true && kC1.alias === "Kaynak Işık" && kC1.aliasFold != null && kC2?.alias === "Kaynak Gök",
    JSON.stringify({ kC1, kC2 }),
  );

  // §10 — ÜRÜN birleştirmesi: aynı müşteri iki karta da ad vermiş (SKIP)
  const cust = await makeCustomer("AL-M", `${TAG} Adlı Müşteri`);
  const itemS = await makeItem("AL-IS");
  const itemK = await makeItem("AL-IK");
  await prisma.customerItemAlias.createMany({
    data: [
      { customerId: cust, itemId: itemS, alias: "Hedef Kart Adı" },
      { customerId: cust, itemId: itemK, alias: "Kaynak Kart Adı" },
    ],
  });
  const itemOp = await mergeEntity("item", itemS, [itemK], 1, "aynı kumaşın iki kartı birleştiriliyor (alias sondası)");
  const itemErr = await tryRevert(itemOp, "kumaş birleştirmesi geri alınıyor");
  const back = await itemAliasRow(cust, itemK);
  check("§10a ⭐ Üretilmiş kolonlu tabloyla ürün birleştirmesi GERİ ALINIYOR", itemErr === null, itemErr ?? "");
  check(
    "§10b ⭐ Silinen ürün adı kaynak karta döndü (aliasFold dolu)",
    back?.alias === "Kaynak Kart Adı" && back.aliasFold != null,
    JSON.stringify(back),
  );

  // §11 — RENK birleştirmesi: aynı müşteri iki renge de ad vermiş (MERGE_FIELDS)
  const colS = await makeColor("AL-CS");
  const colK = await makeColor("AL-CK");
  await prisma.customerColorAlias.createMany({
    data: [
      { customerId: cust, colorId: colS, assigned: false, alias: null },
      { customerId: cust, colorId: colK, assigned: true, alias: "Kaynak Renk Adı" },
    ],
  });
  const colOp = await mergeEntity("color", colS, [colK], 1, "aynı rengin iki kartı birleştiriliyor (alias sondası)");
  const colErr = await tryRevert(colOp, "renk birleştirmesi geri alınıyor");
  const colSurv = await colorAliasRow(cust, colS);
  const colBack = await colorAliasRow(cust, colK);
  check("§11a ⭐ Üretilmiş kolonlu tabloyla renk birleştirmesi GERİ ALINIYOR", colErr === null, colErr ?? "");
  check(
    "§11b ⭐ Hedef renk adı fotoğrafa, kaynak renk adı kaynağa döndü",
    colSurv?.assigned === false && colSurv.alias === null && colBack?.assigned === true && colBack.alias === "Kaynak Renk Adı" && colBack.aliasFold != null,
    JSON.stringify({ colSurv, colBack }),
  );

  await multiSourceRevertCase();
}

/** §12 — iki kaynak aynı (müşteri, kumaş/renk) anahtarında; hedefin satırı iki kez zenginleşir. */
async function multiSourceRevertCase(): Promise<void> {
  const s = await makeCustomer("MK-H", `${TAG} Çok Kaynak Hedef`);
  const k1 = await makeCustomer("MK-K1", `${TAG} Çok Kaynak Bir`);
  const k2 = await makeCustomer("MK-K2", `${TAG} Çok Kaynak İki`);
  const item = await makeItem("MK-I");
  const cShared = await makeColor("MK-C");
  const cSurv = await makeColor("MK-D");
  await prisma.customerItemAlias.createMany({
    data: [
      { customerId: k1, itemId: item, alias: "Bir Kumaş" },
      { customerId: k2, itemId: item, alias: "İki Kumaş" },
    ],
  });
  await prisma.customerColorAlias.createMany({
    data: [
      // Hedefte yok: K1'inki taşınır, K2'ninki onu zenginleştirip silinir.
      { customerId: k1, colorId: cShared, assigned: false, alias: null },
      { customerId: k2, colorId: cShared, assigned: true, alias: "İki Renk" },
      // Hedefte var: K1 ve K2 sırayla zenginleştirir (ilk fotoğraf asıl hâl).
      { customerId: s, colorId: cSurv, assigned: false, alias: null },
      { customerId: k1, colorId: cSurv, assigned: true, alias: null },
      { customerId: k2, colorId: cSurv, assigned: false, alias: "İki Hedef Rengi" },
    ],
  });
  const opId = await mergeEntity("customer", s, [k1, k2], 2, "iki kaynak aynı anahtarlarda birleştiriliyor (çok kaynak)");
  const mid = await colorAliasRow(s, cSurv);
  check(
    "§12a Zemin: hedef satırı iki kaynaktan zenginleşti",
    mid?.assigned === true && mid.alias === "İki Hedef Rengi",
    JSON.stringify(mid),
  );
  // Defterin kendisi ölçülür (geri almanın kalem okuma sırasına bağlı değil): aynı satırın
  // yalnız İLK fotoğrafı yazılmış olmalı ve o fotoğraf birleştirme ÖNCESİ hâldir.
  const survRowId = (await prisma.customerColorAlias.findUniqueOrThrow({
    where: { customerId_colorId: { customerId: s, colorId: cSurv } },
    select: { id: true },
  })).id;
  const shots = (await prisma.mergeOperationRef.findMany({
    where: { operationId: opId, kind: MergeRefKind.FIELD_MERGED, tableName: "customer_color_aliases" },
    select: { rowData: true },
  })).flatMap((r) => (r.rowData as Array<Record<string, unknown>> | null) ?? []);
  const survShots = shots.filter((r) => r.id === survRowId);
  const ids = shots.map((r) => String(r.id));
  check(
    "§12f ⭐ Defter: her satırın TEK fotoğrafı var, hedef satırınki birleştirme öncesi hâl",
    new Set(ids).size === ids.length && survShots.length === 1 &&
      survShots[0]?.assigned === false && survShots[0]?.alias === null,
    JSON.stringify(shots.map((r) => ({ id: String(r.id).slice(0, 8), assigned: r.assigned, alias: r.alias }))),
  );
  const err = await tryRevert(opId, "çok kaynaklı birleştirme geri alınıyor");
  check("§12b ⭐ Çok kaynaklı birleştirme GERİ ALINIYOR", err === null, err ?? "");
  // Sıradan bağımsızlık doğrudan: MOVED kalemi ÖNCE uygulanmış satıra, hedefi gösteren bir
  // fotoğraf SONRA uygulanırsa satır kaynağında kalmalı (taşıma kolonu fotoğraftan yazılmaz).
  // Kendi satırıyla (geri almanın sonucuna yaslanmaz) ve tx geri alınarak.
  const cProbe = await makeColor("MK-P");
  const probe = await prisma.$transaction(async (tx) => {
    const created = await tx.customerColorAlias.create({
      data: { customerId: k1, colorId: cProbe, assigned: false, alias: null },
      select: { id: true },
    });
    const row = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM "customer_color_aliases" WHERE "id" = $1::uuid`,
      created.id,
    ))[0]!;
    await restoreSnapshotRowsTx(
      tx,
      { table: "customer_color_aliases", movedColumn: "customerId", rows: [{ ...row, customerId: s, alias: "FOTOĞRAF" }] },
      newPkCache(),
    );
    const after = await tx.customerColorAlias.findUnique({ where: { id: String(row.id) }, select: { customerId: true, alias: true } });
    throw Object.assign(new Error("sonda geri alındı"), { after });
  }).catch((e: { after?: { customerId: string; alias: string | null } }) => e.after ?? null);
  check(
    "§12g ⭐ Fotoğraf taşıma kolonunu YAZMAZ: sonra uygulanan fotoğraf satırı hedefe geri çekmiyor",
    probe?.customerId === k1 && probe.alias === "FOTOĞRAF",
    JSON.stringify(probe),
  );
  const got = {
    k1Item: (await itemAliasRow(k1, item))?.alias,
    k2Item: (await itemAliasRow(k2, item))?.alias,
    sItem: (await itemAliasRow(s, item))?.alias ?? null,
    k1Shared: await colorAliasRow(k1, cShared),
    k2Shared: await colorAliasRow(k2, cShared),
    sShared: await colorAliasRow(s, cShared),
    sSurv: await colorAliasRow(s, cSurv),
    k1Surv: await colorAliasRow(k1, cSurv),
    k2Surv: await colorAliasRow(k2, cSurv),
  };
  check(
    "§12c ⭐ Ürün adı iki kaynağa da döndü, hedefte kalmadı",
    got.k1Item === "Bir Kumaş" && got.k2Item === "İki Kumaş" && got.sItem === null,
    JSON.stringify({ k1: got.k1Item, k2: got.k2Item, s: got.sItem }),
  );
  check(
    "§12d ⭐ Taşınıp zenginleşen satır İLK kaynağına ve asıl alanlarına döndü",
    got.k1Shared?.assigned === false && got.k1Shared.alias === null &&
      got.k2Shared?.assigned === true && got.k2Shared.alias === "İki Renk" && got.sShared === null,
    JSON.stringify({ k1: got.k1Shared, k2: got.k2Shared, s: got.sShared }),
  );
  check(
    "§12e ⭐ İki kez zenginleşen hedef satırı birleştirme ÖNCESİ hâline döndü",
    got.sSurv?.assigned === false && got.sSurv.alias === null &&
      got.k1Surv?.assigned === true && got.k1Surv.alias === null &&
      got.k2Surv?.assigned === false && got.k2Surv.alias === "İki Hedef Rengi",
    JSON.stringify({ s: got.sSurv, k1: got.k1Surv, k2: got.k2Surv }),
  );
}

async function cleanup(): Promise<void> {
  try {
    const masterIds = [...customerIds, ...itemIds, ...colorIds];
    if (masterIds.length) {
      const ops = await prisma.mergeOperation.findMany({
        where: { OR: [{ survivorId: { in: masterIds } }, { sources: { some: { sourceId: { in: masterIds } } } }] },
        select: { id: true },
      });
      const opIds = ops.map((o) => o.id);
      if (opIds.length) {
        await prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } });
        await prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } });
      }
      await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: masterIds } }, { bId: { in: masterIds } }] } });
    }
    if (orderIds.length) {
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (customerIds.length) {
      await prisma.customerItemColorAlias.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.cariAccount.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }
    // Alias satırları müşteri silinince CASCADE ile gider; kartlar tombstone'suz silinir.
    if (itemIds.length) {
      await prisma.item.updateMany({ where: { id: { in: itemIds } }, data: { mergedIntoId: null } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    }
    if (colorIds.length) {
      await prisma.color.updateMany({ where: { id: { in: colorIds } }, data: { mergedIntoId: null } });
      await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
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
