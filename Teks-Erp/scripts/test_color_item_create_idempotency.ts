// =============================================================================
// RENK + ÜRÜN KARTI DOĞUŞU — opsiyonel `clientToken` (V5c, patron telefonu `POST /api/colors` · `POST /api/items`)
// =============================================================================
// Gerçek DB + gerçek Express (ephemeral port) + gerçek login. Her iki uç için sınanan:
//   §1 token'sız gövde BUGÜNKÜ davranış: 201, token kolonu boş; aynı ad ikinci kez 409
//   §2 token'lı doğuş: 201, token saklı; aynı token + aynı gövde → aynı kayıt (201), tek kayıt, tek CREATE audit
//   §3 aynı token + farklı ad (ürün: farklı tür) → 409 `CLIENT_TOKEN_COLLISION`, yeni kayıt doğmaz
//   §4 4. durum: kayıt pasife alınınca aynı token → 409 `COLOR_CREATE_GONE` / `ITEM_CREATE_GONE`
//   §5 eşzamanlı aynı token iki istek → tek kayıt, iki yanıt aynı id
//   §6 geçersiz token 400 (kayıt doğmaz) · genel PATCH `clientToken` yazamaz
// Negatif sonda (2026-11-13, ölçüldü; geri alındı): route token'ı servise geçirmeyince (`createColorRecord(..., undefined)`)
// renk 7 ❌ (§2 2 · §3 2 · §4 · §5 · §6-PATCH); ürün kimliğinden `tur` çıkarılınca §3-tür 1 ❌.
// =============================================================================
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

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
const madeColors: string[] = [];
const madeItems: string[] = [];

type Resp = { status: number; code?: string; data?: { id?: string } };
type Call = (method: string, path: string, body?: unknown) => Promise<Resp>;

interface Kind {
  readonly label: string;
  readonly path: string;
  readonly table: string;
  readonly gone: string;
  readonly made: string[];
  readonly body: (name: string) => Record<string, unknown>;
  readonly count: (name: string) => Promise<number>;
  readonly token: (id: string) => Promise<string | null | undefined>;
  readonly deactivate: (id: string) => Promise<unknown>;
}

const COLOR: Kind = {
  label: "renk", path: "/api/colors", table: "COLOR", gone: "COLOR_CREATE_GONE", made: madeColors,
  body: (name) => ({ name }),
  count: (name) => prisma.color.count({ where: { name } }),
  token: async (id) => (await prisma.color.findUnique({ where: { id }, select: { clientToken: true } }))?.clientToken,
  deactivate: (id) => prisma.color.update({ where: { id }, data: { isActive: false } }),
};

const ITEM: Kind = {
  label: "ürün", path: "/api/items", table: "ITEM", gone: "ITEM_CREATE_GONE", made: madeItems,
  body: (name) => ({ name, itemType: "FABRIC", unit: "MT" }),
  count: (name) => prisma.item.count({ where: { name } }),
  token: async (id) => (await prisma.item.findUnique({ where: { id }, select: { clientToken: true } }))?.clientToken,
  // Yaşam döngüsü kolonları CHECK'le bağlı: pasif = ARCHIVED + isActive false birlikte.
  deactivate: (id) => prisma.item.update({ where: { id }, data: { isActive: false, lifecycleStatus: "ARCHIVED" } }),
};

async function suite(k: Kind, call: Call): Promise<void> {
  const L = `[${k.label}]`;
  const remember = (r: Resp) => { if (r.data?.id && !k.made.includes(r.data.id)) k.made.push(r.data.id); return r; };
  const post = async (body: unknown) => remember(await call("POST", k.path, body));

  // §1 token'sız
  const n1 = `TEST TOKENSIZ ${TAG}`;
  const a1 = await post(k.body(n1));
  check(`${L} §1 token'sız 201, token kolonu boş`, a1.status === 201 && !!a1.data?.id && (await k.token(a1.data.id)) === null, `${a1.status} ${a1.code ?? ""}`);
  const b1 = await post(k.body(n1));
  check(`${L} §1 ⭐ token'sız tekrar 409 (bugünkü davranış)`, b1.status === 409, `${b1.status} ${b1.code ?? ""}`);

  // §2 token'lı doğuş + replay
  const n2 = `TEST TOKENLI ${TAG}`;
  const t2 = randomUUID();
  const a2 = await post({ ...k.body(n2), clientToken: t2 });
  check(`${L} §2 ⭐ token'lı doğuş 201, token saklı`, a2.status === 201 && !!a2.data?.id && (await k.token(a2.data.id)) === t2, `${a2.status} ${a2.code ?? ""}`);
  const b2 = await post({ ...k.body(n2), clientToken: t2 });
  check(`${L} §2 ⭐ aynı token + aynı gövde → aynı kayıt (201)`, b2.status === 201 && !!b2.data?.id && b2.data.id === a2.data?.id, `${b2.status} ${b2.code ?? ""}`);
  check(`${L} §2 ⭐ tek kayıt`, (await k.count(n2)) === 1);
  await new Promise((r) => setTimeout(r, 300));
  const logs = a2.data?.id ? await prisma.systemLog.count({ where: { recordId: a2.data.id, action: "CREATE", tableName: k.table } }) : -1;
  check(`${L} §2 tek CREATE audit (replay yazmaz)`, logs === 1, String(logs));

  // §3 çakışma
  const c3 = await post({ ...k.body(`${n2} BASKA`), clientToken: t2 });
  check(`${L} §3 ⭐ aynı token farklı ad 409 CLIENT_TOKEN_COLLISION`, c3.status === 409 && c3.code === "CLIENT_TOKEN_COLLISION", `${c3.status} ${c3.code}`);
  check(`${L} §3 çakışmada kayıt doğmadı`, (await k.count(`${n2} BASKA`)) === 0 && (await k.count(n2)) === 1);
  if (k === ITEM) {
    const d3 = await post({ name: n2, itemType: "YARN", unit: "KG", clientToken: t2 });
    check(`${L} §3 ⭐ aynı token farklı tür 409 CLIENT_TOKEN_COLLISION`, d3.status === 409 && d3.code === "CLIENT_TOKEN_COLLISION", `${d3.status} ${d3.code}`);
  }

  // §4 4. durum
  const n4 = `TEST PASIFLENEN ${TAG}`;
  const t4 = randomUUID();
  const a4 = await post({ ...k.body(n4), clientToken: t4 });
  if (a4.data?.id) await k.deactivate(a4.data.id);
  const b4 = await post({ ...k.body(n4), clientToken: t4 });
  check(`${L} §4 ⭐ pasif kaydın token tekrarı 409 ${k.gone}`, a4.status === 201 && b4.status === 409 && b4.code === k.gone, `${a4.status} ${b4.status} ${b4.code}`);

  // §5 eşzamanlı aynı token
  const n5 = `TEST ESZAMANLI ${TAG}`;
  const t5 = randomUUID();
  const [p, q] = await Promise.all([1, 2].map(() => post({ ...k.body(n5), clientToken: t5 })));
  check(`${L} §5 ⭐ eşzamanlı aynı token: iki 201, aynı id, tek kayıt`, p.status === 201 && q.status === 201 && !!p.data?.id && p.data.id === q.data?.id && (await k.count(n5)) === 1, `${p.status}/${q.status} ${p.code ?? ""}${q.code ?? ""}`);

  // §6 geçersiz token · PATCH
  const n6 = `TEST GECERSIZ ${TAG}`;
  const bad = await post({ ...k.body(n6), clientToken: "abc" });
  check(`${L} §6 geçersiz token 400, kayıt doğmadı`, bad.status === 400 && (await k.count(n6)) === 0, `${bad.status}`);
  if (a2.data?.id) {
    await call("PATCH", `${k.path}/${a2.data.id}`, { clientToken: randomUUID(), name: `${n2} YENI` });
    check(`${L} §6 ⭐ genel PATCH clientToken yazamaz`, (await k.token(a2.data.id)) === t2);
  }
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password }) });
  const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
  check("login", !!tk);
  const call: Call = async (method, path, body) => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: Resp["data"]; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };
  await suite(COLOR, call);
  await suite(ITEM, call);
}

async function main(): Promise<void> {
  console.log("=== Renk + ürün doğuşu — clientToken replay bekçisi ===\n");
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    // Yalnız bu koşumun doğurduğu (TEST- önekli, damgalı) tanım satırları; referans almadılar.
    await prisma.item.deleteMany({ where: { id: { in: madeItems } } }).catch((e) => check("temizlik ürün", false, (e as Error).message.slice(0, 300)));
    await prisma.color.deleteMany({ where: { id: { in: madeColors } } }).catch((e) => check("temizlik renk", false, (e as Error).message.slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!blocked) void main();
