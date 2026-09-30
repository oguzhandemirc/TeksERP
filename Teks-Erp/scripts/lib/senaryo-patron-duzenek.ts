// SENARYO P — düzenek: hedef kapısı, sahte satıcı (lisans + SSE zil), sahte satıcı iç API'si, GERÇEK patron
// bulutu süreci ve GERÇEK fabrika backend'i (patron-bulut hakkı fikstürden, URETIM). Her koşum yeni lisans
// kimliği + yeni tesis doğurur; fabrika `_test` DB'sinde eşitleme zinciri (sync_watermarks) sıfırlanır.
// Kapanış yalnız kendi doğurduğumuz süreçlere (PID). `test_` öneki yok → bekçi değil.
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as dotenvParse } from "dotenv";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../../src/lib/pg-session";
import { DAY_MS, msToIso } from "../../src/lib/license/protocol";
import { fixtureHedefEngeli, hacimHedefEngeli } from "./hedef-db-kapisi";
import { fiksturKur, type Fikstur } from "./lisans-fikstur";
import { sahteSaticiBaslat, type SahteSatici } from "./lisans-sahte-satici";
import { FabrikaIstemcisi } from "./senaryo-lisans-istemci";
import { bekle, bosPort, fabrikaBaslat, type FabrikaSureci } from "./senaryo-lisans-surec";
import { icApiBaslat, type IcApi, type IcKurulum } from "./senaryo-patron-ic-api";
import { PATRON_KOKU, davetiTamamla, patronBaslat, yoneticiDavetEt, type BulutHesabi, type PatronSureci } from "./senaryo-patron-bulut";

export const HAK_MODULLERI = ["production.enabled", "finance.enabled", "patron-bulut"];
const KOK_ONEKI = "tekserp-senaryo-p-";

export function dbAdi(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

/** Fabrika DB kapısı — Senaryo L ile aynı: ad allowlist'i + hacim ölçümü (fail-closed). */
async function fabrikaHedefKapisi(url: string): Promise<void> {
  const ad = dbAdi(url);
  if (ad.startsWith("tekserp_fabrika_")) throw new Error(`'${ad}' fabrika verisi sınıfında`);
  const engel = fixtureHedefEngeli();
  if (engel) throw new Error(engel);
  const hacim = await hacimHedefEngeli();
  if (hacim.engel) throw new Error(hacim.engel);
}

export interface PatronDbUrlleri {
  readonly goc: string;
  readonly app: string;
  readonly sync: string;
}

/** Patron DB'leri `patron/sunucu/.env`den (kopyalanmaz, okunur); üçü de AYNI `_test` DB olmalı. */
export function patronDbUrlleri(): PatronDbUrlleri {
  const dosya = path.join(PATRON_KOKU, ".env");
  const e = fs.existsSync(dosya) ? dotenvParse(fs.readFileSync(dosya)) : {};
  const goc = process.env.PATRON_GOC_DATABASE_URL ?? e.GOC_DATABASE_URL ?? "";
  const app = process.env.PATRON_DATABASE_URL ?? e.DATABASE_URL ?? "";
  const sync = process.env.PATRON_ESITLEME_DATABASE_URL ?? e.ESITLEME_DATABASE_URL ?? "";
  const adlar = new Set([goc, app, sync].map(dbAdi));
  const ad = dbAdi(goc);
  if (!goc || !app || !sync || adlar.size !== 1 || !ad.endsWith("_test") || ad.startsWith("tekserp_fabrika_")) {
    throw new Error(`patron DB'si: üç URL aynı *_test DB'yi göstermeli (bulunan: ${[...adlar].join(", ") || "yok"})`);
  }
  return { goc, app, sync };
}

export interface Duzenek {
  readonly kok: string;
  readonly logDizini: string;
  readonly fabrikaUrl: string;
  readonly patronUrl: PatronDbUrlleri;
  readonly f: Fikstur;
  readonly satici: SahteSatici;
  readonly ic: IcApi;
  patron: PatronSureci;
  /** Patron sürecini aynı portta yeniden başlatır (açılışta günlük bakım koşar). */
  patronYenidenBaslat(): Promise<void>;
  readonly patronEnv: NodeJS.ProcessEnv;
  fabrika: FabrikaSureci;
  readonly istemci: FabrikaIstemcisi;
  readonly lisansId: string;
  readonly tesisId: string;
  readonly kurulum: IcKurulum;
  readonly yonetici: BulutHesabi;
  readonly fdb: Pool;
  readonly bdb: Pool;
  readonly adb: Pool;
  /** Adımlar arası paylaşılan kimlikler (P2 carisi, ürün…). */
  readonly ortak: Record<string, string>;
  /** Fabrika sürecinde aralık beklemeden bir eşitleme turu (zamanlayıcının kendi fonksiyonu). */
  tur(secenek?: { uzlastirma?: boolean }): Promise<TurDurumu>;
  durum(): Promise<TurDurumu>;
  /** Fabrika sürecinde bir gelen kutusu koşumu (zamanlayıcının kendi fonksiyonu). */
  gelenKutusu(): Promise<{ outcomes?: Array<Record<string, unknown>>; hata?: string }>;
  kapat(basarili: boolean): Promise<void>;
}

export interface TurDurumu {
  readonly eligible: boolean;
  readonly blockReason: string | null;
  readonly lastRoundAt: number | null;
  readonly lastOutcome: { status: string; reason: string | null; packets: number; horizon: string | null; contractWarning: string | null } | null;
  readonly lastReconcileYmd: string | null;
}

export function kiraVarsayilani(): Record<string, unknown> {
  return { zorlama: false, esitlemeAraligiDk: 1, patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS) };
}


/** Kurulum: her adım başarısızsa atar (koşucu çıkış 2). `kayit` = kapanışta kapatılacak süreç/sunucular. */
export async function duzenekKur(): Promise<Duzenek> {
  const fabrikaUrl = process.env.DATABASE_URL ?? "";
  if (!fabrikaUrl) throw new Error("DATABASE_URL (fabrika _test DB'si) zorunlu");
  await fabrikaHedefKapisi(fabrikaUrl);
  const patronUrl = patronDbUrlleri();
  if (dbAdi(patronUrl.goc) === dbAdi(fabrikaUrl)) throw new Error("patron ve fabrika DB'si ayrı olmalı");
  console.log(`🎯 Fabrika: ${dbAdi(fabrikaUrl)} · Patron bulutu: ${dbAdi(patronUrl.goc)}`);

  const kok = fs.mkdtempSync(path.join(os.tmpdir(), KOK_ONEKI));
  const logDizini = path.join(kok, "log");
  fs.mkdirSync(logDizini);
  console.log(`🗂  Geçici kök: ${kok}`);
  const fdb = new Pool({ connectionString: fabrikaUrl, max: 3, options: PG_SESSION_OPTIONS });
  const bdb = new Pool({ connectionString: patronUrl.goc, max: 3, options: PG_SESSION_OPTIONS });
  const adb = new Pool({ connectionString: patronUrl.app, max: 2, options: PG_SESSION_OPTIONS });
  // Yeni tesis → fabrikanın eşitleme zinciri baştan (kendi `_test` DB'si; yalnız zincir durumu).
  const silinen = await fdb.query(`DELETE FROM sync_watermarks`);
  if (silinen.rowCount) console.log(`🧹 önceki koşumun ${silinen.rowCount} filigranı silindi (yeni tesis, yeni zincir)`);

  // Senaryonun ölçtüğü modüller açık (kendi `_test` DB'si; finans projeksiyonları modül kapısından geçer).
  for (const anahtar of ["production.enabled", "finance.enabled", "finance.pricingEnabled", "ticaret.enabled"]) {
    await fdb.query(
      `INSERT INTO system_settings (key, value, "updatedAt") VALUES ($1, 'true'::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, "updatedAt" = now()`,
      [anahtar],
    );
  }
  const f = fiksturKur(Date.now());
  const capaDosyasi = path.join(kok, "capa.json");
  fs.writeFileSync(capaDosyasi, JSON.stringify(f.kokler), { mode: 0o600 });
  const satici = await sahteSaticiBaslat(f);
  satici.hakEk = { sinif: "URETIM", moduller: [...HAK_MODULLERI] };
  satici.kiraEk = kiraVarsayilani();
  const caDosyasi = path.join(kok, "satici-ca.pem");
  fs.writeFileSync(caDosyasi, satici.ca);

  const tesisId = randomUUID();
  const ic = await icApiBaslat((t, konu) => {
    if (t === tesisId) satici.zil(konu);
  });
  const patronEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GOC_DATABASE_URL: patronUrl.goc,
    DATABASE_URL: patronUrl.app,
    ESITLEME_DATABASE_URL: patronUrl.sync,
    PORT: String(await bosPort()),
    BIND: "127.0.0.1",
    ANAHTAR_DIZINI: path.join(kok, "patron-anahtar"),
    KURULUM_KAYNAGI: "satici",
    SATICI_IC_API_URL: ic.url,
    SATICI_IC_API_BELIRTECI: ic.belirtec,
    KURULUM_ONBELLEK_DK: "1",
    BAKIM_ARALIGI_SN: "2",
    // P5 push kaydı (B5): kayıtlı SAHTE taşıyıcı — ağ yok, olay üretimi + gönderim gerçek kodla, en kısa aralık.
    BILDIRIM_KIPI: "sahte",
    BILDIRIM_ARALIGI_SN: "5",
  };
  const roller = spawnSync(process.execPath, ["--import", "tsx", "scripts/db-rolleri.ts"], { cwd: PATRON_KOKU, env: patronEnv, encoding: "utf8", timeout: 60_000 });
  if (roller.status !== 0) throw new Error(`patron db-rolleri düştü: ${roller.stderr || roller.stdout}`);
  const ac = spawnSync(process.execPath, ["--import", "tsx", "scripts/tesis.ts", "tesis-ac", `--tesis=${tesisId}`, `--ad=Senaryo P Tekstil ${tesisId.slice(0, 6)}`, "--saklama=13"], {
    cwd: PATRON_KOKU,
    env: patronEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (ac.status !== 0) throw new Error(`tesis-ac düştü: ${ac.stderr || ac.stdout}`);
  const patron = await patronBaslat(patronEnv, path.join(logDizini, "patron.log"));

  const fabrika = await fabrikaBaslat({
    ad: "P",
    databaseUrl: fabrikaUrl,
    lisansDizini: path.join(kok, "lisans"),
    yedekDizini: path.join(kok, "yedek"),
    saticiAdresi: satici.url,
    capaDosyasi,
    tlsSertifikasi: caDosyasi,
    parmakIzi: { makine: "5E0A0001-0000-4000-8000-0000000000F1", seri: "SENARYOP01" },
    jwtSecret: randomBytes(48).toString("hex"),
    saat: { duvarMs: 0, monoMs: 0 },
    logDosyasi: path.join(logDizini, "fabrika.log"),
    pgBinDir: process.env.PG_BIN_DIR,
    giris: "scripts/lib/senaryo-patron-sunucu.ts",
    ekEnv: { PATRON_CLOUD_URL: patron.url },
  });
  const istemci = new FabrikaIstemcisi(fabrika.url, { username: "admin", password: "123123" });
  const g = await istemci.giris();
  if (g.status !== 200) throw new Error(`fabrika girişi ${g.status} ${g.kod ?? ""}`);
  if ((await istemci.bekle((d) => d.hazir, 30_000)).ms === null) throw new Error("lisans motoru hazır olmadı");
  const kb = await istemci.sozlesmeyiKabulEt();
  if (kb.status !== 201) throw new Error(`sözleşme kabulü ${kb.status} ${kb.kod ?? ""}`);
  const e = await istemci.istek("POST", "/api/license/etkinlestir", { kod: satici.kod });
  if (e.status !== 200) throw new Error(`etkinleştirme ${e.status} ${e.kod ?? ""}`);
  const lisansId = f.kurulumId;
  const x = satici.kayitliAnahtarX();
  if (!x) throw new Error("sahte satıcı kurulum anahtarını kaydetmedi");
  const kurulum: IcKurulum = {
    kurulumId: lisansId,
    tesis: { id: tesisId, ad: `Senaryo P Tekstil ${tesisId.slice(0, 6)}` },
    acikAnahtar: x,
    sinif: "URETIM",
    moduller: [...HAK_MODULLERI],
    patronBulutBitis: msToIso(Date.now() + 30 * DAY_MS),
    devredildi: false,
    aktif: true,
    saklamaAy: 13,
  };
  ic.kurulumlar.set(lisansId, kurulum);
  const pb = await istemci.istek("POST", "/api/patron-bulut/etkinlestir", {});
  if (pb.status !== 200) throw new Error(`patron bulutu etkinleştirme ${pb.status} ${pb.kod ?? ""}`);
  const eposta = `patron-${tesisId.slice(0, 8)}@senaryo-p.test`;
  const yonetici = await davetiTamamla(patron.url, yoneticiDavetEt(patronEnv, tesisId, eposta), eposta);

  const d: Duzenek = {
    kok, logDizini, fabrikaUrl, patronUrl, f, satici, ic, patron, patronEnv, fabrika, istemci, lisansId, tesisId, kurulum, yonetici, fdb, bdb, adb, ortak: {},
    async tur(secenek = {}) {
      const r = await d.fabrika.ipc<{ durum?: TurDurumu; hata?: string }>({ tip: "senaryo-bulut-tur", ...secenek }, "senaryo-bulut-tur-tamam", 180_000);
      if (r.hata) throw new Error(`tur: ${r.hata}`);
      return r.durum!;
    },
    async patronYenidenBaslat() {
      await d.patron.durdur();
      d.patron = await patronBaslat(patronEnv, path.join(logDizini, "patron.log"));
    },
    async gelenKutusu() {
      const r = await d.fabrika.ipc<{ sonuc?: { outcomes?: Array<Record<string, unknown>> }; hata?: string }>({ tip: "senaryo-gelen-kutusu" }, "senaryo-gelen-kutusu-tamam", 60_000);
      return r.hata ? { hata: r.hata } : { outcomes: r.sonuc?.outcomes ?? [] };
    },
    async durum() {
      const r = await d.fabrika.ipc<{ durum: TurDurumu }>({ tip: "senaryo-bulut-durum" }, "senaryo-bulut-durum-tamam", 10_000);
      return r.durum;
    },
    async kapat(basarili: boolean) {
      await d.fabrika.durdur().catch(() => undefined);
      await d.patron.durdur().catch(() => undefined);
      await satici.kapat().catch(() => undefined);
      await ic.kapat().catch(() => undefined);
      await tesisTemizle(bdb, tesisId).catch((err: Error) => console.log(`⚠️ bulut tesis temizliği: ${err.message}`));
      for (const p of [fdb, bdb, adb]) await p.end().catch(() => undefined);
      // Fikstür topları süreç içi Prisma ile doğar (yalnız kullanıldıysa bağlıdır).
      await (await import("../../src/lib/prisma")).default.$disconnect().catch(() => undefined);
      if (basarili) fs.rmSync(kok, { recursive: true, force: true });
      else console.log(`🗂  Kanıt/günlükler: ${logDizini}`);
    },
  };
  return d;
}

/** Bulut `_test` DB'sinde yalnız BU koşumun tesisi (göç rolü); başka tesisin satırına dokunmaz. */
async function tesisTemizle(bdb: Pool, tesisId: string): Promise<void> {
  const r = await bdb.query<{ t: string }>(
    `SELECT c.table_name AS t FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.column_name = 'tesis_id'`,
  );
  const tablolar = r.rows.map((x) => x.t).filter((t) => t !== "facilities");
  for (let tur = 0; tur < 3; tur++) {
    for (const t of tablolar) await bdb.query(`DELETE FROM "${t}" WHERE tesis_id = $1`, [tesisId]).catch(() => undefined);
  }
  await bdb.query(`DELETE FROM facilities WHERE tesis_id = $1`, [tesisId]);
}

export { bekle };
