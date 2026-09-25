// =============================================================================
// TeksERP - Ürün arşivi ↔ top girişi YARIŞI (URUN-YASAM-DONGUSU.md §5.3, §10.4)
// =============================================================================
// Sayım ile yazım arasında doğan top görünmezse (TOCTOU) Pasif kartta canlı top kalır
// ve D1 sessizce çiğnenir. Kilit sırası her yolda aynı: 8030 SHARED → kart satırı
// (yazıcı FOR UPDATE, top girişi FOR SHARE). Ölçülen: eşzamanlı iki istekten TAM biri
// kazanır, hiçbir turda "Pasif + canlı top" oluşmaz, 5xx/kilitlenme (40P01) yoktur.
// Ayrıca birleştirme (8030 EXCLUSIVE) aynı anda koşarken de sıra döngü kurmaz.
// =============================================================================
import { ItemLifecycleStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { InventoryService } from "../src/services/inventory.service";
import { ITEM_DEAD_ROLL_STATUSES } from "../src/services/helpers/item-lifecycle.helper";

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
const outcome = (r: PromiseSettledResult<unknown>): string => {
  if (r.status === "fulfilled") return "OK";
  const e = r.reason as { statusCode?: number; details?: { code?: string } };
  return `${e.statusCode ?? 500}:${e.details?.code ?? "?"}`;
};

const TAG = `TST-YR-${Date.now()}`;
const TURLAR = 24;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inventory = new InventoryService();
const itemIds: string[] = [];

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const tally = new Map<string, number>();
  let ihlal = 0;
  let sunucuHatasi = 0;
  for (let i = 0; i < TURLAR; i++) {
    const r = await itemService.create({ name: `${TAG} ${i}`, itemType: "FABRIC", unit: "MT" });
    const id = (r.data as { id: string }).id;
    itemIds.push(id);
    // Kademeli gecikme: arşiv girişin tx'i açıldıktan SONRA da gelsin — yoksa hep arşiv
    // kazanır ve kilit penceresi hiç denenmez (ölçüldü 2026-09-25: gecikmesiz 12/12 arşiv).
    // Çift turda arşiv, tek turda giriş geciktirilir — iki sıra da denenir.
    const gecikmeArsiv = i % 2 === 0 ? (i % 8) * 6 : 0;
    const gecikmeGiris = i % 2 === 1 ? (i % 8) * 4 : 0;
    const [arsiv, giris] = await Promise.allSettled([
      sleep(gecikmeArsiv).then(() => itemService.transitionLifecycle(id, ItemLifecycleStatus.ARCHIVED, null, admin.id)),
      sleep(gecikmeGiris).then(() => inventory.createInitialEntry({ itemId: id, initialQty: 10 }, admin.id)),
    ]);
    const key = `arşiv=${outcome(arsiv)} giriş=${outcome(giris)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if ([arsiv, giris].some((x) => x.status === "rejected" && ((x.reason as { statusCode?: number }).statusCode ?? 500) >= 500)) sunucuHatasi++;
    const it = await prisma.item.findUniqueOrThrow({ where: { id }, select: { lifecycleStatus: true } });
    const live = await prisma.roll.count({ where: { itemId: id, status: { notIn: ITEM_DEAD_ROLL_STATUSES } } });
    if (it.lifecycleStatus === "ARCHIVED" && live > 0) ihlal++;
  }
  for (const [k, n] of tally) console.log(`   · ${n} tur: ${k}`);
  check(`${TURLAR} turda D1 hiç çiğnenmedi (Pasif kartta canlı top 0)`, ihlal === 0, `ihlal ${ihlal}`);
  check("5xx / kilitlenme yok", sunucuHatasi === 0, `${sunucuHatasi}`);
  const legal = [...tally.keys()].every(
    (k) =>
      k === "arşiv=OK giriş=409:ITEM_INACTIVE" ||
      k === "arşiv=409:ITEM_HAS_LIVE_REFERENCES giriş=OK",
  );
  check("her tur TAM bir kazanan (iki meşru sonuçtan biri)", legal, [...tally.keys()].join(" | "));
  // Körlük zemini: iki sonuç da görülmeli — yoksa yarış penceresi denenmemiştir.
  check("iki kazanan türü de gerçekleşti (pencere gerçekten denendi)", tally.size >= 2, [...tally.keys()].join(" | "));
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
