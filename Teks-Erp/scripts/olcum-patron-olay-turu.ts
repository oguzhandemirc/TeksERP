// =============================================================================
// ÖLÇÜM — patron bulutu olay turunun büyük veride DB maliyeti (W1, 2026-10-24). Bekçi DEĞİL, CI'a bağlı DEĞİL.
// =============================================================================
// Soru: olay turu en sık 15 sn'de bir koşar; ~10 bin toplu fabrikada bir tur fabrikayı yavaşlatır mı?
// Hedef YALNIZ adı `perf` içeren `_test` DB'si (sentetik hacim; fabrika kopyası YASAK — `rolls` > 0 kaynaktan klon
// test-db aracınca reddedilir, bu betik klonlamaz).
//   cd Teks-Erp && DATABASE_URL='…/tekserp_<x>perf_test' npx tsx scripts/olcum-patron-olay-turu.ts dolgu
//   cd Teks-Erp && DATABASE_URL='…/tekserp_<x>perf_test' node ../scripts/agir-is.mjs -- \
//     npx tsx scripts/olcum-patron-olay-turu.ts olc [--tekrar=5] [--surekli-sn=300] [--json=<dosya>]
//   … olcum-patron-olay-turu.ts kirilim [--tekrar=5] [--json=<dosya>]   (olc sonrası; HER_TUR anlıklarının payı)
// `dolgu`: KENDİ sentetik hacim üreticisi — tek işlemde generate_series INSERT'leri (FK/CHECK/tetikleyicilere uyar;
// ≥500 cari · ≥2.000 sipariş + kalem · ≥10.000 top · ≥5.000 top hareketi). Kapılar SIKI, kaçışı yok (aşağıda).
// `olc`: sahte bulut (yerel HTTP, `bulut-fikstur`) + gerçek `runEventRound`; SQL sayısı/süresi `pg.Client#query`
// sarmasıyla (AsyncLocalStorage: tur sorguları yazıcınınkinden ayrılır).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { runSyncRound } from "../src/cloud-sync/sync-round";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { buildSnapshots } from "../src/cloud-sync/snapshots";
import { collectProjectionChanges } from "../src/cloud-sync/change-scan";
import { computeHorizon, HORIZON_BASE_MARGIN_MS } from "../src/cloud-sync/horizon";
import { loadWatermarks } from "../src/cloud-sync/watermarks";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { runEventRound, __configureCloudSyncForTests } from "../src/jobs/cloud-sync.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { bulutLisansKur, sahteBulutBaslat, type BulutLisans, type SahteBulut } from "./lib/bulut-fikstur";

const PERF_AD = /^tekserp_[a-z0-9]*perf[a-z0-9]*_test$/;
const kip = process.argv[2];
const arg = (ad: string): string | null => process.argv.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3) ?? null;
const TEKRAR = Number(arg("tekrar") ?? 5);
const SUREKLI_SN = Number(arg("surekli-sn") ?? 300);
const TUR_ARALIGI_MS = 15_000;
const uyu = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ufkuGec = (): Promise<void> => uyu(HORIZON_BASE_MARGIN_MS + 600);

// Kapılar SIKI ve kaçışsız (patron kararı 2026-10-24: başka betiğin ad kapısını aşan yol reddedildi).
const YEREL_HOSTLAR = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEPO_KOKU = path.join(__dirname, "..", "..");

function dur(neden: string): never {
  console.error(`⛔ hedef reddi: ${neden}`);
  process.exit(2);
}

function hedefKapisi(): void {
  const ad = hedefDbAdi();
  if (!PERF_AD.test(ad)) dur(`'${ad}' adı ^tekserp_[a-z0-9]*perf[a-z0-9]*_test$ kalıbında değil`);
  const engel = hedefDbEngeli();
  if (engel) dur(engel);
  let host: string;
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    dur("DATABASE_URL okunamadı");
  }
  if (!YEREL_HOSTLAR.has(host)) dur(`host '${host}' yerel değil (yalnız localhost/127.0.0.1/::1)`);
  // Oturum test DB kaydı: araç bu adı KAYITLI bir açılışla tanımalı ("kayıtsız" satır yetmez).
  const r = spawnSync(process.execPath, [path.join(DEPO_KOKU, "scripts", "test-db.mjs"), "liste"], { cwd: DEPO_KOKU, encoding: "utf8" });
  if (r.status !== 0) dur(`test-db.mjs liste koşmadı (çıkış ${r.status}): ${(r.stderr || "").split("\n")[0]}`);
  const satir = (r.stdout || "").split("\n").find((s) => s.split(/\s+/)[0] === ad);
  if (!satir) dur(`'${ad}' test-db.mjs liste çıktısında yok`);
  if (!/kayıt: /.test(satir) || /kayıtsız/.test(satir)) dur(`'${ad}' test-db kaydında açılış kaydı yok: ${satir.trim()}`);
}

async function bosHedefKapisi(): Promise<void> {
  const n = Number((await pool.query<{ n: string }>('SELECT count(*) AS n FROM "rolls"')).rows[0]?.n ?? -1);
  if (n !== 0) dur(`'${hedefDbAdi()}' başlangıçta ${n} top taşıyor (0 olmalı) — fabrika verisi ya da önceki dolgu işareti`);
}

// ── SQL sayacı ────────────────────────────────────────────────────────────────
interface Sayac { n: number; ms: number }
const als = new AsyncLocalStorage<Sayac>();
// Tip zorlamasız sarma: `Reflect` ile (örnek genişletme mandalı `test_type_assertion_ratchet` §2).
const origQuery: unknown = Reflect.get(Client.prototype, "query");
function sayanQuery(this: Client, ...args: unknown[]): unknown {
  const ctx = als.getStore();
  if (typeof origQuery !== "function") throw new Error("pg Client#query bulunamadı");
  if (!ctx) return Reflect.apply(origQuery, this, args);
  const t0 = performance.now();
  const bitti = (): void => {
    ctx.n++;
    ctx.ms += performance.now() - t0;
  };
  const son = args[args.length - 1];
  if (typeof son === "function") {
    args[args.length - 1] = function (this: unknown, ...cb: unknown[]): unknown {
      bitti();
      return Reflect.apply(son, this, cb);
    };
    return Reflect.apply(origQuery, this, args);
  }
  const r: unknown = Reflect.apply(origQuery, this, args);
  if (r instanceof Promise) return r.then((v: unknown) => (bitti(), v), (e: unknown) => { bitti(); throw e; });
  return r;
}
Reflect.set(Client.prototype, "query", sayanQuery);

async function olculu<T>(fn: () => Promise<T>): Promise<{ sonuc: T; duvarMs: number; sql: number; dbMs: number }> {
  const s: Sayac = { n: 0, ms: 0 };
  const t0 = performance.now();
  const sonuc = await als.run(s, fn);
  return { sonuc, duvarMs: Math.round(performance.now() - t0), sql: s.n, dbMs: Math.round(s.ms) };
}

function ozet(xs: number[]): { min: number; medyan: number; maks: number } {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
  return { min: s[0]!, medyan: m, maks: s[s.length - 1]! };
}

async function hacim(): Promise<Record<string, number>> {
  const tablolar = ["rolls", "roll_movements", "roll_status_events", "orders", "order_lines", "customers", "cari_accounts", "work_orders", "work_order_steps", "sacks", "shipments", "sync_marks"];
  const out: Record<string, number> = {};
  for (const t of tablolar) out[t] = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`)).rows[0]?.n ?? 0);
  return out;
}

// ── dolgu (sentetik hacim; tek işlem) ─────────────────────────────────────────
// Damga ilkesi: her türetilmiş zaman `pg_temp.tavan` ile ŞİMDİ − 5 dk'ya kırpılır (gelecekteki `updatedAt`
// filigranı bozardı); doğuş tetikleyicileri (durum olayı, üretim damgası, `shipment_orders` kirli işareti)
// gerçek yoldaki gibi çalışır, birkaç topun çuval değişimi `rolls_sync_parent_moved` işaretini doğurur.
const HACIM = { cari: 520, urun: 40, renk: 30, siparis: 2200, top: 12000 } as const;
const DOLGU_SQL: readonly string[] = [
  `CREATE FUNCTION pg_temp.tavan(t timestamptz) RETURNS timestamptz LANGUAGE sql AS $$ SELECT LEAST(t, now() - interval '5 minutes') $$`,
  // Cari + cari hesap
  `INSERT INTO customers (id, code, name, type, "isActive", "isCustomerRole", city, "createdAt", "updatedAt")
   SELECT gen_random_uuid(), 'OLC' || lpad(g::text, 5, '0'), 'Ölçüm Cari ' || g, 'CUSTOMER', true, true, 'İstanbul',
     now() - interval '420 days' + make_interval(days => g % 380), now() - interval '420 days' + make_interval(days => g % 380, hours => g % 24)
   FROM generate_series(1, ${HACIM.cari}) g`,
  `INSERT INTO cari_accounts (id, kind, "customerId", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), 'CUSTOMER', c.id, c."createdAt", c."updatedAt" FROM customers c WHERE c.code LIKE 'OLC%'`,
  `CREATE TEMP TABLE t_cust AS SELECT id, row_number() OVER (ORDER BY code) AS rn FROM customers WHERE code LIKE 'OLC%'`,
  // Ürün + renk
  `INSERT INTO items (id, code, name, "itemType", unit, "isActive", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), 'OLCU' || lpad(g::text, 3, '0'), 'Ölçüm Kumaş ' || g, 'FABRIC', 'MT', true,
     now() - interval '430 days', now() - interval '430 days' + make_interval(days => g)
   FROM generate_series(1, ${HACIM.urun}) g`,
  `CREATE TEMP TABLE t_item AS SELECT id, row_number() OVER (ORDER BY code) AS rn FROM items WHERE code LIKE 'OLCU%'`,
  `INSERT INTO colors (id, code, name, "isActive", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), 'OLCR' || lpad(g::text, 3, '0'), 'Ölçüm Renk ' || g, true,
     now() - interval '430 days', now() - interval '430 days' + make_interval(days => g)
   FROM generate_series(1, ${HACIM.renk}) g`,
  `CREATE TEMP TABLE t_color AS SELECT id, row_number() OVER (ORDER BY code) AS rn FROM colors WHERE code LIKE 'OLCR%'`,
  // Sipariş: 365 güne yayılı; 60 günden eski olanlar çoğunlukla kapanmış
  `CREATE TEMP TABLE t_ord AS
   SELECT g AS rn, gen_random_uuid() AS id, c.id AS cust,
     now() - interval '1 day' - make_interval(secs => (${HACIM.siparis} - g) * 365.0 * 86400 / ${HACIM.siparis}) AS odate,
     NULL::text AS status, NULL::timestamptz AS upd
   FROM generate_series(1, ${HACIM.siparis}) g JOIN t_cust c ON c.rn = (g % ${HACIM.cari}) + 1`,
  `UPDATE t_ord SET status = CASE
     WHEN odate < now() - interval '60 days' THEN CASE WHEN rn % 20 = 0 THEN 'CANCELLED' WHEN rn % 10 = 1 THEN 'PARTIAL_SHIPPED' ELSE 'COMPLETED' END
     ELSE CASE rn % 4 WHEN 0 THEN 'PENDING' WHEN 3 THEN 'PARTIAL_SHIPPED' ELSE 'APPROVED' END END`,
  `UPDATE t_ord SET upd = GREATEST(odate, pg_temp.tavan(odate + make_interval(days => CASE WHEN status IN ('COMPLETED', 'CANCELLED') THEN 25 + rn % 10 ELSE rn % 15 END)))`,
  `INSERT INTO orders (id, "orderNumber", currency, status, "orderDate", deadline, "completedAt", "createdAt", "updatedAt", "customerId", "cancelledAt", "cancelReason", destination)
   SELECT id, 'OLC-S-' || lpad(rn::text, 6, '0'), 'TRY', status::"OrderStatus", odate, odate + interval '30 days',
     CASE WHEN status = 'COMPLETED' THEN upd END, odate, upd, cust,
     CASE WHEN status = 'CANCELLED' THEN upd END, CASE WHEN status = 'CANCELLED' THEN 'ölçüm' END, 'DOMESTIC'
   FROM t_ord`,
  // Kalem: sipariş başına 3
  `CREATE TEMP TABLE t_line AS
   SELECT o.rn AS orn, k, gen_random_uuid() AS id, o.id AS oid, o.odate, o.upd, o.status,
     (300 + ((o.rn * 7 + k * 13) % 2700))::numeric AS qty, i.id AS item, c.id AS color
   FROM t_ord o CROSS JOIN generate_series(1, 3) k
   JOIN t_item i ON i.rn = ((o.rn * 3 + k) % ${HACIM.urun}) + 1
   JOIN t_color c ON c.rn = ((o.rn + k * 7) % ${HACIM.renk}) + 1`,
  `INSERT INTO order_lines (id, "orderId", "itemId", "colorId", quantity, "unitPrice", "shippedQty", "createdAt", "updatedAt", "cancelledAt", unit)
   SELECT id, oid, item, color, qty, 85.50, CASE WHEN status = 'COMPLETED' THEN qty ELSE 0 END, odate, upd,
     CASE WHEN status = 'CANCELLED' THEN upd END, 'MT'
   FROM t_line`,
  // İş emri: iptal olmayan siparişin ilk kalemine bir tane; üç adım (Tambur → Boya fason → Kurşun/KK2)
  `CREATE TEMP TABLE t_wo AS
   SELECT row_number() OVER (ORDER BY l.orn) AS rn, gen_random_uuid() AS id, l.id AS line, l.orn, l.item, l.color, l.qty,
     l.odate + interval '10 minutes' AS created, GREATEST(l.odate + interval '10 minutes', l.upd) AS upd,
     CASE WHEN l.status IN ('COMPLETED', 'PARTIAL_SHIPPED') AND l.odate < now() - interval '60 days' THEN 'COMPLETED'
          WHEN l.status IN ('APPROVED', 'PARTIAL_SHIPPED') THEN 'IN_PROGRESS' ELSE 'PLANNED' END AS status
   FROM t_line l WHERE l.k = 1 AND l.status <> 'CANCELLED'`,
  `INSERT INTO work_orders (id, type, "targetQuantity", width, status, "plannedStartDate", "plannedEndDate", "createdAt", "updatedAt", "isActive", "targetItemId", "targetColorId", "workOrderNumber")
   SELECT id, 'ORDER_PRODUCTION', qty, 180, status::"WorkOrderStatus", created, created + interval '14 days', created, upd, true, item, color,
     'OLC-IE-' || lpad(rn::text, 6, '0')
   FROM t_wo`,
  `CREATE TEMP TABLE t_step AS
   SELECT w.rn AS wrn, s.seq, gen_random_uuid() AS id, w.id AS wo, st.id AS station, w.created,
     CASE WHEN w.status = 'COMPLETED' THEN 'COMPLETED'
          WHEN w.status = 'IN_PROGRESS' THEN CASE s.seq WHEN 1 THEN 'COMPLETED' WHEN 2 THEN 'ACTIVE' ELSE 'PENDING' END
          ELSE 'PENDING' END AS status
   FROM t_wo w CROSS JOIN (VALUES (1, 'TAMBUR_1'), (2, 'BOYA_FASON'), (3, 'KURSUN_KK2')) AS s(seq, code)
   JOIN stations st ON st.code = s.code`,
  `INSERT INTO work_order_steps (id, "workOrderId", "stationId", "stepSequence", status, "startedAt", "completedAt", "createdAt", "updatedAt")
   SELECT id, wo, station, seq, status::"StepStatus",
     CASE WHEN status IN ('COMPLETED', 'ACTIVE') THEN pg_temp.tavan(created + make_interval(hours => seq * 24)) END,
     CASE WHEN status = 'COMPLETED' THEN pg_temp.tavan(created + make_interval(hours => seq * 24 + 20)) END,
     created, GREATEST(created, pg_temp.tavan(created + make_interval(hours => seq * 24 + CASE WHEN status = 'COMPLETED' THEN 20 ELSE 0 END)))
   FROM t_step`,
  `INSERT INTO work_order_to_order_lines (id, "workOrderId", "orderLineId", "allocatedQty", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), id, line, qty, created, created FROM t_wo`,
  // Sevkiyat (kapanmış + kısmi siparişe bir tane) + iki çuval
  `CREATE TEMP TABLE t_shp AS
   SELECT row_number() OVER (ORDER BY o.rn) AS rn, gen_random_uuid() AS id, o.id AS oid, o.rn AS orn, o.cust,
     GREATEST(o.odate, pg_temp.tavan(o.odate + interval '20 days')) AS disp
   FROM t_ord o WHERE o.status IN ('COMPLETED', 'PARTIAL_SHIPPED')`,
  `INSERT INTO shipments (id, "shipmentNo", status, "dispatchedAt", "createdAt", "updatedAt", "customerId", destination, "plateNumber", "driverName")
   SELECT id, 'OLC-SV-' || lpad(rn::text, 6, '0'), 'DISPATCHED', disp, disp - interval '3 hours', disp, cust, 'DOMESTIC', '34 OLC ' || rn, 'Ölçüm Şoför'
   FROM t_shp`,
  `INSERT INTO shipment_orders ("shipmentId", "orderId", "createdAt", "isActive") SELECT id, oid, disp - interval '3 hours', false FROM t_shp`,
  `CREATE TEMP TABLE t_sack AS
   SELECT s.rn AS srn, q.seq, gen_random_uuid() AS id, s.id AS shp, s.cust, s.disp FROM t_shp s CROSS JOIN generate_series(1, 2) AS q(seq)`,
  `INSERT INTO sacks (id, "sackNo", seq, "shipmentId", "customerId", "weightKg", "weighedAt", "createdAt", "updatedAt")
   SELECT id, 'OLC-C-' || lpad(srn::text, 6, '0') || '-' || seq, seq, shp, cust, 250 + srn % 50, disp - interval '4 hours', disp - interval '5 hours', disp
   FROM t_sack`,
  // Top: iş emirlerine dağılır; durum iş emrinin durumundan
  `CREATE TEMP TABLE t_roll AS
   SELECT r, gen_random_uuid() AS id, w.rn AS wrn, w.status AS wstatus, w.item, w.color, w.created, w.orn, (80 + r % 41)::numeric AS qty,
     CASE w.status
       WHEN 'COMPLETED' THEN CASE WHEN r % 20 < 14 THEN 'SHIPPED' WHEN r % 20 < 19 THEN 'WAREHOUSE' WHEN r % 40 = 19 THEN 'SCRAP' ELSE 'A1_STOCK' END
       WHEN 'IN_PROGRESS' THEN CASE WHEN r % 3 = 0 THEN 'AT_SUBCONTRACTOR' ELSE 'IN_PRODUCTION' END
       ELSE 'STOCK' END AS status
   FROM generate_series(1, ${HACIM.top}) r JOIN t_wo w ON w.rn = ((r - 1) % (SELECT count(*) FROM t_wo)) + 1`,
  `INSERT INTO rolls (id, barcode, "initialQty", "currentQty", "weightKg", status, width, "entrySource", "createdAt", "updatedAt", "itemId", "colorId",
     "producedInStepId", "currentStepId", "shipmentId", "sackId", "warehouseId", "statusChangedAt", "finalizedAt", "preShipStatus")
   SELECT t.id, 'OLC' || lpad(t.r::text, 7, '0'), t.qty, t.qty, round(t.qty * 0.3, 3), t.status::"RollStatus", 180, 'SUPPLIER_RECEIPT',
     pg_temp.tavan(t.created + interval '2 hours'), x.upd, t.item, CASE WHEN t.status = 'STOCK' THEN NULL ELSE t.color END,
     CASE WHEN t.status IN ('SHIPPED', 'WAREHOUSE', 'A1_STOCK', 'SCRAP') THEN s3.id END,
     CASE WHEN t.status IN ('IN_PRODUCTION', 'AT_SUBCONTRACTOR') THEN s2.id END,
     CASE WHEN t.status = 'SHIPPED' THEN sh.id END, CASE WHEN t.status = 'SHIPPED' THEN sk.id END,
     CASE WHEN t.status IN ('WAREHOUSE', 'A1_STOCK') THEN (SELECT id FROM warehouses WHERE "isDefault" LIMIT 1) END,
     x.upd, CASE WHEN t.status IN ('SHIPPED', 'WAREHOUSE', 'A1_STOCK', 'SCRAP') THEN pg_temp.tavan(t.created + interval '3 days') END,
     CASE WHEN t.status = 'SHIPPED' THEN 'WAREHOUSE'::"RollStatus" END
   FROM t_roll t
   JOIN t_step s2 ON s2.wrn = t.wrn AND s2.seq = 2
   JOIN t_step s3 ON s3.wrn = t.wrn AND s3.seq = 3
   LEFT JOIN t_shp sh ON sh.orn = t.orn
   LEFT JOIN t_sack sk ON sk.srn = sh.rn AND sk.seq = t.r % 2 + 1
   CROSS JOIN LATERAL (SELECT GREATEST(pg_temp.tavan(t.created + interval '2 hours'), CASE
     WHEN t.status = 'SHIPPED' THEN sh.disp
     WHEN t.status IN ('WAREHOUSE', 'A1_STOCK', 'SCRAP') THEN pg_temp.tavan(t.created + interval '3 days')
     WHEN t.status IN ('IN_PRODUCTION', 'AT_SUBCONTRACTOR') THEN pg_temp.tavan(t.created + interval '1 day')
     ELSE pg_temp.tavan(t.created + interval '2 hours') END) AS upd) x`,
  // Top hareketi: biten iş emrinde üç kapalı adım; süren iş emrinde 1. adım kapalı, 2. açık
  `INSERT INTO roll_movements (id, "rollId", "workOrderStepId", "qtyIn", "qtyOut", "weightIn", "weightOut", "enteredAt", "exitedAt", "createdAt", "updatedAt")
   SELECT gen_random_uuid(), t.id, st.id, t.qty, CASE WHEN x.kapali THEN t.qty END, round(t.qty * 0.3, 3), CASE WHEN x.kapali THEN round(t.qty * 0.3, 3) END,
     x.giris, CASE WHEN x.kapali THEN x.cikis END, x.giris, CASE WHEN x.kapali THEN x.cikis ELSE x.giris END
   FROM t_roll t JOIN t_step st ON st.wrn = t.wrn
   CROSS JOIN LATERAL (SELECT pg_temp.tavan(t.created + make_interval(hours => st.seq * 24)) AS giris,
     pg_temp.tavan(t.created + make_interval(hours => st.seq * 24 + 20)) AS cikis, (t.wstatus = 'COMPLETED' OR st.seq = 1) AS kapali) x
   WHERE t.wstatus = 'COMPLETED' OR (t.wstatus = 'IN_PROGRESS' AND st.seq <= 2)`,
  // Gerçek yoldaki çuval düzeltmesi: her 80. sevkli top aynı sevkiyatın öbür çuvalına → tetikleyici işaret yazar
  `UPDATE rolls ro SET "sackId" = sk2.id, "updatedAt" = GREATEST(ro."updatedAt", pg_temp.tavan(ro."updatedAt" + interval '1 hour'))
   FROM t_roll t JOIN t_shp sh ON sh.orn = t.orn JOIN t_sack sk2 ON sk2.srn = sh.rn AND sk2.seq = 2 - t.r % 2
   WHERE ro.id = t.id AND t.status = 'SHIPPED' AND t.r % 80 = 0`,
];

async function dolgu(): Promise<number> {
  await bosHedefKapisi();
  const t0 = performance.now();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (const sql of DOLGU_SQL) await c.query(sql);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
  await pool.query("ANALYZE");
  const h = await hacim();
  const eksik = [["rolls", 10_000], ["orders", 2_000], ["order_lines", 2_000], ["roll_movements", 5_000], ["customers", 500]]
    .filter(([t, n]) => (h[t as string] ?? 0) < (n as number));
  console.log(JSON.stringify({ sureMs: Math.round(performance.now() - t0), hacim: h }));
  if (eksik.length) {
    console.error(`⛔ hacim eşiği tutmadı: ${JSON.stringify(eksik)}`);
    return 1;
  }
  return 0;
}

// ── ölçüm ─────────────────────────────────────────────────────────────────────
async function bayrak(acik: boolean): Promise<void> {
  const key = SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: acik }, update: { value: acik } });
}

async function kirilim(): Promise<Record<string, unknown>> {
  const stored = await loadWatermarks();
  const horizon = (await computeHorizon()).at;
  const tarama: Record<string, { ms: number; sql: number }> = {};
  for (const p of RECORD_PROJECTIONS) {
    const o = await olculu(() => collectProjectionChanges(p, stored, horizon));
    tarama[p.name] = { ms: o.duvarMs, sql: o.sql };
  }
  const anlik = await olculu(() => buildSnapshots({ now: new Date(), productionOn: true, financeOn: true, cadences: new Set(["HER_TUR"]) }));
  return { taramaToplamMs: Object.values(tarama).reduce((a, b) => a + b.ms, 0), tarama, anlikHerTur: { ms: anlik.duvarMs, sql: anlik.sql, dbMs: anlik.dbMs } };
}

// Sunucu tarafı yürütme süresi (PG14+ `pg_stat_database.active_time`, ms). `dbMs` istemci toplamıdır: paralel
// sorguları üst üste ve Docker ağ gidiş-dönüşünü de sayar; yük sorusunun cevabı sunucu süresidir. Boştaki
// bağlantı istatistiğini en geç 10 sn'de yazar → okumadan önce 11 sn beklenir.
const ISTAT_GECIKME_MS = 11_000;
async function aktifMs(): Promise<number> {
  const r = await pool.query<{ ms: number }>("SELECT active_time AS ms FROM pg_stat_database WHERE datname = current_database()");
  return Number(r.rows[0]?.ms ?? Number.NaN);
}

// `kirilim` kipi: HER_TUR anlıklarını modül bayrağı birleşimleriyle ayrıştırır (olc sonrası, filigranlar dolu).
// taban = ozet (üretimsiz) + tesis + saglik · +finans = ozet-finans · +uretim = uretim-akisi + ozet.uretim.
async function anlikKirilimi(): Promise<number> {
  AuditService.logEvent = async () => undefined;
  AuditService.log = async () => undefined;
  const kombi = { taban: [false, false], finansli: [false, true], uretimli: [true, false], hepsi: [true, true] } as const;
  const out: Record<string, unknown> = {};
  for (const [ad, [productionOn, financeOn]] of Object.entries(kombi)) {
    const xs: Array<{ duvarMs: number; sql: number; sunucuMs: number }> = [];
    for (let i = 0; i < TEKRAR; i++) {
      await uyu(ISTAT_GECIKME_MS);
      const a0 = await aktifMs();
      const o = await olculu(() => buildSnapshots({ now: new Date(), productionOn, financeOn, cadences: new Set(["HER_TUR"]) }));
      await uyu(ISTAT_GECIKME_MS);
      xs.push({ duvarMs: o.duvarMs, sql: o.sql, sunucuMs: Math.round((await aktifMs()) - a0) });
    }
    out[ad] = { duvar: ozet(xs.map((x) => x.duvarMs)), sunucu: ozet(xs.map((x) => x.sunucuMs)), sql: ozet(xs.map((x) => x.sql)) };
    console.log(`${ad}: ${JSON.stringify(out[ad])}`);
  }
  const json = arg("json");
  if (json) fs.writeFileSync(json, JSON.stringify(out, null, 2));
  return 0;
}

async function tur(): Promise<{ duvarMs: number; sql: number; dbMs: number }> {
  const o = await olculu(() => runEventRound());
  return { duvarMs: o.duvarMs, sql: o.sql, dbMs: o.dbMs };
}

async function topHareketi(n: number): Promise<void> {
  const ornek = await prisma.rollMovement.findMany({ take: n, orderBy: { enteredAt: "desc" }, select: { rollId: true, workOrderStepId: true, qtyIn: true } });
  for (const m of ornek) {
    await prisma.rollMovement.create({ data: { rollId: m.rollId, workOrderStepId: m.workOrderStepId, qtyIn: m.qtyIn, qtyOut: m.qtyIn, exitedAt: new Date(), notes: "olcum" } });
    await prisma.roll.update({ where: { id: m.rollId }, data: { updatedAt: new Date() } });
  }
}

async function siparisDegistir(): Promise<void> {
  const o = await prisma.order.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true, deadline: true } });
  await prisma.order.update({ where: { id: o!.id }, data: { deadline: new Date((o!.deadline ?? new Date()).getTime() + 86_400_000) } });
}

async function olc(): Promise<number> {
  AuditService.logEvent = async () => undefined;
  AuditService.log = async () => undefined;
  const rapor: Record<string, unknown> = { tarih: new Date().toISOString(), db: hedefDbAdi(), hacim: await hacim() };
  console.log(JSON.stringify(rapor.hacim));
  let lisans: BulutLisans | null = null;
  let bulut: SahteBulut | null = null;
  let kod = 0;
  try {
    // Filigransız başla = ilk tam eşitleme ölçülür; dolgunun tetikleyici işaretleri (sync_marks) KORUNUR.
    await prisma.syncWatermark.deleteMany({});
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    await bayrak(true);
    // Olay zamanlayıcısı no-op: turları bu betik sürer (15 sn = olay turunun en sık hâli).
    __configureCloudSyncForTests({ transport: egressCloudTransport, reset: true, eventTimer: () => ({ cancel() {} }) });

    // İlk tam eşitleme (bir kez; yükseltme günü maliyeti).
    const ilk = { tur: 0, duvarMs: 0, sql: 0, dbMs: 0, paket: 0 };
    for (let i = 0; i < 200; i++) {
      const o = await olculu(() => runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR", "SAATLIK", "GUNLUK"]) }, { transport: egressCloudTransport }));
      ilk.tur++;
      ilk.duvarMs += o.duvarMs;
      ilk.sql += o.sql;
      ilk.dbMs += o.dbMs;
      ilk.paket += o.sonuc.packets;
      if (o.sonuc.status === "HATA") throw new Error(`ilk tur HATA ${o.sonuc.reason}`);
      if (!o.sonuc.more) break;
    }
    rapor.ilkTamEsitleme = ilk;
    console.log(`ilk tam eşitleme: ${JSON.stringify(ilk)}`);
    await ufkuGec();
    await tur();

    const seri = async (ad: string, hazirla: () => Promise<void>): Promise<void> => {
      const xs: Array<{ duvarMs: number; sql: number; dbMs: number; sunucuMs: number }> = [];
      for (let i = 0; i < TEKRAR; i++) {
        await hazirla();
        await uyu(ISTAT_GECIKME_MS); // ufuk payını da aşar
        const a0 = await aktifMs();
        const o = await tur();
        await uyu(ISTAT_GECIKME_MS);
        xs.push({ ...o, sunucuMs: Math.round((await aktifMs()) - a0) });
      }
      rapor[ad] = {
        olcumler: xs, duvar: ozet(xs.map((x) => x.duvarMs)), sunucu: ozet(xs.map((x) => x.sunucuMs)),
        db: ozet(xs.map((x) => x.dbMs)), sql: ozet(xs.map((x) => x.sql)),
      };
      console.log(`${ad}: ${JSON.stringify(rapor[ad])}`);
    };
    await seri("a_degisiklikYok", async () => undefined);
    await seri("b_tekSiparis", siparisDegistir);
    await seri("c_yuzTopHareketi", () => topHareketi(100));
    rapor.kirilim = await kirilim();
    console.log(`kırılım: ${JSON.stringify(rapor.kirilim)}`);

    // Sürekli yazma: saniyede 1 top hareketi (+ top damgası), 5 sn'de bir sipariş değişikliği; tur 15 sn'de bir.
    // Sunucu süresi DB geneli sayılır → önce 60 sn YALNIZ yazıcı koşar, onun hızı toplamdan düşülür.
    const yazici = { hareket: 0, siparis: 0 };
    const yaziciKos = async (bitis: number): Promise<void> => {
      let k = 0;
      while (Date.now() < bitis) {
        await topHareketi(1);
        yazici.hareket++;
        if (++k % 5 === 0) {
          await siparisDegistir();
          yazici.siparis++;
        }
        await uyu(1_000);
      }
    };
    await uyu(ISTAT_GECIKME_MS);
    const y0 = await aktifMs();
    const yt0 = Date.now();
    await yaziciKos(yt0 + 60_000);
    const yalnizYaziciPencereMs = Date.now() - yt0;
    await uyu(ISTAT_GECIKME_MS);
    const yaziciSunucuMs = (await aktifMs()) - y0;
    const yaziciHizi = yaziciSunucuMs / yalnizYaziciPencereMs;

    const s0 = await aktifMs();
    const t0 = Date.now();
    const bitis = t0 + SUREKLI_SN * 1000;
    const yaz = yaziciKos(bitis);
    const turlar: Array<{ duvarMs: number; sql: number; dbMs: number }> = [];
    while (Date.now() < bitis) {
      const bas = Date.now();
      turlar.push(await tur());
      await uyu(Math.max(0, TUR_ARALIGI_MS - (Date.now() - bas)));
    }
    await yaz;
    const duvar = Date.now() - t0;
    await uyu(ISTAT_GECIKME_MS);
    const toplamSunucuMs = (await aktifMs()) - s0;
    const turSunucuMs = toplamSunucuMs - yaziciHizi * duvar;
    const dbToplam = turlar.reduce((a, b) => a + b.dbMs, 0);
    const turToplam = turlar.reduce((a, b) => a + b.duvarMs, 0);
    const yuzde = (x: number): number => Number(((x / duvar) * 100).toFixed(2));
    rapor.d_surekli = {
      sureMs: duvar, tur: turlar.length, yazici,
      turDuvar: ozet(turlar.map((x) => x.duvarMs)), turDb: ozet(turlar.map((x) => x.dbMs)), turSql: ozet(turlar.map((x) => x.sql)),
      yalnizYazici: { pencereMs: yalnizYaziciPencereMs, sunucuMs: Math.round(yaziciSunucuMs) },
      toplamSunucuMs: Math.round(toplamSunucuMs), turSunucuMs: Math.round(turSunucuMs),
      turSunucuOraniYuzde: yuzde(turSunucuMs), turDuvarOraniYuzde: yuzde(turToplam), istemciDbOraniYuzde: yuzde(dbToplam),
    };
    console.log(`sürekli: ${JSON.stringify(rapor.d_surekli)}`);
    rapor.hacimSonra = await hacim();
  } catch (err) {
    console.error(`⛔ ölçüm: ${(err as Error).stack ?? String(err)}`);
    kod = 1;
  } finally {
    __configureCloudSyncForTests({ reset: true, eventTimer: null });
    await bulut?.kapat();
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  const json = arg("json");
  if (json) fs.writeFileSync(json, JSON.stringify(rapor, null, 2));
  console.log(`\n=== ÖZET ===\n${JSON.stringify(rapor, null, 2)}`);
  return kod;
}

async function main(): Promise<number> {
  hedefKapisi();
  if (kip === "dolgu") return dolgu();
  if (kip === "olc") return olc();
  if (kip === "kirilim") return anlikKirilimi();
  console.error("kullanım: olcum-patron-olay-turu.ts dolgu|olc|kirilim [--tekrar=5] [--surekli-sn=300] [--json=<dosya>]");
  return 2;
}

main()
  .then(async (k) => {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(k);
  })
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
