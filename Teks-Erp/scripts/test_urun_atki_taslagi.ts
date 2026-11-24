// =============================================================================
// test_urun_atki_taslagi — ürün penceresinden girilen atkı (B19 tek pencere, GERÇEK DB)
// Kabul (PLAN K1–K7, K9): yeni kumaş + `weftSpecDraft` → kart ürünle AYNI tx'te doğar (kod = ürün kodu, ad = ürün adı,
// iplik satırları sıralı); aynı `clientToken` tekrarı aynı ürünü/kartı döner; geçersiz taslak 400 ve hiçbir şey yazılmaz;
// taslak + seçili kart / KUMAŞ dışı 400; kod çakışmasında "-2"; ürün satırı tx içinde düşerse kart da geri alınır (yarış);
// `attach-to-item` atkısız kumaşa kart + bağ, tekrar replay, farklı içerik / beklenmeyen kart 409 (kart yazılmaz);
// uç kapıları yapısal. Fikstür `TEST-B19-<ts>`.
// Negatif sonda: `item.service.ts` içinde taslak kartı `tx` yerine `prisma` ile yazılırsa §3 (yarış geri alma) KIRMIZI.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { itemService } from "../src/routes/item.routes";
import { createItemRecord } from "../src/services/color-item-create.service";
import { attachNewWeftSpecToItem } from "../src/services/weft-spec-draft.service";
import { createWeftSpec } from "../src/services/weft-spec.service";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

async function errOf(fn: () => Promise<unknown>): Promise<{ status: number; code: unknown } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: e.details?.code };
    return { status: 500, code: (e as { code?: string }).code };
  }
}

const TAG = `TEST-B19-${Date.now()}`;
const ids = { items: [] as string[] };

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const mkItem = async (s: string, itemType: "YARN" | "FABRIC"): Promise<string> => {
    const r = await prisma.item.create({
      data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, itemType, unit: itemType === "YARN" ? "KG" : "MT", ...(itemType === "YARN" ? { linearDensityDen: 150 } : {}) },
      select: { id: true },
    });
    ids.items.push(r.id);
    return r.id;
  };
  const [y1, y2] = [await mkItem("Y1", "YARN"), await mkItem("Y2", "YARN")];
  const draft = { sequenceCode: "A2 B1", picksPerCm: "18", weftProgramNo: "77", yarns: [{ yarnItemId: y1 }, { yarnItemId: y2 }] };
  const create = (s: string, extra: Record<string, unknown>, token?: string) =>
    createItemRecord(itemService, { code: `${TAG}-${s}`, name: `${TAG} kumaş ${s}`, itemType: "FABRIC", ...extra }, admin.id, token);
  const itemByCode = (code: string) => prisma.item.findFirst({ where: { code }, select: { id: true, name: true, weftSpecId: true } });
  const cardCount = () => prisma.weftSpec.count({ where: { code: { startsWith: TAG } } });

  console.log("§1 yeni kumaş + atkı taslağı (K1, K2)");
  const token = randomUUID();
  await create("K1", { weftSpecDraft: draft }, token);
  const k1 = await itemByCode(`${TAG}-K1`);
  if (k1) ids.items.push(k1.id);
  const card = k1?.weftSpecId ? await prisma.weftSpec.findUnique({ where: { id: k1.weftSpecId }, select: { code: true, name: true, sequenceCode: true, weftProgramNo: true, yarns: { select: { yarnItemId: true, picksInRepeat: true, sortOrder: true }, orderBy: { sortOrder: "asc" } } } }) : null;
  check("§1a ürün doğdu ve yeni karta bağlı", !!k1 && !!card);
  check("§1b kart kodu = ürün kodu, adı = ürün adı", card?.code === `${TAG}-K1` && card?.name === k1?.name, `${card?.code} · ${card?.name}`);
  check("§1c iplik satırları sıralı, adetler sıra kodundan (A2 B1 → 2,1)", JSON.stringify(card?.yarns.map((y) => [y.yarnItemId, y.picksInRepeat, y.sortOrder])) === JSON.stringify([[y1, 2, 0], [y2, 1, 1]]) && card?.sequenceCode === "A2 B1" && card?.weftProgramNo === "77");
  const before = await cardCount();
  await create("K1", { weftSpecDraft: draft }, token);
  const k1b = await prisma.item.findMany({ where: { code: `${TAG}-K1` }, select: { id: true } });
  check("§1d aynı clientToken tekrarı → aynı ürün, kart sayısı artmadı", k1b.length === 1 && k1b[0]!.id === k1?.id && (await cardCount()) === before);

  console.log("§2 geçersiz taslak ve sözleşme (K3, K4, K5)");
  const badYarn = await errOf(() => create("K3", { weftSpecDraft: { ...draft, yarns: [{ yarnItemId: k1!.id }] } }));
  check("§2a iplik olmayan kalem → 400, ne ürün ne kart", badYarn?.status === 400 && !(await itemByCode(`${TAG}-K3`)) && (await cardCount()) === before, JSON.stringify(badYarn));
  const empty = await errOf(() => create("K3", { weftSpecDraft: { sequenceCode: null, yarns: [] } }));
  check("§2b boş taslak → 400 WEFT_DRAFT_EMPTY, ürün yok", empty?.status === 400 && empty.code === "WEFT_DRAFT_EMPTY" && !(await itemByCode(`${TAG}-K3`)), JSON.stringify(empty));
  const noPicks = await errOf(() => create("K3", { weftSpecDraft: { yarns: [{ yarnItemId: y1 }] } }));
  check("§2c sıra kodu yok + adet yok → 400, ürün yok", noPicks?.status === 400 && !(await itemByCode(`${TAG}-K3`)), JSON.stringify(noPicks));
  const both = await errOf(() => create("K4", { weftSpecDraft: draft, weftSpecId: k1!.weftSpecId }));
  check("§2d taslak + seçili kart → 400 WEFT_DRAFT_WITH_CARD", both?.status === 400 && both.code === "WEFT_DRAFT_WITH_CARD" && !(await itemByCode(`${TAG}-K4`)), JSON.stringify(both));
  const yarnDraft = await errOf(() => createItemRecord(itemService, { code: `${TAG}-K4Y`, name: `${TAG} iplik K4Y`, itemType: "YARN", linearDensityDen: "150", weftSpecDraft: draft }, admin.id));
  check("§2e KUMAŞ dışı → 400, ürün yok", yarnDraft?.status === 400 && !(await itemByCode(`${TAG}-K4Y`)), JSON.stringify(yarnDraft));
  const pre = await createWeftSpec({ code: `${TAG}-K5`, name: `${TAG} kumaş K5`, yarns: [{ yarnItemId: y1, picksInRepeat: 1 }] }, admin.id);
  await create("K5", { weftSpecDraft: draft });
  const k5 = await itemByCode(`${TAG}-K5`);
  if (k5) ids.items.push(k5.id);
  const k5card = k5?.weftSpecId ? await prisma.weftSpec.findUnique({ where: { id: k5.weftSpecId }, select: { id: true, code: true, name: true } }) : null;
  // Ürün adı normalize edilir (büyük harf); kart adı ürünün kayıtlı adından türer.
  check("§2f kod/ad doluysa sonek: -2 / (2); önceki karta dokunulmadı", k5card?.code === `${TAG}-K5-2` && k5card?.name === `${k5?.name} (2)` && k5card.id !== pre.id, `${k5card?.code} · ${k5card?.name}`);

  console.log("§3 tek tx: ürün satırı tx içinde düşerse kart da geri alınır");
  // Başka yazar aynı adlı kumaşı açık tx'te yazıp tutar: ön kontrol onu görmez, taslak kartı yazılır, ürün satırı ad seddinde
  // bekler; yazar commit edince ürün P2002 ile düşer → kart da geri alınmalı (kart tx dışında yazılsaydı kalırdı).
  let held!: () => void;
  const holds = new Promise<void>((res) => { held = res; });
  const raceName = `${TAG} kumaş YARIŞ`;
  const writer = prisma.$transaction(async (tx) => {
    const w = await tx.item.create({ data: { code: `${TAG}-YW`, name: raceName, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    ids.items.push(w.id);
    held();
    await new Promise((res) => setTimeout(res, 1500));
  }, { timeout: 20_000 });
  await holds;
  const raced = await errOf(() => createItemRecord(itemService, { code: `${TAG}-YR`, name: raceName, itemType: "FABRIC", weftSpecDraft: draft }, admin.id));
  await writer;
  const leftover = await prisma.weftSpec.count({ where: { code: `${TAG}-YR` } });
  // Servis ham P2002 fırlatır; HTTP katmanı (error middleware) onu 409'a çevirir.
  check("§3a ürün ad seddinde düştü (P2002/409), ürün yok", !!raced && (raced.code === "P2002" || raced.status === 409) && !(await itemByCode(`${TAG}-YR`)), JSON.stringify(raced));
  check("§3b taslak kartı da geri alındı (yarım kayıt yok)", leftover === 0, `${leftover} kart`);

  console.log("§4 attach-to-item (K6, K7)");
  const fa = await mkItem("KA", "FABRIC");
  const r1 = await attachNewWeftSpecToItem({ itemId: fa, expectedWeftSpecId: null, weft: draft }, admin.id);
  const boundA = (await prisma.item.findUniqueOrThrow({ where: { id: fa }, select: { weftSpecId: true } })).weftSpecId;
  check("§4a atkısız kumaşa kart + bağ, replayed=false, kod = kumaş kodu", boundA === r1.weftSpec.id && r1.replayed === false && r1.weftSpec.code === `${TAG}-KA`);
  const n = await cardCount();
  const r2 = await attachNewWeftSpecToItem({ itemId: fa, expectedWeftSpecId: null, weft: draft }, admin.id);
  check("§4b aynı içerik tekrarı → replayed=true, aynı kart, kart sayısı aynı", r2.replayed === true && r2.weftSpec.id === r1.weftSpec.id && (await cardCount()) === n);
  const diff = await errOf(() => attachNewWeftSpecToItem({ itemId: fa, expectedWeftSpecId: null, weft: { ...draft, sequenceCode: "A1 B1" } }, admin.id));
  check("§4c farklı içerik + eski beklenen → 409 WEFT_SPEC_BINDING_CHANGED, kart yok", diff?.status === 409 && diff.code === "WEFT_SPEC_BINDING_CHANGED" && (await cardCount()) === n, JSON.stringify(diff));
  const fb = await mkItem("KB", "FABRIC");
  await prisma.item.update({ where: { id: fb }, data: { weftSpecId: pre.id } });
  const stale = await errOf(() => attachNewWeftSpecToItem({ itemId: fb, expectedWeftSpecId: null, weft: draft }, admin.id));
  check("§4d beklenen kart tutmuyor → 409, kart yazılmadı, bağ yerinde", stale?.status === 409 && (await cardCount()) === n && (await prisma.item.findUniqueOrThrow({ where: { id: fb }, select: { weftSpecId: true } })).weftSpecId === pre.id, JSON.stringify(stale));
  const notFabric = await errOf(() => attachNewWeftSpecToItem({ itemId: y1, expectedWeftSpecId: null, weft: draft }, admin.id));
  check("§4e iplik kalemine → 400", notFabric?.status === 400, JSON.stringify(notFabric));

  console.log("§5 uç kapıları (yapısal)");
  const wr = readFileSync(path.join(__dirname, "../src/routes/weft-spec.routes.ts"), "utf8");
  const ir = readFileSync(path.join(__dirname, "../src/routes/item.routes.ts"), "utf8");
  check("§5a attach-to-item warpspec:write + item:write arkasında", /router\.post\("\/attach-to-item", requirePermission\("warpspec:write"\), requirePermission\("item:write"\)/.test(wr));
  check("§5b attach gövdesi strict", /attachBody = z\.object\([\s\S]*?\}\)\.strict\(\)/.test(wr));
  check("§5c POST /api/items taslak varsa dokuma + warpspec:write kapısından geçer", /router\.post\("\/",[^\n]*weftDraftNeedsDokuma/.test(ir) && /requireDokumaEnabled\(req, res, [\s\S]{0,80}requireWarpWrite/.test(ir));
}

async function cleanup(): Promise<void> {
  const t = async (f: () => Promise<unknown>): Promise<void> => { await f().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  const extra = await prisma.item.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } });
  const items = [...new Set([...ids.items, ...extra.map((i) => i.id)])];
  const weft = (await prisma.weftSpec.findMany({ where: { code: { startsWith: TAG } }, select: { id: true } })).map((w) => w.id);
  await t(() => prisma.item.updateMany({ where: { id: { in: items } }, data: { weftSpecId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: weft } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: items } } }));
}

main()
  .catch((e) => { fail++; console.error("  ✗ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
