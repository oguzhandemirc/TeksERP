// =============================================================================
// BEKÇİ — D4-F1 müşteri barkodu modeli + tek okutma boğazı + bağla ucu (DALGA4 §7, §13 D4-F1)
// Çalıştır: npx tsx scripts/run-all-tests.ts musteri_barkodu
// =============================================================================
// §AST ⭐ `rollCustomerCode` üzerinde `code` ile okuma / ham SQL yalnız `roll-scan-resolve.helper.ts`te
//      (ikinci çözücü yazılamaz); üç uygulama yeri (`findRollByBarcode` · `scanIntoSack` · `resolveExact`)
//      boğazı çağırır; helper başlığı kalan okutma çağrılarını [İÇ]/[AÇILMALI] etiketiyle listeler.
// §1 ⭐ OFF (varsayılan): üç okutma noktası bugünkü yanıtı verir — iç barkod yanıtı ON ile bayt-aynı,
//      müşteri kodu okutması bugünkü 404/"bulunamadı"/fan-out'a düşer; yanıtta `matchedBy` yok.
// §2 bağla ucu: sahipsiz top 400 ROLL_NOT_EMANET · iç seriye benzeyen kod 409 CUSTOMER_CODE_COLLIDES ·
//      başka topun barkodu 409 COLLIDES · aynı müşteride aktif kod 409 CUSTOMER_CODE_TAKEN ·
//      topta ikinci kod 409 ROLL_CUSTOMER_CODE_EXISTS · ⭐ aynı token iki istek → tek satır + replay.
// §3 ⭐ ON: müşteri kodu üç noktada topa çözülür (`matchedBy: CUSTOMER_CODE`).
// §4 ⭐ ON: iç barkod HER ZAMAN önce (eski veride iç barkoda eşit müşteri kodu olsa bile).
// §5 ⭐ ON: iki müşteride aynı kod → 409 CUSTOMER_CODE_AMBIGUOUS + 2 aday (findRollByBarcode · scanIntoSack);
//      aramada sessiz seçim yok (hızlı yol yok).
// §6 kaldır: sebep zorunlu (400) · damga + yeniden bağlama · kaldırılmış token replay'i 409 · ikinci kaldırma 409.
// §7 ⭐ DB seddi: çift aktif insert 23505 (müşteri+kod · top) · boş kod CHECK · damgalı satır tekilliğe girmez.
// §8 ayar: geçersiz değer 400 (Türkçe).
// Negatif sondalar (elle, PR gövdesinde): helper'da iç barkod önceliği ters çevrilince §4 ❌ ·
// `src/services/` altına `rollCustomerCode.findFirst({ where: { code } })` yazılınca §AST ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { CustomerCodeSource, ItemType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { ShippingService } from "../src/services/shipping.service";
import { searchService } from "../src/services/search.service";
import { RollCustomerCodeService } from "../src/services/roll-customer-code.service";
import { generateRollBarcodeTx } from "../src/services/helpers/roll-barcode.helper";
import { classifyScannedCode } from "../src/services/helpers/series-classifier.helper";
import { SETTING_KEYS, invalidateFeatureFlagsCache, systemSettingService } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function hata(p: Promise<unknown>): Promise<{ status: number | null; code: unknown; details: Record<string, unknown>; msg: string }> {
  try {
    await p;
    return { status: null, code: null, details: {}, msg: "" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: Record<string, unknown>; message?: string };
    return { status: err.statusCode ?? -1, code: err.details?.code ?? null, details: err.details ?? {}, msg: err.message ?? String(e) };
  }
}

// ── §AST ─────────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
const HELPER = "services/helpers/roll-scan-resolve.helper.ts";
const READ_METHODS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "groupBy", "aggregate"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function whereHasCode(arg: ts.Expression | undefined): boolean {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return arg !== undefined; // dinamik argüman: ölçülemez → ihlal say
  for (const p of arg.properties) {
    const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
    if (name !== "where") continue;
    if (!ts.isPropertyAssignment(p)) return true;
    const w = p.initializer;
    if (!ts.isObjectLiteralExpression(w)) return true;
    return w.properties.some((q) => q.name && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name)) && q.name.text === "code");
  }
  return false;
}

function astSection(): void {
  const violations: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (rel === HELPER) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("rollCustomerCode") && !text.includes("roll_customer_codes")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = node.expression.expression;
        if (READ_METHODS.has(method) && ts.isPropertyAccessExpression(target) && target.name.text === "rollCustomerCode" && whereHasCode(node.arguments[0])) {
          violations.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} rollCustomerCode.${method}({ where: { code } })`);
        }
      }
      if ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) && node.getText().includes("roll_customer_codes")) {
        violations.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ham SQL roll_customer_codes`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  check("§AST ⭐ müşteri kodu ile okuma yalnız tek boğazda (ikinci çözücü yok)", violations.length === 0, violations.join(" · "));

  const uses = (rel: string, fn: string): boolean => {
    const text = readFileSync(join(SRC, rel), "utf8");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (node: ts.Node): void => {
      const named = (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === fn;
      if (named && node.getText().includes("resolveRollByScanCode(")) found = true;
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  };
  check("§AST uygulama yerleri boğazı çağırır (findRollByBarcode · scanIntoSack · resolveExact)",
    uses("services/inventory.service.ts", "findRollByBarcode") && uses("services/shipping.service.ts", "scanIntoSack") && uses("services/search.service.ts", "resolveExact"));

  // Envanter: `normalizeScanCode(` gerçek çağrısı olan her dosya (uygulama yerleri hariç) helper başlığında anılır.
  const header = readFileSync(join(SRC, HELPER), "utf8").split("// ====")[2] ?? "";
  // Uygulama yerleri + tanım + bağlama yazarı (kodu YAZARKEN normalize eder, okutma çözmez).
  const applied = new Set(["services/inventory.service.ts", "services/shipping.service.ts", "services/search.service.ts", "utils/code-format.ts", "services/roll-customer-code.service.ts"]);
  const missing: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    if (rel === HELPER) continue;
    const text = readFileSync(file, "utf8");
    if (!/normalizeScanCode\(/.test(text)) continue;
    const short = rel.replace(/^services\//, "");
    const tagged = header.split("\n").some((l) => l.includes(`${short}:`) && /\[(İÇ|AÇILMALI)\]|sınıflandırıcının kendisi/.test(l));
    if (!applied.has(rel) && !tagged) missing.push(rel);
    if (rel === "services/inventory.service.ts" && !header.includes("inventory.service.ts:")) missing.push(rel);
  }
  check("§AST kalan okutma çağrıları helper başlığında etiketli", missing.length === 0, missing.join(", "));
}

// ── DB bölümleri ────────────────────────────────────────────────────────────
const inventory = new InventoryService();
const shipping = new ShippingService();
const SEARCH_PERMS = ["roll:read", "shipping:read", "order:read", "workorder:read"];

async function setLookup(on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP },
    create: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP, value: on, description: "TEST musteri_barkodu" },
    update: { value: on },
  });
  invalidateFeatureFlagsCache();
}

async function main(): Promise<void> {
  astSection();

  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36).toUpperCase();
  const P = `TEST-MKB-${STAMP}`;
  const actor = await testActorId();
  const fx = { customerIds: [] as string[], rollIds: [] as string[], sackIds: [] as string[], itemId: null as string | null };
  const saved = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP } });

  try {
    const item = await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST MKB kumaş ${STAMP}`, itemType: ItemType.FABRIC }, select: { id: true } });
    fx.itemId = item.id;
    const mkCust = async (tag: string) => {
      const c = await prisma.customer.create({ data: { code: `${P}-${tag}`.slice(0, 32), name: `TEST MKB ${tag} ${STAMP}` }, select: { id: true } });
      fx.customerIds.push(c.id);
      return c.id;
    };
    const A = await mkCust("A");
    const B = await mkCust("B");
    const mkRoll = async (owner: string | null) => {
      const barcode = await generateRollBarcodeTx(prisma as never, "H");
      const r = await prisma.roll.create({ data: { itemId: item.id, initialQty: 50, currentQty: 50, ownerCustomerId: owner, barcode }, select: { id: true, barcode: true } });
      fx.rollIds.push(r.id);
      return { id: r.id, barcode: r.barcode! };
    };
    const rA1 = await mkRoll(A);
    const rA2 = await mkRoll(A);
    const rB1 = await mkRoll(B);
    const rNone = await mkRoll(null);
    const rLegacy = await mkRoll(A);
    const CODE = `MK${STAMP}01`;
    const SHARED = `MK${STAMP}77`;
    check("ön koşul: test kodları bizim serimize uymuyor", classifyScannedCode(CODE) === null && classifyScannedCode(SHARED) === null);
    check("ön koşul: top barkodu ROLL sınıfında", classifyScannedCode(rA1.barcode)?.kind === "ROLL");

    // ── §2 bağla ucu ──
    const t1 = randomUUID();
    const b1 = await RollCustomerCodeService.bind(rA1.id, { code: CODE.toLowerCase(), clientToken: t1 }, actor);
    check("§2 bağlandı (kod normalize: büyük harf, kaynak BOUND_LABEL, sahibin müşterisi)",
      b1.success && b1.data?.code === CODE && b1.data?.source === CustomerCodeSource.BOUND_LABEL && b1.data?.customerId === A);
    const [r1, r2] = await Promise.all([
      RollCustomerCodeService.bind(rA1.id, { code: CODE, clientToken: t1 }, actor),
      RollCustomerCodeService.bind(rA1.id, { code: CODE, clientToken: t1 }, actor),
    ]);
    const rowsT1 = await prisma.rollCustomerCode.count({ where: { clientToken: t1 } });
    check("§2 ⭐ aynı token iki istek → tek satır + replay", rowsT1 === 1 && r1.data?.id === b1.data?.id && r2.data?.id === b1.data?.id && (r1 as { idempotent?: boolean }).idempotent === true);
    const coll = await hata(RollCustomerCodeService.bind(rA1.id, { code: "XX" + CODE, clientToken: t1 }, actor));
    check("§2 aynı token başka kod → 409 CLIENT_TOKEN_COLLISION", coll.status === 409 && coll.code === "CLIENT_TOKEN_COLLISION", String(coll.code));
    const none = await hata(RollCustomerCodeService.bind(rNone.id, { code: `MK${STAMP}02`, clientToken: randomUUID() }, actor));
    check("§2 sahipsiz top → 400 ROLL_NOT_EMANET", none.status === 400 && none.code === "ROLL_NOT_EMANET", String(none.code));
    const sackLike = `CV${new Date().toISOString().slice(2, 10).replace(/-/g, "").replace(/(\d\d)(\d\d)(\d\d)/, "$3$2$1")}0001`;
    const ours = await hata(RollCustomerCodeService.bind(rA2.id, { code: rB1.barcode, clientToken: randomUUID() }, actor));
    check("§2 iç seriye benzeyen kod (top barkodu biçimi) → 409 CUSTOMER_CODE_COLLIDES", ours.status === 409 && ours.code === "CUSTOMER_CODE_COLLIDES", String(ours.code));
    if (classifyScannedCode(sackLike)) {
      const sk = await hata(RollCustomerCodeService.bind(rA2.id, { code: sackLike, clientToken: randomUUID() }, actor));
      check("§2 çuval biçimli kod → 409 CUSTOMER_CODE_COLLIDES", sk.status === 409 && sk.code === "CUSTOMER_CODE_COLLIDES", String(sk.code));
    }
    const taken = await hata(RollCustomerCodeService.bind(rA2.id, { code: CODE, clientToken: randomUUID() }, actor));
    check("§2 aynı müşteride aktif kod → 409 CUSTOMER_CODE_TAKEN", taken.status === 409 && taken.code === "CUSTOMER_CODE_TAKEN", `${taken.code} ${taken.msg}`);
    const second = await hata(RollCustomerCodeService.bind(rA1.id, { code: `MK${STAMP}03`, clientToken: randomUUID() }, actor));
    check("§2 topta ikinci aktif kod → 409 ROLL_CUSTOMER_CODE_EXISTS", second.status === 409 && second.code === "ROLL_CUSTOMER_CODE_EXISTS", `${second.code} ${second.msg}`);
    const bad = await hata(RollCustomerCodeService.bind(rA2.id, { code: "  ", clientToken: randomUUID() }, actor));
    check("§2 boş kod → 400 (Türkçe)", bad.status === 400 && /boş/.test(bad.msg), bad.msg);

    // ── §1 OFF: bugünkü yanıt ──
    await setLookup(false);
    const sackOff = (await shipping.openSack({})).data as { id: string };
    fx.sackIds.push(sackOff.id);
    const offHit = await inventory.findRollByBarcode(rA1.barcode);
    const offMiss = await inventory.findRollByBarcode(CODE);
    check("§1 ⭐ OFF findRollByBarcode: müşteri kodu bugünkü 'Barkod bulunamadı'",
      JSON.stringify(offMiss) === JSON.stringify({ success: false, data: null, message: "Barkod bulunamadı" }));
    check("§1 OFF findRollByBarcode iç barkod: matchedBy yok", offHit.success && !("matchedBy" in (offHit.data as object)));
    const offSack = await hata(shipping.scanIntoSack({ sackId: sackOff.id, barcode: CODE }, actor));
    check("§1 ⭐ OFF scanIntoSack: müşteri kodu bugünkü 404 metni", offSack.status === 404 && offSack.msg === `Top/kartela bulunamadı: ${CODE}`, offSack.msg);
    const offSearch = await searchService.search(CODE, { permissions: SEARCH_PERMS });
    check("§1 ⭐ OFF arama: müşteri kodu hızlı yola girmez (exact null)", offSearch.exact === null);
    const offSearchHit = await searchService.search(rA1.barcode, { permissions: SEARCH_PERMS });

    // ── §3 ON: müşteri kodu çözülür; iç barkod yanıtı OFF ile bayt-aynı ──
    await setLookup(true);
    const onHit = await inventory.findRollByBarcode(rA1.barcode);
    check("§1 ⭐ iç barkod yanıtı ON/OFF bayt-aynı (findRollByBarcode)", JSON.stringify(onHit) === JSON.stringify(offHit));
    const onSearchHit = await searchService.search(rA1.barcode, { permissions: SEARCH_PERMS });
    check("§1 ⭐ iç barkod yanıtı ON/OFF bayt-aynı (arama)", JSON.stringify(onSearchHit) === JSON.stringify(offSearchHit) && offSearchHit.exact?.row.id === rA1.id);
    await setLookup(false);
    const offSackHit = await shipping.scanIntoSack({ sackId: sackOff.id, barcode: rA1.barcode }, actor);
    await prisma.roll.update({ where: { id: rA1.id }, data: { sackId: null } });
    await setLookup(true);
    const onSackHit = await shipping.scanIntoSack({ sackId: sackOff.id, barcode: rA1.barcode }, actor);
    check("§1 ⭐ iç barkod yanıtı ON/OFF bayt-aynı (çuvala okutma)", JSON.stringify(onSackHit) === JSON.stringify(offSackHit) && (offSackHit.data as { rollId?: string }).rollId === rA1.id && !("matchedBy" in (onSackHit.data as object)));
    await prisma.roll.update({ where: { id: rA1.id }, data: { sackId: null } });

    const onCode = await inventory.findRollByBarcode(CODE.toLowerCase());
    const onData = onCode.data as unknown as { id: string; matchedBy?: string; customerCode?: string };
    check("§3 ⭐ ON findRollByBarcode müşteri koduyla topu bulur", onCode.success && onData.id === rA1.id && onData.matchedBy === "CUSTOMER_CODE" && onData.customerCode === CODE);
    const onSack = await shipping.scanIntoSack({ sackId: sackOff.id, barcode: CODE }, actor);
    const onSackData = onSack.data as { rollId?: string; matchedBy?: string };
    check("§3 ⭐ ON scanIntoSack müşteri koduyla topu çuvala ekler", onSackData.rollId === rA1.id && onSackData.matchedBy === "CUSTOMER_CODE");
    await prisma.roll.update({ where: { id: rA1.id }, data: { sackId: null } });
    const onSearch = await searchService.search(CODE, { permissions: SEARCH_PERMS });
    check("§3 ⭐ ON arama müşteri koduyla hızlı yoldan topu döner", onSearch.exact?.row.id === rA1.id && onSearch.exact?.matchedBy === "CUSTOMER_CODE");

    // ── §4 iç barkod önce: eski veride (kapı öncesi) başka topun barkoduna eşit müşteri kodu ──
    await prisma.rollCustomerCode.create({ data: { rollId: rLegacy.id, customerId: A, code: rB1.barcode, source: CustomerCodeSource.BOUND_LABEL, clientToken: randomUUID() } });
    const pri = await inventory.findRollByBarcode(rB1.barcode);
    const priData = pri.data as unknown as { id: string; matchedBy?: string };
    check("§4 ⭐ iç barkod müşteri kodundan önce (findRollByBarcode)", priData.id === rB1.id && priData.matchedBy === undefined, `bulunan=${priData.id === rLegacy.id ? "müşteri kodlu top" : priData.id}`);
    const priSearch = await searchService.search(rB1.barcode, { permissions: SEARCH_PERMS });
    check("§4 ⭐ iç barkod müşteri kodundan önce (arama)", priSearch.exact?.row.id === rB1.id && priSearch.exact?.matchedBy === undefined);
    await prisma.rollCustomerCode.updateMany({ where: { rollId: rLegacy.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "TEST eski veri sondası" } });

    // ── §5 belirsizlik ──
    await RollCustomerCodeService.bind(rA2.id, { code: SHARED, clientToken: randomUUID() }, actor);
    await RollCustomerCodeService.bind(rB1.id, { code: SHARED, clientToken: randomUUID() }, actor);
    const amb = await hata(inventory.findRollByBarcode(SHARED));
    const cands = (amb.details.candidates ?? []) as { rollId: string; customerId: string }[];
    check("§5 ⭐ iki müşteride aynı kod → 409 CUSTOMER_CODE_AMBIGUOUS + 2 aday",
      amb.status === 409 && amb.code === "CUSTOMER_CODE_AMBIGUOUS" && cands.length === 2 && new Set(cands.map((c) => c.rollId)).size === 2 && cands.some((c) => c.customerId === B));
    const ambSack = await hata(shipping.scanIntoSack({ sackId: sackOff.id, barcode: SHARED }, actor));
    check("§5 ⭐ scanIntoSack belirsizlikte 409 ve topa dokunmaz",
      ambSack.status === 409 && ambSack.code === "CUSTOMER_CODE_AMBIGUOUS" && (await prisma.roll.count({ where: { id: { in: [rA2.id, rB1.id] }, sackId: sackOff.id } })) === 0);
    const ambSearch = await searchService.search(SHARED, { permissions: SEARCH_PERMS });
    check("§5 arama belirsiz kodda sessiz seçim yapmaz", ambSearch.exact === null);

    // ── §6 kaldır ──
    const noReason = await hata(RollCustomerCodeService.revoke(rA1.id, {}, actor));
    check("§6 kaldırma sebebi zorunlu → 400", noReason.status === 400, noReason.msg);
    const rv = await RollCustomerCodeService.revoke(rA1.id, { reason: "Etiket yırtıldı" }, actor);
    const stamped = await prisma.rollCustomerCode.findUnique({ where: { id: b1.data!.id }, select: { revokedAt: true, revokeReason: true, revokedById: true } });
    check("§6 kaldırma damgalar (satır silinmez)", rv.success && stamped?.revokedAt !== null && stamped?.revokeReason === "Etiket yırtıldı" && stamped?.revokedById === actor);
    const again = await hata(RollCustomerCodeService.revoke(rA1.id, { reason: "İkinci deneme" }, actor));
    check("§6 aktif kod yokken kaldırma → 409 CUSTOMER_CODE_NOT_ACTIVE", again.status === 409 && again.code === "CUSTOMER_CODE_NOT_ACTIVE");
    const replayDead = await hata(RollCustomerCodeService.bind(rA1.id, { code: CODE, clientToken: t1 }, actor));
    check("§6 kaldırılmış kaydın token replay'i → 409 CUSTOMER_CODE_REVOKED", replayDead.status === 409 && replayDead.code === "CUSTOMER_CODE_REVOKED", String(replayDead.code));
    const rebind = await RollCustomerCodeService.bind(rA1.id, { code: CODE, clientToken: randomUUID() }, actor);
    const history = await prisma.rollCustomerCode.count({ where: { rollId: rA1.id } });
    check("§6 değiştirme = damga + yeni satır (aynı kod yeniden bağlanır, geçmiş 2 satır)", rebind.success && history === 2);
    const offAfter = await inventory.findRollByBarcode(CODE);
    check("§6 yeniden bağlanan kod çözülür", (offAfter.data as unknown as { id: string }).id === rA1.id);

    // ── §7 DB seddi ──
    const rawInsert = async (rollId: string, customerId: string, code: string): Promise<string> => {
      try {
        await prisma.$executeRaw`INSERT INTO roll_customer_codes (id, "rollId", "customerId", code, source, "clientToken", "updatedAt")
          VALUES (${randomUUID()}::uuid, ${rollId}::uuid, ${customerId}::uuid, ${code}, 'BOUND_LABEL'::"CustomerCodeSource", ${randomUUID()}::uuid, now())`; // tz-ok: test satırı
        return "OK";
      } catch (e) {
        return String((e as Error).message) + JSON.stringify((e as { meta?: unknown }).meta ?? {});
      }
    };
    const dupCust = await rawInsert(rNone.id, A, CODE);
    check("§7 ⭐ müşteri+kod çift aktif insert → 23505", /23505|customer_code_active_uq|Unique constraint/i.test(dupCust), dupCust.slice(0, 160));
    const dupRoll = await rawInsert(rA1.id, B, `MK${STAMP}09`);
    check("§7 ⭐ topta çift aktif insert → 23505", /23505|roll_active_uq|Unique constraint/i.test(dupRoll), dupRoll.slice(0, 160));
    const empty = await rawInsert(rNone.id, B, " ");
    check("§7 boş kod CHECK reddi", /roll_customer_codes_code_ck|23514|check constraint/i.test(empty), empty.slice(0, 160));
    const revokedOk = await prisma.rollCustomerCode.count({ where: { rollId: rA1.id, code: CODE } });
    check("§7 damgalı satır tekilliğe girmez (aynı top+kod 2 satır)", revokedOk === 2);

    // ── §8 ayar ──
    const badFlag = await hata(systemSettingService.setFeatureFlags({ scanCustomerCodeLookupEnabled: "EVET" } as never, actor));
    check("§8 ayar: boolean olmayan değer 400", badFlag.status === 400 && /boolean/.test(badFlag.msg), badFlag.msg);
  } finally {
    if (saved) await prisma.systemSetting.update({ where: { key: saved.key }, data: { value: saved.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP } });
    invalidateFeatureFlagsCache();
    if (fx.rollIds.length) {
      await prisma.rollCustomerCode.deleteMany({ where: { rollId: { in: fx.rollIds } } });
      await prisma.roll.updateMany({ where: { id: { in: fx.rollIds } }, data: { sackId: null } });
    }
    if (fx.sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: fx.sackIds } } });
    if (fx.rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } });
    if (fx.customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } });
    if (fx.itemId) await prisma.item.deleteMany({ where: { id: fx.itemId } });
  }
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  });
