// =============================================================================
// CARİ KART DOĞUŞU — opsiyonel `clientToken` (V4c, patron telefonu `POST /api/customers`)
// =============================================================================
// Gerçek DB + gerçek Express (ephemeral port) + gerçek login. Sınanan:
//   §1 token'sız gövde BUGÜNKÜ davranış: 201, token kolonu boş; aynı ad ikinci kez 409 `CUSTOMER_NAME_DUPLICATE`
//   §2 token'lı doğuş: 201, token saklı; aynı token + aynı gövde → aynı kart (201, `cariAccountId` alanı), tek kart, tek audit
//   §3 aynı token + farklı ad / farklı vergi no → 409 `CLIENT_TOKEN_COLLISION`, yeni kart doğmaz
//   §4 4. durum: kart pasife alınınca aynı token → 409 `CUSTOMER_CREATE_GONE`
//   §5 eşzamanlı aynı token iki istek → tek kart, iki yanıt aynı id
//   §6 geçersiz token 400 (kart doğmaz) · genel PATCH `clientToken` yazamaz
// Negatif sonda (2026-11-13, ölçüldü; md5 ile geri): route `clientToken`ı servise geçirmeyince 8 ❌ (§2 3 · §3 2 · §4 · §5 · §6);
// kimlikten `vergiNo` çıkarılınca §3 1 ❌; `alive` koşulsuz dönünce §4 1 ❌.
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

const blocked = hedefDbEngeli();
if (blocked) {
  console.error(`⛔ DURDURULDU — ${blocked}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
const made: string[] = [];

type Resp = { status: number; code?: string; message?: string; data?: { id?: string; cariAccountId?: string | null } };

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password }) });
  const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
  check("login", !!tk);
  const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; message?: string; details?: { code?: string } };
    if (j.data?.id && !made.includes(j.data.id)) made.push(j.data.id);
    return { status: r.status, code: j.details?.code, message: j.message, data: j.data };
  };
  const count = (name: string) => prisma.customer.count({ where: { name } });

  // ── §1 token'sız: bugünkü davranış ─────────────────────────────────────────
  const n1 = `TOKENSIZ CARI ${TAG}`;
  const a1 = await call("POST", "/api/customers", { name: n1, isCustomerRole: true });
  const row1 = a1.data?.id ? await prisma.customer.findUnique({ where: { id: a1.data.id }, select: { clientToken: true } }) : null;
  check("§1 token'sız 201, token kolonu boş", a1.status === 201 && row1?.clientToken === null, `${a1.status} ${JSON.stringify(row1)}`);
  const b1 = await call("POST", "/api/customers", { name: n1, isCustomerRole: true });
  check("§1 ⭐ token'sız tekrar 409 CUSTOMER_NAME_DUPLICATE (bugünkü davranış)", b1.status === 409 && b1.code === "CUSTOMER_NAME_DUPLICATE", `${b1.status} ${b1.code}`);

  // ── §2 token'lı doğuş + replay ─────────────────────────────────────────────
  const n2 = `TOKENLI CARI ${TAG}`;
  const tax2 = `8${String(Date.now()).slice(-9)}`;
  const t2 = randomUUID();
  const body2 = { name: n2, taxNumber: tax2, isCustomerRole: true, city: "Bursa", clientToken: t2 };
  const a2 = await call("POST", "/api/customers", body2);
  const row2 = a2.data?.id ? await prisma.customer.findUnique({ where: { id: a2.data.id }, select: { clientToken: true } }) : null;
  check("§2 ⭐ token'lı doğuş 201, token saklı", a2.status === 201 && row2?.clientToken === t2, `${a2.status} ${JSON.stringify(row2)}`);
  const b2 = await call("POST", "/api/customers", body2);
  check("§2 ⭐ aynı token + aynı gövde → aynı kart (201)", b2.status === 201 && !!b2.data?.id && b2.data.id === a2.data?.id, `${b2.status} ${b2.code ?? ""} ${b2.data?.id}`);
  check("§2 replay yanıtı ilk doğuşun biçiminde (cariAccountId alanı)", !!b2.data && "cariAccountId" in b2.data && b2.data.cariAccountId === (a2.data?.cariAccountId ?? null), JSON.stringify({ a: a2.data?.cariAccountId, b: b2.data?.cariAccountId }));
  check("§2 ⭐ tek kart", (await count(n2)) === 1);
  await new Promise((r) => setTimeout(r, 300));
  const logs = a2.data?.id ? await prisma.systemLog.count({ where: { recordId: a2.data.id, action: "CREATE", tableName: "CUSTOMER" } }) : -1;
  check("§2 tek CREATE audit (replay yazmaz)", logs === 1, String(logs));

  // ── §3 çakışma ─────────────────────────────────────────────────────────────
  const c3 = await call("POST", "/api/customers", { ...body2, name: `${n2} BASKA` });
  check("§3 ⭐ aynı token farklı ad 409 CLIENT_TOKEN_COLLISION", c3.status === 409 && c3.code === "CLIENT_TOKEN_COLLISION", `${c3.status} ${c3.code}`);
  const d3 = await call("POST", "/api/customers", { ...body2, taxNumber: `7${String(Date.now()).slice(-9)}` });
  check("§3 ⭐ aynı token farklı vergi no 409 CLIENT_TOKEN_COLLISION", d3.status === 409 && d3.code === "CLIENT_TOKEN_COLLISION", `${d3.status} ${d3.code}`);
  check("§3 çakışmada kart doğmadı", (await count(`${n2} BASKA`)) === 0 && (await count(n2)) === 1);

  // ── §4 4. durum ────────────────────────────────────────────────────────────
  const n4 = `PASIFLENEN CARI ${TAG}`;
  const t4 = randomUUID();
  const a4 = await call("POST", "/api/customers", { name: n4, isCustomerRole: true, clientToken: t4 });
  if (a4.data?.id) await prisma.customer.update({ where: { id: a4.data.id }, data: { isActive: false } });
  const b4 = await call("POST", "/api/customers", { name: n4, isCustomerRole: true, clientToken: t4 });
  check("§4 ⭐ pasif kartın token tekrarı 409 CUSTOMER_CREATE_GONE", a4.status === 201 && b4.status === 409 && b4.code === "CUSTOMER_CREATE_GONE", `${a4.status} ${b4.status} ${b4.code}`);

  // ── §5 eşzamanlı aynı token ────────────────────────────────────────────────
  const n5 = `ESZAMANLI CARI ${TAG}`;
  const t5 = randomUUID();
  const [p, q] = await Promise.all([1, 2].map(() => call("POST", "/api/customers", { name: n5, isCustomerRole: true, clientToken: t5 })));
  check("§5 ⭐ eşzamanlı aynı token: iki 201, aynı id, tek kart", p.status === 201 && q.status === 201 && !!p.data?.id && p.data.id === q.data?.id && (await count(n5)) === 1, `${p.status}/${q.status} ${p.code ?? ""}${q.code ?? ""}`);

  // ── §6 geçersiz token · PATCH ──────────────────────────────────────────────
  const n6 = `GECERSIZ TOKEN ${TAG}`;
  const bad = await call("POST", "/api/customers", { name: n6, isCustomerRole: true, clientToken: "abc" });
  check("§6 geçersiz token 400, kart doğmadı", bad.status === 400 && (await count(n6)) === 0, `${bad.status}`);
  if (a2.data?.id) {
    await call("PATCH", `/api/customers/${a2.data.id}`, { clientToken: randomUUID(), city: "İzmir" });
    const after = await prisma.customer.findUnique({ where: { id: a2.data.id }, select: { clientToken: true } });
    check("§6 ⭐ genel PATCH clientToken yazamaz", after?.clientToken === t2, JSON.stringify(after));
  }
}

async function main(): Promise<void> {
  console.log("=== Cari kart doğuşu — clientToken replay bekçisi ===\n");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    await cleanupTestCustomers(made).catch((e) => check("temizlik", false, (e as Error).message.slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!blocked) void main();
