// =============================================================================
// BEKÇİ — Carinin belgeleri (cari-be madde 1, 2026-11-12)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_customer_documents.ts
//
// ÖLÇÜLENLER:
//   §1 cari süzgeci: kartın sevk/sipariş/fatura basılı belgeleri + gelen belgesi listede; başka carinin belgesi YOK;
//      SUPERSEDED sürüm yok, VOIDED durumuyla var; hedef kayıt türü/kimliği kaynak kayıttır
//   §2 kimlik ↔ rol: kartın fason profiline (eski bacak) bağlı cari hesaptaki fatura aynı kartın belgesidir
//   §3 tür izni: her tür kendi okuma izniyle; izinsiz tür ne satırda ne `types`ta; istenen izinsiz tür kesişimden düşer
//   §4 modül: finans kapalı → fatura yok; gelen belge kapalı → gelen belge yok (izin olsa da)
//   §5 sayfalama + toplam tek gövdeden; tür ve tarih süzgeci
//   §6 HTTP: tanınmayan tür/anahtar 400, `customer:read` yok 403, yok cari 404
//   §7 sorgu bütçesi: 3 ve 15 belgeli caride sorgu sayısı EŞİT (N+1 yok)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; modül ayarları birebir geri yüklenir; temizlik `finally`de.
// Negatif sonda (2026-11-12): (a) servisteki tür izni süzgeci kaldırılınca §3 ❌; (b) gelen belge dalında
// `senderCustomerId` koşulu `IS NOT NULL` yapılınca (cari süzgeci gevşer) §1 "başka cari sızmaz" ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { PrintedDocStatus, PrintedDocType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { listCustomerDocuments, type CustomerDocumentsQuery } from "../src/services/customer-documents.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) total++;
    return orig(...args);
  };
});
async function measure(fn: () => Promise<unknown>): Promise<number> {
  total = 0;
  capture = true;
  try { await fn(); } finally { capture = false; }
  return total;
}

const TAG = `TEST-CDOC-${randomUUID().slice(0, 6)}`;
const ids = { customers: [] as string[], subs: [] as string[], users: [] as string[], shipments: [] as string[], orders: [] as string[], invoices: [] as string[], accounts: [] as string[], notes: [] as string[], docs: [] as string[] };
const MODULE_KEYS = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED];
const ALL = ["customer:read", "shipping:read", "order:read", "finance:read", "gelen-belge:read"];
const Q = (over: Partial<CustomerDocumentsQuery> = {}): CustomerDocumentsQuery => ({ page: 1, pageSize: 25, types: [], ...over });

async function card(n: string): Promise<string> {
  const id = (await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} kart ${n}` }, select: { id: true } })).id;
  ids.customers.push(id);
  return id;
}
async function doc(docType: PrintedDocType, sourceId: string, no: string, version = 1, status: PrintedDocStatus = "ACTIVE"): Promise<string> {
  const id = (await prisma.printedDocument.create({ data: { docType, sourceId, version, status, documentNo: no, snapshot: {} }, select: { id: true } })).id;
  ids.docs.push(id);
  return id;
}
async function shipment(customerId: string, no: string): Promise<string> {
  const id = (await prisma.shipment.create({ data: { shipmentNo: no, customerId }, select: { id: true } })).id;
  ids.shipments.push(id);
  return id;
}
async function setModule(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

interface Fixture { k: string; other: string; many: string; sub: string; shipA: string; shipB: string; order: string; invoice: string; note: string; otherNote: string }

async function build(): Promise<Fixture> {
  const k = await card("K");
  const other = await card("O");
  const many = await card("M");
  const sub = (await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fason`, customerId: k }, select: { id: true } })).id;
  ids.subs.push(sub);
  const shipA = await shipment(k, `${TAG}-SA`);
  const shipB = await shipment(k, `${TAG}-SB`);
  await doc("SHIPMENT_DISPATCH", shipA, `${TAG}-SA`, 1, "SUPERSEDED");
  await doc("SHIPMENT_DISPATCH", shipA, `${TAG}-SA`, 2);
  await doc("SHIPMENT_DISPATCH", shipB, `${TAG}-SB`, 1, "VOIDED");
  const order = (await prisma.order.create({ data: { orderNumber: `${TAG}-O`, customerId: k }, select: { id: true } })).id;
  ids.orders.push(order);
  await doc("ORDER_CONFIRMATION", order, `${TAG}-O`);
  // Eski fason bacağındaki hesap: kartın kimliğidir (§2).
  const acc = (await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub }, select: { id: true } })).id;
  ids.accounts.push(acc);
  const invoice = (await prisma.invoice.create({ data: { docNo: `${TAG}-INV`, type: "SALES", cariId: acc, issueDate: new Date() }, select: { id: true } })).id;
  ids.invoices.push(invoice);
  await doc("INVOICE_INTERNAL", invoice, `${TAG}-INV`);
  const note = (await prisma.customerDeliveryNote.create({ data: { noteNo: `${TAG}-GB`, sourceKind: "MANUAL", senderCustomerId: k }, select: { id: true } })).id;
  const otherNote = (await prisma.customerDeliveryNote.create({ data: { noteNo: `${TAG}-GBO`, sourceKind: "MANUAL", ownerCustomerId: other }, select: { id: true } })).id;
  ids.notes.push(note, otherNote);
  const otherShip = await shipment(other, `${TAG}-SO`);
  await doc("SHIPMENT_DISPATCH", otherShip, `${TAG}-SO`);
  for (let i = 0; i < 15; i++) await doc("SHIPMENT_DISPATCH", await shipment(many, `${TAG}-M${i}`), `${TAG}-M${i}`);
  return { k, other, many, sub, shipA, shipB, order, invoice, note, otherNote };
}

async function filterSection(f: Fixture): Promise<void> {
  console.log("── §1 cari süzgeci ──");
  const r = await listCustomerDocuments(f.k, Q(), ALL);
  const nos = r.data.map((d) => d.documentNo);
  check("körlük zemini: 5 belge (2 sevk + teyit + fatura + gelen belge)", r.pagination.total === 5 && r.data.length === 5, nos.join(","));
  check("başka carinin basılı/gelen belgesi sızmaz", !nos.includes(`${TAG}-SO`) && !nos.includes(`${TAG}-GBO`));
  const sa = r.data.filter((d) => d.sourceId === f.shipA);
  check("SUPERSEDED sürüm listelenmez (yalnız v2)", sa.length === 1 && sa[0]?.version === 2 && sa[0]?.status === "ACTIVE");
  check("VOIDED belge durumuyla listelenir", r.data.some((d) => d.sourceId === f.shipB && d.status === "VOIDED"));
  check("hedef = kaynak kayıt (sevk/sipariş/gelen belge)", r.data.some((d) => d.target.type === "shipment" && d.target.id === f.shipA)
    && r.data.some((d) => d.target.type === "order" && d.target.id === f.order)
    && r.data.some((d) => d.kind === "incoming" && d.target.type === "incoming-delivery-note" && d.target.id === f.note));
  console.log("\n── §2 kimlik ↔ rol ──");
  check("fason profilinin eski bacak hesabındaki fatura kartın belgesi", r.data.some((d) => d.docType === "INVOICE_INTERNAL" && d.target.id === f.invoice));
  const o = await listCustomerDocuments(f.other, Q(), ALL);
  check("öteki kart yalnız kendi 2 belgesini görür", o.pagination.total === 2 && o.data.every((d) => d.documentNo.startsWith(`${TAG}-SO`) || d.documentNo === `${TAG}-GBO`));
}

async function gateSection(f: Fixture): Promise<void> {
  console.log("\n── §3 tür izni ──");
  const ship = await listCustomerDocuments(f.k, Q(), ["customer:read", "shipping:read"]);
  check("yalnız sevk izni → yalnız sevk irsaliyeleri", ship.data.length === 2 && ship.data.every((d) => d.docType === "SHIPMENT_DISPATCH"));
  check("izinsiz tür `types`ta yok", ship.types.includes("SHIPMENT_DISPATCH") && !ship.types.includes("INVOICE_INTERNAL") && !ship.types.includes("INCOMING_DELIVERY_NOTE") && !ship.types.includes("ORDER_CONFIRMATION"));
  const asked = await listCustomerDocuments(f.k, Q({ types: ["INVOICE_INTERNAL"] }), ["customer:read", "shipping:read"]);
  check("istenen izinsiz tür kesişimden düşer (boş, sızmaz)", asked.data.length === 0 && asked.pagination.total === 0);
  const none = await listCustomerDocuments(f.k, Q(), ["customer:read"]);
  check("hiç belge izni yok → boş liste, boş tür", none.data.length === 0 && none.types.length === 0);
  console.log("\n── §4 modül ──");
  await setModule(SETTING_KEYS.FINANCE_ENABLED, false);
  await setModule(SETTING_KEYS.GELEN_BELGE_ENABLED, false);
  const off = await listCustomerDocuments(f.k, Q(), ALL);
  check("finans kapalı → fatura yok, tür yok", !off.data.some((d) => d.docType === "INVOICE_INTERNAL") && !off.types.includes("INVOICE_INTERNAL"));
  check("gelen belge kapalı → gelen belge yok, tür yok", !off.data.some((d) => d.kind === "incoming") && !off.types.includes("INCOMING_DELIVERY_NOTE"));
  check("çekirdek türler etkilenmez", off.pagination.total === 3);
  await setModule(SETTING_KEYS.FINANCE_ENABLED, true);
  await setModule(SETTING_KEYS.GELEN_BELGE_ENABLED, true);
}

async function pagingSection(f: Fixture): Promise<void> {
  console.log("\n── §5 sayfalama + süzgeç ──");
  const p1 = await listCustomerDocuments(f.many, Q({ pageSize: 10 }), ALL);
  const p2 = await listCustomerDocuments(f.many, Q({ pageSize: 10, page: 2 }), ALL);
  const ids2 = new Set([...p1.data, ...p2.data].map((d) => d.id));
  check("toplam 15, iki sayfa, çakışma yok", p1.pagination.total === 15 && p1.pagination.totalPages === 2 && p2.data.length === 5 && ids2.size === 15);
  const t = await listCustomerDocuments(f.k, Q({ types: ["ORDER_CONFIRMATION", "INCOMING_DELIVERY_NOTE"] }), ALL);
  check("tür süzgeci", t.pagination.total === 2 && t.data.every((d) => d.docType === "ORDER_CONFIRMATION" || d.docType === "INCOMING_DELIVERY_NOTE"));
  const future = await listCustomerDocuments(f.k, Q({ from: "2999-01-01" }), ALL);
  const past = await listCustomerDocuments(f.k, Q({ to: "2000-01-01" }), ALL);
  check("tarih süzgeci (gelecek/geçmiş pencere boş)", future.pagination.total === 0 && past.pagination.total === 0);
}

async function httpSection(f: Fixture, base: string): Promise<void> {
  console.log("\n── §6 HTTP ──");
  const user = async (ek: string, perms: string[]): Promise<string> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    if (rows.length) await prisma.userPermission.createMany({ data: rows.map((p) => ({ userId: u.id, permissionId: p.id })) });
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
    const tk = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!tk) throw new Error(`login başarısız: ${username}`);
    return tk;
  };
  const get = (token: string, path: string) => fetch(`${base}/api/customers/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const ok = await user("all", ALL);
  const ship = await user("ship", ["shipping:read"]);
  const res = await get(ok, `${f.k}/documents?type=ORDER_CONFIRMATION`);
  const body = (await res.json()) as { data?: Array<{ docType: string }>; pagination?: { total: number }; types?: string[] };
  check("200 + tür süzgeci uçtan", res.status === 200 && body.pagination?.total === 1 && body.data?.[0]?.docType === "ORDER_CONFIRMATION" && Array.isArray(body.types));
  check("tanınmayan tür 400", (await get(ok, `${f.k}/documents?type=STOCK_COUNT`)).status === 400);
  check("tanınmayan anahtar 400", (await get(ok, `${f.k}/documents?foo=1`)).status === 400);
  check("bozuk tarih 400", (await get(ok, `${f.k}/documents?from=12.11.2026`)).status === 400);
  check("customer:read yok 403", (await get(ship, `${f.k}/documents`)).status === 403);
  check("yok cari 404", (await get(ok, `${randomUUID()}/documents`)).status === 404);
}

async function budgetSection(f: Fixture): Promise<void> {
  console.log("\n── §7 sorgu bütçesi ──");
  await listCustomerDocuments(f.k, Q(), ALL); // ısıtma
  const qSmall = await measure(() => listCustomerDocuments(f.k, Q({ types: ["SHIPMENT_DISPATCH"] }), ALL));
  const qMany = await measure(() => listCustomerDocuments(f.many, Q({ types: ["SHIPMENT_DISPATCH"] }), ALL));
  check("2 ve 15 belgeli caride sorgu sayısı eşit", qSmall > 0 && qSmall === qMany, `küçük=${qSmall} büyük=${qMany}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Carinin belgeleri bekçisi ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: MODULE_KEYS } }, select: { key: true, value: true } });
  for (const key of MODULE_KEYS) await setModule(key, true);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const f = await build();
    await filterSection(f);
    await gateSection(f);
    await pagingSection(f);
    await httpSection(f, base);
    await budgetSection(f);
  } finally {
    server.close();
    await temizle();
    for (const key of MODULE_KEYS) {
      const old = foto.find((s) => s.key === key);
      if (old) await prisma.systemSetting.update({ where: { key }, data: { value: old.value ?? true } });
      else await prisma.systemSetting.delete({ where: { key } }).catch(() => undefined);
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  await prisma.printedDocument.deleteMany({ where: { id: { in: ids.docs } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: ids.notes } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: ids.accounts } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: ids.accounts } } });
  await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("HATA", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
