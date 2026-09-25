// =============================================================================
// TeksERP - Ürün kartı ARŞİV KAPISI (URUN-YASAM-DONGUSU.md §3.1 D1, §5, §10.3)
// =============================================================================
// D1: Pasif kartta canlı referans OLAMAZ — bugünkü "uyar ama bırak" bilerek değişti.
// Ölçülen: üç giriş yolu (POST /lifecycle · DELETE · PATCH isActive:false) canlı topta
// 409 `ITEM_HAS_LIVE_REFERENCES` + kayıt listesi verir; önizleme kayıtları TEK TEK
// listeler; çıkış yolu (Tükenene kadar) açıktır; kalan 0 olunca Pasif'e geçilir; geçiş
// hedef-durum idempotenttir; lifecycle kolonları gövdeden yazılamaz; birleştirmenin
// hedefi Aktif olmalıdır. (Diğer ana veriler S4'te bu dosyaya eklenecek.)
// =============================================================================
import { ItemLifecycleStatus, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { InventoryService } from "../src/services/inventory.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

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

async function mkItem(suffix: string): Promise<string> {
  const r = await itemService.create({ name: `${TAG} ${suffix}`, itemType: "FABRIC", unit: "MT" });
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
  check("önizleme sekiz türün hepsini döner (0 olanlar dahil)", pv.references.length === 8);

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
}

async function temizle(): Promise<void> {
  if (itemIds.length === 0) return;
  const rolls = await prisma.roll.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
  const rollIds = rolls.map((x) => x.id);
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: itemIds } } });
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
    process.exit(fail > 0 ? 1 : 0);
  });
