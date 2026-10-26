// =============================================================================
// BEKÇİ — PATRON BULUTU OLAY GÜDÜMLÜ TUR (`cloud-sync/dirty-flag.ts` + `jobs/cloud-sync.job.ts`, P4)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bulut_olay_gudumlu   (kendi _test DB'si; ~25 sn)
//
// NE ÖLÇER (sahte bulut + enjekte kapı saati + elle tetiklenen zamanlayıcı):
//   §1 ⭐ bayrak KAPALI → yazım kirli kümeye düşer, 20 sn boyunca `/v1/esitle` YOK (bugünkü davranış)
//   §2 ⭐ bayrak açık + ön koşul uygun → zamanlayıcı ilk kirlenmeden 3 sn sonra, TEK tur, değişen satır pakette
//   §3 ⭐ birleştirme penceresindeki 5 yazım → TEK tur, beşi de o turda (debounce)
//   §4 ⭐ ardışık tetikte iki tur arası ≥15 sn
//   §5 ⭐ ön koşul kapalı (abonelik yok) → zamanlayıcı kurulmaz, doğrudan tur da dışarı istek atmaz
//   §6 ⭐ itx · toplu tx · ham SQL yazımı kirletir; okuma ve advisory kilit kirletmez
//   §7 ⭐ izlenen tablo kümesi (kökler ∪ `READS_MODEL_MAP`) = katalog değişiklik kaynakları (iki yönlü);
//      harita şemadaki `@@map`le birebir; her delege istemcide var; `markDirty` tek yazar; sarma tek nokta
//   §8 zil turu tüm projeksiyonlar (`snapshotsOnly: false`); gelen kutusu işlenince olay turu istenir
//   §9 ⭐ dinleyici ya da işaretleme adımı fırlatsa da izlenen modelde yazma (create · update · itx ·
//      `$executeRaw`) BAŞARILI, satır DB'de görünür (iyileştirme katmanı yazma yolunu kıramaz)
//   §10 ⭐ sarma yerinde yamaya şeffaf: `prisma.$transaction` / delege yöntemi değiştirilince yeni
//      kaynak çağrılır, geri yükleme kendi sarmasını yeniden sarmaz (`zorlanmis-sira` kancası buna dayanır)
//
// NEGATİF SONDA (dosya dışı mutasyon, geri alındı; sonuç DEVIR notunda):
//   N1 `EVENT_DEBOUNCE_MS = 0` → §2a + §3a ❌ (ilk yazım anında tur, kalan dördü 15 sn sonraki turda)
//   N2 `EVENT_MIN_GAP_MS = 0`  → §4 ❌
//   N3 `markDirty` dinleyici try/catch'i kaldırıldı → §9f ❌ (ikinci tablo işaretsiz kalır)
//   N4 `safeMark` try/catch'i kaldırıldı → §9g ❌ (saat hatası yazmayı düşürür)
//   N5 ikisi birden kaldırıldı → §9a–§9d ❌ (dinleyici hatası yazma çağrısına yayılır)
//   N6 `cachedWrap` kaynak kimliği yerine yalnız `prop`la önbellekler → §10a + §10c ❌ (CI'da
//      `test_token_replay_d3_yollari` / `test_wo_roll_detach` "B kapıya varmadı" ile yakalamıştı)
//   N7 `OWN_WRAPPERS` kontrolü kaldırıldı → §10b + §10d ❌ (geri yüklenen sarma yeniden sarılır)
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuditService } from "../src/services/audit.service";
import { runSyncRound } from "../src/cloud-sync/sync-round";
import { egressCloudTransport } from "../src/cloud-sync/cloud-client";
import { HORIZON_BASE_MARGIN_MS } from "../src/cloud-sync/horizon";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import {
  READS_MODEL_MAP, catalogChangeTables, onDirty, peekDirty, watchedDelegateKeys, __resetDirtyForTests,
} from "../src/cloud-sync/dirty-flag";
import {
  EVENT_DEBOUNCE_MS, EVENT_MIN_GAP_MS, getCloudSyncStatus, requestEventRound, runEventRound, __configureCloudSyncForTests,
} from "../src/jobs/cloud-sync.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { bulutLisansKur, sahteBulutBaslat, type SahteBulut, type BulutLisans } from "./lib/bulut-fikstur";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

AuditService.logEvent = async () => undefined;
AuditService.log = async () => undefined;

const TAG = `BLOG${Date.now().toString(36).toUpperCase()}`;
const ROOT = path.join(__dirname, "..");
/** Plan değerleri (K1) LİTERAL — işin sabitine bağlanırsa mutasyonda bekçi kör kalır. */
const PLAN_DEBOUNCE_MS = 3_000;
const PLAN_MIN_GAP_MS = 15_000;

// ── Kapı saati + elle tetiklenen zamanlayıcı ───────────────────────────────────
let now = Date.now();
const timers: Array<{ at: number; fn: () => Promise<void>; iptal: boolean }> = [];
function eventTimer(fn: () => Promise<void>, delayMs: number): { cancel(): void } {
  const t = { at: now + delayMs, fn, iptal: false };
  timers.push(t);
  return { cancel: () => { t.iptal = true; } };
}
const bekleyen = (): Array<{ at: number }> => timers.filter((t) => !t.iptal);
/** Kapı saatini ilerletir, vakti gelen zamanlayıcıları sırayla koşar (turun bitmesini bekler). */
async function ilerle(ms: number): Promise<void> {
  const hedef = now + ms;
  for (;;) {
    const sira = timers.filter((t) => !t.iptal && t.at <= hedef).sort((a, b) => a.at - b.at)[0];
    if (!sira) break;
    sira.iptal = true;
    now = Math.max(now, sira.at);
    await sira.fn();
  }
  now = hedef;
}
/** Güvenli ufuk DB saatinin pay kadar gerisindedir: yeni yazım, pay geçmeden turda görünmez. */
const ufkuGec = (): Promise<void> => new Promise((r) => setTimeout(r, HORIZON_BASE_MARGIN_MS + 600));

const esitleSayisi = (b: SahteBulut): number => b.istekler.filter((i) => i.yol === "/v1/esitle").length;
function renkSatirlari(b: SahteBulut, n0: number): Set<string> {
  const out = new Set<string>();
  for (const p of b.paketler.slice(n0)) for (const k of p.kayitlar) if (k.projeksiyon === "renk") for (const r of k.yaz) out.add(String(r.id));
  return out;
}

async function bayrak(acik: boolean): Promise<void> {
  const key = SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU;
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: acik }, update: { value: acik } });
}

async function renkYarat(ek: string): Promise<string> {
  const c = await prisma.color.create({ data: { code: `${TAG}${ek}`, name: `${TAG} renk ${ek}` }, select: { id: true } });
  return c.id;
}
const renkDegistir = (id: string, ad: string) => prisma.color.update({ where: { id }, data: { name: `${TAG} ${ad}` } });

/** Bölüm başı: iş durumu sıfır, kirli küme boş, kapı saati şimdi (önceki turun aralığı sayılmaz). */
function bolumBasi(): void {
  timers.length = 0;
  now = Date.now();
  __configureCloudSyncForTests({ transport: egressCloudTransport, reset: true, now: () => now, eventTimer });
  __resetDirtyForTests({ now: () => now });
}

async function kapaliBolumu(bulut: SahteBulut, renk: string): Promise<void> {
  console.log("\n§1 — bayrak kapalı: kirli küme dolar, dışarı istek yok");
  await bayrak(false);
  bolumBasi();
  const e0 = esitleSayisi(bulut);
  await renkDegistir(renk, "kapali");
  const kirli = peekDirty();
  check("§1a yazım kirli kümeye düştü (colors)", kirli.tables.has("colors") && kirli.firstDirtyAt === now, [...kirli.tables].join(","));
  await ilerle(20_000);
  check("§1b ⭐ 20 sn boyunca `/v1/esitle` YOK (bayrak kapalı = bugünkü davranış)", esitleSayisi(bulut) === e0, `${esitleSayisi(bulut) - e0} istek`);
  check("§1c kirli küme tüketilmedi (kira turu kapsar)", peekDirty().tables.has("colors"));
  check("§1d durum: olay turu yok", getCloudSyncStatus().lastEventRoundAt === null && getCloudSyncStatus().lastTrigger === null);
}

async function acikBolumu(bulut: SahteBulut, renk: string): Promise<void> {
  console.log("\n§2 — bayrak açık + uygun: 3 sn sonra tek tur");
  await bayrak(true);
  bolumBasi();
  const e0 = esitleSayisi(bulut);
  const n0 = bulut.paketler.length;
  const t0 = now;
  await renkDegistir(renk, "acik");
  const z = bekleyen();
  check("§2a ⭐ tek zamanlayıcı, ilk kirlenmeden 3 sn sonra", z.length === 1 && z[0]!.at - t0 === PLAN_DEBOUNCE_MS && EVENT_DEBOUNCE_MS === PLAN_DEBOUNCE_MS, z.map((x) => x.at - t0).join(","));
  await ufkuGec();
  await ilerle(EVENT_DEBOUNCE_MS - 1);
  check("§2b debounce dolmadan istek yok", esitleSayisi(bulut) === e0);
  await ilerle(1);
  const st = getCloudSyncStatus();
  check("§2c ⭐ tek `/v1/esitle`, değişen renk satırı pakette, tetik 'olay'", esitleSayisi(bulut) - e0 === 1 && renkSatirlari(bulut, n0).has(renk) && st.lastTrigger === "olay" && st.lastEventRoundAt === t0 + EVENT_DEBOUNCE_MS,
    `${esitleSayisi(bulut) - e0} istek · ${st.lastTrigger} · ${st.lastOutcome?.status}`);
  check("§2d tur kirli kümeyi tüketti", peekDirty().tables.size === 0);
}

async function birlestirmeBolumu(bulut: SahteBulut): Promise<string> {
  console.log("\n§3 — birleştirme: pencere içindeki 5 yazım tek turda");
  bolumBasi();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await renkYarat(`B${i}`));
  bolumBasi();
  const e0 = esitleSayisi(bulut);
  const n0 = bulut.paketler.length;
  for (let i = 0; i < 5; i++) {
    await renkDegistir(ids[i]!, `birlesik ${i}`);
    await ilerle(500);
  }
  await ufkuGec();
  await ilerle(20_000);
  const giden = renkSatirlari(bulut, n0);
  check("§3a ⭐ 5 yazım → 20 sn içinde TEK tur", esitleSayisi(bulut) - e0 === 1, `${esitleSayisi(bulut) - e0} istek`);
  check("§3b ⭐ beş değişiklik de o turda", ids.every((id) => giden.has(id)), `${ids.filter((id) => giden.has(id)).length}/5`);
  return ids[0]!;
}

async function aralikBolumu(bulut: SahteBulut, renk: string): Promise<void> {
  console.log("\n§4 — iki tur arası ≥15 sn");
  bolumBasi();
  const e0 = esitleSayisi(bulut);
  await renkDegistir(renk, "aralik 1");
  await ufkuGec();
  await ilerle(EVENT_DEBOUNCE_MS);
  const r1 = getCloudSyncStatus().lastEventRoundAt ?? 0;
  await ilerle(1_000);
  await renkDegistir(renk, "aralik 2");
  const z = bekleyen();
  check("§4a ⭐ ikinci zamanlayıcı ilk turdan ≥15 sn sonra", z.length === 1 && z[0]!.at - r1 >= PLAN_MIN_GAP_MS, z.map((x) => x.at - r1).join(","));
  await ufkuGec();
  await ilerle(EVENT_MIN_GAP_MS);
  const r2 = getCloudSyncStatus().lastEventRoundAt ?? 0;
  check("§4b ⭐ iki tur, aralık ≥15 sn", esitleSayisi(bulut) - e0 === 2 && r2 - r1 >= PLAN_MIN_GAP_MS && EVENT_MIN_GAP_MS === PLAN_MIN_GAP_MS, `${esitleSayisi(bulut) - e0} istek · ${r2 - r1} ms`);
}

async function onKosulBolumu(lisans: BulutLisans, bulut: SahteBulut, renk: string): Promise<void> {
  console.log("\n§5 — ön koşul kapalı: fail-closed");
  lisans.lisansiYaz({}, { patronBulutBitis: null });
  bolumBasi();
  const once = bulut.istekler.length;
  await renkDegistir(renk, "abonelik yok");
  check("§5a ⭐ zamanlayıcı kurulmadı (kirli küme yine dolu)", bekleyen().length === 0 && peekDirty().tables.has("colors"));
  await runEventRound();
  await ilerle(30_000);
  check("§5b ⭐ doğrudan tur dahil dışarı SIFIR istek", bulut.istekler.length === once, `${bulut.istekler.length - once} istek`);
  lisans.lisansiYaz();
}

async function itxBolumu(renk: string): Promise<void> {
  console.log("\n§6 — itx · toplu tx · ham SQL");
  __resetDirtyForTests({ now: () => now });
  await prisma.color.findMany({ take: 1 });
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(${1}::int, 0)`;
  await prisma.$queryRaw`SELECT 1 FROM "orders" LIMIT 1`;
  check("§6a okuma · advisory kilit · SELECT kirletmez", peekDirty().tables.size === 0, [...peekDirty().tables].join(","));
  await prisma.$transaction(async (tx) => {
    await tx.color.update({ where: { id: renk }, data: { name: `${TAG} itx` } });
  });
  check("§6b ⭐ interaktif tx içindeki yazım kirletir", peekDirty().tables.has("colors"));
  __resetDirtyForTests({ now: () => now });
  const yok = randomUUID();
  await prisma.$transaction([prisma.sack.updateMany({ where: { id: yok }, data: {} }), prisma.color.count()]);
  check("§6c toplu tx (dizi) içindeki yazım kirletir", peekDirty().tables.has("sacks"), [...peekDirty().tables].join(","));
  __resetDirtyForTests({ now: () => now });
  await prisma.$executeRaw`UPDATE "invoices" SET "updatedAt" = NOW() WHERE "id" = ${yok}::uuid`;
  await prisma.$queryRawUnsafe(`WITH x AS (UPDATE "payments" SET "updatedAt" = NOW() WHERE "id" = $1::uuid RETURNING "id") SELECT count(*) FROM x`, yok);
  check("§6d ham SQL yazımı (şablon + Unsafe/CTE) izlenen tabloyu kirletir", peekDirty().tables.has("invoices") && peekDirty().tables.has("payments"), [...peekDirty().tables].join(","));
  __resetDirtyForTests({ now: () => now });
  await prisma.user.updateMany({ where: { id: yok }, data: {} });
  check("§6e katalog dışı model kirletmez", peekDirty().tables.size === 0);
}

function haritaBolumu(): void {
  console.log("\n§7 — izlenen küme ↔ katalog (iki yönlü)");
  const roots = new Set(RECORD_PROJECTIONS.map((p) => p.root.table));
  const beyan = new Set([...roots, ...Object.keys(READS_MODEL_MAP)]);
  const katalog = catalogChangeTables();
  const eksik = [...katalog].filter((t) => !beyan.has(t));
  const fazla = [...beyan].filter((t) => !katalog.has(t));
  check("§7a ⭐ katalog değişiklik kaynağı → haritada (eksik yok)", eksik.length === 0, eksik.join(","));
  check("§7b ⭐ harita → katalogda (ölü beyan yok)", fazla.length === 0, fazla.join(","));
  const kokCakisma = Object.keys(READS_MODEL_MAP).filter((t) => roots.has(t));
  check("§7c harita kökleri tekrar etmez (kök çifti katalogdan)", kokCakisma.length === 0, kokCakisma.join(","));
  const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
  const tablo = new Map<string, string>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) tablo.set(m[1]!, /@@map\("([^"]+)"\)/.exec(m[2]!)?.[1] ?? m[1]!);
  const yanlis = [
    ...Object.entries(READS_MODEL_MAP).map(([t, m]) => [t, m] as const),
    ...RECORD_PROJECTIONS.map((p) => [p.root.table, p.root.model] as const),
  ].filter(([t, m]) => tablo.get(m) !== t);
  check("§7d ⭐ her model → tablo çifti şemadaki @@map ile birebir", yanlis.length === 0, yanlis.map(([t, m]) => `${m}→${t}≠${tablo.get(m)}`).join(","));
  const istemci = prisma as unknown as Record<string, unknown>;
  const delegesiz = watchedDelegateKeys().filter((k) => typeof (istemci[k] as { updateMany?: unknown } | undefined)?.updateMany !== "function");
  check("§7e her izlenen delege istemcide var", delegesiz.length === 0, delegesiz.join(","));
  const df = fs.readFileSync(path.join(ROOT, "src", "cloud-sync", "dirty-flag.ts"), "utf8");
  const yazanlar = gezSrc(path.join(ROOT, "src")).filter((f) => /import\s*\{[^}]*\bmarkDirty\b[^}]*\}\s*from\s*"[^"]*dirty-flag"/.test(fs.readFileSync(f, "utf8")));
  check("§7f ⭐ `markDirty` TEK yazar (dışa açık değil, kimse içe aktarmıyor)", !/export\s+function\s+markDirty\b/.test(df) && /function markDirty\(/.test(df) && yazanlar.length === 0, yazanlar.map((f) => path.relative(ROOT, f)).join(","));
  const sarma = gezSrc(path.join(ROOT, "src")).filter((f) => /\bwithDirtyTracking\s*\(/.test(fs.readFileSync(f, "utf8")) && !f.endsWith("dirty-flag.ts"));
  check("§7g istemci sarması tek noktada (lib/prisma.ts)", sarma.length === 1 && sarma[0]!.endsWith(path.join("lib", "prisma.ts")), sarma.map((f) => path.relative(ROOT, f)).join(","));
}

function gezSrc(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...gezSrc(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function zilBolumu(): void {
  console.log("\n§8 — zil ve gelen kutusu");
  const is = fs.readFileSync(path.join(ROOT, "src", "jobs", "cloud-sync.job.ts"), "utf8");
  const zil = /async function runSnapshotRound\(\)[\s\S]*?\n\}/.exec(is)?.[0] ?? "";
  check("§8a ⭐ zil turu tüm projeksiyonları tazeler (snapshotsOnly: false)", zil.includes("snapshotsOnly: false") && !zil.includes("snapshotsOnly: true"));
  const gk = fs.readFileSync(path.join(ROOT, "src", "jobs", "cloud-inbox.job.ts"), "utf8");
  check("§8b gelen kutusu işlenince olay turu istenir", /requestEventRound\(\)/.test(gk));
}

async function firlatanDinleyiciBolumu(): Promise<void> {
  console.log("\n§9 — dinleyici fırlatır: yazma yine başarılı");
  __resetDirtyForTests({ now: () => now });
  let cagri = 0;
  onDirty(() => {
    cagri++;
    throw new Error("x");
  });
  const kod = `${TAG}FIR`;
  const sonuc = async (f: () => Promise<unknown>): Promise<string> => {
    try {
      await f();
      return "ok";
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };
  let id = "";
  const c = await sonuc(async () => {
    id = (await prisma.color.create({ data: { code: kod, name: `${TAG} fir` }, select: { id: true } })).id;
  });
  const v1 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  check("§9a ⭐ create başarılı, satır DB'de", c === "ok" && v1?.name === `${TAG} fir`, c);
  const u = await sonuc(() => prisma.color.update({ where: { id }, data: { name: `${TAG} fir-u` } }));
  const v2 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  check("§9b ⭐ update başarılı, değer DB'de", u === "ok" && v2?.name === `${TAG} fir-u`, u);
  const t = await sonuc(() => prisma.$transaction(async (tx) => tx.color.update({ where: { id }, data: { name: `${TAG} fir-tx` } })));
  const v3 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  check("§9c itx içindeki update başarılı, değer DB'de", t === "ok" && v3?.name === `${TAG} fir-tx`, t);
  const r = await sonuc(() => prisma.$executeRaw`UPDATE "colors" SET "name" = ${`${TAG} fir-raw`} WHERE "id" = ${id}::uuid`);
  const v4 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  check("§9d ⭐ `$executeRaw` başarılı, değer DB'de", r === "ok" && v4?.name === `${TAG} fir-raw`, r);
  check("§9e dinleyici gerçekten çağrıldı ve kirli küme doldu (sonda boş değil)", cagri >= 4 && peekDirty().tables.has("colors"), `${cagri} çağrı`);
  // Çok tablolu ham SQL: ilk tablonun dinleyici hatası ikinci tablonun işaretini düşürmez (iç catch).
  __resetDirtyForTests({ now: () => now });
  const yok = randomUUID();
  const m = await sonuc(() => prisma.$queryRawUnsafe(
    `WITH a AS (UPDATE "colors" SET "name" = $1 WHERE "id" = $2::uuid RETURNING 1), b AS (UPDATE "invoices" SET "updatedAt" = NOW() WHERE "id" = $3::uuid RETURNING 1) SELECT (SELECT count(*) FROM a) + (SELECT count(*) FROM b) AS n`,
    `${TAG} fir-cok`, id, yok,
  ));
  const v5 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  check("§9f ⭐ çok tablolu ham SQL: yazma DB'de + İKİ tablo da işaretli", m === "ok" && v5?.name === `${TAG} fir-cok` && peekDirty().tables.has("colors") && peekDirty().tables.has("invoices"),
    `${m} · ${[...peekDirty().tables].join(",")}`);
  // İşaretleme adımının kendisi fırlatır (saat): gerçek Prisma çağrısı yine yapılır (`safeMark`).
  onDirty(null);
  __resetDirtyForTests({ now: () => { throw new Error("saat"); } });
  const s1 = await sonuc(() => prisma.color.update({ where: { id }, data: { name: `${TAG} fir-saat` } }));
  __resetDirtyForTests({ now: () => { throw new Error("saat"); } });
  const s2 = await sonuc(() => prisma.$executeRaw`UPDATE "colors" SET "name" = ${`${TAG} fir-saat-raw`} WHERE "id" = ${id}::uuid`);
  const v6 = id ? await prisma.color.findUnique({ where: { id }, select: { name: true } }) : null;
  __resetDirtyForTests({ now: () => now });
  check("§9g ⭐ işaretleme fırlatır (model + ham yol): yazma DB'de", s1 === "ok" && s2 === "ok" && v6?.name === `${TAG} fir-saat-raw`, `${s1} · ${s2}`);
}

async function yamaBolumu(): Promise<void> {
  console.log("\n§10 — sarma yerinde yamaya şeffaf");
  const kanca = prisma as unknown as { $transaction: (...a: unknown[]) => unknown };
  const onceki = kanca.$transaction;
  let yamaCagri = 0;
  try {
    kanca.$transaction = (...a: unknown[]) => {
      yamaCagri++;
      return Reflect.apply(onceki, prisma, a);
    };
    await prisma.$transaction(async (tx) => tx.color.count());
    check("§10a ⭐ yamalanmış `$transaction` çağrıldı", yamaCagri === 1, `${yamaCagri} çağrı`);
  } finally {
    kanca.$transaction = onceki;
  }
  check("§10b geri yükleme sonrası aynı sarma (çift sarma yok)", prisma.$transaction === onceki);
  const delege = prisma.color as unknown as Record<string, unknown>;
  const eskiUpdate = delege.updateMany as (...a: unknown[]) => unknown;
  let dCagri = 0;
  try {
    delege.updateMany = (...a: unknown[]) => {
      dCagri++;
      return Reflect.apply(eskiUpdate, delege, a);
    };
    await prisma.color.updateMany({ where: { id: randomUUID() }, data: {} });
    check("§10c ⭐ yamalanmış delege yöntemi çağrıldı", dCagri === 1, `${dCagri} çağrı`);
  } finally {
    delege.updateMany = eskiUpdate;
  }
  check("§10d delege geri yükleme sonrası aynı sarma", (prisma.color as unknown as Record<string, unknown>).updateMany === eskiUpdate);
}

async function main(): Promise<void> {
  console.log(`=== PATRON BULUTU OLAY GÜDÜMLÜ TUR (${TAG}) ===`);
  let bulut: SahteBulut | null = null;
  let lisans: BulutLisans | null = null;
  const key = SETTING_KEYS.PATRON_BULUT_OLAY_GUDUMLU;
  const eskiBayrak = await prisma.systemSetting.findUnique({ where: { key } });
  try {
    await prisma.syncWatermark.deleteMany({});
    await prisma.syncMark.deleteMany({});
    const renk = await renkYarat("ANA");
    lisans = await bulutLisansKur();
    bulut = await sahteBulutBaslat(lisans.x);
    // İlk tur TAM'dır; ölçümler artımlı turlarda yapılır.
    await runSyncRound({ kind: "ARTIMLI", cadences: new Set(["HER_TUR"]) }, { transport: egressCloudTransport });
    onDirty(requestEventRound);
    await kapaliBolumu(bulut, renk);
    await acikBolumu(bulut, renk);
    const r3 = await birlestirmeBolumu(bulut);
    await aralikBolumu(bulut, r3);
    await onKosulBolumu(lisans, bulut, renk);
    await itxBolumu(renk);
    haritaBolumu();
    zilBolumu();
    await firlatanDinleyiciBolumu();
    await yamaBolumu();
  } catch (e) {
    check("beklenmeyen hata", false, e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    onDirty(null);
    __configureCloudSyncForTests({ reset: true, now: Date.now, eventTimer: null });
    await bulut?.kapat();
    if (eskiBayrak) await prisma.systemSetting.update({ where: { key }, data: { value: eskiBayrak.value ?? false } }).catch(() => undefined);
    else await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DELETE FROM "colors" WHERE "code" LIKE $1`, `${TAG}%`).catch(() => undefined);
    await prisma.syncWatermark.deleteMany({}).catch(() => undefined);
    await prisma.syncMark.deleteMany({}).catch(() => undefined);
    if (lisans) fs.rmSync(lisans.dizin, { recursive: true, force: true });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end().catch(() => undefined);
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
