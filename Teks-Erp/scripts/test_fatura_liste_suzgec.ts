// =============================================================================
// FATURA LİSTESİ SÜZGECİ — fail-closed bekçisi (G3f, Gülkesim provası 2026-11-01)
// =============================================================================
// Bulgu: GET /api/finance/invoices `?shipmentId=…&limit=…`i sessizce yok sayıp TÜM
// listeyi döndürüyordu (kök CLAUDE.md FAIL-CLOSED). Sınanan:
//   §1 şema (saf): tanınmayan ad · bozuk UUID · bilinmeyen enum · sayfa boyu > 200 → red;
//      panelin gönderdiği küme (page · pageSize · search · type · status · cariId) + limit kabul
//   §2 HTTP: tanınmayan parametre 400 · shipmentId tekil/virgüllü listeyi DOĞRU süzer ve
//      pagination.total süzülmüş sayıdır · limit = sayfa boyu · parametresiz 200
// Emsal: scripts/test_gelen_belge_taslak.ts (app.listen(0) + ensureTestAdmin).
// =============================================================================
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { invoiceListQuerySchema } from "../src/routes/finance-invoice-list.query";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TST-FLS${Date.now().toString(36).toUpperCase()}`;
const made = { customers: [] as string[], shipments: [] as string[], invoices: [] as string[], caris: [] as string[] };
const UUID = "6f1c2b9e-1d2a-4c3b-8e4f-5a6b7c8d9e0f";

function schemaSection(): void {
  console.log("§1 şema (saf)");
  const ok = (q: Record<string, string>) => invoiceListQuerySchema.safeParse(q).success;
  check("panel kümesi kabul", ok({ page: "1", pageSize: "100", search: "x", type: "SALES", status: "DRAFT", cariId: UUID }));
  check("limit kabul (sayfalama sözlüğü)", ok({ limit: "5" }));
  check("shipmentId tekil + virgüllü kabul", ok({ shipmentId: UUID }) && ok({ shipmentId: `${UUID},${UUID}` }));
  check("⭐ tanınmayan ad → red", !ok({ foo: "1" }) && !ok({ shipmentID: UUID }));
  check("bozuk UUID → red", !ok({ shipmentId: "abc" }) && !ok({ shipmentId: `${UUID},abc` }) && !ok({ cariId: "abc" }));
  check("boş shipmentId → red", !ok({ shipmentId: "" }) && !ok({ shipmentId: "," }));
  check("bilinmeyen enum → red", !ok({ status: "APPROVED" }) && !ok({ type: "X" }));
  check("sayfa boyu > 200 ve sayı olmayan sayfa → red", !ok({ pageSize: "201" }) && !ok({ limit: "0" }) && !ok({ page: "abc" }));
}

async function main(): Promise<void> {
  console.log("=== Fatura listesi süzgeci bekçisi ===\n");
  schemaSection();
  const prior = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, select: { value: true } });
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, create: { key: SETTING_KEYS.FINANCE_ENABLED, value: true }, update: { value: true } });
    const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
    const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
    check("admin login", tk.length > 0);
    const get = async (qs: string) => {
      const r = await fetch(`${url}/api/finance/invoices?${qs}`, { headers: { Authorization: `Bearer ${tk}` } });
      const j = (await r.json().catch(() => ({}))) as { data?: Array<{ id: string }>; pagination?: { total: number; pageSize: number } };
      return { status: r.status, ids: (j.data ?? []).map((x) => x.id), total: j.pagination?.total ?? -1, pageSize: j.pagination?.pageSize ?? -1 };
    };

    const cust = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} cari` }, select: { id: true } });
    made.customers.push(cust.id);
    const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: cust.id, subcontractorId: null }));
    made.caris.push(cari.id);
    const ship = async (n: number) => {
      const s = await prisma.shipment.create({ data: { shipmentNo: `${TAG}-S${n}`, customerId: cust.id, status: "PLANNED", destination: "DOMESTIC" }, select: { id: true } });
      made.shipments.push(s.id);
      return s.id;
    };
    const s1 = await ship(1);
    const s2 = await ship(2);
    const s3 = await ship(3);
    const inv = async (n: number, shipmentId: string | null) => {
      const i = await prisma.invoice.create({ data: { docNo: `${TAG}-F${n}`, type: "SALES", cariId: cari.id, issueDate: new Date(), shipmentId }, select: { id: true } });
      made.invoices.push(i.id);
      return i.id;
    };
    const a = await inv(1, s1);
    const b = await inv(2, s2);
    await inv(3, null);

    console.log("§2 HTTP");
    const unknown = await get(`foo=1&cariId=${cari.id}`);
    check("⭐ tanınmayan parametre → 400 (TÜM liste DÖNMEZ)", unknown.status === 400 && unknown.ids.length === 0, String(unknown.status));
    const emptyId = await get("shipmentId=");
    const commaId = await get("shipmentId=%2C");
    check("⭐ boş shipmentId (`=` / `,`) → 400 (TÜM liste DÖNMEZ)", emptyId.status === 400 && emptyId.ids.length === 0 && commaId.status === 400 && commaId.ids.length === 0, `${emptyId.status}/${commaId.status}`);
    const badId = await get("shipmentId=abc");
    check("bozuk shipmentId → 400", badId.status === 400, String(badId.status));
    const one = await get(`shipmentId=${s1}`);
    check("⭐ shipmentId tekil süzer (yalnız bağlı fatura) + total süzülmüş", one.status === 200 && one.ids.length === 1 && one.ids[0] === a && one.total === 1, `${one.status} ${one.ids.length}/${one.total}`);
    const two = await get(`shipmentId=${s1},${s2}`);
    check("shipmentId virgüllü liste süzer", two.status === 200 && two.ids.length === 2 && two.ids.includes(a) && two.ids.includes(b) && two.total === 2, `${two.ids.length}/${two.total}`);
    const none = await get(`shipmentId=${s3}`);
    check("faturasız sevkiyat → boş liste (TÜM liste değil)", none.status === 200 && none.ids.length === 0 && none.total === 0, `${none.ids.length}/${none.total}`);
    const lim = await get(`limit=1&cariId=${cari.id}`);
    check("limit = sayfa boyu (1 satır, total 3)", lim.status === 200 && lim.ids.length === 1 && lim.pageSize === 1 && lim.total === 3, `${lim.ids.length} ps=${lim.pageSize} t=${lim.total}`);
    const plain = await get(`cariId=${cari.id}`);
    check("panel biçimi (yalnız tanınan) → 200, cari süzgeci 3", plain.status === 200 && plain.total === 3, `${plain.status} ${plain.total}`);
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    stopNotificationJobs();
    await new Promise<void>((r) => server.close(() => r()));
    if (prior) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.FINANCE_ENABLED }, data: { value: prior.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.FINANCE_ENABLED } });
    await cleanup().catch((e) => check("temizlik", false, String(e)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

async function cleanup(): Promise<void> {
  await prisma.invoice.deleteMany({ where: { id: { in: made.invoices } } });
  await prisma.shipment.deleteMany({ where: { id: { in: made.shipments } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: made.caris } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
}

if (!engel) void main();
