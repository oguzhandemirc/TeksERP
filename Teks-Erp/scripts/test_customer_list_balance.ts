// =============================================================================
// BEKÇİ — Cari listesinde bakiye (cari-be madde 2, 2026-11-12)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_customer_list_balance.ts
//
// ÖLÇÜLENLER:
//   §1 değer: liste bakiyesi = tekil çözücünün (`cariService.findByCustomer`) sıfır olmayan bakiyeleri, para birimi
//      başına (toplanmaz); eski fason bacağındaki hesap kartın bakiyesidir; hesapsız kart boş dizi
//   §2 kapılar (HTTP): `finance:read` ∧ finans açık → alan var; `finance:read` yok → alan YOK; modül kapalı → alan YOK
//   §3 sorgu bütçesi: 1 ve 11 kartlık sayfada sorgu sayısı EŞİT (N+1 yok)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; `finance.enabled` birebir geri yüklenir; temizlik `finally`de.
// Negatif sonda (2026-11-12): (a) helper'da kart başına ayrı `findFirst` → §3 ❌; (b) route'ta izin şartı
// kaldırılınca §2 "finance:read yok → alan yok" ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Currency } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { cariService } from "../src/services/cari.service";
import { balancesByCustomer } from "../src/services/helpers/customer-list-balance.helper";

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

const TAG = `TEST-CLB-${randomUUID().slice(0, 6)}`;
const ids = { customers: [] as string[], subs: [] as string[], users: [] as string[] };
type Row = { id: string; code: string; balances?: Array<{ currency: string; balance: string }> };

async function card(n: number): Promise<string> {
  const id = (await prisma.customer.create({ data: { code: `${TAG}-K${n}`, name: `${TAG} kart ${n}` }, select: { id: true } })).id;
  ids.customers.push(id);
  return id;
}
async function account(data: { customerId?: string; subcontractorId?: string }, balances: Array<[Currency, string]>): Promise<string> {
  const acc = await prisma.cariAccount.create({ data: { kind: data.customerId ? "CUSTOMER" : "SUBCONTRACTOR", ...data }, select: { id: true } });
  for (const [currency, balance] of balances) await prisma.cariBalance.create({ data: { cariId: acc.id, currency, balance } });
  return acc.id;
}
// Sıra Currency enum sırasıdır (TRY önce); değer karşılaştırması sıradan bağımsız.
const sig = (b: Array<{ currency: string; balance: string }> | undefined): string => JSON.stringify(b ? [...b].sort((x, y) => x.currency.localeCompare(y.currency)) : null);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Cari listesi bakiyesi bekçisi ===\n");
  const KEY = SETTING_KEYS.FINANCE_ENABLED;
  const foto = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: true }, update: { value: true } });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const user = async (ek: string, perms: string[]): Promise<string> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    if (rows.length) await prisma.userPermission.createMany({ data: rows.map((p) => ({ userId: u.id, permissionId: p.id })) });
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
    const t = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${username}`);
    return t;
  };
  const list = async (token: string): Promise<Row[]> => {
    const r = await fetch(`${base}/api/customers?search=${encodeURIComponent(TAG)}&pageSize=50`, { headers: { Authorization: `Bearer ${token}` } });
    return ((await r.json()) as { data?: Row[] }).data ?? [];
  };

  try {
    const k1 = await card(1);
    await account({ customerId: k1 }, [["TRY", "100.50"], ["USD", "0"], ["EUR", "-50"]]);
    const k2 = await card(2);
    const sub = (await prisma.subcontractor.create({ data: { code: `${TAG}-F2`, name: `${TAG} fason 2`, customerId: k2 }, select: { id: true } })).id;
    ids.subs.push(sub);
    await account({ subcontractorId: sub }, [["TRY", "30"]]);
    const k3 = await card(3);

    console.log("── §1 değer = tekil çözücü ──");
    const map = await balancesByCustomer([k1, k2, k3]);
    const single = async (id: string) => ((await cariService.findByCustomer(id)).data?.balances ?? [])
      .filter((b) => !b.balance.isZero()).map((b) => ({ currency: b.currency, balance: b.balance.toFixed(2) }));
    check("kart hesabı: liste = findByCustomer (sıfır olmayanlar)", sig(map.get(k1)) === sig(await single(k1)), sig(map.get(k1)));
    check("para birimleri ayrı satır, toplanmaz (EUR + TRY)", map.get(k1)?.length === 2 && map.get(k1)?.some((b) => b.currency === "EUR" && b.balance === "-50.00") === true);
    check("eski fason bacağı: liste = findByCustomer", sig(map.get(k2)) === sig(await single(k2)) && map.get(k2)?.[0]?.balance === "30.00", sig(map.get(k2)));
    check("hesapsız kart haritada yok", !map.has(k3));

    console.log("\n── §2 kapılar (HTTP) ──");
    const fin = await user("fin", ["customer:read", "finance:read"]);
    const op = await user("op", ["customer:read"]);
    const finRows = await list(fin);
    const r1 = finRows.find((r) => r.id === k1);
    const r3 = finRows.find((r) => r.id === k3);
    check("körlük zemini: fikstür kartları listede", finRows.length >= 3, `n=${finRows.length}`);
    check("finance:read ∧ açık → alan var, değer helper'la aynı", sig(r1?.balances) === sig(map.get(k1)));
    check("hesapsız kart → boş dizi", Array.isArray(r3?.balances) && r3?.balances?.length === 0);
    const opRows = await list(op);
    check("finance:read yok → alan YOK", opRows.length >= 3 && opRows.every((r) => !("balances" in r)));
    await prisma.systemSetting.update({ where: { key: KEY }, data: { value: false } });
    const offRows = await list(fin);
    check("modül kapalı → alan YOK", offRows.length >= 3 && offRows.every((r) => !("balances" in r)));
    await prisma.systemSetting.update({ where: { key: KEY }, data: { value: true } });

    console.log("\n── §3 sorgu bütçesi ──");
    const many: string[] = [];
    for (let i = 10; i < 20; i++) {
      const id = await card(i);
      await account({ customerId: id }, [["TRY", String(i)]]);
      many.push(id);
    }
    await balancesByCustomer([k1]); // ısıtma
    const q1 = await measure(() => balancesByCustomer([k1]));
    const q11 = await measure(() => balancesByCustomer([k1, ...many]));
    const got = await balancesByCustomer([k1, ...many]);
    check("körlük zemini: 11 kartın hepsi çözüldü", got.size === 11);
    check("1 ve 11 kartta sorgu sayısı eşit", q1 > 0 && q1 === q11, `q1=${q1} q11=${q11}`);
    check("boş sayfa sorgu atmaz", (await measure(() => balancesByCustomer([]))) === 0);
  } finally {
    server.close();
    await temizle();
    if (foto) await prisma.systemSetting.update({ where: { key: KEY }, data: { value: foto.value ?? true } });
    else await prisma.systemSetting.delete({ where: { key: KEY } }).catch(() => undefined);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...accIds, ...ids.customers] } } });
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
