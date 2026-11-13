// =============================================================================
// BEKÇİ — PATRON OKUMA UCU (`/api/patron/v1/*`, V3a 2026-11-13)
// =============================================================================
// Patron uygulaması bulut kopyası yerine ERP'yi okur; yanıtlar bulutun tel tipleriyle AYNI olmalı
// (tek kaynak `patron/sunucu/src/wire/api.ts` — burada yalnız DOSYA olarak okunur, içe aktarılmaz).
//   §1 statik: route toplu kapısı (verifyToken + patron-app:login), yazma ucu yok · ERP→bulut eşlemesinde her
//      ERP kodu katalogda, her bulut kodu okuma kodu (yaz/hesap yok) · küme izinleri bulut katalog özetiyle
//      aynı · arama seçenekleri ve kimlik süzgeçleri bulut `LIST_SEARCH`/`LIST_ID_FILTERS`le aynı
//   §2 HTTP biçim aynası: oturum / liste / kayıt / anlık yanıt anahtarları api.ts arayüzleriyle birebir
//   §3 izin kapısı: patron-app:login yok → 403 · küme izni yok → 403 · alt satır izni yok → anahtar yok ·
//      tanınmayan küme 404 · beyansız süzgeç 400
//   §4 süzme/sayfalama: gecikmiş süzgeci ↔ bellek yüklemi (boğaz-ikiz), imleç ikinci sayfayı tekrarsız verir
//   §5 önbellek yetkiyi delmez: aynı kullanıcı önbellekteki kümeye izni kalkınca 403 alır
//   §6 modül kapısı (KÜME BAŞINA, router kapısı yok): ön muhasebe kapalı → `ozet-finans` 403 MODULE_DISABLED (lisans
//      tavanıysa LICENSE_MODULE) · üretim kapalı → `ozet.uretim` 403 · ticaret kapalı → kümeler açık (ticaret kümesi yok)
//   §1h/§1i küme kapısının kapsamı: ticaret tablosu okuyan küme TAM OLARAK `TICARET_SETS` (fiyat kartı) ve ticaret
//      kapısını taşır · her kümenin bütün kapıları `MODULE_GATES`te (`test_ticaret_regime_gate` muafı ve
//      `test_production_regime_gate` §6 bu ölçüme yaslanır)
//   §7 (V3c) sunulan HER küme tam izinli patronla 200 + bulut biçimi (Page/ProjectionRecord · Snapshot)
//   §8 (V3c) çözücülü süzgeç: birleşmiş carinin faturası hedef hesap süzgecinde, kaynak süzgecinde YOK · anahtar
//      süzgeci (kategoriAnahtari) beyansız kümede 400, biçimsiz değerde boş · yeni aramalar (urun, teklif) ·
//      modül kapısı yeni kümelerde (kasa, teklif, is-emri, fiyat ← ticaret)
// NEGATİF SONDA (✓B, dosya dışı mutasyon, md5 ile geri): sonuçlar harita satırında ve commit mesajında.
// Gerekçe: aşamalı geçişte uygulama yalnız adres değiştirir — biçim/izin farkı sahada sessiz boş ekrandır.
// Koşum: npx tsx scripts/run-all-tests.ts patron_okuma_ucu   (kendi _test DB'si; ayar yazar → hedef DB kapısı)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import ts from "typescript";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { PERMISSION_CATALOG, PATRON_LOGIN_PERMISSION } from "../src/constants/permission-catalog";
import { CLOUD_READ_PERMISSIONS, SNAPSHOT_PROJECTIONS } from "../src/cloud-sync/projections";
import { ERP_TO_CLOUD, PATRON_READ_SETS, PATRON_RECORD_SETS, PATRON_SNAPSHOT_SETS, TICARET_SETS, patronSet } from "../src/services/patron-read/izin-esleme";
import { SEARCH, idFiltersOf } from "../src/services/patron-read/kayit-sayfasi";
import { clearPatronSnapshotCache, getSnapshot } from "../src/services/patron-read/patron-read.service";
import { daysPastDeadline, isDeadlineOpenStatus } from "../src/services/helpers/order-deadline.helper";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const API_TS = "patron/sunucu/src/wire/api.ts";
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// ── api.ts AST okuyucuları (arayüz üyeleri + sabit nesne değerleri) ──
const apiSrc = ts.createSourceFile("api.ts", read(API_TS), ts.ScriptTarget.Latest, true);
function iface(name: string): { all: string[]; required: string[] } {
  const all: string[] = [], required: string[] = [];
  apiSrc.forEachChild((n) => {
    if (!ts.isInterfaceDeclaration(n) || n.name.text !== name) return;
    for (const m of n.members) if (ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name)) { all.push(m.name.text); if (!m.questionToken) required.push(m.name.text); }
  });
  return { all, required };
}
function literal(e: ts.Expression): unknown {
  if (ts.isStringLiteral(e)) return e.text;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(e)) return e.elements.map(literal);
  if (ts.isObjectLiteralExpression(e)) return Object.fromEntries(e.properties.filter(ts.isPropertyAssignment).map((p) => [ts.isStringLiteral(p.name) ? p.name.text : (p.name as ts.Identifier).text, literal(p.initializer)]));
  return undefined;
}
function constValue(name: string): unknown {
  let out: unknown;
  apiSrc.forEachChild((n) => {
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) out = literal(d.initializer);
  });
  return out;
}
const shapeOk = (obj: unknown, name: string): [boolean, string] => {
  const { all, required } = iface(name);
  const keys = Object.keys((obj ?? {}) as object);
  const extra = keys.filter((k) => !all.includes(k)), missing = required.filter((k) => !keys.includes(k));
  return [all.length > 0 && extra.length === 0 && missing.length === 0, `${name}: fazla [${extra}] eksik [${missing}]`];
};

function statik(): void {
  console.log("\n=== §1 statik ===");
  const route = read("Teks-Erp/src/routes/patron-read.routes.ts");
  const firstUse = route.indexOf("router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION))");
  const firstGet = route.indexOf("router.get(");
  check("§1a toplu kapı verifyToken + patron-app:login, ilk uçtan ÖNCE", firstUse > 0 && firstGet > firstUse);
  check("§1b yazma ucu YOK (post/put/patch/delete)", !/router\.(post|put|patch|delete)\(/.test(route));
  const catalog = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));
  const cloudRead = new Set<string>(CLOUD_READ_PERMISSIONS);
  const badErp = ERP_TO_CLOUD.filter((r) => !catalog.has(r.erp)).map((r) => r.erp);
  const badCloud = ERP_TO_CLOUD.flatMap((r) => r.cloud).filter((c) => !cloudRead.has(c));
  check("§1c eşlemedeki her ERP kodu izin kataloğunda", badErp.length === 0, badErp.join(","));
  check("§1d eşleme yalnız bulut OKUMA kodu verir (yaz/hesap yok)", badCloud.length === 0 && ERP_TO_CLOUD.length >= 8, badCloud.join(","));
  const ozet = JSON.parse(read("patron/sunucu/src/catalog/katalog-ozeti.json")) as { ROOT_PROJECTIONS: Array<{ name: string; kind: string; permissions: string[]; subRows?: string[] }> };
  const diffs: string[] = [];
  for (const name of PATRON_READ_SETS) {
    const def = patronSet(name, "KAYIT") ?? patronSet(name, "ANLIK");
    const cloud = ozet.ROOT_PROJECTIONS.find((r) => r.name === name);
    if (!def || !cloud) { diffs.push(`${name}: yok`); continue; }
    if (!sameSet(def.requires, cloud.permissions)) diffs.push(`${name}: ${def.requires} ≠ ${cloud.permissions}`);
    const subs = Object.entries(def.subRows ?? {}).filter(([, v]) => v).map(([k]) => k);
    if (!sameSet(subs, cloud.subRows ?? [])) diffs.push(`${name} alt satır: ${subs} ≠ ${cloud.subRows ?? []}`);
    if ((def.kind === "ANLIK") !== (cloud.kind === "ANLIK")) diffs.push(`${name}: tür`);
  }
  check("§1e küme izinleri + alt satırları bulut katalog özetiyle birebir", diffs.length === 0 && PATRON_READ_SETS.length >= 45, diffs.join(" · ") || `${PATRON_READ_SETS.length} küme`);
  const cloudSearch = constValue("LIST_SEARCH") as Record<string, { alanlar: string[]; suzgec: { secenekler: Array<{ deger: string; alan: string; esit: unknown }> } | null }>;
  const sDiffs: string[] = [];
  for (const [name, spec] of Object.entries(SEARCH)) {
    const c = cloudSearch?.[name];
    if (!c) { sDiffs.push(`${name}: bulutta yok`); continue; }
    if (!sameSet(spec.alanlar, c.alanlar)) sDiffs.push(`${name} alanlar`);
    const mine = spec.secenekler.map((o) => `${o.deger}=${o.alan}:${String(o.esit)}`);
    const theirs = (c.suzgec?.secenekler ?? []).map((o) => `${o.deger}=${o.alan}:${String(o.esit)}`);
    if (!sameSet(mine, theirs)) sDiffs.push(`${name} seçenek ${mine} ≠ ${theirs}`);
  }
  const servedSearch = PATRON_READ_SETS.filter((n) => cloudSearch && n in cloudSearch);
  check("§1f arama/süzgeç seçenekleri bulut LIST_SEARCH ile birebir (sunulan her aranabilir küme)", sDiffs.length === 0 && sameSet(servedSearch, Object.keys(SEARCH)), sDiffs.join(" · ") || Object.keys(SEARCH).join(","));
  const cloudIds = constValue("LIST_ID_FILTERS") as Record<string, string[]>;
  const iDiffs: string[] = [];
  for (const name of PATRON_READ_SETS) {
    const def = patronSet(name, "KAYIT");
    if (!def) continue;
    const theirs = Object.entries(cloudIds ?? {}).filter(([, v]) => v.includes(name)).map(([k]) => k);
    if (!sameSet(idFiltersOf(def.projection!), theirs)) iDiffs.push(`${name}: ${idFiltersOf(def.projection!)} ≠ ${theirs}`);
  }
  check("§1g kimlik süzgeçleri bulut LIST_ID_FILTERS ile birebir", iDiffs.length === 0 && cloudIds !== undefined, iDiffs.join(" · "));
  // Ticaret kapısı küme başınadır: ticaret tablosu okuyan küme `TICARET_SETS`te OLMALI (ve ticaret kapısını taşımalı);
  // listede olup okumayan küme de düşer (gereksiz kapı patron ekranını boşuna kapatır). Ticaret bekçisi muafı buna yaslanır.
  const TICARET_TABLE = /purchase_order|stock_count|item_price|PurchaseOrder|StockCount|ItemPrice/;
  const ticaretReaders: string[] = [];
  for (const name of PATRON_READ_SETS) {
    const rec = patronSet(name, "KAYIT"), snap = patronSet(name, "ANLIK");
    const src = rec ? rec.projection : SNAPSHOT_PROJECTIONS.find((s) => s.name === snap?.builder);
    if (!src || TICARET_TABLE.test(JSON.stringify(src))) ticaretReaders.push(name);
  }
  const ungatedTicaret = ticaretReaders.filter((n) => !(patronSet(n, "KAYIT") ?? patronSet(n, "ANLIK"))?.gates.includes("ticaret.enabled"));
  check("§1h ticaret tablosu okuyan küme = TICARET_SETS ve hepsi ticaret kapısında (alış siparişi · sayım · fiyat kartı)",
    sameSet(ticaretReaders, [...TICARET_SETS]) && ungatedTicaret.length === 0 && ticaretReaders.includes("fiyat"), `okuyan [${ticaretReaders}] kapısız [${ungatedTicaret}]`);
  const gateKeys = [...route.matchAll(/"([a-z]+\.enabled)"\s*:\s*require\w+Enabled\b/g)].map((m) => m[1]!);
  const served = PATRON_READ_SETS.map((n) => patronSet(n, "KAYIT") ?? patronSet(n, "ANLIK"));
  const ungated = served.flatMap((d) => [...(d?.module ? [d.module] : []), ...(d?.gates ?? [])].filter((g) => !gateKeys.includes(g)).map((g) => `${d!.name}→${g}`));
  const lostModule = served.filter((d) => d?.module && !d.gates.includes(d.module)).map((d) => d!.name);
  check("§1i her kümenin modülü + kapıları MODULE_GATES'te adlı kapıya bağlı (üretim + ticaret dahil)",
    ungated.length === 0 && lostModule.length === 0 && gateKeys.includes("production.enabled") && gateKeys.includes("ticaret.enabled") && served.some((d) => d?.module === "production.enabled"),
    [...ungated, ...lostModule].join(",") || gateKeys.join(","));
}

type Reply = { status: number; body: { data?: Record<string, unknown> & { kayitlar?: Array<Record<string, unknown>> }; details?: { code?: string } } };

async function main(): Promise<void> {
  statik();
  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); return; }
  await reconcilePermissionCatalog();
  process.env.RATE_LIMIT_ENABLED = "false";
  const T = `TEST-POU-${Date.now()}`;
  const PASS = "Deneme-patron-oku-12345";
  const userIds: string[] = [];
  const made: { customer?: string; item?: string; orders: string[]; customers: string[]; caris: string[]; invoices: string[] } = { orders: [], customers: [], caris: [], invoices: [] };
  const finKey = SETTING_KEYS.FINANCE_ENABLED;
  const flagKeys = [finKey, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.EMANET_ENABLED];
  const flagsBefore = await prisma.systemSetting.findMany({ where: { key: { in: flagKeys } }, select: { key: true, value: true } });
  const setFlag = async (key: string, value: boolean) => {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    invalidateFeatureFlagsCache();
  };
  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = async (path: string, token?: string, method = "GET", body?: unknown): Promise<Reply> => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    try { return { status: r.status, body: JSON.parse(await r.text()) as Reply["body"] }; } catch { return { status: r.status, body: {} }; }
  };
  const makeUser = async (tag: string, codes: string[], clientType = "patron") => {
    const perms = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true } });
    if (perms.length !== codes.length) throw new Error(`fikstür izinleri eksik: ${codes}`);
    const u = await prisma.user.create({ data: { username: `${T}-${tag}`, passwordHash: await AuthService.hashPassword(PASS), fullName: `TEST patron oku ${tag}`, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } }, select: { id: true, username: true } });
    userIds.push(u.id);
    const r = await call("/auth/login", undefined, "POST", { username: u.username, password: PASS, clientType, confirmKick: true });
    const token = (r.body.data as { token?: string } | undefined)?.token;
    if (!token) throw new Error(`giriş başarısız ${tag}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return { id: u.id, username: u.username, token, codes };
  };
  try {
    const now = Date.now();
    made.customer = (await prisma.customer.create({ data: { code: `${T}-C`.slice(0, 32), name: `${T} CARİ`, contactName: "Yetkili Kişi" }, select: { id: true } })).id;
    made.item = (await prisma.item.create({ data: { code: `${T}-I`.slice(0, 32), name: `${T} KUMAŞ`, itemType: "FABRIC" }, select: { id: true } })).id;
    const mk = async (n: number, status: "APPROVED" | "COMPLETED", deadlineOffsetDays: number) => {
      const o = await prisma.order.create({ data: { orderNumber: `${T}-O${n}`, customerId: made.customer!, status, totalAmount: 1000 + n, orderDate: new Date(now - n * 60_000), deadline: new Date(now + deadlineOffsetDays * 86_400_000) }, select: { id: true } });
      made.orders.push(o.id);
      await prisma.orderLine.create({ data: { orderId: o.id, itemId: made.item!, quantity: 10, unitPrice: 5 } });
      return o.id;
    };
    const late = await mk(1, "APPROVED", -3), future = await mk(2, "APPROVED", 5), doneLate = await mk(3, "COMPLETED", -3);
    const boss = await makeUser("boss", [PATRON_LOGIN_PERMISSION, "order:read", "customer:read", "finance:read", "report:inventory", "workorder:read"]);
    const sales = await makeUser("sales", [PATRON_LOGIN_PERMISSION, "order:read"]);
    // Patron izni olmayan geçerli oturum (panel girişi) — uç 403 vermeli.
    const noPatron = await makeUser("nopatron", ["order:read"], "electron");

    console.log("\n=== §2 biçim aynası ===");
    const ot = await call("/patron/v1/oturum", boss.token);
    const okShape = (r: Reply, name: string, label: string) => { const [ok, why] = shapeOk(r.body.data, name); check(label, r.status === 200 && ok, `${r.status} ${why}`); };
    okShape(ot, "FacilityStatus", "§2a oturum = FacilityStatus");
    check("§2b oturum hesap = AccountSummary, izinler bulut kodları (finans → fiyat/kasa), yaz YOK",
      shapeOk(ot.body.data?.hesap, "AccountSummary")[0] && (ot.body.data?.hesap as { izinler: string[] }).izinler.includes("bulut:fiyat:oku") && !(ot.body.data?.hesap as { izinler: string[] }).izinler.some((c) => c.endsWith(":yaz")));
    const list = await call(`/patron/v1/veri/siparis?ara=${encodeURIComponent(T)}&limit=2`, boss.token);
    okShape({ status: list.status, body: { data: list.body.data } } as Reply, "Page", "§2c liste = Page");
    const rec0 = list.body.data?.kayitlar?.[0];
    check("§2d kayıt = ProjectionRecord (finans izinli → anahtar var)", shapeOk(rec0, "ProjectionRecord")[0] && rec0 !== undefined && "finans" in rec0, shapeOk(rec0, "ProjectionRecord")[1]);
    const one = await call(`/patron/v1/veri/siparis/${late}`, boss.token);
    okShape(one, "ProjectionRecord", "§2e tek kayıt = ProjectionRecord");
    check("§2f kayit fabrika tel satırı (id + siparisNo + türetilmiş musteriAdi)", (one.body.data?.kayit as Record<string, unknown> | undefined)?.siparisNo === `${T}-O1` && (one.body.data?.kayit as Record<string, unknown>)?.musteriAdi !== undefined);
    const snap = await call("/patron/v1/anlik/ozet.siparis", boss.token);
    okShape(snap, "Snapshot", "§2g anlık = Snapshot");
    check("§2h surum = üretim anı (ISO, şimdiye yakın)", Math.abs(Date.parse(String(snap.body.data?.surum)) - Date.now()) < 120_000);
    const lines = await call(`/patron/v1/veri/siparis-kalemi?siparisId=${late}`, boss.token);
    check("§2i kalem listesi siparisId süzgeciyle tek satır", lines.status === 200 && lines.body.data?.kayitlar?.length === 1);
    const me = await call("/auth/me", boss.token);
    check("§2j /auth/me patronReadSets = sunulan kümeler", sameSet(((me.body.data as Record<string, unknown> | undefined)?.patronReadSets as string[]) ?? [], PATRON_READ_SETS));

    console.log("\n=== §3 izin kapısı ===");
    check("§3a patron-app:login yok → 403", (await call("/patron/v1/oturum", noPatron.token)).status === 403);
    const salesOzet = await call("/patron/v1/anlik/stok-karnesi", sales.token);
    check("§3b küme izni yok → 403 PATRON_SET_FORBIDDEN", salesOzet.status === 403 && salesOzet.body.details?.code === "PATRON_SET_FORBIDDEN", `${salesOzet.status}`);
    const salesRec = await call(`/patron/v1/veri/siparis/${late}`, sales.token);
    check("§3c fiyat izni yok → kayıtta finans anahtarı YOK", salesRec.status === 200 && !("finans" in (salesRec.body.data ?? {})));
    const salesCari = await call(`/patron/v1/veri/cari-kart/${made.customer}`, sales.token);
    check("§3d cari izni yok → kisisel anahtarı YOK; boss'ta var", salesCari.status === 200 && !("kisisel" in (salesCari.body.data ?? {})) && "kisisel" in ((await call(`/patron/v1/veri/cari-kart/${made.customer}`, boss.token)).body.data ?? {}));
    check("§3e tanınmayan küme 404 (veri + anlık), sunulmayan bulut kümesi de 404", (await call("/patron/v1/veri/yok-boyle", boss.token)).status === 404 && (await call("/patron/v1/anlik/yok", boss.token)).status === 404 && (await call("/patron/v1/veri/ozet-finans", boss.token)).status === 404 && (await call("/patron/v1/anlik/siparis", boss.token)).status === 404);
    check("§3f beyansız süzgeç 400 (cari-kart?siparisId, bilinmeyen suzgec)", (await call(`/patron/v1/veri/cari-kart?siparisId=${late}`, boss.token)).status === 400 && (await call("/patron/v1/veri/siparis?suzgec=YOK", boss.token)).status === 400);
    check("§3g kimliksiz 401", (await call("/patron/v1/oturum")).status === 401);

    console.log("\n=== §4 süzme ve sayfalama ===");
    const lateList = await call(`/patron/v1/veri/siparis?ara=${encodeURIComponent(T)}&suzgec=GECIKMIS`, boss.token);
    const lateIds = (lateList.body.data?.kayitlar ?? []).map((r) => r.id as string);
    const db = await prisma.order.findMany({ where: { id: { in: made.orders } }, select: { id: true, status: true, deadline: true } });
    const memLate = db.filter((o) => isDeadlineOpenStatus(o.status) && daysPastDeadline(o.deadline, Date.now()) !== null).map((o) => o.id);
    check("§4a GECIKMIS süzgeci = bellek yüklemi (boğaz-ikiz)", sameSet(lateIds, memLate) && lateIds.includes(late) && !lateIds.includes(future) && !lateIds.includes(doneLate), `${lateIds.length}/${memLate.length}`);
    const p1 = await call(`/patron/v1/veri/siparis?ara=${encodeURIComponent(T)}&limit=2`, boss.token);
    const next = p1.body.data?.sonraki as string | null;
    const p2 = next ? await call(`/patron/v1/veri/siparis?ara=${encodeURIComponent(T)}&limit=2&imlec=${encodeURIComponent(next)}`, boss.token) : null;
    const all = [...(p1.body.data?.kayitlar ?? []), ...(p2?.body.data?.kayitlar ?? [])].map((r) => r.id as string);
    check("§4b imleç: 2 + 1, tekrar yok, sıra siparisTarihi DESC", all.length === 3 && new Set(all).size === 3 && all[0] === late && p2?.body.data?.sonraki === null, all.join(","));
    check("§4c durum süzgeci (COMPLETED)", ((await call(`/patron/v1/veri/siparis?ara=${encodeURIComponent(T)}&durum=COMPLETED`, boss.token)).body.data?.kayitlar ?? []).map((r) => r.id).join() === doneLate);

    console.log("\n=== §5 önbellek yetkiyi delmez ===");
    clearPatronSnapshotCache();
    const u = { userId: boss.id, username: boss.username, permissions: boss.codes };
    const first = await getSnapshot(u, "stok-karnesi");
    const again = await getSnapshot(u, "stok-karnesi");
    check("§5a ikinci çağrı önbellekten (aynı surum)", first.surum === again.surum);
    let denied = "";
    try { await getSnapshot({ ...u, permissions: [PATRON_LOGIN_PERMISSION] }, "stok-karnesi"); } catch (e) { denied = String((e as { details?: { code?: string } }).details?.code); }
    check("§5b aynı kullanıcı izni kalkınca önbellek varken 403", denied === "PATRON_SET_FORBIDDEN", denied);

    console.log("\n=== §6 modül kapısı ===");
    await setFlag(finKey, false);
    const off = await call("/patron/v1/anlik/ozet-finans", boss.token);
    check("§6a ön muhasebe kapalı → 403 MODULE_DISABLED|LICENSE_MODULE", off.status === 403 && ["MODULE_DISABLED", "LICENSE_MODULE"].includes(String(off.body.details?.code)), `${off.status} ${off.body.details?.code}`);
    check("§6b modülsüz küme etkilenmez (ozet.siparis 200)", (await call("/patron/v1/anlik/ozet.siparis", boss.token)).status === 200);
    await setFlag(finKey, true);
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, false);
    clearPatronSnapshotCache();
    const prodOff = await call("/patron/v1/anlik/ozet.uretim", boss.token);
    check("§6c üretim kapalı → ozet.uretim 403 MODULE_DISABLED|LICENSE_MODULE, ozet.siparis 200",
      prodOff.status === 403 && ["MODULE_DISABLED", "LICENSE_MODULE"].includes(String(prodOff.body.details?.code)) && (await call("/patron/v1/anlik/ozet.siparis", boss.token)).status === 200,
      `${prodOff.status} ${prodOff.body.details?.code}`);
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.TICARET_ENABLED, false);
    clearPatronSnapshotCache();
    const tic = await Promise.all(["/patron/v1/oturum", "/patron/v1/anlik/ozet.siparis", "/patron/v1/anlik/acik-siparis-karsilama", "/patron/v1/veri/siparis?limit=1"].map((u) => call(u, boss.token)));
    check("§6d ticaret kapalı → kümeler AÇIK (router düzeyi ticaret kapısı yok)", tic.every((r) => r.status === 200), tic.map((r) => r.status).join(","));
    await v3c({ call, makeUser, setFlag, T, made });
  } finally {
    for (const key of flagKeys) {
      const before = flagsBefore.find((f) => f.key === key);
      if (before) await prisma.systemSetting.update({ where: { key }, data: { value: before.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    invalidateFeatureFlagsCache();
    await prisma.invoice.deleteMany({ where: { id: { in: made.invoices } } });
    await prisma.cariAccount.updateMany({ where: { id: { in: made.caris } }, data: { mergedIntoId: null } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: made.caris } } });
    await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
    await prisma.orderLine.deleteMany({ where: { orderId: { in: made.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: made.orders } } });
    if (made.item) await prisma.item.deleteMany({ where: { id: made.item } });
    if (made.customer) await prisma.customer.deleteMany({ where: { id: made.customer } });
    await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

type Ctx = {
  call: (path: string, token?: string, method?: string, body?: unknown) => Promise<Reply>;
  makeUser: (tag: string, codes: string[]) => Promise<{ id: string; token: string }>;
  setFlag: (key: string, value: boolean) => Promise<void>;
  T: string;
  made: { item?: string; customers: string[]; caris: string[]; invoices: string[] };
};
const MOD_OFF = ["MODULE_DISABLED", "LICENSE_MODULE"];

/** V3c: ikinci parti kümeler — tarama, çözücülü/anahtar süzgeç, yeni aramalar, yeni kümelerde modül kapısı. */
async function v3c({ call, makeUser, setFlag, T: tag, made }: Ctx): Promise<void> {
  const T = tag;
  for (const k of [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.EMANET_ENABLED]) await setFlag(k, true);
  clearPatronSnapshotCache();
  const all = await makeUser("all", [PATRON_LOGIN_PERMISSION, "order:read", "customer:read", "finance:read", "report:inventory", "workorder:read", "shipping:read", "quote:read", "cost:read"]);

  console.log("\n=== §7 her küme 200 + bulut biçimi ===");
  const bad: string[] = [];
  for (const name of PATRON_RECORD_SETS) {
    const r = await call(`/patron/v1/veri/${name}?limit=2`, all.token);
    const recs = r.body.data?.kayitlar ?? [];
    const why = [shapeOk(r.body.data, "Page"), ...recs.map((x) => shapeOk(x, "ProjectionRecord"))].filter(([ok]) => !ok).map(([, w]) => w);
    if (r.status !== 200 || why.length > 0) bad.push(`${name}:${r.status}:${r.body.details?.code ?? ""}:${why.join(";")}`);
  }
  check("§7a her KAYIT kümesi 200 + Page/ProjectionRecord", bad.length === 0 && PATRON_RECORD_SETS.length === 28, bad.join(" · ") || `${PATRON_RECORD_SETS.length} küme`);
  const badSnap: string[] = [];
  for (const name of PATRON_SNAPSHOT_SETS) {
    const r = await call(`/patron/v1/anlik/${name}`, all.token);
    const [ok, why] = shapeOk(r.body.data, "Snapshot");
    if (r.status !== 200 || !ok || r.body.data?.projeksiyon !== name) badSnap.push(`${name}:${r.status}:${r.body.details?.code ?? ""}:${ok ? "" : why}`);
  }
  check("§7b her ANLIK küme 200 + Snapshot (emanet/maliyet/üretim açık)", badSnap.length === 0 && PATRON_SNAPSHOT_SETS.length === 17, badSnap.join(" · ") || `${PATRON_SNAPSHOT_SETS.length} küme`);
  const ot = (await call("/patron/v1/oturum", all.token)).body.data as { liste?: { anahtarSuzgecleri?: Record<string, string[]>; kimlikSuzgecleri?: Record<string, string[]>; aranabilir?: string[] }; projeksiyonlar?: string[] } | undefined;
  check("§7c oturum liste: kategoriAnahtari → kasa-hareketi, cariHesapId ∋ fatura, aranabilir ∋ urun/renk/teklif",
    JSON.stringify(ot?.liste?.anahtarSuzgecleri) === JSON.stringify({ kategoriAnahtari: ["kasa-hareketi"] }) && (ot?.liste?.kimlikSuzgecleri?.cariHesapId ?? []).includes("fatura") && ["urun", "renk", "teklif"].every((n) => ot?.liste?.aranabilir?.includes(n)),
    JSON.stringify(ot?.liste));

  console.log("\n=== §8 süzgeçler ve yeni kümelerde modül kapısı ===");
  const cust = async (n: number) => { const c = await prisma.customer.create({ data: { code: `${T}-K${n}`.slice(0, 32), name: `${T} CARİ ${n}` }, select: { id: true } }); made.customers.push(c.id); return c.id; };
  const target = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: await cust(1) }, select: { id: true } });
  made.caris.push(target.id);
  const source = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: await cust(2), mergedIntoId: target.id, isActive: false }, select: { id: true } });
  made.caris.push(source.id);
  const inv = await prisma.invoice.create({ data: { docNo: `${T}-F`.slice(0, 32), type: "SALES", cariId: source.id, issueDate: new Date(), status: "CANCELLED", cancelledAt: new Date() }, select: { id: true } });
  made.invoices.push(inv.id);
  const byTarget = (await call(`/patron/v1/veri/fatura?cariHesapId=${target.id}`, all.token)).body.data?.kayitlar ?? [];
  const bySource = await call(`/patron/v1/veri/fatura?cariHesapId=${source.id}`, all.token);
  check("§8a birleşmiş carinin faturası HEDEF süzgecinde (kayit.cariHesapId = hedef)", byTarget.length === 1 && byTarget[0]?.id === inv.id && (byTarget[0]?.kayit as Record<string, unknown>)?.cariHesapId === target.id, JSON.stringify(byTarget.map((r) => r.id)));
  check("§8b aynı fatura KAYNAK süzgecinde yok (tel görünümüyle aynı)", bySource.status === 200 && (bySource.body.data?.kayitlar ?? []).length === 0, String(bySource.status));
  const keyBad = await call("/patron/v1/veri/fatura?kategoriAnahtari=CAT%3AKira", all.token);
  const keyOdd = await call("/patron/v1/veri/kasa-hareketi?kategoriAnahtari=bozuk", all.token);
  const keyOk = await call(`/patron/v1/veri/kasa-hareketi?kategoriAnahtari=${encodeURIComponent(`CAT:${T}`)}`, all.token);
  check("§8c kategoriAnahtari: beyansız kümede 400 · biçimsiz değerde 200 boş · geçerli anahtarda 200",
    keyBad.status === 400 && keyOdd.status === 200 && (keyOdd.body.data?.kayitlar ?? []).length === 0 && keyOk.status === 200, `${keyBad.status} ${keyOdd.status} ${keyOk.status}`);
  const urun = (await call(`/patron/v1/veri/urun?ara=${encodeURIComponent(T)}&suzgec=FABRIC`, all.token)).body.data?.kayitlar ?? [];
  const tek = await call("/patron/v1/veri/teklif?suzgec=SURESI_DOLDU", all.token);
  check("§8d arama: urun ad/kod + tür süzgeci bulur · teklif SURESI_DOLDU 200", urun.some((r) => r.id === made.item) && tek.status === 200, `${urun.length} ${tek.status}`);
  const offCase = async (flag: string, path: string) => { await setFlag(flag, false); const r = await call(path, all.token); await setFlag(flag, true); return r.status === 403 && MOD_OFF.includes(String(r.body.details?.code)) ? "" : `${path}:${r.status}`; };
  const offs = [
    await offCase(SETTING_KEYS.FINANCE_ENABLED, "/patron/v1/veri/kasa?limit=1"),
    await offCase(SETTING_KEYS.MALIYET_ENABLED, "/patron/v1/veri/teklif?limit=1"),
    await offCase(SETTING_KEYS.PRODUCTION_ENABLED, "/patron/v1/veri/is-emri?limit=1"),
    await offCase(SETTING_KEYS.TICARET_ENABLED, "/patron/v1/veri/fiyat?limit=1"),
  ].filter(Boolean);
  check("§8e modül kapalı → kasa/teklif/is-emri 403, ticaret kapalı → fiyat 403 (MODULE_DISABLED|LICENSE_MODULE)", offs.length === 0, offs.join(" · "));
  await setFlag(SETTING_KEYS.TICARET_ENABLED, false);
  const ticOpen = await call("/patron/v1/veri/kasa?limit=1", all.token);
  await setFlag(SETTING_KEYS.TICARET_ENABLED, true);
  check("§8f ticaret kapalıyken ticaret dışı finans kümesi açık (kasa 200)", ticOpen.status === 200, String(ticOpen.status));
}

main()
  .catch((e) => { check("beklenmeyen hata", false, String((e as Error)?.stack ?? e)); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
