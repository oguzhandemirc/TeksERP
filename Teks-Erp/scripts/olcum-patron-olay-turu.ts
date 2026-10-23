// =============================================================================
// ÖLÇÜM — patron bulutu olay turunun büyük veride DB maliyeti (W1, 2026-10-24). Bekçi DEĞİL, CI'a bağlı DEĞİL.
// =============================================================================
// Soru: olay turu en sık 15 sn'de bir koşar; ~10 bin toplu fabrikada bir tur fabrikayı yavaşlatır mı?
// Hedef YALNIZ adı `perf` içeren `_test` DB'si (sentetik hacim; fabrika kopyası YASAK — `rolls` > 0 kaynaktan klon
// test-db aracınca reddedilir, bu betik klonlamaz).
//   cd Teks-Erp && DATABASE_URL='…/tekserp_<x>perf_test' npx tsx scripts/olcum-patron-olay-turu.ts dolgu
//   cd Teks-Erp && DATABASE_URL='…/tekserp_<x>perf_test' node ../scripts/agir-is.mjs -- \
//     npx tsx scripts/olcum-patron-olay-turu.ts olc [--tekrar=5] [--surekli-sn=300] [--json=<dosya>]
// `dolgu`: 500 cari (createMany) + `seed-load-scale.ts` (sipariş/kalem/iş emri/top/hareket/çuval/sevkiyat; o betiğin
// ad kapısı `teks_loadtest` ister → hedef bu betiğin kapısından geçtikten sonra URL'ye `application_name` eklenir).
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

function hedefKapisi(): void {
  const ad = hedefDbAdi();
  const engel = hedefDbEngeli();
  if (engel || !PERF_AD.test(ad)) {
    console.error(`⛔ hedef reddi: '${ad}' ${engel ?? "adı `tekserp_*perf*_test` kalıbında değil"}`);
    process.exit(2);
  }
}

// ── SQL sayacı ────────────────────────────────────────────────────────────────
interface Sayac { n: number; ms: number }
const als = new AsyncLocalStorage<Sayac>();
const origQuery = Client.prototype.query;
(Client.prototype as unknown as { query: (...a: unknown[]) => unknown }).query = function (this: Client, ...args: unknown[]): unknown {
  const ctx = als.getStore();
  if (!ctx) return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
  const t0 = performance.now();
  const bitti = (): void => {
    ctx.n++;
    ctx.ms += performance.now() - t0;
  };
  const son = args[args.length - 1];
  if (typeof son === "function") {
    args[args.length - 1] = function (this: unknown, ...cb: unknown[]) {
      bitti();
      return (son as (...x: unknown[]) => unknown).apply(this, cb);
    };
    return (origQuery as (...a: unknown[]) => unknown).apply(this, args);
  }
  const r = (origQuery as (...a: unknown[]) => unknown).apply(this, args) as Promise<unknown> | undefined;
  if (r && typeof (r as Promise<unknown>).then === "function") return r.then((v) => (bitti(), v), (e: unknown) => { bitti(); throw e; });
  return r;
};

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
  const tablolar = ["rolls", "roll_movements", "orders", "order_lines", "customers", "work_orders", "sacks", "shipments", "system_logs"];
  const out: Record<string, number> = {};
  for (const t of tablolar) out[t] = Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`)).rows[0]?.n ?? 0);
  return out;
}

// ── dolgu ─────────────────────────────────────────────────────────────────────
async function dolgu(): Promise<number> {
  const mevcut = await prisma.customer.count();
  if (mevcut < 500) {
    const n = 520 - mevcut;
    const r = await prisma.customer.createMany({
      data: Array.from({ length: n }, (_, i) => ({ code: `OLC${String(i + 1).padStart(5, "0")}`, name: `Ölçüm Cari ${i + 1}`, isCustomerRole: true })),
      skipDuplicates: true,
    });
    console.log(`cari: +${r.count}`);
  }
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("application_name", "teks_loadtest_olcum");
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed-load-scale.ts"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url.toString(), ORDERS_PER_DAY: arg("gunluk") ?? "10", DAYS: arg("gun") ?? "365" },
    stdio: "inherit",
  });
  console.log(JSON.stringify(await hacim()));
  return r.status ?? 1;
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
    await prisma.syncWatermark.deleteMany({});
    await prisma.syncMark.deleteMany({});
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
      const xs: Array<{ duvarMs: number; sql: number; dbMs: number }> = [];
      for (let i = 0; i < TEKRAR; i++) {
        await hazirla();
        await ufkuGec();
        xs.push(await tur());
      }
      rapor[ad] = { olcumler: xs, duvar: ozet(xs.map((x) => x.duvarMs)), db: ozet(xs.map((x) => x.dbMs)), sql: ozet(xs.map((x) => x.sql)) };
      console.log(`${ad}: ${JSON.stringify(rapor[ad])}`);
    };
    await seri("a_degisiklikYok", async () => undefined);
    await seri("b_tekSiparis", siparisDegistir);
    await seri("c_yuzTopHareketi", () => topHareketi(100));
    rapor.kirilim = await kirilim();
    console.log(`kırılım: ${JSON.stringify(rapor.kirilim)}`);

    // Sürekli yazma: saniyede 1 top hareketi (+ top damgası), 5 sn'de bir sipariş değişikliği; tur 15 sn'de bir.
    const bitis = Date.now() + SUREKLI_SN * 1000;
    const yazici = { hareket: 0, siparis: 0 };
    const yaz = (async () => {
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
    })();
    const turlar: Array<{ duvarMs: number; sql: number; dbMs: number }> = [];
    const t0 = Date.now();
    while (Date.now() < bitis) {
      const bas = Date.now();
      turlar.push(await tur());
      await uyu(Math.max(0, TUR_ARALIGI_MS - (Date.now() - bas)));
    }
    await yaz;
    const duvar = Date.now() - t0;
    const dbToplam = turlar.reduce((a, b) => a + b.dbMs, 0);
    const turToplam = turlar.reduce((a, b) => a + b.duvarMs, 0);
    rapor.d_surekli = {
      sureMs: duvar, tur: turlar.length, yazici,
      turDuvar: ozet(turlar.map((x) => x.duvarMs)), turDb: ozet(turlar.map((x) => x.dbMs)), turSql: ozet(turlar.map((x) => x.sql)),
      dbOraniYuzde: Number(((dbToplam / duvar) * 100).toFixed(2)), turDuvarOraniYuzde: Number(((turToplam / duvar) * 100).toFixed(2)),
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
  console.error("kullanım: olcum-patron-olay-turu.ts dolgu|olc [--tekrar=5] [--surekli-sn=300] [--json=<dosya>]");
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
