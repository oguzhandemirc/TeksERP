// =============================================================================
// BEKÇİ — ÇIPLAK SÜZGEÇ FAIL-CLOSED (kullanıcı bulgusu 2026-09-18): `?status=OPEN` sessizce yok sayılıyordu → 400
// =============================================================================
//   §1 saf `assertNoBareFilterParams`: tanınan ad çıplak → 400 BARE_FILTER_PARAM (mesaj `filter[...]` yazımını söyler,
//      details.hint); `filter[status]` sarmalı, sözlük adları (page/limit/withTotal…) ve ucun kendi okuduğu (`bareAllowed`)
//      serbest; tanınmayan çıplak ad (`foo=1`) da serbest (kapı yalnız TANINAN adı yakalar — bilinmeyeni Prisma'ya
//      düşürmez, `safeFilters` zaten süzer).
//   §2 BaseService listesi (ItemService.findAll): çıplak `isActive=true` → 400; `filter[isActive]` → 200; çıplak `scope`
//      (skaler değil) → 200; cursor modu da aynı kapı.
//   §3 alış siparişi listesi: `PURCHASE_ORDER_FILTER_NAMES` (status · supplierId · subcontractorId) çıplak → 400;
//      `warehouseId` bu ucun süzgeci değil → serbest (kapı ucun okuduğu adlarla sınırlı).
//   §4 top listesi/özet/depo kapsamı: çıplak `mulkiyet`/`ownerCustomerId` → 400; list.ts'in okuduğu her süzgeç adı
//      `ROLL_LIST_FILTER_NAMES`te (sonda 2026-11-26: findAllRolls'tan kapı kalkınca §4a/§4b ❌; listeden `mulkiyet`
//      düşünce §4a/§4d/§4f ❌).
// Negatif sondalar (kırmızı görüldü): `known.has(k)` şartı düşürülünce §1c (tanınmayan ad da 400) ❌ ·
//   `findAllOffset`ten `assertListQueryShape` kalkınca §2a ❌ · `LIST_QUERY_RESERVED`ten `limit` düşünce §1b ❌.
// DB'ye YAZMAZ (yalnız okur: ItemService.findAll) → yine de `hedefDbEngeli()` (okuma bekçileri de sonda DB'de).
// =============================================================================
import type { Request, Response } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ROLL_LIST_FILTER_NAMES } from "../src/services/inventory/list";
import { InventoryController } from "../src/controllers/inventory.controller";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { LIST_QUERY_RESERVED, assertNoBareFilterParams } from "../src/utils/query-parser";
import { ItemService } from "../src/services/item.service";
import { PURCHASE_ORDER_FILTER_NAMES } from "../src/services/purchase-order.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const req = (query: Record<string, string>): Request => ({ query } as unknown as Request);
const kod = (e: unknown): string => (e instanceof AppError ? String((e.details as { code?: string } | undefined)?.code ?? e.statusCode) : String((e as Error)?.message ?? e).slice(0, 80));
async function bekle<T>(p: Promise<T> | (() => T)): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> {
  try { return { ok: true, v: typeof p === "function" ? (p as () => T)() : await p }; } catch (e) { return { ok: false, e }; }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exit(1); }
  console.log("\n=== Çıplak süzgeç fail-closed (BARE_FILTER_PARAM) ===\n");

  // ── §1 saf ─────────────────────────────────────────────────────────────
  const known = ["status", "isActive", "supplierId"];
  const r1a = await bekle(() => assertNoBareFilterParams(req({ status: "OPEN,PARTIAL" }), known));
  const e1a = r1a.ok ? null : (r1a.e as AppError);
  check("§1a ⭐ tanınan ad çıplak → 400 BARE_FILTER_PARAM; mesaj `filter[status]` yazımını söyler; details.hint", !r1a.ok && kod(r1a.e) === "BARE_FILTER_PARAM" && e1a?.statusCode === 400 && e1a.message.includes("filter[status]") && JSON.stringify((e1a.details as { hint?: string[] }).hint) === JSON.stringify(["filter[status]"]), r1a.ok ? "geçti" : e1a?.message);
  const r1b = await bekle(() => assertNoBareFilterParams(req({ "filter[status]": "OPEN", page: "2", limit: "50", withTotal: "true", cursor: "x", search: "a" }), known));
  check("§1b sarmalı süzgeç + sözlük adları (page/limit/withTotal/cursor/search) serbest", r1b.ok && LIST_QUERY_RESERVED.has("limit") && LIST_QUERY_RESERVED.has("withTotal"));
  const r1c = await bekle(() => assertNoBareFilterParams(req({ foo: "1", scope: "public" }), known));
  check("§1c tanınmayan çıplak ad serbest (kapı yalnız TANINAN adı yakalar)", r1c.ok);
  const r1d = await bekle(() => assertNoBareFilterParams(req({ status: "OPEN" }), known, ["status"]));
  check("§1d ucun kendi okuduğu çıplak ad (`bareAllowed`) serbest", r1d.ok);
  const r1e = await bekle(() => assertNoBareFilterParams(req({ status: "OPEN", isActive: "true" }), known));
  check("§1e birden çok çıplak ad tek 400'de listelenir", !r1e.ok && JSON.stringify(((r1e.e as AppError).details as { params?: string[] }).params) === JSON.stringify(["status", "isActive"]));

  // ── §2 BaseService listesi ─────────────────────────────────────────────
  const items = new ItemService({ modelName: "item", tableName: "ITEM", searchFields: ["name"], codeSearchFields: ["code"], duplicateNameField: "name" });
  const r2a = await bekle(items.findAll(req({ isActive: "true", pageSize: "1" })));
  check("§2a ⭐ BaseService listesi: çıplak `isActive=true` (skaler alan) → 400 BARE_FILTER_PARAM", !r2a.ok && kod(r2a.e) === "BARE_FILTER_PARAM", r2a.ok ? "geçti" : kod(r2a.e));
  const r2b = await bekle(items.findAll(req({ "filter[isActive]": "true", pageSize: "1" })));
  check("§2b `filter[isActive]` sarmalı → liste döner", r2b.ok);
  const r2c = await bekle(items.findAll(req({ scope: "public", pageSize: "1" })));
  check("§2c çıplak `scope` (skaler değil, extraWhere okur) serbest", r2c.ok, r2c.ok ? "" : kod(r2c.e));
  const r2d = await bekle(items.findAll(req({ mode: "cursor", limit: "1", itemType: "FABRIC" })));
  check("§2d cursor modunda da aynı kapı: çıplak `itemType` → 400", !r2d.ok && kod(r2d.e) === "BARE_FILTER_PARAM", r2d.ok ? "geçti" : kod(r2d.e));

  // ── §3 alış siparişi listesi ───────────────────────────────────────────
  const r3a = await bekle(() => assertNoBareFilterParams(req({ status: "OPEN,PARTIAL" }), PURCHASE_ORDER_FILTER_NAMES));
  check("§3a ⭐ `?status=OPEN,PARTIAL` (bulgu) → 400; okuyucu ile kapı aynı liste (status · supplierId · subcontractorId)", !r3a.ok && JSON.stringify([...PURCHASE_ORDER_FILTER_NAMES]) === JSON.stringify(["status", "supplierId", "subcontractorId"]));
  const r3b = await bekle(() => assertNoBareFilterParams(req({ warehouseId: "x" }), PURCHASE_ORDER_FILTER_NAMES));
  check("§3b bu ucun süzgeci olmayan çıplak ad (`warehouseId`) serbest — kapı ucun okuduğuyla sınırlı", r3b.ok);

  // ── §4 top listesi · özet · depo kapsamı ───────────────────────────────
  const inv = new InventoryService();
  const r4a = await bekle(inv.findAllRolls(req({ mulkiyet: "OWN", pageSize: "1" })));
  check("§4a ⭐ /rolls çıplak `?mulkiyet=OWN` → 400 BARE_FILTER_PARAM (sessiz TÜMÜ değil)", !r4a.ok && kod(r4a.e) === "BARE_FILTER_PARAM", r4a.ok ? "geçti" : kod(r4a.e));
  const r4b = await bekle(inv.findAllRolls(req({ mode: "cursor", limit: "1", ownerCustomerId: "00000000-0000-0000-0000-000000000000" })));
  check("§4b /rolls cursor: çıplak `?ownerCustomerId=` → 400", !r4b.ok && kod(r4b.e) === "BARE_FILTER_PARAM", r4b.ok ? "geçti" : kod(r4b.e));
  const r4c = await bekle(inv.findAllRolls(req({ "filter[mulkiyet]": "OWN", pageSize: "1" })));
  check("§4c `filter[mulkiyet]` sarmalı → liste döner", r4c.ok, r4c.ok ? "" : kod(r4c.e));
  const r4d = await bekle(inv.getRollStats(req({ mulkiyet: "CONSIGNED" })));
  check("§4d /rolls/stats aynı kapı (liste ↔ şerit tek küme)", !r4d.ok && kod(r4d.e) === "BARE_FILTER_PARAM", r4d.ok ? "geçti" : kod(r4d.e));
  let scopeErr: unknown = null;
  await new InventoryController().getWarehouseScope(req({ mulkiyet: "OWN" }), { status: () => ({ json: () => undefined }) } as unknown as Response, (e?: unknown) => { scopeErr = e; });
  check("§4e /rolls/warehouse-scope çıplak `?mulkiyet=` → 400", kod(scopeErr) === "BARE_FILTER_PARAM", kod(scopeErr));
  // Okuyucu ↔ kapı tek küme: list.ts'in okuduğu her `f["x"]` listede olmalı (yeni süzgeç kapıyı sessizce delmesin).
  const listSrc = readFileSync(path.join(__dirname, "../src/services/inventory/list.ts"), "utf8");
  const readNames = [...new Set([...listSrc.matchAll(/\bf\["([A-Za-z]+)"\]/g)].map((m) => m[1]!))];
  const missingNames = readNames.filter((n) => !(ROLL_LIST_FILTER_NAMES as readonly string[]).includes(n));
  check("§4f okunan her top süzgeci ROLL_LIST_FILTER_NAMES'te (okuyucu = kapı)", readNames.length >= 20 && missingNames.length === 0, missingNames.join(",") || `${readNames.length} ad`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
