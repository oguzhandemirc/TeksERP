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
// Negatif sondalar (kırmızı görüldü): `known.has(k)` şartı düşürülünce §1c (tanınmayan ad da 400) ❌ ·
//   `findAllOffset`ten `assertListQueryShape` kalkınca §2a ❌ · `LIST_QUERY_RESERVED`ten `limit` düşünce §1b ❌.
// DB'ye YAZMAZ (yalnız okur: ItemService.findAll) → yine de `hedefDbEngeli()` (okuma bekçileri de sonda DB'de).
// =============================================================================
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
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

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("❌ bekçi çöktü:", e);
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
