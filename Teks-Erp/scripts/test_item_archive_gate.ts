// =============================================================================
// TeksERP - Ürün kartı ARŞİV KAPISI (URUN-YASAM-DONGUSU.md §3.1 D1, §5, §10.3)
// =============================================================================
// D1: Pasif kartta canlı referans OLAMAZ — bugünkü "uyar ama bırak" bilerek değişti.
// Ölçülen: üç giriş yolu (POST /lifecycle · DELETE · PATCH isActive:false) canlı topta
// 409 `ITEM_HAS_LIVE_REFERENCES` + kayıt listesi verir; önizleme kayıtları TEK TEK
// listeler; çıkış yolu (Tükenene kadar) açıktır; kalan 0 olunca Pasif'e geçilir; geçiş
// hedef-durum idempotenttir; lifecycle kolonları gövdeden yazılamaz; birleştirmenin
// hedefi Aktif olmalıdır. (Diğer ana veriler S4'te bu dosyaya eklenecek.)
// §7 (1e K2a, 2026-10-29): hizmet kalemi özellik/değer eşlemesi ve müşteri hizmet fiyatı canlı referanstır.
// Negatif sonda: `liveRefWhere`de SERVICE_* yüklemleri `{ id: "00000000-0000-0000-0000-000000000000" }` yapılınca §7 kırmızı.
// =============================================================================
import { Currency, ItemLifecycleStatus, ItemType, PriceKind, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { InventoryService } from "../src/services/inventory.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { ITEM_LIVE_REF_KINDS } from "../src/services/helpers/item-lifecycle.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
async function errOf(fn: () => Promise<unknown>): Promise<{ code: string; status: number; details: Record<string, unknown> }> {
  try {
    await fn();
    return { code: "OK", status: 200, details: {} };
  } catch (e) {
    const d = ((e as { details?: Record<string, unknown> }).details ?? {}) as Record<string, unknown>;
    return { code: String(d.code ?? "ERR"), status: (e as { statusCode?: number }).statusCode ?? 500, details: d };
  }
}

const TAG = `TST-AK-${Date.now()}`;
const inventory = new InventoryService();
const itemIds: string[] = [];
const svcFx = { propIds: [] as string[], customerIds: [] as string[] };

async function mkItem(suffix: string): Promise<string> {
  const r = await itemService.create({ name: `${TAG} ${suffix}`, itemType: "FABRIC", unit: "MT" }, await testActorId());
  const id = (r.data as { id: string }).id;
  itemIds.push(id);
  return id;
}
const state = async (id: string) =>
  prisma.item.findUniqueOrThrow({ where: { id }, select: { lifecycleStatus: true, isActive: true, lifecycleReason: true } });

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const ADMIN = admin.id;

  const Z = await mkItem("CANLI");
  const r = await inventory.createInitialEntry({ itemId: Z, initialQty: 55 }, ADMIN);
  const roll = r.data as { id: string; barcode: string };

  console.log("=== 1) Önizleme kayıtları tek tek listeler ===");
  const pv = (await itemService.lifecyclePreview(Z, ItemLifecycleStatus.ARCHIVED)).data as {
    canTransition: boolean;
    liveTotal: number;
    references: Array<{ kind: string; count: number; records: Array<{ id: string; title: string }> }>;
  };
  const rollRef = pv.references.find((x) => x.kind === "ROLL");
  check("canlı topta Pasif'e geçiş önizlemede KAPALI", pv.canTransition === false && pv.liveTotal === 1, `liveTotal=${pv.liveTotal}`);
  check("top barkoduyla listelendi", rollRef?.records[0]?.title === roll.barcode, rollRef?.records[0]?.title);
  // Tür sayısı sabit yazılmaz: katalog büyüdükçe (S4 kartela 2026-09-26) bekçi kendiliğinden izler.
  check("önizleme katalogdaki her türü döner (0 olanlar dahil)",
    JSON.stringify(pv.references.map((x) => x.kind)) === JSON.stringify(ITEM_LIVE_REF_KINDS.map((k) => k.kind)),
    `${pv.references.length}/${ITEM_LIVE_REF_KINDS.length}`);

  console.log("\n=== 2) Üç giriş yolu da 409 + kayıt listesi ===");
  for (const [ad, fn] of [
    ["POST /lifecycle", () => itemService.transitionLifecycle(Z, ItemLifecycleStatus.ARCHIVED, null, ADMIN)],
    ["DELETE (softDelete)", () => itemService.softDelete(Z, ADMIN)],
    ["PATCH isActive:false", () => itemService.update(Z, { isActive: false }, ADMIN)],
  ] as const) {
    const e = await errOf(fn);
    const refs = e.details.references as Array<{ kind: string; records: Array<{ title: string }> }> | undefined;
    check(`${ad} → 409 ITEM_HAS_LIVE_REFERENCES`, e.status === 409 && e.code === "ITEM_HAS_LIVE_REFERENCES", `${e.status} ${e.code}`);
    check(`${ad} → details.references topu barkoduyla taşıyor`, !!refs?.find((x) => x.kind === "ROLL")?.records.some((x) => x.title === roll.barcode));
  }
  const s0 = await state(Z);
  check("kart hâlâ Aktif (hiçbir yol yarım yazmadı)", s0.lifecycleStatus === "ACTIVE" && s0.isActive === true);

  console.log("\n=== 3) Çıkış yolu: Tükenene kadar ===");
  const t1 = await itemService.transitionLifecycle(Z, ItemLifecycleStatus.PHASE_OUT, "fazla kart", ADMIN);
  const s1 = await state(Z);
  check("Tükenene kadar'a geçildi, isActive TRUE kaldı (mal akar)", s1.lifecycleStatus === "PHASE_OUT" && s1.isActive === true && s1.lifecycleReason === "fazla kart");
  const auditN = await prisma.systemLog.count({ where: { recordId: Z, action: "UPDATE" } });
  const t2 = await itemService.transitionLifecycle(Z, ItemLifecycleStatus.PHASE_OUT, "tekrar", ADMIN);
  const auditN2 = await prisma.systemLog.count({ where: { recordId: Z, action: "UPDATE" } });
  check("aynı hedefe ikinci istek idempotent — yazım ve audit yok", t1.idempotent === false && t2.idempotent === true && auditN2 === auditN, `audit ${auditN}→${auditN2}`);
  const sum = (await itemService.lifecycleSummary([Z, Z])).data ?? [];
  check("liste rozeti özeti: kalan canlı top ve toplam (tekrarlı id tek satır)", sum.length === 1 && sum[0]?.id === Z && sum[0]?.rolls === 1 && (sum[0]?.liveTotal ?? 0) >= 1, JSON.stringify(sum));
  // Panel formu her kayıtta isActive:true gönderir; Tükenene kadar kartın adını düzeltmek
  // onu Aktif'e döndürmemeli (true yalnız Pasif kartı diriltir).
  const f1 = await itemService.update(Z, { isActive: true, name: `${TAG} FORM` }, ADMIN);
  const sf = await prisma.item.findUniqueOrThrow({ where: { id: Z }, select: { lifecycleStatus: true, name: true } });
  check("⭐ form kaydı (isActive:true + ad) Tükenene kadar kartı Aktif'e DÖNDÜRMEZ, ad güncellenir", sf.lifecycleStatus === "PHASE_OUT" && sf.name === `${TAG} FORM`, `${sf.lifecycleStatus} · ${String(f1.message ?? "")}`);
  const f2 = (await itemService.update(Z, { isActive: true }, ADMIN)) as { idempotent?: boolean; message?: string };
  check("yalnız isActive:true → yazım yok, mesaj gerçek durumu söyler", (await state(Z)).lifecycleStatus === "PHASE_OUT" && f2.idempotent === true && String(f2.message).includes("Tükenene kadar"), String(f2.message));

  console.log("\n=== 4) Kalan 0 → Pasif ===");
  // Fikstür: topu iptal edilmiş say (gerçek iptal akışı bu bekçinin konusu değil).
  await prisma.roll.update({ where: { id: roll.id }, data: { status: RollStatus.CANCELLED } });
  const pv2 = (await itemService.lifecyclePreview(Z, ItemLifecycleStatus.ARCHIVED)).data as { canTransition: boolean; liveTotal: number };
  check("canlı referans 0 → önizleme Pasif'e izin veriyor (\"Pasife hazır\")", pv2.canTransition === true && pv2.liveTotal === 0);
  const del = await errOf(() => itemService.softDelete(Z, ADMIN));
  const s2 = await state(Z);
  check("DELETE artık Pasif'e geçiriyor, isActive FALSE", del.code === "OK" && s2.lifecycleStatus === "ARCHIVED" && s2.isActive === false, del.code);
  await itemService.update(Z, { isActive: true }, ADMIN);
  check("PATCH isActive:true → Aktif'e dönüş", (await state(Z)).lifecycleStatus === "ACTIVE");

  console.log("\n=== 5) Gövdeden yazılamaz (yeni skaler = yeni yazılabilir alan kuralı) ===");
  await itemService.update(Z, { lifecycleStatus: "ARCHIVED", lifecycleReason: "sızma", name: `${TAG} CANLI2` }, ADMIN);
  const s3 = await state(Z);
  check("PATCH gövdesindeki lifecycleStatus/lifecycleReason YOK sayıldı, ad güncellendi", s3.lifecycleStatus === "ACTIVE" && s3.lifecycleReason !== "sızma");

  console.log("\n=== 6) Birleştirmenin hedefi Aktif olmalı ===");
  const S = await mkItem("HEDEF");
  const K = await mkItem("KAYNAK");
  await itemService.transitionLifecycle(S, ItemLifecycleStatus.PHASE_OUT, null, ADMIN);
  const m = await errOf(() =>
    MasterDataMergeService.merge("item", { survivorId: S, sourceIds: [K], reason: "bekçi birleştirme denemesi", acknowledgedConflicts: 0, userId: ADMIN }),
  );
  check("Tükenene kadar hedefe birleştirme 409 ITEM_MERGE_TARGET_NOT_ACTIVE", m.code === "ITEM_MERGE_TARGET_NOT_ACTIVE", m.code);
  check("kaynak dokunulmadı", (await state(K)).lifecycleStatus === "ACTIVE");

  console.log("\n=== 7) Eşlenmiş hizmet kalemi pasife alınamaz (1e K2a 2026-10-29: motor eşlemeyi + müşteri fiyatını her sevkte okur) ===");
  const svc = (await itemService.create({ name: `${TAG} HIZMET`, itemType: "SERVICE", unit: "MT" }, ADMIN)).data as { id: string };
  itemIds.push(svc.id);
  // Kart varsayılan fiyatı (müşterisiz) TANIMDIR: tek başına pasife almayı engellemez.
  await prisma.itemPrice.create({ data: { itemId: svc.id, customerId: null, kind: PriceKind.SALE, currency: Currency.TRY, price: "1.0000" } });
  const prop = await prisma.fabricProperty.create({ data: { code: `${TAG}-P`.slice(0, 32), name: `${TAG} kurşun`, valueType: "FLAG", serviceItemId: svc.id }, select: { id: true } });
  svcFx.propIds.push(prop.id);
  const choice = await prisma.fabricProperty.create({ data: { code: `${TAG}-G`.slice(0, 32), name: `${TAG} gramaj`, valueType: "CHOICE" }, select: { id: true } });
  svcFx.propIds.push(choice.id);
  const val = await prisma.fabricPropertyValue.create({ data: { propertyId: choice.id, code: "G40", name: "40 gr" }, select: { id: true } });
  await prisma.fabricPropertyValue.update({ where: { id: val.id }, data: { serviceItemId: svc.id } });
  const cust = await prisma.customer.create({ data: { code: `${TAG}-C`.slice(0, 32), name: `${TAG} müşteri` }, select: { id: true } });
  svcFx.customerIds.push(cust.id);
  await prisma.itemPrice.create({ data: { itemId: svc.id, customerId: cust.id, kind: PriceKind.SALE, currency: Currency.TRY, price: "2.5000" } });
  const kinds = ["SERVICE_PROPERTY_MAP", "SERVICE_VALUE_MAP", "SERVICE_CUSTOMER_PRICE"];
  const pv7 = (await itemService.lifecyclePreview(svc.id, ItemLifecycleStatus.ARCHIVED)).data as { canTransition: boolean; liveTotal: number; references: Array<{ kind: string; count: number; records: Array<{ title: string }> }> };
  check("⭐ önizleme: eşleme (özellik + değer) ve müşteri fiyatı canlı referans, Pasif KAPALI (varsayılan fiyat sayılmaz)",
    pv7.canTransition === false && pv7.liveTotal === 3 && kinds.every((k) => pv7.references.find((x) => x.kind === k)?.count === 1), JSON.stringify(pv7.references.filter((x) => x.count > 0).map((x) => [x.kind, x.count])));
  const e7 = await errOf(() => itemService.transitionLifecycle(svc.id, ItemLifecycleStatus.ARCHIVED, null, ADMIN));
  const refs7 = (e7.details.references ?? []) as Array<{ kind: string; label: string; count: number; records: Array<{ title: string }> }>;
  check("⭐ pasife alma 409 ITEM_HAS_LIVE_REFERENCES + üç türün kaydı adıyla (Türkçe etiket)",
    e7.status === 409 && e7.code === "ITEM_HAS_LIVE_REFERENCES" && refs7.find((x) => x.kind === "SERVICE_PROPERTY_MAP")?.records[0]?.title === `${TAG} kurşun`
      && refs7.find((x) => x.kind === "SERVICE_VALUE_MAP")?.records[0]?.title === `${TAG} gramaj · 40 gr`
      && refs7.find((x) => x.kind === "SERVICE_CUSTOMER_PRICE")?.records[0]?.title === `${TAG} müşteri`
      && refs7.find((x) => x.kind === "SERVICE_CUSTOMER_PRICE")?.label === "Müşteri hizmet fiyatı",
    `${e7.status} ${e7.code} ${JSON.stringify(refs7.filter((x) => x.count > 0))}`);
  check("kart Aktif kaldı", (await state(svc.id)).lifecycleStatus === "ACTIVE");
  // Çıkış yolu: eşlemeler kaldırılır, müşteri fiyatı damgalanır ⇒ Pasif'e geçilir.
  await prisma.fabricProperty.update({ where: { id: prop.id }, data: { serviceItemId: null } });
  await prisma.fabricPropertyValue.update({ where: { id: val.id }, data: { serviceItemId: null } });
  await prisma.itemPrice.updateMany({ where: { itemId: svc.id, customerId: cust.id }, data: { revokedAt: new Date() } });
  const ok7 = await errOf(() => itemService.transitionLifecycle(svc.id, ItemLifecycleStatus.ARCHIVED, null, ADMIN));
  check("eşleme kaldırılıp müşteri fiyatı damgalanınca Pasif'e geçilir (varsayılan fiyat durur)", ok7.code === "OK" && (await state(svc.id)).lifecycleStatus === "ARCHIVED", ok7.code);
}

async function temizle(): Promise<void> {
  if (itemIds.length === 0) return;
  const rolls = await prisma.roll.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
  const rollIds = rolls.map((x) => x.id);
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } });
  await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: svcFx.propIds } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: svcFx.propIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: svcFx.customerIds } } });
  await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle().catch((e) => console.error("temizlik:", (e as Error).message));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
