// =============================================================================
// BEKÇİ — /api/service-prices (hizmet fiyat tablosu uçları, D4) · HTTP ayaklı
// =============================================================================
// Çalıştırma (Teks-Erp/ içinden):
//   DATABASE_URL='postgresql://…/<ad>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts hizmet_fiyat_uclari
//
// ÖLÇÜLENLER:
//   §1 Kimliksiz 401 · okuma `item:read` · yazma `price:write` (okuyucu 403) · izinsiz 403
//   §2 clientToken replay: aynı token + aynı yük → aynı kayıt (yeni satır YOK); aynı token + farklı yük → 409
//   §3 Tablo projeksiyonu: genel kademe → TIER rozeti; müşteri görünümü → CUSTOMER_TIER; ileri tarihli fiyat
//      bekleyen hücrede, güncel fiyat değişmez; geçmiş PENDING; bekleyen kaldırılınca hücre boşalır
//   §4 Kapılar: hizmet faturası kapalı → 403 SERVICE_BILLING_DISABLED; ön muhasebe kapalı → 403 MODULE_DISABLED
//   §5 Fail-closed: geçmiş tarihli `validFrom` 400 · para birimsiz tablo 400 · FABRIC kalem tablosu 400
// (Ayar satırları `finally`de birebir geri yazılır.)
//
// ⭐ NEGATİF SONDA (2026-11-06, ölçüldü): replay politikasında `identity` → `[]` → §2b/§2d ❌ (500); route'tan
//    `requireServiceBillingEnabled` çıkarıldı → §4a ❌ (200); ikisi geri alındı, 23/0.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { httpBekciKapisi } from "./lib/http-bekci-kapisi";
import { atlamaDefteri } from "./lib/atlama";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const BASE = process.env.TEST_API_URL ?? "http://localhost:4100";
const API = `${BASE}/api/service-prices`;
const STAMP = `${process.pid}${Date.now().toString(36)}`.toUpperCase();
const P = `TEST-HFU-${STAMP}`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const PASSWORD = "test123456";
const PREFIX = `bekci.hfu.${process.pid}`;
const ROLES = { none: ["station:read"], read: ["item:read"], write: ["item:read", "price:write"] } as const;
type RoleKey = keyof typeof ROLES;
const FLAG_KEYS = [SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED];
const saved = new Map<string, { value: unknown } | null>();
const fx = { userIds: [] as string[], itemIds: [] as string[], propIds: [] as string[], customerIds: [] as string[] };

async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}

async function login(role: RoleKey): Promise<Record<string, string>> {
  const perms = await prisma.permission.findMany({ where: { code: { in: [...ROLES[role]] } }, select: { id: true } });
  if (perms.length !== ROLES[role].length) throw new Error(`İzin satırı eksik (${role})`);
  const u = await prisma.user.create({
    data: { username: `${PREFIX}.${role}`, fullName: `HFU Bekçi ${role}`, passwordHash: await AuthService.hashPassword(PASSWORD), permissions: { create: perms.map((p) => ({ permissionId: p.id })) } },
    select: { id: true },
  });
  fx.userIds.push(u.id);
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `${PREFIX}.${role}`, password: PASSWORD, clientType: "electron" }),
  });
  if (!r.ok) throw new Error(`giriş başarısız (${role}): ${r.status}`);
  const token = ((await r.json()) as { data: { token: string } }).data.token;
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

type Json = Record<string, unknown>;
async function call(h: Record<string, string> | null, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: h ?? {}, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await r.json().catch(() => null)) as { data?: unknown; message?: string; error?: { details?: { code?: string } }; details?: { code?: string } } | null;
  return { status: r.status, data: json?.data as Json | undefined, list: json?.data as Json[] | undefined, message: json?.message, code: json?.error?.details?.code ?? json?.details?.code };
}

const HTTP_KONTROL = 22;

async function main(): Promise<void> {
  console.log("=== Hizmet fiyat tablosu uçları ===\n");
  const engel = hedefDbEngeli();
  if (engel) {
    check("hedef DB test DB'si", false, engel);
    return;
  }
  const kapi = await httpBekciKapisi({ base: BASE, kontrolSayisi: HTTP_KONTROL });
  if (kapi.kirmizi) {
    check("HTTP ayağı ölçülebildi", false, kapi.kirmizi);
    ATLAMA.atla("§1–§5 HTTP", "kapı kırmızı verdi — ayak hiç koşmadı", HTTP_KONTROL);
    return;
  }
  if (!kapi.token) {
    ATLAMA.atla("§1–§5 HTTP", kapi.atlaSebebi ?? "ölçüm yapılamadı", HTTP_KONTROL);
    return;
  }
  for (const k of FLAG_KEYS) saved.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));
  for (const k of FLAG_KEYS) await setFlag(k, true);

  const svc = (await prisma.serviceItem.create({ data: { code: `${P}-S`.slice(0, 32), name: `TEST HFU Tambur ${STAMP}`, unit: "MT" }, select: { id: true } })).id;
  const fabric = (await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST HFU kumaş ${STAMP}`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(svc, fabric);
  const prop = await prisma.fabricProperty.create({ data: { code: `${P}-P`.slice(0, 32), name: `TEST HFU tambur ${STAMP}`, valueType: "FLAG", serviceItemId: svc }, select: { id: true } });
  fx.propIds.push(prop.id);
  const val = (await prisma.fabricPropertyValue.create({ data: { propertyId: prop.id, code: `HFU-${STAMP}`.slice(0, 32), name: "Ağır" }, select: { id: true } })).id;
  const cust = (await prisma.customer.create({ data: { code: `${P}-C`.slice(0, 32), name: `TEST HFU müşteri ${STAMP}` }, select: { id: true } })).id;
  fx.customerIds.push(cust);

  const H = {} as Record<RoleKey, Record<string, string>>;
  for (const r of Object.keys(ROLES) as RoleKey[]) H[r] = await login(r);
  const q = `?itemId=${svc}&currency=TRY`;

  console.log("§1 kimlik + izin");
  check("§1a kimliksiz 401", (await call(null, "GET", "/services")).status === 401);
  const services = await call(H.read, "GET", "/services");
  check("§1b item:read hizmet listesini okur, hizmet listede", services.status === 200 && !!services.list?.some((s) => s.id === svc), `durum=${services.status}`);
  check("§1c izinsiz tablo 403", (await call(H.none, "GET", `/table${q}`)).status === 403);
  const body = { itemId: svc, propertyValueId: val, currency: "TRY", price: 12.5 };
  const roRed = await call(H.read, "POST", "/", { ...body, clientToken: randomUUID() });
  check("§1d item:read yazamaz (403)", roRed.status === 403, `durum=${roRed.status}`);

  console.log("§2 clientToken replay");
  const t1 = randomUUID();
  const w1 = await call(H.write, "POST", "/", { ...body, clientToken: t1 });
  check("§2a price:write genel kademe fiyatı yazar", w1.status === 200 && typeof w1.data?.id === "string", `durum=${w1.status} kod=${w1.code}`);
  const w1b = await call(H.write, "POST", "/", { ...body, clientToken: t1 });
  check("§2b aynı token + aynı yük → aynı kayıt", w1b.status === 200 && w1b.data?.id === w1.data?.id && w1b.data?.created === false, `durum=${w1b.status}`);
  const rowCount = await prisma.itemPrice.count({ where: { serviceItemId: svc } });
  check("§2c replay yeni satır yazmadı", rowCount === 1, `satır=${rowCount}`);
  const w1c = await call(H.write, "POST", "/", { ...body, price: 99, clientToken: t1 });
  check("§2d ⭐ aynı token + farklı fiyat → 409", w1c.status === 409, `durum=${w1c.status} kod=${w1c.code}`);
  check("§2e clientToken zorunlu (400)", (await call(H.write, "POST", "/", body)).status === 400);

  console.log("§3 tablo projeksiyonu");
  type Tier = { valueId: string; general: { current: Json | null; pending: Json | null }; customer: { current: Json | null } | null; effective: { price: string | null; source: string | null } };
  const tierOf = (r: Awaited<ReturnType<typeof call>>) => ((r.data?.tiers as Tier[] | undefined) ?? []).find((t) => t.valueId === val);
  const t0 = tierOf(await call(H.read, "GET", `/table${q}`));
  check("§3a genel kademe → TIER rozeti, 12.5", t0?.effective.source === "TIER" && Number(t0.effective.price) === 12.5, JSON.stringify(t0?.effective));
  const wc = await call(H.write, "POST", "/", { ...body, customerId: cust, price: 11, clientToken: randomUUID() });
  check("§3b müşteri kademe fiyatı yazılır", wc.status === 200, `durum=${wc.status} kod=${wc.code}`);
  const tc = tierOf(await call(H.read, "GET", `/table${q}&customerId=${cust}`));
  check("§3c ⭐ müşteri görünümü → CUSTOMER_TIER, 11", tc?.effective.source === "CUSTOMER_TIER" && Number(tc.effective.price) === 11 && Number(tc.customer?.current?.price) === 11, JSON.stringify(tc?.effective));
  const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const wf = await call(H.write, "POST", "/", { ...body, price: 14, validFrom: future, clientToken: randomUUID() });
  check("§3d ileri tarihli fiyat yazılır", wf.status === 200, `durum=${wf.status} kod=${wf.code}`);
  const tf = tierOf(await call(H.read, "GET", `/table${q}`));
  check("§3e ⭐ bekleyen hücrede 14, güncel 12.5 değişmedi", Number(tf?.general.pending?.price) === 14 && Number(tf?.general.current?.price) === 12.5 && Number(tf?.effective.price) === 12.5, JSON.stringify(tf?.general));
  check("§3f güncel fiyatın bitişi ileri tarih (zamanlanmış)", tf?.general.current?.until === future, String(tf?.general.current?.until));
  const hist = await call(H.read, "GET", `/${svc}/history?currency=TRY&customerId=null&propertyValueId=${val}`);
  const states = (hist.list ?? []).map((h) => h.state).sort().join(",");
  check("§3g geçmiş: PENDING + SCHEDULED", hist.status === 200 && states === "PENDING,SCHEDULED", states);
  const rv = await call(H.write, "POST", `/${String(wf.data?.id)}/revoke`);
  const tr = tierOf(await call(H.read, "GET", `/table${q}`));
  check("§3h bekleyen kaldırılınca hücre boşalır, güncelin zamanlaması geri alınır", rv.status === 200 && tr?.general.pending === null && tr?.general.current?.until === null, `durum=${rv.status} ${JSON.stringify(tr?.general)}`);
  check("§3i okuyucu kaldıramaz (403)", (await call(H.read, "POST", `/${String(w1.data?.id)}/revoke`)).status === 403);

  console.log("§4 kapılar");
  await setFlag(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, false);
  const g1 = await call(H.read, "GET", `/table${q}`);
  check("§4a ⭐ hizmet faturası kapalı → 403 SERVICE_BILLING_DISABLED", g1.status === 403 && g1.code === "SERVICE_BILLING_DISABLED", `durum=${g1.status} kod=${g1.code}`);
  await setFlag(SETTING_KEYS.FINANCE_SERVICE_BILLING_ENABLED, true);
  await setFlag(SETTING_KEYS.FINANCE_ENABLED, false);
  const g2 = await call(H.write, "POST", "/", { ...body, price: 13, clientToken: randomUUID() });
  check("§4b ⭐ ön muhasebe kapalı → 403 MODULE_DISABLED (yazım da)", g2.status === 403 && g2.code === "MODULE_DISABLED", `durum=${g2.status} kod=${g2.code}`);
  await setFlag(SETTING_KEYS.FINANCE_ENABLED, true);

  console.log("§5 fail-closed");
  const past = await call(H.write, "POST", "/", { ...body, price: 15, validFrom: new Date(Date.now() - 86_400_000).toISOString(), clientToken: randomUUID() });
  check("§5a geçmiş tarihli validFrom 400", past.status === 400, `durum=${past.status} kod=${past.code}`);
  check("§5b para birimsiz tablo 400", (await call(H.read, "GET", `/table?itemId=${svc}`)).status === 400);
  const fab = await call(H.read, "GET", `/table?itemId=${fabric}&currency=TRY`);
  check("§5c hizmet olmayan kalemin tablosu 400 SERVICE_TIER_NOT_SERVICE", fab.status === 400 && fab.code === "SERVICE_TIER_NOT_SERVICE", `durum=${fab.status} kod=${fab.code}`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      for (const [key, row] of saved) {
        if (row === null) await prisma.systemSetting.deleteMany({ where: { key } });
        else await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never } });
      }
      await prisma.itemPrice.deleteMany({ where: { OR: [{ itemId: { in: fx.itemIds } }, { serviceItemId: { in: fx.itemIds } }] } });
      await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: fx.propIds } } });
      await prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } });
      await prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } });
      await prisma.serviceItem.deleteMany({ where: { id: { in: fx.itemIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } });
      if (fx.userIds.length) {
        await prisma.userPermission.deleteMany({ where: { userId: { in: fx.userIds } } });
        await prisma.session.deleteMany({ where: { userId: { in: fx.userIds } } }).catch(() => undefined);
        await prisma.user.updateMany({ where: { id: { in: fx.userIds } }, data: { isActive: false } }).catch(() => undefined);
      }
    } catch (e) {
      console.error("⚠️ temizlik:", e instanceof Error ? e.message : e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
