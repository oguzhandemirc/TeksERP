// =============================================================================
// SENARYO L — lisans uçtan uca (plan §8 "Senaryo L", adımlar L1…L34 SIRAYLA)
// =============================================================================
// Koşum (Teks-Erp/ içinden; hedefler YALNIZ `_test` DB — fabrika DB'lerine ASLA):
//   DATABASE_URL='postgresql://…/<ana>_test?schema=public' \
//   SENARYO_DR_DATABASE_URL='…/<dr>_test' SENARYO_BAYI_DATABASE_URL='…/<bayi>_test' \
//   SATICI_DATABASE_URL='…/<satici>_test' [PG_BIN_DIR=<pg16 istemcisi>] \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-lisans.ts [--json=<dosya>]
// GERÇEK süreçler: satıcı sunucusu (satici/sunucu, kendi DB'si) + fabrika backend'leri (gerçek
// `src/server.ts`; giriş `lib/senaryo-lisans-sunucu.ts` yalnız test çapasını ve sahte makine
// kimliğini enjekte eder). Aralarında HTTPS aktarıcı (fabrikanın "interneti": açık/kesik/yut),
// saat her süreçte IPC ile kaydırılır (duvar = saat sıçraması, monotonik = gerçek geçen süre).
// Rol dağılımı: A ana (L1–L12) → C taşınmış ana (L12–L29) · B/B2 kopya · D DR · E bayi kurulumu ·
// F/G/H/J lisans v2 P + iz merdiveni (L31–L34, kendi kurulum + rol DB'si; `lib/senaryo-lisans-v2-merdiven.ts`).
// Her adım: yeşil/kırmızı/kısmi + kanıt (HTTP durumu, details.code, detay/portal okuması).
// Çıkış: 0 hepsi yeşil · 1 yeşil olmayan adım var · 2 hedef reddi / düzenek kurulamadı.
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
import { LICENSE_FILES } from "../src/lib/license/store";
import {
  DAY_MS,
  HealthSummarySchema,
  LicenseResponseSchema,
  PollRequestSchema,
  b64uEncode,
  isDownloadPathAllowed,
  msToIso,
  parseJws,
  verifyDownloadToken,
} from "../src/lib/license/protocol";
import { fixtureHedefEngeli, hacimHedefEngeli } from "./lib/hedef-db-kapisi";
import { FabrikaIstemcisi, PortalIstemcisi, type LisansDetayi, type Yanit } from "./lib/senaryo-lisans-istemci";
import { l18KunyeOlc } from "./lib/senaryo-lisans-kunye";
import { l30ModulOlc } from "./lib/senaryo-lisans-modul";
import { l31Internetsiz400, l32UcIzSilme, l33TekIzSilme, l34UzatmaDosyasi } from "./lib/senaryo-lisans-v2-merdiven";
import { l35IptalTuru, l36TorenAtlanmasi } from "./lib/senaryo-lisans-v2-g4";
import { l37KapanisKirasi } from "./lib/senaryo-lisans-v2-kapanis";
import { l38Donanim } from "./lib/senaryo-lisans-v2-donanim";
import { etkinlestirZayifOnayli, kiraSatiri, nedenOzeti, rolDbHazirla } from "./lib/senaryo-lisans-v2-duzenek";
import {
  Aktarici,
  ConnectVekili,
  bayiAnahtariUret,
  bekle,
  fabrikaBaslat,
  saticiBaslat,
  saticiYardimcisi,
  tlsSertifikasiUret,
  type FabrikaSureci,
  type SaticiSureci,
} from "./lib/senaryo-lisans-surec";

// ---------------------------------------------------------------- sonuç defteri
type Sonuc = "YESIL" | "KIRMIZI" | "KISMI";
interface AdimSonucu {
  no: string;
  baslik: string;
  sonuc: Sonuc;
  kanit: string[];
  neden: string | null;
  ms: number;
}
const sonuclar: AdimSonucu[] = [];

class Adim {
  readonly kanit: string[] = [];
  kirmizi = 0;
  kismiNedeni: string | null = null;
  kontrol(ad: string, ok: boolean, ayrinti = ""): boolean {
    const satir = `${ok ? "✅" : "❌"} ${ad}${ayrinti ? ` — ${ayrinti}` : ""}`;
    this.kanit.push(satir);
    console.log(`    ${satir}`);
    if (!ok) this.kirmizi++;
    return ok;
  }
  not(metin: string): void {
    this.kanit.push(`ℹ️ ${metin}`);
    console.log(`    ℹ️ ${metin}`);
  }
  kismi(neden: string): void {
    this.kismiNedeni = neden;
    console.log(`    ⚠️ KISMİ: ${neden}`);
  }
}

/** `--son=L8`: o adımdan sonra dur (hata ayıklama; sonraki adımlar koşmaz). */
const SON_ADIM = process.argv.find((a) => a.startsWith("--son="))?.slice("--son=".length) ?? null;
class DurNoktasi extends Error {}

const KOK_ONEKI = "tekserp-senaryo-l-";
/** L35'in iptal belgesini içe aktaran tören aracının defter etiketi (satıcı temizliği bu etiketle siler). */
const IPTAL_YUKLEYEN = "cli:donem-ice-aktar";
const ADIM_SAYISI = 38;

/** Lisans kimliği (D14) fabrikanın LICENSE_DIR'inde doğar; satıcı kurulumu bu kimlikle bulunur. */
function lisansKimligiOku(dizin: string): string | null {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dizin, LICENSE_FILES.IDENTITY), "utf8")) as { kurulumId?: unknown };
    return typeof j.kurulumId === "string" ? j.kurulumId : null;
  } catch {
    return null;
  }
}

/** Çökmüş önceki koşumların geçici köklerinde kalan lisans kimlikleri (temizlik kimliğe göre). */
function eskiKoklerdekiLisansKimlikleri(): string[] {
  const out: string[] = [];
  for (const k of fs.readdirSync(os.tmpdir()).filter((a) => a.startsWith(KOK_ONEKI))) {
    const kok = path.join(os.tmpdir(), k);
    try {
      for (const d of fs.readdirSync(kok).filter((a) => a.startsWith("lisans-"))) {
        const id = lisansKimligiOku(path.join(kok, d));
        if (id) out.push(id);
      }
    } catch {
      /* okunamayan kök atlanır */
    }
  }
  return out;
}

type IndirmeAnahtari = { kid: string; x: string };
/** 3a Worker modülünün (`deploy/guncelleme-sunucusu/worker/indirme-kapisi.js`, düz JS) L15'te kullanılan yüzü. */
interface WorkerKapisi {
  VARSAYILAN_AYAR: Record<string, unknown>;
  belirteciDogrula(b: string, o: { anahtarlar: IndirmeAnahtari[]; simdiMs: number }): Promise<{ ok: true; belge: { yolOneki: string; exp: string } } | { ok: false; kod: string }>;
  yolIzinli(belge: { yolOneki: string }, yol: string): boolean;
  kapiOlustur(o: { ayar: unknown; fetchImpl: (r: Request) => Promise<Response>; simdi: () => number }): (r: Request) => Promise<Response>;
}

/** L15 fetch kolu: kapının kendisi, sahte origin'le — kabulde origin'e belirteç gitmez, retlerde origin'e hiç gidilmez. */
async function l15FetchIsleyicisi(a: Adim, worker: WorkerKapisi, belirtec: string, anahtarlar: IndirmeAnahtari[], simdiMs: number, exp: number): Promise<void> {
  const origin: Request[] = [];
  const fetchImpl = async (r: Request): Promise<Response> => {
    origin.push(r);
    return new Response("ok", { status: 200 });
  };
  const git = (url: string, baslik: Record<string, string> = {}, simdi = simdiMs) =>
    worker.kapiOlustur({ ayar: { ...worker.VARSAYILAN_AYAR, anahtarlar }, fetchImpl, simdi: () => simdi })(new Request(url, { headers: baslik }));
  const kod = (y: Response) => `${y.status} ${y.headers.get("X-TKL-Kod") ?? ""}`.trim();
  const kok = "https://guncelleme.example.test";
  const exe = `${kok}/${KANAL}/electron/TeksERP-Setup.exe`;
  const y1 = await git(`${exe}?onbellek-atla=1`, { "X-TKL-Indirme": belirtec });
  const o1 = origin[0];
  a.kontrol("fetch: başlıklı istek 200; origin'e belirteç gitmez, sorgu aynen gider", y1.status === 200 && origin.length === 1 && !o1?.headers.has("x-tkl-indirme") && o1?.url === `${exe}?onbellek-atla=1`, `${kod(y1)} ${o1?.url ?? "-"}`);
  const y2 = await git(exe);
  a.kontrol("fetch: belirteçsiz → 403 INDIRME_BELIRTEC_YOK", kod(y2) === "403 INDIRME_BELIRTEC_YOK", kod(y2));
  const y3 = await git(`${kok}/${KANAL}/mobil/x.apk?t=${belirtec}`);
  a.kontrol("fetch: yanlış önek (?t=) → 403 INDIRME_YOL", kod(y3) === "403 INDIRME_YOL", kod(y3));
  const y4 = await git(exe, { "X-TKL-Indirme": belirtec }, exp + 11 * 60 * 1000);
  a.kontrol("fetch: süresi dolmuş → 403 BELGE_SURESI_DOLDU", kod(y4) === "403 BELGE_SURESI_DOLDU", kod(y4));
  a.kontrol("fetch: retlerde origin HİÇ çağrılmadı", origin.length === 1, String(origin.length));
}

async function adim(no: string, baslik: string, fn: (a: Adim) => Promise<void>): Promise<void> {
  if (SON_ADIM && sonuclar.some((s) => s.no === SON_ADIM)) throw new DurNoktasi(SON_ADIM);
  console.log(`\n${no} ${baslik}`);
  const a = new Adim();
  const t0 = Date.now();
  try {
    await fn(a);
  } catch (err) {
    a.kontrol("adım istisnasız tamamlandı", false, (err as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? String(err));
  }
  const sonuc: Sonuc = a.kirmizi > 0 ? "KIRMIZI" : a.kismiNedeni ? "KISMI" : "YESIL";
  sonuclar.push({ no, baslik, sonuc, kanit: a.kanit, neden: a.kismiNedeni, ms: Date.now() - t0 });
}

/** Satıcı yanıt gövdesindeki kira JWS'inin `kiraId`si (imza denetlenmez — yalnız zincir karşılaştırması için). */
function kiraIdYanittan(yanit: string): string | null {
  try {
    const kira: unknown = (JSON.parse(yanit) as { kira?: unknown }).kira;
    if (typeof kira !== "string") return null;
    const yuk = JSON.parse(Buffer.from(kira.split(".")[1] ?? "", "base64url").toString("utf8")) as { kiraId?: unknown };
    return typeof yuk.kiraId === "string" ? yuk.kiraId : null;
  } catch {
    return null;
  }
}

const ozet = (y: Yanit): string => `${y.status}${y.kod ? ` ${y.kod}` : ""}`;

// ---------------------------------------------------------------- hedef kapısı
function dbAdi(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

async function fabrikaHedefKapisi(url: string, etiket: string): Promise<void> {
  const onceki = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    const ad = dbAdi(url);
    const engel = ad.startsWith("tekserp_fabrika_") ? `'${ad}' fabrika verisi sınıfında` : fixtureHedefEngeli();
    if (engel) throw new Error(`${etiket}: ${engel}`);
    const hacim = await hacimHedefEngeli();
    if (hacim.engel) throw new Error(`${etiket}: ${hacim.engel}`);
  } finally {
    process.env.DATABASE_URL = onceki;
  }
}

function saticiHedefKapisi(url: string): void {
  const ad = dbAdi(url);
  if (!ad.endsWith("_test") || ad.startsWith("tekserp_fabrika_")) throw new Error(`SATICI_DATABASE_URL: '${ad}' bekçi hedefi olamaz (yalnız *_test)`);
}

// ---------------------------------------------------------------- düzenek
const KANAL = "senaryo-kanal";
const RENK_ONEKI = "Senaryo Rengi ";
// API adı TR büyük harfe çevirir ve sayısal eki başa alabilir ("SENARYO RENGİ AB12CD" · "123456 SENARYO RENGİ").
const RENK_DESENI_SQL = "^(senaryo reng(i|İ|ı|I) [0-9a-f]{6}|[0-9a-f]{6} senaryo reng(i|İ|ı|I))$";
/** Etkinleştirme / taşıma kodu: 16 karakter Crockford base32 (`TKS-XXXX-XXXX-XXXX-XXXX`). */
const KOD_DESENI = /^TKS(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
const UUID_DESENI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// depo.multiEnabled: Faz 2d şifreli modülü (L30) — anahtarı yalnız HAK'taki modüle sarılır.
const HAK_MODULLERI = ["production.enabled", "finance.enabled", "depo.multiEnabled"];
const BAYI_PAROLASI = `senaryo-bayi-${randomBytes(6).toString("hex")}`;
const PARMAK_IZLERI = {
  A: { makine: "5E0A0001-0000-4000-8000-00000000000A", seri: "SENARYOA01" },
  B: { makine: "5E0A0001-0000-4000-8000-00000000000B", seri: "SENARYOB01" },
  C: { makine: "5E0A0001-0000-4000-8000-00000000000C", seri: "SENARYOC01" },
  D: { makine: "5E0A0001-0000-4000-8000-00000000000D", seri: "SENARYOD01" },
  E: { makine: "5E0A0001-0000-4000-8000-00000000000E", seri: "SENARYOE01" },
  B2: { makine: "5E0A0001-0000-4000-8000-0000000000B2", seri: "SENARYOB02" },
} as const;

interface Hazirlik {
  dizin: string;
  capaDosyasi: string;
  kokParolasi: string;
  kokKid: string;
  indirme: { kid: string; x: string };
  kidler: string[];
  yonetici: { id: string; kullaniciAdi: string; parola: string; sir: string };
}

interface Fabrika {
  readonly ad: string;
  surec: FabrikaSureci | null;
  readonly istemci: FabrikaIstemcisi;
  readonly aktarici: Aktarici;
  readonly databaseUrl: string;
  readonly lisansDizini: string;
  readonly yedekDizini: string;
  readonly parmakIzi: { makine: string; seri: string };
  /** Dünya saatine ek: duvar (saat sıçraması) ve monotonik (yalnız bu makinede geçen süre). */
  ekDuvarMs: number;
  ekMonoMs: number;
}

async function main(): Promise<number> {
  const anaUrl = process.env.DATABASE_URL ?? "";
  const drUrl = process.env.SENARYO_DR_DATABASE_URL ?? "";
  const bayiUrl = process.env.SENARYO_BAYI_DATABASE_URL ?? "";
  const saticiUrl = process.env.SATICI_DATABASE_URL ?? "";
  const jsonCikti = process.argv.find((a) => a.startsWith("--json="))?.slice("--json=".length) ?? null;
  try {
    if (!anaUrl || !drUrl || !bayiUrl || !saticiUrl) throw new Error("DATABASE_URL, SENARYO_DR_DATABASE_URL, SENARYO_BAYI_DATABASE_URL, SATICI_DATABASE_URL zorunlu");
    if (new Set([anaUrl, drUrl, bayiUrl].map(dbAdi)).size !== 3) throw new Error("üç fabrika DB'si ayrı olmalı");
    await fabrikaHedefKapisi(anaUrl, "DATABASE_URL");
    await fabrikaHedefKapisi(drUrl, "SENARYO_DR_DATABASE_URL");
    await fabrikaHedefKapisi(bayiUrl, "SENARYO_BAYI_DATABASE_URL");
    saticiHedefKapisi(saticiUrl);
  } catch (err) {
    console.error(`⛔ Hedef kapısı: ${(err as Error).message}`);
    return 2;
  }
  console.log(`🎯 Fabrika: ${dbAdi(anaUrl)} · DR: ${dbAdi(drUrl)} · Bayi: ${dbAdi(bayiUrl)} · Satıcı: ${dbAdi(saticiUrl)}`);

  const kok = fs.mkdtempSync(path.join(os.tmpdir(), KOK_ONEKI));
  console.log(`🗂  Geçici kök: ${kok}`);
  const tls = tlsSertifikasiUret(kok);
  const saticiEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: saticiUrl,
    SATICI_ERISIM_GUNLUGU: "0",
    PORT_GENEL: "0",
    PORT_TAILNET: "0",
    GENEL_BIND: "127.0.0.1",
    TAILNET_BIND: "127.0.0.1",
    // Portal 127.0.0.1'den çağrılır: geri döngü yalnız bu bayrakla tailnet kaynağı (satıcıda varsayılan kapalı).
    TAILNET_LOOPBACK: "1",
    BAKIM_ARALIGI_SN: "2",
    KOPYA_PENCERE_SN: "20",
    PORTAL_GIRIS_HIZ_DK: "1000",
    PORTAL_OTURUM_BOSTA_DK: "1440",
    PORTAL_OTURUM_AZAMI_SAAT: "72",
  };
  const havuzlar = new Map<string, Pool>();
  const db = (url: string): Pool => {
    let p = havuzlar.get(url);
    if (!p) {
      p = new Pool({ connectionString: url, max: 2, options: PG_SESSION_OPTIONS });
      havuzlar.set(url, p);
    }
    return p;
  };
  const kurulumKimligi = async (url: string): Promise<string | null> => {
    const r = await db(url).query<{ id: string | null }>(`SELECT value->>'installationId' AS id FROM system_settings WHERE key = 'system.installationId'`);
    return r.rows[0]?.id ?? null;
  };

  /** Yalıtılmış rol DB'si (`<ana>_<rol>_test`): kopya makine kendi DB'sini taşır — v2 DB izi paylaşılmaz. */
  const rolDb = async (rol: string): Promise<string> => {
    const r = await rolDbHazirla({ havuz: db, anaUrl, rol, kapi: (u) => fabrikaHedefKapisi(u, `rol ${rol}`) });
    if (r.yeni) console.log(`🆕 rol DB'si açıldı: ${r.ad} (boş + migrate deploy + seed) — DROP listesine yazın`);
    return r.url;
  };

  // Önceki koşumun artığı (çökmüş koşum) — LİSANS kimliğiyle (D14; eski köklerden), D14 öncesi satırlar
  // için DB kimliğiyle de; ana DB'deki senaryo renkleri (saat kaydırmasında gelecek tarihli doğmuş olabilir).
  const eskiKimlikler = [
    ...eskiKoklerdekiLisansKimlikleri(),
    ...(await Promise.all([anaUrl, drUrl, bayiUrl].map(kurulumKimligi))).filter((x): x is string => Boolean(x)),
  ];
  const eskiRenk = await db(anaUrl).query(`DELETE FROM colors WHERE name ~* $1`, [RENK_DESENI_SQL]);
  if (eskiRenk.rowCount) console.log(`🧹 önceki koşumdan ${eskiRenk.rowCount} senaryo rengi silindi`);
  saticiYardimcisi(saticiEnv, ["temizle", `--kurulum-idleri=${eskiKimlikler.join(",")}`, "--bayi-adi-oneki=Senaryo L Bayi", `--kanallar=${KANAL}`, `--iptal-yukleyen=${IPTAL_YUKLEYEN}`]);
  const hz = saticiYardimcisi<Hazirlik>(saticiEnv, ["hazirla"]);

  const dunya = { kaymaMs: 0 };
  const saticiSimdi = (): number => Date.now() + dunya.kaymaMs;
  const logDizini = path.join(kok, "log");
  fs.mkdirSync(logDizini);
  let satici: SaticiSureci | null = null;
  const fabrikalar = new Map<string, Fabrika>();
  const jwt = randomBytes(48).toString("hex");
  const yeniFabrika = async (ad: string, databaseUrl: string, parmakIzi: { makine: string; seri: string }, lisansDizini = path.join(kok, `lisans-${ad}`)): Promise<Fabrika> => {
    let f = fabrikalar.get(ad);
    if (!f) {
      const aktarici = new Aktarici(satici!.genel, tls);
      await aktarici.baslat();
      f = {
        ad,
        surec: null,
        istemci: new FabrikaIstemcisi("", { username: "admin", password: "123123" }),
        aktarici,
        databaseUrl,
        lisansDizini,
        yedekDizini: path.join(kok, `yedek-${ad}`),
        parmakIzi,
        ekDuvarMs: 0,
        ekMonoMs: 0,
      };
      fabrikalar.set(ad, f);
    }
    return f;
  };
  const baslat = async (f: Fabrika): Promise<void> => {
    f.surec = await fabrikaBaslat({
      ad: f.ad,
      databaseUrl: f.databaseUrl,
      lisansDizini: f.lisansDizini,
      yedekDizini: f.yedekDizini,
      saticiAdresi: f.aktarici.adres,
      capaDosyasi: hz.capaDosyasi,
      tlsSertifikasi: tls.sertifika,
      parmakIzi: f.parmakIzi,
      jwtSecret: jwt,
      saat: { duvarMs: dunya.kaymaMs + f.ekDuvarMs, monoMs: dunya.kaymaMs + f.ekMonoMs },
      logDosyasi: path.join(logDizini, `fabrika-${f.ad}.log`),
      pgBinDir: process.env.PG_BIN_DIR,
    });
    f.istemci.url = f.surec.url;
    const g = await f.istemci.giris();
    if (g.status !== 200) throw new Error(`${f.ad} girişi ${ozet(g)}`);
    // Lisans kimliği etkinleştirmeden ÖNCE bilinmeyebilir (D14: portalda doğar, yanıtla gelir) — yalnız hazır beklenir.
    const hazir = await f.istemci.bekle((d) => d.hazir, 30_000);
    if (hazir.ms === null) throw new Error(`${f.ad} lisans motoru hazır olmadı`);
  };
  const durdur = async (f: Fabrika): Promise<void> => {
    await f.surec?.durdur();
    f.surec = null;
  };
  const saatUygula = async (f: Fabrika): Promise<void> => {
    if (f.surec) await f.surec.saat({ duvarMs: dunya.kaymaMs + f.ekDuvarMs, monoMs: dunya.kaymaMs + f.ekMonoMs });
  };
  /** Dünya (satıcı + çalışan her fabrika) gerçekten ilerler: duvar ve monotonik birlikte. */
  const dunyayiIlerlet = async (ms: number): Promise<void> => {
    dunya.kaymaMs += ms;
    await satici!.saat({ duvarMs: dunya.kaymaMs, monoMs: dunya.kaymaMs });
    for (const f of fabrikalar.values()) await saatUygula(f);
  };

  const flagOncesi = new Map<string, string | null>();
  const flagYaz = async (url: string, anahtar: string, deger: boolean): Promise<void> => {
    if (!flagOncesi.has(anahtar)) {
      const r = await db(url).query<{ value: unknown }>(`SELECT value FROM system_settings WHERE key = $1`, [anahtar]);
      flagOncesi.set(anahtar, r.rows[0] ? JSON.stringify(r.rows[0].value) : null);
    }
    await db(url).query(
      `INSERT INTO system_settings (key, value, "updatedAt") VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [anahtar, JSON.stringify(deger)],
    );
  };

  // Senaryonun kendi fikstür rengi: kimliğiyle toplanır, sonda silinir (saat kaydırmasında doğan satır
  // ana DB'de gelecek tarihli kalıp başka bekçileri — bulut uzlaştırması — bozmasın).
  const senaryoRenkleri: string[] = [];
  const renkYarat = async (f: Fabrika): Promise<Yanit> => {
    const y = await f.istemci.istek("POST", "/api/colors", { name: `${RENK_ONEKI}${randomBytes(3).toString("hex")}` });
    if (y.status === 201 && typeof y.veri.id === "string") senaryoRenkleri.push(y.veri.id);
    return y;
  };

  let portal = null as unknown as PortalIstemcisi;
  const ekKurulumKimlikleri: string[] = [];
  const olusturulanlar = { kullanicilar: [hz.yonetici.id] as string[], bayiler: [] as string[], kidler: [...hz.kidler] as string[] };
  // Senaryonun satıcı tarafındaki kimlikleri
  // anaLisansId: ana kurulumun LİSANS kimliği (portalda doğar, D14) — fabrika DB'sinin installationId'si DEĞİL.
  const S = { musteriId: "", tesisId: "", anaDbId: "", anaLisansId: "", anaHakId: "", lisansNo: "", drDbId: "", kod: "", k4: "", k5: "", yedek: "" };
  const detayKurulum = async (dbId: string): Promise<Record<string, unknown>> => (await portal.istek("GET", `/kurulumlar/${dbId}`)).veri;
  const yaptirim = async (govde: Record<string, unknown>): Promise<Yanit> => portal.istek("POST", `/kurulumlar/${S.anaDbId}/yaptirim`, { sebep: "Senaryo L", ...govde });
  const agirYaptirim = async (kademe: "K4" | "K5"): Promise<Yanit> =>
    portal.istek("POST", `/kurulumlar/${S.anaDbId}/agir-yaptirim`, { kademe, onay: S.lisansNo, sebep: `Senaryo L ${kademe}` });
  const geriAl = async (eylemId: string): Promise<Yanit> => portal.istek("POST", `/yaptirimlar/${eylemId}/geri-al`, { sebep: "Senaryo L geri alma" });
  const hakSurum = async (govde: Record<string, unknown>): Promise<Yanit> =>
    portal.istek("POST", `/haklar/${S.anaHakId}/surum`, { kokParolasi: hz.kokParolasi, sebep: "Senaryo L", ...govde });
  const zilBekle = async (f: Fabrika, ms = 20_000): Promise<boolean> => (await f.istemci.bekle((d) => d.yoklama.zil.bagli, ms, 250)).ms !== null;

  let cikis = 0;
  try {
    satici = await saticiBaslat({
      env: { ...saticiEnv, ANAHTAR_DIZINI: hz.dizin, GUVEN_CAPASI_DOSYASI: hz.capaDosyasi },
      saat: { duvarMs: 0, monoMs: 0 },
      logDosyasi: path.join(logDizini, "satici.log"),
    });
    portal = new PortalIstemcisi(satici.tailnet, "/portal/api", hz.yonetici, saticiSimdi);
    console.log(`🏪 Satıcı: genel ${satici.genel} · portal ${satici.tailnet}`);

    const A = await yeniFabrika("A", anaUrl, PARMAK_IZLERI.A);
    await baslat(A);
    console.log(`🏭 A: ${A.surec!.url}`);
    // Yönetici OLMAYAN kullanıcı (L7'de veri-dışarı izin guard'ı) — lisans etkinleşmeden, yazmalar açıkken.
    const operator = { username: `senaryo${randomBytes(3).toString("hex")}`, password: "senaryo123" };
    const opY = await A.istemci.istek("POST", "/api/admin/users", { ...{ username: operator.username, fullName: "Senaryo Operatör", password: operator.password }, grantOperatorDefaults: true, generateMobileCredentials: false });
    if (opY.status !== 201) throw new Error(`operatör kullanıcısı açılamadı: ${ozet(opY)}`);

    // ============================================================ L1
    await adim("L1", "portalda (kanal) → müşteri → tesis → kurulum → hak (+ etkinleştirme kodu)", async (a) => {
      // Kurulum KAYITLI bir kanala doğar (kanal ana verisi, sert silme yok): yoksa portaldan açılır.
      const liste = await portal.istek("GET", "/kanallar");
      const kanalVar = Array.isArray(liste.json.data) && (liste.json.data as { kod?: string }[]).some((k) => k.kod === KANAL);
      const kn = kanalVar ? null : await portal.istek("POST", "/kanallar", { kod: KANAL, ad: "Senaryo L kanalı", tur: "uretim" });
      a.kontrol("kanal kayıtlı (yoksa portaldan açıldı → 201)", liste.status === 200 && (kanalVar || kn?.status === 201), kanalVar ? "vardı" : kn ? ozet(kn) : "?");
      const m = await portal.istek("POST", "/musteriler", { ad: `Senaryo L Tekstil ${randomBytes(3).toString("hex")}` });
      S.musteriId = String(m.veri.id);
      a.kontrol("müşteri → 201", m.status === 201, ozet(m));
      const t = await portal.istek("POST", "/tesisler", { musteriId: S.musteriId, ad: "Merkez Tesis" });
      S.tesisId = String(t.veri.id);
      a.kontrol("tesis → 201", t.status === 201, ozet(t));
      // Lisans kimliğini portal ÜRETİR (D14): gövde onu taşımaz, yanıt döner.
      const k = await portal.istek("POST", "/kurulumlar", { tesisId: S.tesisId, sinif: "URETIM", kanalKodu: KANAL, yoklamaAraligiDk: 5 });
      S.anaDbId = String(k.veri.id);
      S.anaLisansId = String(k.veri.kurulumId);
      a.kontrol("kurulum (URETIM) → 201, lisans kimliği satıcıda doğdu", k.status === 201 && UUID_DESENI.test(S.anaLisansId), `${ozet(k)} ${S.anaLisansId}`);
      const h = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/hak`, { moduller: HAK_MODULLERI, kalici: false, bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS) });
      S.anaHakId = String(h.veri.id);
      S.lisansNo = String(h.veri.lisansNo);
      a.kontrol("hak taslağı → 201, lisans no doğuşta", h.status === 201 && /^TKS-\d{4}-\d{4,6}$/.test(S.lisansNo), `${ozet(h)} ${S.lisansNo}`);
      const s = await hakSurum({ sebep: "ilk imza" });
      a.kontrol("hak sürüm 1 (kök parolasıyla imza) → 201", s.status === 201 && s.veri.surum === 1, `${ozet(s)} surum=${String(s.veri.surum)}`);
      const kod = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/etkinlestirme-kodu`, {});
      S.kod = String(kod.veri.kod);
      a.kontrol("etkinleştirme kodu → 201 (16 karakter, TKS-XXXX-XXXX-XXXX-XXXX)", kod.status === 201 && KOD_DESENI.test(String(kod.veri.kod)), ozet(kod));
    });

    // ============================================================ L2
    await adim("L2", "etkinleştirme → hak + kira, kademe NORMAL", async (a) => {
      const kabulsuz = await A.istemci.istek("POST", "/api/license/etkinlestir", { kod: S.kod });
      a.kontrol("sözleşme kabul edilmeden etkinleştirme → 409 LICENSE_ACCEPTANCE_REQUIRED (satıcıya gitmez, Ek-7)", kabulsuz.status === 409 && kabulsuz.kod === "LICENSE_ACCEPTANCE_REQUIRED", ozet(kabulsuz));
      const kb = await A.istemci.sozlesmeyiKabulEt();
      a.kontrol("panelin kabul adımı: POST /api/license/kabul → 201", kb.status === 201, ozet(kb));
      const y = await etkinlestirZayifOnayli({ fabrika: A.istemci, portal, kurulumDbId: S.anaDbId, kod: S.kod.toLowerCase().replace(/-/g, " "), kontrol: a.kontrol.bind(a), etiket: "A" });
      a.kontrol("POST /api/license/etkinlestir (küçük harf + boşluklu elle yazım) → 200", y.status === 200, ozet(y));
      const d = await A.istemci.detay();
      a.kontrol("hak + kira yerelde, lisans no eşleşir", d.hak?.lisansNo === S.lisansNo && Boolean(d.kira?.kiraId), `${d.hak?.lisansNo} kira=${d.kira?.kiraId.slice(0, 8)}`);
      a.kontrol("lisans kimliği etkinleştirme yanıtından öğrenildi (portalda doğan kimlik, DB kimliği değil)", d.kurulum.kurulumId === S.anaLisansId, `${d.kurulum.kurulumId} / ${S.anaLisansId}`);
      a.kontrol("geçerlilik GECERLI, hesaplanan = uygulanan = NORMAL, kip gözlem", d.durum.gecerlilik === "GECERLI" && d.durum.hesaplananKademe === "NORMAL" && d.durum.uygulananKademe === "NORMAL" && d.durum.kip === "gozlem", `${d.durum.gecerlilik}/${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}/${d.durum.kip}`);
      a.kontrol("parmak izi ESLESTI", d.parmakIzi.karar === "ESLESTI", `${d.parmakIzi.karar} ${d.parmakIzi.eslesen}/${d.parmakIzi.olculebilen}`);
      const pk = await detayKurulum(S.anaDbId);
      a.kontrol("portal: kurulum ETKIN, anahtar kimliği kayıtlı", (pk.kurulum as { durum?: string }).durum === "ETKIN" && (pk.kurulum as { anahtarKimligi?: string }).anahtarKimligi === d.kurulum.anahtarKimligi, String((pk.kurulum as { durum?: string }).durum));
      a.kontrol("kapı zili bağlandı (etkinleştirme dürttü)", await zilBekle(A));
    });

    // ============================================================ L3
    await adim("L3", "yoklama kirayı yeniler; gövde allowlist dışı anahtar taşımaz", async (a) => {
      const n0 = A.aktarici.kayitlar.length;
      const once = (await A.istemci.detay()).kira?.kiraId;
      const y = await A.istemci.yokla();
      const d = await A.istemci.detay();
      a.kontrol("POST /api/license/yokla → BASARILI, yeni kira", y.outcome === "BASARILI" && d.kira?.kiraId !== once, `${y.outcome} ${once?.slice(0, 8)} → ${d.kira?.kiraId.slice(0, 8)}`);
      const kayit = A.aktarici.sonKayit("/v1/yokla");
      const govde = kayit ? (JSON.parse(kayit.govde) as Record<string, unknown>) : {};
      const kati = PollRequestSchema.safeParse(govde);
      a.kontrol("tel üstündeki yoklama gövdesi KATI şemadan geçer (fazla anahtar = red)", kati.success, kati.success ? Object.keys(govde).join(",") : kati.error.issues[0]?.message ?? "");
      const saglik = HealthSummarySchema.safeParse(govde.saglik);
      a.kontrol("sağlık özeti allowlist'te (strictObject)", saglik.success, Object.keys((govde.saglik as object) ?? {}).join(","));
      const metin = kayit?.govde ?? "";
      const sizinti = ["admin", A.lisansDizini, dbAdi(anaUrl), hz.yonetici.kullaniciAdi].filter((s) => metin.includes(s));
      a.kontrol("gövdede kullanıcı adı / dosya yolu / DB adı YOK", sizinti.length === 0, sizinti.join(",") || "temiz");
      // Zincir: gövdenin sonKiraId'si bu istekten ÖNCEKİ son kiradır. Etkinleştirmenin dürttüğü arka plan
      // yoklaması `once` okunduktan sonra kira yenilemiş olabilir — o zaman beklenen onun kirasıdır (yarış değil zincir).
      const araYoklamalar = A.aktarici.kayitlar.slice(n0).filter((k) => k.yol === "/v1/yokla" && k !== kayit);
      const araKira = araYoklamalar.length > 0 ? kiraIdYanittan(araYoklamalar[araYoklamalar.length - 1]!.yanit) : null;
      const beklenen = araKira ?? once;
      a.kontrol("kira zinciri: gövdedeki sonKiraId önceki kira", govde.sonKiraId === beklenen, `sonKiraId ${String(govde.sonKiraId).slice(0, 8)} · önceki ${String(beklenen).slice(0, 8)} · ara yoklama ${araYoklamalar.length}`);
    });

    // ============================================================ L4
    await adim("L4", "K0 → zil → ≤5 sn'de bant", async (a) => {
      a.kontrol("zil bağlı", await zilBekle(A));
      await bekle(5500); // son yoklamadan en az MIN_POLL_GAP (5 sn) — ölçüm yağmur korumasından ayrılsın
      const mesaj = `Senaryo L: ödeme hatırlatması ${randomBytes(2).toString("hex")}`;
      const t0 = Date.now();
      const y = await yaptirim({ kademe: "K0", mesaj });
      a.kontrol("portal K0 → 201", y.status === 201, ozet(y));
      const b = await A.istemci.bekle((d) => d.durum.hesaplanan.bant?.metin === mesaj, 15_000, 100);
      const ms = b.ms === null ? null : Date.now() - t0;
      a.kontrol("zil → yoklama → hesaplanan bant = portal mesajı, ≤ 5 sn", ms !== null && ms <= 5000, `${ms ?? "zaman aşımı"} ms`);
      a.kontrol("gözlem = sıfır fark: uygulanan bant YOK", b.detay.durum.uygulanan.bant === null && b.detay.durum.uygulananKademe === "NORMAL");
      const durum = await A.istemci.istek("GET", "/api/license/durum");
      a.kontrol("GET /api/license/durum bant null (istemci çizmez)", durum.status === 200 && durum.veri.bant === null, ozet(durum));
      const g = await geriAl(String(y.veri.id));
      a.kontrol("K0 geri alındı → 201", g.status === 201, ozet(g));
      const temiz = await A.istemci.bekle((d) => d.durum.hesaplanan.bant === null, 15_000);
      a.kontrol("geri alma zille yansıdı (bant kalktı)", temiz.ms !== null, `${temiz.ms ?? "zaman aşımı"} ms`);
    });

    // ============================================================ L5
    await adim("L5", "gözlem kipinde K4 → yazma YİNE 201 (sıfır fark)", async (a) => {
      const k4 = await agirYaptirim("K4");
      S.k4 = String(k4.veri.id);
      a.kontrol("portal K4 (lisans no ile ikinci onay) → 201", k4.status === 201, ozet(k4));
      const onaysiz = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/agir-yaptirim`, { kademe: "K4", sebep: "onaysız deneme" });
      a.kontrol("ikinci onaysız K4 → 400 IKINCI_ONAY_GEREKLI", onaysiz.status === 400 && onaysiz.kod === "IKINCI_ONAY_GEREKLI", ozet(onaysiz));
      const b = await A.istemci.bekle((d) => d.durum.hesaplananKademe === "KISITLI", 20_000);
      a.kontrol("hesaplanan KISITLI, uygulanan NORMAL (gözlem)", b.ms !== null && b.detay.durum.uygulananKademe === "NORMAL", `${b.detay.durum.hesaplananKademe}/${b.detay.durum.uygulananKademe}`);
      const sayac0 = b.detay.gozlem.reddedilecekIstek;
      const renk = await renkYarat(A);
      a.kontrol("POST /api/colors → 201 (yazma açık)", renk.status === 201, ozet(renk));
      const siparis = await A.istemci.istek("POST", "/api/orders", {});
      a.kontrol("POST /api/orders kapıdan geçer (doğrulama 400, lisans 403 DEĞİL)", siparis.status === 400 && !String(siparis.kod ?? "").startsWith("LICENSE"), ozet(siparis));
      const d = await A.istemci.detay();
      a.kontrol("gözlem sayacı 'reddederdim' artışı", d.gozlem.reddedilecekIstek >= sayac0 + 2, `${sayac0} → ${d.gozlem.reddedilecekIstek}`);
    });

    // ============================================================ L6
    await adim("L6", "zorlama + K4 → POST sipariş 403 LICENSE_RESTRICTED; okuma/dışa aktarma/yedek açık", async (a) => {
      const z = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/zorlama`, { zorla: true, sebep: "Senaryo L zorlama" });
      a.kontrol("portal zorlama → 200", z.status === 200, ozet(z));
      const b = await A.istemci.bekle((d) => d.durum.kip === "zorla" && d.durum.uygulananKademe === "KISITLI", 20_000);
      a.kontrol("kip zorla, uygulanan KISITLI", b.ms !== null, `${b.detay.durum.kip}/${b.detay.durum.uygulananKademe}`);
      const s = await A.istemci.istek("POST", "/api/orders", {});
      a.kontrol("POST /api/orders → 403 LICENSE_RESTRICTED (kademe ayrıntılı)", s.status === 403 && s.kod === "LICENSE_RESTRICTED" && s.details.kademe === "KISITLI", `${ozet(s)} ${JSON.stringify(s.details)}`);
      const liste = await A.istemci.istek("GET", "/api/orders");
      a.kontrol("GET /api/orders → 200", liste.status === 200, ozet(liste));
      const varliklar = await A.istemci.istek("GET", "/api/import/entities");
      const liste0 = Array.isArray(varliklar.json.data) ? (varliklar.json.data as Array<{ entity: string; canRead: boolean }>) : [];
      const varlik = (liste0.find((v) => v.entity === "colors") ?? liste0.find((v) => v.canRead))?.entity ?? "colors";
      const disa = await A.istemci.istek("GET", `/api/import/${varlik}/export`);
      a.kontrol(`dışa aktarma GET /api/import/${varlik}/export → 200`, varliklar.status === 200 && disa.status === 200, `${ozet(varliklar)} / ${ozet(disa)}`);
      if (!process.env.PG_BIN_DIR) a.not("PG_BIN_DIR yok: yedek alma sunucunun pg_dump'ıyla denenir");
      const al = await A.istemci.istek("POST", "/api/admin/backup");
      a.kontrol("POST /api/admin/backup (KISITLI izin listesi) → 202", al.status === 202, ozet(al));
      let dosya: string | null = null;
      for (let i = 0; i < 120 && !dosya; i++) {
        await bekle(500);
        const l = await A.istemci.istek("GET", "/api/admin/backups");
        const files = (l.json.files ?? []) as Array<{ name: string }>;
        dosya = files[0]?.name ?? null;
      }
      const indir = dosya ? await A.istemci.istek("GET", `/api/admin/backups/${encodeURIComponent(dosya)}/download`) : null;
      a.kontrol("yedek indirme → 200", indir?.status === 200, dosya ? `${dosya} ${indir ? ozet(indir) : ""}` : "yedek dosyası oluşmadı");
      S.yedek = dosya ?? "";
    });

    // ============================================================ L7
    await adim("L7", "K5 → yalnız giriş + veri-dışarı (yönetici); geri al → ≤5 sn'de normal", async (a) => {
      a.kontrol("zil bağlı", await zilBekle(A));
      const k5 = await agirYaptirim("K5");
      S.k5 = String(k5.veri.id);
      a.kontrol("portal K5 → 201", k5.status === 201, ozet(k5));
      const b = await A.istemci.bekle((d) => d.durum.uygulananKademe === "DURDURULMUS", 20_000);
      a.kontrol("uygulanan DURDURULMUS", b.ms !== null, `${b.ms ?? "zaman aşımı"} ms`);
      const liste = await A.istemci.istek("GET", "/api/orders");
      a.kontrol("GET /api/orders → 403 LICENSE_SUSPENDED", liste.status === 403 && liste.kod === "LICENSE_SUSPENDED", ozet(liste));
      const giris = await A.istemci.giris();
      a.kontrol("POST /api/auth/login (yönetici) → 200", giris.status === 200, ozet(giris));
      const me = await A.istemci.istek("GET", "/api/auth/me");
      a.kontrol("GET /api/auth/me → 200 ('verilerimi al' izinleri)", me.status === 200, ozet(me));
      const vd = await A.istemci.istek("GET", "/api/license/veri-disari");
      a.kontrol("GET /api/license/veri-disari (yönetici) → 200 + yollar", vd.status === 200 && Boolean((vd.veri.yollar as object | undefined) ?? null), ozet(vd));
      const yl = await A.istemci.istek("GET", "/api/admin/backups");
      const yd = S.yedek ? await A.istemci.istek("GET", `/api/admin/backups/${encodeURIComponent(S.yedek)}/download`) : null;
      a.kontrol("K5'te yedek listesi + indirme → 200", yl.status === 200 && yd?.status === 200, `${ozet(yl)} / ${yd ? ozet(yd) : "yedek yok"}`);
      const op = new FabrikaIstemcisi(A.surec!.url, operator, "mobile");
      const og = await op.giris();
      const ovd = await op.istek("GET", "/api/license/veri-disari");
      a.kontrol("yönetici olmayan: giriş 200 ama veri-dışarı 403 (izin guard'ı, kapı değil)", og.status === 200 && ovd.status === 403 && !String(ovd.kod ?? "").startsWith("LICENSE"), `${ozet(og)} / ${ozet(ovd)}`);
      await bekle(5500);
      const t0 = Date.now();
      const g5 = await geriAl(S.k5);
      a.kontrol("K5 geri alındı → 201", g5.status === 201, ozet(g5));
      const c5 = await A.istemci.bekle((d) => d.durum.uygulananKademe !== "DURDURULMUS", 15_000, 100);
      const ms5 = c5.ms === null ? null : Date.now() - t0;
      a.kontrol("K5 geri alma ≤ 5 sn'de yansır (K4 sürdüğü için KISITLI)", ms5 !== null && ms5 <= 5000 && c5.detay.durum.uygulananKademe === "KISITLI", `${ms5 ?? "zaman aşımı"} ms → ${c5.detay.durum.uygulananKademe}`);
      await bekle(5500);
      const t1 = Date.now();
      const g4 = await geriAl(S.k4);
      a.kontrol("K4 geri alındı → 201", g4.status === 201, ozet(g4));
      const c4 = await A.istemci.bekle((d) => d.durum.uygulananKademe === "NORMAL", 15_000, 100);
      const ms4 = c4.ms === null ? null : Date.now() - t1;
      a.kontrol("K4 geri alma ≤ 5 sn'de NORMAL", ms4 !== null && ms4 <= 5000, `${ms4 ?? "zaman aşımı"} ms`);
      const s = await renkYarat(A);
      a.kontrol("NORMAL'de yazma yine 201", s.status === 201, ozet(s));
    });

    // ============================================================ L8
    await adim("L8", "K2 (finans) → 403 LICENSE_MODULE; DB'ye elle bayrak yazılsa da 403", async (a) => {
      await flagYaz(anaUrl, "finance.enabled", true);
      const once = await A.istemci.istek("GET", "/api/finance/cheques");
      a.kontrol("finans açık + HAK'ta: GET /api/finance/cheques → 200", once.status === 200, ozet(once));
      const k2 = await yaptirim({ kademe: "K2", moduller: ["finance.enabled"] });
      a.kontrol("portal K2 [finance.enabled] → 201", k2.status === 201, ozet(k2));
      const b = await A.istemci.bekle((d) => (d.durum.uygulanan.modulTavani.denied ?? []).includes("finance.enabled"), 20_000);
      a.kontrol("uygulanan tavan: finance.enabled DONDURULDU", b.ms !== null);
      const fin = await A.istemci.istek("GET", "/api/finance/cheques");
      a.kontrol("GET /api/finance/cheques → 403 LICENSE_MODULE (DONDURULDU)", fin.status === 403 && fin.kod === "LICENSE_MODULE" && fin.details.neden === "DONDURULDU" && fin.details.modul === "finance.enabled", `${ozet(fin)} ${JSON.stringify(fin.details)}`);
      await flagYaz(anaUrl, "dokuma.enabled", true);
      const dok = await A.istemci.istek("GET", "/api/weaving-orders");
      a.kontrol("HAK'ta olmayan dokuma DB'ye elle açıldı: GET /api/weaving-orders → 403 LICENSE_MODULE (LISANSTA_YOK)", dok.status === 403 && dok.kod === "LICENSE_MODULE" && dok.details.neden === "LISANSTA_YOK", `${ozet(dok)} ${JSON.stringify(dok.details)}`);
      const ff = await A.istemci.istek("GET", "/api/feature-flags");
      const kapali = ((ff.veri.license as { kapaliModuller?: Array<{ anahtar: string; neden: string }> } | undefined)?.kapaliModuller ?? []).map((m) => `${m.anahtar}:${m.neden}`);
      a.kontrol("panel bloğu: kapaliModuller = finans DONDURULDU + dokuma LISANSTA_YOK", kapali.includes("finance.enabled:DONDURULDU") && kapali.includes("dokuma.enabled:LISANSTA_YOK"), kapali.join(","));
      const acma = await A.istemci.istek("PATCH", "/api/feature-flags", { dokumaEnabled: true });
      a.kontrol("PATCH /api/feature-flags lisansın kapattığını AÇAMAZ → 403 LICENSE_MODULE", acma.status === 403 && acma.kod === "LICENSE_MODULE", ozet(acma));
      const g = await geriAl(String(k2.veri.id));
      a.kontrol("K2 geri alındı", g.status === 201, ozet(g));
      await flagYaz(anaUrl, "dokuma.enabled", false);
      await A.istemci.yokla();
      const sonra = await A.istemci.istek("GET", "/api/finance/cheques");
      a.kontrol("geri alma sonrası finans → 200", sonra.status === 200, ozet(sonra));
    });

    // ============================================================ L9
    // v2 (tasarım §1.1 · §1.3 · K1; lisans.md:12 · :31): kira bitişi yalnız tazeliktir, süre çapası ödenmiş tarih P. P'yi sözleşme sonuyla
    // yakına çekip (portal geçerlilik bitişi) zaman çizelgesi yürütülür; sonda sözleşme sonu kaldırılır (P = ufuk).
    await adim("L9", "saat ileri (gerçek süre), dışarı kesik: P−30 bilgi bandı → P sonrası EK_SURE (gün sayacı) → P+30 KISITLI → P uzar, yeni kira NORMAL", async (a) => {
      const g0 = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/gecerlilik`, { tarih: msToIso(saticiSimdi() + 29 * DAY_MS), sebep: "Senaryo L9 sözleşme sonu" });
      const p0 = await A.istemci.yokla();
      const d0 = await A.istemci.detay();
      const pTarih = d0.durum.odenmisTarih?.tarih ? Date.parse(d0.durum.odenmisTarih.tarih) : NaN;
      a.kontrol(
        "sözleşme sonu P = +29 gün → yeni kira P'yi taşır: NORMAL + bilgi bandı ODEME_YAKLASIYOR (P sözleşme sonu, K1)",
        g0.status < 300 && p0.outcome === "BASARILI" && Math.abs(pTarih - (saticiSimdi() + 29 * DAY_MS)) < DAY_MS && d0.durum.odenmisTarih?.sozlesmeSonu === true &&
          d0.durum.hesaplananKademe === "NORMAL" && d0.durum.nedenler.some((n) => n.kod === "ODEME_YAKLASIYOR") && d0.durum.hesaplanan.bant?.ton === "bilgi",
        `${ozet(g0)} ${p0.outcome} P=${d0.durum.odenmisTarih?.tarih ?? "yok"} ${d0.durum.hesaplananKademe} bant=${d0.durum.hesaplanan.bant?.ton ?? "yok"}`,
      );
      A.aktarici.kipAyarla("kesik");
      await dunyayiIlerlet(31 * DAY_MS);
      const p1 = await A.istemci.yokla();
      a.kontrol("dışarı kesik: yoklama BASARISIZ", p1.outcome === "BASARISIZ", `${p1.outcome} ${p1.code ?? ""}`);
      const d1 = await A.istemci.detay();
      a.kontrol("+31 gün (P+2): EK_SURE, gün sayacı ~28", d1.durum.hesaplananKademe === "EK_SURE" && d1.durum.uygulananKademe === "EK_SURE" && d1.durum.ekSureKalanGun !== null && d1.durum.ekSureKalanGun >= 27 && d1.durum.ekSureKalanGun <= 29, `${d1.durum.hesaplananKademe} ekSureKalanGun=${d1.durum.ekSureKalanGun} saat=${d1.durum.saat.kaynak}`);
      const durum = await A.istemci.istek("GET", "/api/license/durum");
      a.kontrol("/durum ekSureKalanGun + uyarı bandı (zorla)", durum.veri.ekSureKalanGun === d1.durum.ekSureKalanGun && (durum.veri.bant as { ton?: string } | null)?.ton === "uyari", JSON.stringify({ k: durum.veri.kademe, g: durum.veri.ekSureKalanGun }));
      const yaz = await renkYarat(A);
      a.kontrol("EK_SURE'de yazma açık (201)", yaz.status === 201, ozet(yaz));
      await dunyayiIlerlet(30 * DAY_MS + 3 * 60 * 60 * 1000);
      const p2 = await A.istemci.yokla();
      const d2 = await A.istemci.detay();
      a.kontrol("+61 gün (P+32) + başarılı alışveriş yok (iki anahtar) → KISITLI", p2.outcome === "BASARISIZ" && d2.durum.hesaplananKademe === "KISITLI" && d2.durum.uygulananKademe === "KISITLI", `${p2.outcome}/${d2.durum.hesaplananKademe}`);
      const s = await A.istemci.istek("POST", "/api/orders", {});
      a.kontrol("KISITLI: POST /api/orders → 403 LICENSE_RESTRICTED", s.status === 403 && s.kod === "LICENSE_RESTRICTED", ozet(s));
      A.aktarici.kipAyarla("acik");
      const g1 = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/gecerlilik`, { tarih: null, sebep: "Senaryo L9 ödeme: sözleşme sonu kaldırıldı" });
      const p3 = await A.istemci.yokla();
      const d3 = await A.istemci.detay();
      a.kontrol(`portal: sözleşme sonu kaldırıldı (${ozet(g1)}) → P = ufuk`, g1.status < 300 && d3.durum.odenmisTarih?.sozlesmeSonu === false, JSON.stringify(d3.durum.odenmisTarih));
      a.kontrol("dışarı açık: yeni kira (P uzadı) → NORMAL", p3.outcome === "BASARILI" && d3.durum.hesaplananKademe === "NORMAL" && d3.durum.uygulananKademe === "NORMAL", `${p3.outcome}/${d3.durum.hesaplananKademe}`);
    });

    // ============================================================ L10
    await adim("L10", "saat geri → OLCULEMEDI(SAAT_GERI), yüksek su kullanılır", async (a) => {
      A.ekDuvarMs = -10 * DAY_MS;
      await saatUygula(A);
      const d1 = await A.istemci.detay();
      const bulgu = d1.durum.nedenler.map((n) => n.kod);
      a.kontrol("duvar -10 gün (monotonik var): OLCULEMEDI + SAAT_GERI, güvenilir = alt sınır", d1.durum.gecerlilik === "OLCULEMEDI" && bulgu.includes("SAAT_GERI") && d1.durum.saat.bulgu === "SAAT_GERI", `${d1.durum.gecerlilik} ${bulgu.join(",")} kaynak=${d1.durum.saat.kaynak}`);
      const guvenilir = Date.parse(d1.durum.saat.guvenilir);
      a.kontrol("güvenilir saat dünya saatinde (duvar değil)", Math.abs(guvenilir - saticiSimdi()) < 60 * 60 * 1000, `${d1.durum.saat.guvenilir}`);
      a.kontrol("kademe düşmedi (UYARI; erken bitiş/uzatma yok)", d1.durum.hesaplananKademe === "UYARI", d1.durum.hesaplananKademe);
      // v2: DB izi durum kaydının imzalı kopyasıdır (lisans.md:66) — yalnız dosya silinirse çalışma süresi izden sürer,
      // tek iz kaybı LISANS_IZI_KAYIP (lisans.md:67); yüksek su yoluna iki kopya birden (dosya + DB izi) silinince düşülür.
      await durdur(A);
      fs.rmSync(path.join(A.lisansDizini, "durum.json"), { force: true });
      await baslat(A);
      const d1b = await A.istemci.detay();
      const b1b = d1b.durum.nedenler.map((n) => n.kod);
      a.kontrol("yalnız durum dosyası silindi: DB izi kopyası köprüler (kaynak MONOTONIK, lisans.md:66) + SAAT_GERI + LISANS_IZI_KAYIP (tek iz, lisans.md:67)", d1b.durum.saat.kaynak === "MONOTONIK" && d1b.durum.saat.bulgu === "SAAT_GERI" && b1b.includes("LISANS_IZI_KAYIP"), `${d1b.durum.saat.kaynak} ${nedenOzeti(d1b)}`);
      a.kontrol("yalnız durum dosyası silindi: DURUM_DOSYASI YOK (DB izi kopyası duruyor — tasarım §1.5)", !b1b.includes("DURUM_DOSYASI"), nedenOzeti(d1b));
      await durdur(A);
      fs.rmSync(path.join(A.lisansDizini, "durum.json"), { force: true });
      await db(anaUrl).query(`DELETE FROM system_settings WHERE key = 'license.trace'`);
      await baslat(A);
      const d2 = await A.istemci.detay();
      const b2 = d2.durum.nedenler.map((n) => n.kod);
      a.kontrol("durum dosyası + DB izi silinip yeniden açılış: kaynak YUKSEK_SU + SAAT_GERI + DURUM_DOSYASI + LISANS_IZI_KAYIP", d2.durum.saat.kaynak === "YUKSEK_SU" && d2.durum.saat.bulgu === "SAAT_GERI" && b2.includes("DURUM_DOSYASI") && b2.includes("LISANS_IZI_KAYIP"), `${d2.durum.saat.kaynak} ${nedenOzeti(d2)}`);
      a.kontrol("yüksek su = son kiranın sunucu saati (dünya), duvarın ilerisinde", Date.parse(d2.durum.saat.guvenilir) > saticiSimdi() - 2 * DAY_MS, d2.durum.saat.guvenilir);
      A.ekDuvarMs = 0;
      await saatUygula(A);
      const p = await A.istemci.yokla();
      const d3 = await A.istemci.detay();
      a.kontrol("saat düzelince yoklama → yeni kira, durum kaydı yeniden başlar, GECERLI", p.outcome === "BASARILI" && d3.durum.gecerlilik === "GECERLI" && d3.depo.durumKaydi.gecerli, `${p.outcome} ${d3.durum.gecerlilik}`);
    });

    // ============================================================ L11
    const B = await yeniFabrika("B", await rolDb("B"), PARMAK_IZLERI.B);
    await adim("L11", "LICENSE_DIR farklı parmak izli ikinci backend'e kopyalanır → GECERSIZ + portalda kopya uyarısı", async (a) => {
      fs.cpSync(A.lisansDizini, B.lisansDizini, { recursive: true });
      const uyari0 = ((await detayKurulum(S.anaDbId)).kopyaUyarilari as unknown[] | undefined)?.length ?? 0;
      await baslat(B);
      const d = await B.istemci.detay();
      a.kontrol("kopya (B): parmak izi ESLESMEDI → GECERSIZ", d.parmakIzi.karar === "ESLESMEDI" && d.durum.gecerlilik === "GECERSIZ", `${d.parmakIzi.karar} ${d.parmakIzi.uyusmayan.join(",")} ${nedenOzeti(d)}`);
      const p = await B.istemci.yokla();
      a.kontrol("B yoklaması (ilk pencere: yalnız uyarı, kira verilir)", p.outcome === "BASARILI" || p.outcome === "BASARISIZ", `${p.outcome} ${p.code ?? ""}`);
      const pk = await detayKurulum(S.anaDbId);
      const acik = ((pk.kopyaUyarilari as Array<{ tur: string; durum: string }>) ?? []).filter((u) => u.durum === "ACIK");
      a.kontrol("portal: ACIK kopya uyarısı (PARMAK_IZI_UYUSMAZ / ZINCIR_CATALI)", acik.length > 0 && ((pk.kopyaUyarilari as unknown[]).length > uyari0), acik.map((u) => u.tur).join(","));
      await durdur(B);
      const pa = await A.istemci.yokla();
      const da = await A.istemci.detay();
      a.kontrol("asıl sahibi (A) etkilenmez: yoklama BASARILI, GECERLI", pa.outcome === "BASARILI" && da.durum.gecerlilik === "GECERLI", `${pa.outcome} ${da.durum.gecerlilik}`);
      for (const u of ((await detayKurulum(S.anaDbId)).kopyaUyarilari as Array<{ id: string; durum: string }>).filter((x) => x.durum === "ACIK")) {
        await portal.istek("POST", `/kopya-uyarilari/${u.id}/kapat`, { sebep: "Senaryo L11 incelendi", digerParmakIziniKabulEt: false });
      }
    });

    // ============================================================ L12
    const C = await yeniFabrika("C", anaUrl, PARMAK_IZLERI.C);
    // D8: talep yalnız TALEPtir; onay tek kullanımlık TAŞIMA KODU üretir, yeni makine onu normal etkinleştirme
    // yolundan kullanınca anahtar değişir. C, A'nın DB'sini taşır ama lisans klasörünü taşımaz (lisans kimliğini
    // bilmez): talep kimliksizse portal DB kimliği ipucuyla ana kurulumu önerir, hedefi operatör seçer.
    await adim("L12", "taşıma: talep → portal onayı taşıma kodu → yeni makine kodla etkinleşir, eski düşer", async (a) => {
      await baslat(C);
      const t = await C.istemci.istek("POST", "/api/license/tasima-talebi", { gerekce: "Senaryo L: sunucu değişimi" });
      a.kontrol("C: taşıma talebi → BEKLIYOR", t.status === 200 && t.veri.durum === "BEKLIYOR", `${ozet(t)} ${String(t.veri.durum)}`);
      const cAnahtar = (await C.istemci.detay()).kurulum.anahtarKimligi;
      const liste = await portal.istek("GET", "/tasima-talepleri?durum=BEKLIYOR");
      type Talep = { id: string; kurulumId: string | null; yeniAnahtarKimligi: string; onerilenKurulumlar?: { id: string }[] };
      const talep = ((liste.veri.items ?? []) as Talep[]).find((x) => x.yeniAnahtarKimligi === cAnahtar);
      a.kontrol(
        "portal: talep BEKLIYOR listesinde; bağlı ya da (kimliksizse) ana kurulum öneriler arasında",
        Boolean(talep) && (talep!.kurulumId === S.anaDbId || (talep!.onerilenKurulumlar ?? []).some((k) => k.id === S.anaDbId)),
        talep ? `bağ=${talep.kurulumId ?? "yok"} öneri=${(talep.onerilenKurulumlar ?? []).length}` : "talep yok",
      );
      const o = await portal.istek("POST", `/tasima-talepleri/${talep?.id}/onayla`, { sebep: "Senaryo L onay", kurulumId: S.anaDbId });
      const tasimaKodu = String((o.veri.tasimaKodu as { kod?: string } | null)?.kod);
      a.kontrol("portal onay → 200 + tek kullanımlık taşıma kodu (16 karakter)", o.status === 200 && KOD_DESENI.test(tasimaKodu), ozet(o));
      // D8: onay lisans taşımaz — C yoklayınca talep ONAYLANDI kalır ve kod beklenir.
      const yb = await C.istemci.yokla();
      const cb = await C.istemci.detay();
      a.kontrol(
        "C: onay sonrası yoklama → TASIMA_KODU_BEKLENIYOR, talep ONAYLANDI, lisans YOK",
        yb.code === "TASIMA_KODU_BEKLENIYOR" && cb.tasima?.durum === "ONAYLANDI" && cb.kira === null,
        `${yb.outcome} ${yb.code ?? ""} tasima=${cb.tasima?.durum ?? "yok"}`,
      );
      const kbC = await C.istemci.sozlesmeyiKabulEt();
      a.kontrol("C (yeni makine = yeni anahtar): sözleşme yeniden kabul → 201", kbC.status === 201, ozet(kbC));
      const e = await etkinlestirZayifOnayli({ fabrika: C.istemci, portal, kurulumDbId: S.anaDbId, kod: tasimaKodu, kontrol: a.kontrol.bind(a), etiket: "C" });
      const d = await C.istemci.detay();
      a.kontrol(
        "C: taşıma koduyla etkinleşme → GECERLI, parmak izi ESLESTI, lisans kimliği aynı",
        e.status === 200 && d.durum.gecerlilik === "GECERLI" && d.parmakIzi.karar === "ESLESTI" && d.kurulum.kurulumId === S.anaLisansId,
        `${ozet(e)} ${d.durum.gecerlilik} ${d.parmakIzi.karar} ${d.kurulum.kurulumId}`,
      );
      // v2 (tasarım §1.2 K6; lisans.md:30 (c)): taşınan eski anahtar imzasız 403 yerine imzalı KAPANIŞ kirası alır —
      // K3, kısıtlama = olayın ilk kapanış kirası + ek süre; asla anında durdurma.
      const pa = await A.istemci.yokla();
      const dA = await A.istemci.detay();
      const pk = await detayKurulum(S.anaDbId);
      const kA = kiraSatiri(pk, dA.kira?.kiraId);
      a.kontrol(
        "A (taşınan eski anahtar): elindeki kira KAPANIŞ (neden TASIMA; K3, kısıtlamaya ~30 gün), anında KISITLI değil",
        kA?.karar === "KAPANIS" && kA.kapanisNedeni === "TASIMA" && dA.kira?.yaptirim.kademe === "K3" && dA.durum.kisitlamaKalanGun !== null &&
          dA.durum.kisitlamaKalanGun >= 29 && dA.durum.kisitlamaKalanGun <= 30 && dA.durum.uygulananKademe !== "KISITLI",
        `yoklama=${pa.outcome} ${pa.code ?? ""} karar=${kA?.karar} neden=${kA?.kapanisNedeni} yaptirim=${dA.kira?.yaptirim.kademe} kisitlamaKalanGun=${dA.durum.kisitlamaKalanGun} ${dA.durum.uygulananKademe}`,
      );
      a.kontrol("portal: kurulumun anahtarı artık C'ninki", (pk.kurulum as { anahtarKimligi?: string }).anahtarKimligi === d.kurulum.anahtarKimligi);
      await durdur(A);
      a.kontrol("C zile bağlanır", (await zilBekle(C, 30_000)) || (await C.istemci.yokla(), await zilBekle(C, 15_000)));
    });

    // ============================================================ L13
    const D = await yeniFabrika("D", drUrl, PARMAK_IZLERI.D);
    await adim("L13", "DR devral (ana kimliksiz → satıcı tesisin tek etkin üretimini çıkarır) → üretim kirası iptal (DEVREDILDI)", async (a) => {
      await baslat(D);
      const k = await portal.istek("POST", "/kurulumlar", { tesisId: S.tesisId, sinif: "DR", kanalKodu: KANAL, yoklamaAraligiDk: 5 });
      S.drDbId = String(k.veri.id);
      const h = await portal.istek("POST", `/kurulumlar/${S.drDbId}/hak`, { moduller: HAK_MODULLERI, kalici: true, bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS) });
      const s = await portal.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { kokParolasi: hz.kokParolasi, sebep: "DR ilk imza" });
      const kod = await portal.istek("POST", `/kurulumlar/${S.drDbId}/etkinlestirme-kodu`, {});
      a.kontrol("portal: DR kurulumu + hak + kod", k.status === 201 && h.status === 201 && s.status === 201 && kod.status === 201, `${ozet(k)}/${ozet(h)}/${ozet(s)}/${ozet(kod)}`);
      const kbD = await D.istemci.sozlesmeyiKabulEt();
      a.kontrol("D: sözleşme kabulü → 201", kbD.status === 201, ozet(kbD));
      const e = await etkinlestirZayifOnayli({ fabrika: D.istemci, portal, kurulumDbId: S.drDbId, kod: String(kod.veri.kod), kontrol: a.kontrol.bind(a), etiket: "D" });
      const de = await D.istemci.detay();
      a.kontrol(
        "D kimliksiz etkinleşti; lisans kimliği portalda doğan DR kimliği (yanıttan), ananınkinden ve DB kimliğinden ayrı",
        e.status === 200 && de.kurulum.kurulumId === String(k.veri.kurulumId) && de.kurulum.kurulumId !== S.anaLisansId && de.kurulum.kurulumId !== de.kurulum.veritabaniKimligi,
        `${ozet(e)} ${de.kurulum.kurulumId?.slice(0, 8)} / db ${String(de.kurulum.veritabaniKimligi).slice(0, 8)}`,
      );
      // Faz 2d kararı: anaKurulumId isteğe bağlı — tesiste TEK etkin ÜRETİM varken satıcı onu çıkarır
      // (belirsizlik 409 DR_ANA_BELIRSIZ satıcı bekçisinde: test_tasima_dr §4i). Kimlikli yol L29'da.
      const dr = await D.istemci.istek("POST", "/api/license/dr-devral", { gerekce: "Senaryo L: ana sunucu arızası" });
      const dd = await D.istemci.detay();
      a.kontrol("D: kimliksiz dr-devral → 200, GECERLI", dr.status === 200 && dd.durum.gecerlilik === "GECERLI", `${ozet(dr)} ${dd.durum.gecerlilik}`);
      const pk = await detayKurulum(S.anaDbId);
      const kayit = (pk.kurulumKaydi as Array<{ olay: string }>).map((x) => x.olay);
      a.kontrol("portal: ana kurulum DEVREDILDI + kurulum kaydı", (pk.kurulum as { durum?: string }).durum === "DEVREDILDI" && kayit.includes("DEVREDILDI"), `${(pk.kurulum as { durum?: string }).durum} ${kayit.slice(0, 3).join(",")}`);
      const b = await C.istemci.bekle((d) => d.durum.devredildi, 20_000);
      a.kontrol("ana (C): zille devredildi kirası → KISITLI + tehlike bandı", b.ms !== null && b.detay.durum.uygulananKademe === "KISITLI" && b.detay.durum.uygulanan.bant?.ton === "tehlike", `${b.ms ?? "zaman aşımı"} ms ${b.detay.durum.uygulananKademe}`);
      const ind = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("ana (C): üretim kirasıyla indirme belirteci YOK", ind.status === 404 || ind.status === 403, ozet(ind));
      const g = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/dr-geri-al`, { sebep: "Senaryo L: ana sunucu onarıldı" });
      a.kontrol("portal DR geri al → 200", g.status === 200, ozet(g));
      const n = await C.istemci.bekle((d) => !d.durum.devredildi && d.durum.uygulananKademe === "NORMAL", 20_000);
      a.kontrol("ana (C) yeniden NORMAL", n.ms !== null, `${n.detay.durum.uygulananKademe}`);
      await durdur(D);
    });

    // ============================================================ L14
    await adim("L14", "dışarı çıkış kesik → aktarma isteği/yanıtı ile yenileme; QR yolu /v1/cevrimdisi", async (a) => {
      C.aktarici.kipAyarla("kesik");
      const p = await C.istemci.yokla();
      a.kontrol("dışarı kesik: yoklama BASARISIZ", p.outcome === "BASARISIZ", `${p.outcome} ${p.code ?? ""}`);
      const once = (await C.istemci.detay()).kira?.kiraId;
      const ist = await C.istemci.istek("GET", "/api/license/aktarma-istegi?amac=yokla");
      a.kontrol("aktarma isteği → 200 (hedefYol /v1/cevrimdisi, gövde {v, zarf})", ist.status === 200 && ist.veri.hedefYol === "/v1/cevrimdisi" && typeof (ist.veri.istekGovdesi as { zarf?: string }).zarf === "string", ozet(ist));
      const panel = await fetch(`${satici!.genel}/v1/cevrimdisi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ist.veri.istekGovdesi) });
      const yanit = (await panel.json()) as Record<string, unknown>;
      a.kontrol("panel (kendi interneti) → satıcı /v1/cevrimdisi 200", panel.status === 200 && LicenseResponseSchema.safeParse(yanit).success, String(panel.status));
      const kabul = await C.istemci.istek("POST", "/api/license/aktarma-yaniti", { yanit });
      const d1 = await C.istemci.detay();
      a.kontrol("aktarma yanıtı kabul → yeni kira", kabul.status === 200 && d1.kira?.kiraId !== once, `${ozet(kabul)} ${once?.slice(0, 8)} → ${d1.kira?.kiraId.slice(0, 8)}`);
      const qr = await C.istemci.istek("GET", "/api/license/cevrimdisi-istek?amac=yokla");
      const qrAdresi = String(qr.veri.qrAdresi ?? "");
      a.kontrol("QR isteği: qrAdresi = <satıcı>/q#<zarf>", qr.status === 200 && qrAdresi.includes("/q#"), qrAdresi.slice(0, 60));
      const sayfa = await fetch(`${satici!.genel}/q`);
      a.kontrol("telefon: GET /q → 200 HTML", sayfa.status === 200 && String(sayfa.headers.get("content-type")).includes("text/html"), String(sayfa.status));
      const tel = await fetch(`${satici!.genel}/v1/cevrimdisi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ v: 1, zarf: qrAdresi.split("#")[1] }) });
      const telYanit = await tel.text();
      const metin = Buffer.from(telYanit, "utf8").toString("base64url");
      const q = await C.istemci.istek("POST", "/api/license/cevrimdisi-yanit", { yanit: metin });
      const d2 = await C.istemci.detay();
      a.kontrol("QR yanıtı (base64url) kabul → yeni kira", tel.status === 200 && q.status === 200 && d2.kira?.kiraId !== d1.kira?.kiraId, `${tel.status}/${ozet(q)}`);
      C.aktarici.kipAyarla("acik");
    });

    // ============================================================ L15
    await adim("L15", "indirme belirteci: Worker doğrulayıcısı geçerli / süresi dolmuş / yanlış önek / imzasız ayırır", async (a) => {
      // Ölçüm 3a Worker'ının KENDİ modülüyle (Node'da; workerd canlı ölçümü runbook §4'te), belirteç gerçek backend'den.
      const worker = (await import(pathToFileURL(path.join(__dirname, "..", "..", "deploy/guncelleme-sunucusu/worker/indirme-kapisi.js")).href)) as WorkerKapisi;
      const t = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("GET /api/license/indirme-belirteci?urun=electron → 200", t.status === 200 && t.veri.yolOneki === `/${KANAL}/electron/`, ozet(t));
      const belirtec = String(t.veri.belirtec);
      const anahtarlar = [{ kid: hz.indirme.kid, x: hz.indirme.x }];
      const simdiMs = saticiSimdi();
      const ok = await worker.belirteciDogrula(belirtec, { anahtarlar, simdiMs });
      a.kontrol("Worker: geçerli belirteç doğrulanır", ok.ok, ok.ok ? "" : ok.kod);
      const kahin = verifyDownloadToken(belirtec, { keys: [...anahtarlar], nowMs: simdiMs });
      a.kontrol("Worker ↔ kâhin aynı belge", ok.ok && kahin.ok && ok.belge.yolOneki === kahin.value.yolOneki && ok.belge.exp === kahin.value.exp);
      const exe = `/${KANAL}/electron/TeksERP-Setup.exe`;
      a.kontrol("yol: kanal önekinin altı kabul", ok.ok && worker.yolIzinli(ok.belge, exe));
      a.kontrol("yanlış önek (başka kanal / mobil) RED", ok.ok && !worker.yolIzinli(ok.belge, "/baska-kanal/electron/x.exe") && !worker.yolIzinli(ok.belge, `/${KANAL}/mobil/x.apk`));
      a.kontrol("yol kaçışı (..) RED", ok.ok && !worker.yolIzinli(ok.belge, `/${KANAL}/electron/../mobil/x.apk`));
      const exp = ok.ok ? Date.parse(ok.belge.exp) : 0;
      const dolmus = await worker.belirteciDogrula(belirtec, { anahtarlar, simdiMs: exp + 11 * 60 * 1000 });
      a.kontrol("süresi dolmuş → BELGE_SURESI_DOLDU", !dolmus.ok && dolmus.kod === "BELGE_SURESI_DOLDU", dolmus.ok ? "kabul!" : dolmus.kod);
      const [h, p] = belirtec.split(".");
      const imzasiz = `${b64uEncode(JSON.stringify({ alg: "none", typ: "tekserp-indirme", kid: hz.indirme.kid }))}.${p}.`;
      const r1 = await worker.belirteciDogrula(imzasiz, { anahtarlar, simdiMs });
      a.kontrol("imzasız (alg none) → JWS_ALG", !r1.ok && r1.kod === "JWS_ALG", r1.ok ? "kabul!" : r1.kod);
      const yuk = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as Record<string, unknown>;
      const kurcali = `${h}.${b64uEncode(JSON.stringify({ ...yuk, yolOneki: "/baska-kanal/electron/", kanal: "baska-kanal" }))}.${belirtec.split(".")[2]}`;
      const r2 = await worker.belirteciDogrula(kurcali, { anahtarlar, simdiMs });
      a.kontrol("kurcalanmış yük → JWS_IMZA", !r2.ok && r2.kod === "JWS_IMZA", r2.ok ? "kabul!" : r2.kod);
      await l15FetchIsleyicisi(a, worker, belirtec, anahtarlar, simdiMs, exp);
    });

    // ============================================================ L16
    await adim("L16", "yerel proxy üzerinden yoklama (Agent({proxyEnv}))", async (a) => {
      const vekil = new ConnectVekili();
      await vekil.baslat();
      try {
        const u = await C.istemci.istek("PUT", "/api/license/proxy", { adres: vekil.adres, atla: null });
        a.kontrol("PUT /api/license/proxy → 200 (kaynak panel)", u.status === 200 && u.veri.kaynak === "panel", `${ozet(u)} ${String(u.veri.adres)}`);
        const p = await C.istemci.yokla();
        const hedef = new URL(C.aktarici.adres).host;
        a.kontrol("yoklama proxy'den geçti: BASARILI + CONNECT satıcı adresine", p.outcome === "BASARILI" && vekil.hedefler.includes(hedef), `${p.outcome} CONNECT=${vekil.hedefler.join(",")}`);
        const k = await C.istemci.istek("PUT", "/api/license/proxy", { adres: null, atla: null });
        const n0 = vekil.hedefler.length;
        const p2 = await C.istemci.yokla();
        a.kontrol("proxy kaldırılınca doğrudan (yeni CONNECT yok), yeniden başlatma yok", k.status === 200 && p2.outcome === "BASARILI" && vekil.hedefler.length === n0, `${ozet(k)} ${p2.outcome}`);
      } finally {
        await vekil.durdur();
      }
    });

    // ============================================================ L17
    await adim("L17", "planlı eylem vadesinde K3 kendiliğinden başlar", async (a) => {
      const vade = saticiSimdi() + 12_000;
      const pl = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/planli-eylem`, { kademe: "K3", vade: msToIso(vade), kisitlamaGun: 7, mesaj: "Vade geçti: ödeme bekleniyor", sebep: "Senaryo L planlı" });
      a.kontrol("portal planlı eylem (K3, vade +12 sn) → 201 BEKLIYOR", pl.status === 201 && pl.veri.durum === "BEKLIYOR", ozet(pl));
      const d0 = await C.istemci.detay();
      a.kontrol("vadeden önce yaptırım YOK", d0.durum.yaptirimKademesi === null, String(d0.durum.yaptirimKademesi));
      let uygulandi = false;
      for (let i = 0; i < 60 && !uygulandi; i++) {
        await bekle(500);
        const pe = ((await detayKurulum(S.anaDbId)).planliEylemler as Array<{ id: string; durum: string; uygulamaZamani: string | null }>).find((x) => x.id === pl.veri.id);
        uygulandi = pe?.durum === "UYGULANDI";
      }
      a.kontrol("satıcı bakım işi vadede uyguladı (UYGULANDI)", uygulandi);
      const b = await C.istemci.bekle((d) => d.durum.yaptirimKademesi === "K3", 20_000);
      a.kontrol("fabrika (zil): K3 geri sayım, UYARI + kisitlamaKalanGun 7", b.ms !== null && b.detay.durum.uygulananKademe === "UYARI" && b.detay.durum.kisitlamaKalanGun === 7, `${b.detay.durum.uygulananKademe} kalan=${b.detay.durum.kisitlamaKalanGun}`);
      const defter = (await detayKurulum(S.anaDbId)).yaptirimDefteri as Array<{ id: string; tur: string; planliEylemId: string | null }>;
      const eylem = defter.find((x) => x.tur === "K3" && x.planliEylemId === pl.veri.id);
      a.kontrol("yaptırım defterinde planlı eyleme bağlı K3 satırı", Boolean(eylem));
      if (eylem) await geriAl(eylem.id);
      const n = await C.istemci.bekle((d) => d.durum.yaptirimKademesi === null, 20_000);
      a.kontrol("K3 geri alındı → NORMAL", n.ms !== null && n.detay.durum.uygulananKademe === "NORMAL", n.detay.durum.uygulananKademe);
    });

    // ============================================================ L18
    await adim("L18", "bakım sonrası derleme tarihi → UYARI → EK_SURE", async (a) => {
      if (!C.surec) throw new Error("C backend'i çalışmıyor");
      await l18KunyeOlc({ kok, surec: C.surec, istemci: C.istemci, kontrol: (ad, ok, ayrinti) => a.kontrol(ad, ok, ayrinti), simdiMs: saticiSimdi() });
    });

    // ============================================================ L19
    await adim("L19", "taksit: ödeme onayı → otomatik uzatma; ödeme yoksa vade + 15'te K3", async (a) => {
      const simdi = saticiSimdi();
      const tp = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/taksit-plani`, {
        aciklama: "Senaryo L taksit",
        kalemler: [
          { vade: msToIso(simdi - 20 * DAY_MS), tutar: "1000.00" },
          { vade: msToIso(simdi - 5 * DAY_MS), tutar: "1000.00" },
          { vade: msToIso(simdi + 20 * DAY_MS), tutar: "1000.00" },
        ],
      });
      a.kontrol("portal taksit planı (3 kalem, gecikme 15 gün) → 201", tp.status === 201, ozet(tp));
      const kalemler = (tp.veri.kalemler as Array<{ id: string; sira: number }>) ?? [];
      let k3 = false;
      let plan: { kalemler: Array<{ id: string; durum: string; sira: number }> } | undefined;
      for (let i = 0; i < 30 && !k3; i++) {
        await bekle(500);
        const pk = await detayKurulum(S.anaDbId);
        plan = (pk.taksitPlanlari as Array<{ id: string; kalemler: Array<{ id: string; durum: string; sira: number }> }>).find((x) => x.id === tp.veri.id);
        k3 = plan?.kalemler[0]?.durum === "GECIKTI";
      }
      a.kontrol("vade + 15 geçen 1. kalem GECIKTI (K3), vade + 15 dolmamış 2. kalem BEKLIYOR", k3 && plan?.kalemler[1]?.durum === "BEKLIYOR", plan?.kalemler.map((k) => `${k.sira}:${k.durum}`).join(","));
      const b = await C.istemci.bekle((d) => d.durum.yaptirimKademesi === "K3", 20_000);
      a.kontrol("fabrika: K3 geri sayımı 15 gün (plan vadesi geçmiş olduğundan kademe EK_SURE)", b.ms !== null && b.detay.durum.kisitlamaKalanGun === 15 && b.detay.durum.uygulananKademe === "EK_SURE", `${b.detay.durum.uygulananKademe} kalan=${b.detay.durum.kisitlamaKalanGun}`);
      const o = await portal.istek("POST", `/taksit-kalemleri/${kalemler[0]?.id}/odeme`, {});
      const yeni = (o.veri.gecerlilik as { parametre?: { yeni?: string } } | null)?.parametre?.yeni ?? null;
      a.kontrol("ödeme onayı → K3 ters kayıtla kalkar, geçerlilik 2. kalem vadesi + 15'e uzar", o.status === 200 && o.veri.kaldirilanK3 !== null && yeni !== null && Math.abs(Date.parse(yeni) - (simdi + 10 * DAY_MS)) < 60_000, `${ozet(o)} yeni=${yeni}`);
      const u = await C.istemci.bekle((d) => d.durum.yaptirimKademesi === null && d.kira?.gecerlilikBitis === yeni, 20_000);
      a.kontrol("fabrika: kira geçerlilik bitişi uzadı, yaptırım yok", u.ms !== null, `${u.detay.kira?.gecerlilikBitis}`);
      await portal.istek("POST", `/taksit-planlari/${String(tp.veri.id)}/kapat`, { sebep: "Senaryo L sonu" });
      await portal.istek("POST", `/kurulumlar/${S.anaDbId}/gecerlilik`, { tarih: null, sebep: "Senaryo L sonu" });
      await C.istemci.yokla();
      const n = await C.istemci.detay();
      a.kontrol("temizlik: plan kapandı, geçerlilik sınırı kalktı", n.kira?.gecerlilikBitis === null && n.durum.uygulananKademe === "NORMAL", `${n.kira?.gecerlilikBitis} ${n.durum.uygulananKademe}`);
    });

    // ============================================================ L20
    const E = await yeniFabrika("E", bayiUrl, PARMAK_IZLERI.E);
    await adim("L20", "bayi tavan içi HAK basar → geçerli; tavan aşımı → RED", async (a) => {
      const by = await portal.istek("POST", "/bayiler", { ad: `Senaryo L Bayi ${randomBytes(3).toString("hex")}`, tavan: { moduller: HAK_MODULLERI, siniflar: ["URETIM"], kurulumAdedi: 1, kanallar: [KANAL], kaliciIzni: true, bakimAyTavani: 12 }, sebep: "Senaryo L bayi" });
      const bayiId = String(by.veri.id);
      olusturulanlar.bayiler.push(bayiId);
      a.kontrol("portal bayi + tavan → 201", by.status === 201, ozet(by));
      const kid = `bayi-senaryo-${randomBytes(3).toString("hex")}`;
      bayiAnahtariUret(saticiEnv, { dizin: hz.dizin, kid, bayiId, moduller: HAK_MODULLERI, siniflar: ["URETIM"], kokKid: hz.kokKid, kokParolasi: hz.kokParolasi, bayiParolasi: BAYI_PAROLASI });
      olusturulanlar.kidler.push(kid);
      await bekle(3000); // satıcının bakım işi anahtar deposunu tazeler (2 sn)
      const bag = await portal.istek("POST", `/bayiler/${bayiId}/anahtar`, { kid });
      a.kontrol("gerçek CLI (bayi-uret, parolalar stdin) + anahtar bağlama → 200", bag.status === 200, ozet(bag));
      const hesapParolasi = `bayi-hesap-${randomUUID()}`;
      const hesap = await portal.istek("POST", "/kullanicilar", { kullaniciAdi: `senaryo-bayi-${randomBytes(3).toString("hex")}`, adSoyad: "Senaryo Bayi", rol: "BAYI", bayiId, parola: hesapParolasi });
      const kul = hesap.veri.kullanici as { id: string; kullaniciAdi: string };
      olusturulanlar.kullanicilar.push(kul.id);
      const bayi = new PortalIstemcisi(satici!.genel, "/bayi/api", { kullaniciAdi: kul.kullaniciAdi, parola: hesapParolasi, sir: (hesap.veri.totp as { sir: string }).sir }, saticiSimdi);
      await baslat(E);
      const m = await bayi.istek("POST", "/musteriler", { ad: `Senaryo L Bayi Müşterisi ${randomBytes(3).toString("hex")}` });
      const t = await bayi.istek("POST", "/tesisler", { musteriId: String(m.veri.id), ad: "Merkez" });
      const k = await bayi.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), sinif: "URETIM", kanalKodu: KANAL });
      // Bakım bitişi tavanın 12 ayının açıkça içinde (sınırdaki eşitlik ay uzunluğuna göre oynar).
      const h = await bayi.istek("POST", `/kurulumlar/${String(k.veri.id)}/hak`, { moduller: HAK_MODULLERI, kalici: true, bakimBitis: msToIso(saticiSimdi() + 330 * DAY_MS) });
      const s = await bayi.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { bayiParolasi: BAYI_PAROLASI, sebep: "bayi ilk imza" });
      a.kontrol("bayi (genel dinleyici): müşteri · tesis · kurulum · hak · bayi imzası → 201", [m, t, k, h, s].every((x) => x.status === 201), [m, t, k, h, s].map(ozet).join("/"));
      const kod = await bayi.istek("POST", `/kurulumlar/${String(k.veri.id)}/etkinlestirme-kodu`, {});
      const kbE = await E.istemci.sozlesmeyiKabulEt();
      a.kontrol("E: sözleşme kabulü → 201", kbE.status === 201, ozet(kbE));
      const e = await etkinlestirZayifOnayli({ fabrika: E.istemci, portal, kurulumDbId: String(k.veri.id), kod: String(kod.veri.kod), kontrol: a.kontrol.bind(a), etiket: "E" });
      const d = await E.istemci.detay();
      a.kontrol("fabrika (E) bayi imzalı HAK'la etkinleşti → GECERLI, hak.bayiId = bayi", e.status === 200 && d.durum.gecerlilik === "GECERLI" && d.hak?.bayiId === bayiId, `${ozet(e)} ${d.durum.gecerlilik} bayiId=${d.hak?.bayiId}`);
      const asim = await bayi.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { bayiParolasi: BAYI_PAROLASI, sebep: "tavan dışı", moduller: [...HAK_MODULLERI, "ticaret.enabled"] });
      a.kontrol("tavan dışı modül → 409 BAYI_TAVANI_ASILDI", asim.status === 409 && asim.kod === "BAYI_TAVANI_ASILDI", ozet(asim));
      const adet = await bayi.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), sinif: "URETIM", kanalKodu: KANAL });
      a.kontrol("kurulum adedi aşımı → 409 BAYI_TAVANI_ASILDI", adet.status === 409 && adet.kod === "BAYI_TAVANI_ASILDI", ozet(adet));
      await durdur(E);
    });

    // ============================================================ L21
    await adim("L21", "kalıcıya çevir (kök parolası imza alt sürecinin stdin'inden; HAK sürümü artar)", async (a) => {
      const once = await C.istemci.detay();
      const yanlis = await hakSurum({ kokParolasi: "yanlis-kok-parolasi-000", kalici: true, sebep: "yanlış parola" });
      a.kontrol("yanlış kök parolası → 400 IMZA_PAROLASI_HATALI", yanlis.status === 400 && yanlis.kod === "IMZA_PAROLASI_HATALI", ozet(yanlis));
      const s = await hakSurum({ kalici: true, sebep: "Senaryo L kalıcıya çevir" });
      a.kontrol("doğru parola → 201, sürüm +1", s.status === 201 && s.veri.surum === (once.hak?.surum ?? 0) + 1, `${ozet(s)} ${once.hak?.surum} → ${String(s.veri.surum)}`);
      const p = await C.istemci.yokla();
      const d = await C.istemci.detay();
      a.kontrol("fabrika yeni HAK'ı aldı: kalici=true, sürüm arttı", p.outcome === "BASARILI" && d.hak?.kalici === true && d.hak.surum === (once.hak?.surum ?? 0) + 1, `${p.outcome} kalici=${d.hak?.kalici} surum=${d.hak?.surum}`);
      a.not("kök parolasının argv/env'e girmediği test_kok_parola_argv'de süreç listesiyle ölçülür (bu adım parolayı yalnız form gövdesiyle verir)");
    });

    // ============================================================ L22
    // L22/L24 gerçek zincir: satıcı → fabrika ucu → istemci başlığı (belirteç yoksa başlıksız, 3b/3c) →
    // indirme kapısı Worker'ı (gerçek modül, satıcının İNDİRME açık anahtarı, sahte origin).
    const indirmeKapisindan = async (belirtec: string | null): Promise<{ status: number; kod: string | null; origin: number }> => {
      const { pathToFileURL } = await import("node:url");
      const w = (await import(pathToFileURL(path.resolve(__dirname, "..", "..", "deploy", "guncelleme-sunucusu", "worker", "indirme-kapisi.js")).href)) as {
        kapiOlustur: (g: { ayar: unknown; fetchImpl?: (r: Request) => Promise<Response>; simdi?: () => number }) => (r: Request) => Promise<Response>;
        VARSAYILAN_AYAR: Record<string, unknown>;
      };
      let origin = 0;
      const kapi = w.kapiOlustur({
        ayar: { ...w.VARSAYILAN_AYAR, anahtarlar: [{ kid: hz.indirme.kid, x: hz.indirme.x }] },
        fetchImpl: async () => {
          origin++;
          return new Response("origin", { status: 200 });
        },
        simdi: saticiSimdi,
      });
      const y = await kapi(new Request(`https://guncelleme.example.test/${KANAL}/electron/latest.yml`, { headers: belirtec ? { "X-TKL-Indirme": belirtec } : {} }));
      return { status: y.status, kod: y.headers.get("x-tkl-kod"), origin };
    };
    const istemciBelirteci = (t: Yanit): string | null => (t.status === 200 && typeof t.veri.belirtec === "string" ? t.veri.belirtec : null);
    await adim("L22", "K1 → indirme belirteci VERİLMEZ, diğer uçlar açık", async (a) => {
      const once = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      const w0 = await indirmeKapisindan(istemciBelirteci(once));
      a.kontrol("K1 ÖNCESİ zincir: fabrikanın belirteciyle Worker 200 (origin çağrıldı)", once.status === 200 && w0.status === 200 && w0.origin === 1, `${ozet(once)} → ${w0.status} ${w0.kod ?? ""}`);
      const k1 = await yaptirim({ kademe: "K1" });
      a.kontrol("portal K1 → 201", k1.status === 201, ozet(k1));
      const b = await C.istemci.bekle((d) => !d.durum.uygulanan.guncellemeIzni, 20_000);
      a.kontrol("uygulanan güncelleme izni kapandı", b.ms !== null);
      const son = C.aktarici.sonKayit("/v1/yokla");
      const belirtecler = son ? ((JSON.parse(son.yanit) as { indirmeBelirtecleri?: unknown[] }).indirmeBelirtecleri ?? []).length : -1;
      a.kontrol("satıcı yanıtında indirme belirteci YOK", belirtecler === 0, `adet=${belirtecler}`);
      const t = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("GET indirme-belirteci → 403 LICENSE_UPDATES_FROZEN", t.status === 403 && t.kod === "LICENSE_UPDATES_FROZEN", ozet(t));
      const wK1 = await indirmeKapisindan(istemciBelirteci(t));
      a.kontrol("K1 zinciri: istemci başlıksız → Worker 403 INDIRME_BELIRTEC_YOK, origin'e gidilmedi", wK1.status === 403 && wK1.kod === "INDIRME_BELIRTEC_YOK" && wK1.origin === 0, `${wK1.status} ${wK1.kod ?? ""}`);
      const w = await renkYarat(C);
      const r = await C.istemci.istek("GET", "/api/orders");
      a.kontrol("diğer uçlar açık: POST /api/colors 201, GET /api/orders 200", w.status === 201 && r.status === 200, `${ozet(w)} / ${ozet(r)}`);
      await geriAl(String(k1.veri.id));
      const n = await C.istemci.bekle((d) => d.durum.uygulanan.guncellemeIzni, 20_000);
      const t2 = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("K1 geri alınınca belirteç yine verilir", n.ms !== null && t2.status === 200, ozet(t2));
      const w2 = await indirmeKapisindan(istemciBelirteci(t2));
      a.kontrol("geri alınınca zincir: yeni belirteçle Worker 200", w2.status === 200 && w2.origin === 1, `${w2.status} ${w2.kod ?? ""}`);
    });

    // ============================================================ L23
    await adim("L23", "panel aktarma yanıtı imzasız/kurcalı → RED", async (a) => {
      const ist = await C.istemci.istek("GET", "/api/license/aktarma-istegi?amac=yokla");
      const r = await fetch(`${satici!.genel}/v1/cevrimdisi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ist.veri.istekGovdesi) });
      const yanit = (await r.json()) as { kira: string; hak: string | null } & Record<string, unknown>;
      a.kontrol("satıcı gerçek yanıtı üretti", r.status === 200, String(r.status));
      const [h, p, sgn] = yanit.kira.split(".");
      const yuk = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as Record<string, unknown>;
      const kurcali = { ...yanit, kira: `${h}.${b64uEncode(JSON.stringify({ ...yuk, bitis: msToIso(Date.parse(String(yuk.bitis)) + 365 * DAY_MS) }))}.${sgn}` };
      const k1 = await C.istemci.istek("POST", "/api/license/aktarma-yaniti", { yanit: kurcali });
      a.kontrol("kurcalı kira (bitiş +1 yıl) → 400 LICENSE_RESPONSE_INVALID / JWS_IMZA", k1.status === 400 && k1.kod === "LICENSE_RESPONSE_INVALID" && k1.details.protocolCode === "JWS_IMZA", `${ozet(k1)} ${String(k1.details.protocolCode)}`);
      const imzasiz = { ...yanit, kira: `${b64uEncode(JSON.stringify({ alg: "none", typ: "tekserp-kira", kid: "alt-2026-1" }))}.${p}.` };
      const k2 = await C.istemci.istek("POST", "/api/license/aktarma-yaniti", { yanit: imzasiz });
      a.kontrol("imzasız (alg none) → 400 LICENSE_RESPONSE_INVALID", k2.status === 400 && k2.kod === "LICENSE_RESPONSE_INVALID", `${ozet(k2)} ${String(k2.details.protocolCode)}`);
      const drKayit = D.aktarici.sonKayit("/v1/yokla") ?? D.aktarici.sonKayit("/v1/dr-devral");
      if (drKayit) {
        const baska = JSON.parse(drKayit.yanit) as Record<string, unknown>;
        const k3 = await C.istemci.istek("POST", "/api/license/aktarma-yaniti", { yanit: baska });
        a.kontrol("başka kurulumun (DR) imzalı yanıtı → 400 LICENSE_RESPONSE_INVALID", k3.status === 400 && k3.kod === "LICENSE_RESPONSE_INVALID", ozet(k3));
      }
      const once = (await C.istemci.detay()).kira?.kiraId;
      const k4 = await C.istemci.istek("POST", "/api/license/aktarma-yaniti", { yanit });
      const d = await C.istemci.detay();
      a.kontrol("aynı yanıtın dokunulmamış hâli kabul (fark yalnız kurcalama)", k4.status === 200 && d.kira?.kiraId !== once, ozet(k4));
    });

    // ============================================================ L24
    await adim("L24", "bakım sonrası sunucu yeni sürüm belirteci vermez", async (a) => {
      const s = await hakSurum({ bakimBitis: msToIso(saticiSimdi() - DAY_MS), sebep: "Senaryo L bakım bitti" });
      a.kontrol("portal: bakım bitişi geçmişte (yeni HAK sürümü) → 201", s.status === 201, ozet(s));
      const p = await C.istemci.yokla();
      const son = C.aktarici.sonKayit("/v1/yokla");
      const adet = son ? ((JSON.parse(son.yanit) as { indirmeBelirtecleri?: unknown[] }).indirmeBelirtecleri ?? []).length : -1;
      a.kontrol("yoklama BASARILI ama satıcı yanıtında indirme belirteci YOK", p.outcome === "BASARILI" && adet === 0, `${p.outcome} adet=${adet}`);
      const t = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("fabrika: belirteç verilmez (403 LICENSE_UPDATES_FROZEN ya da 404)", (t.status === 403 && t.kod === "LICENSE_UPDATES_FROZEN") || (t.status === 404 && t.kod === "LICENSE_DOWNLOAD_TOKEN_UNAVAILABLE"), ozet(t));
      const wB = await indirmeKapisindan(istemciBelirteci(t));
      a.kontrol("bakım sonrası zincir: istemci başlıksız → Worker 403 INDIRME_BELIRTEC_YOK", wB.status === 403 && wB.kod === "INDIRME_BELIRTEC_YOK" && wB.origin === 0, `${wB.status} ${wB.kod ?? ""}`);
      const d = await C.istemci.detay();
      a.kontrol("program DURMAZ: uygulanan kademe NORMAL/UYARI (son hak edilen sürümde kalır)", ["NORMAL", "UYARI"].includes(d.durum.uygulananKademe), `${d.durum.uygulananKademe} ${d.durum.nedenler.map((n) => n.kod).join(",")}`);
      const geri = await hakSurum({ bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS), sebep: "Senaryo L bakım yenilendi" });
      await C.istemci.yokla();
      const t2 = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("bakım yenilenince belirteç yine verilir", geri.status === 201 && t2.status === 200, `${ozet(geri)} / ${ozet(t2)}`);
      const wY = await indirmeKapisindan(istemciBelirteci(t2));
      a.kontrol("yenilenince zincir: Worker 200", wY.status === 200 && wY.origin === 1, `${wY.status} ${wY.kod ?? ""}`);
    });

    // ============================================================ L25
    await adim("L25", "saat İLERİ sıçrar ama yoklama başarılı → kademe DÜŞMEZ", async (a) => {
      C.ekDuvarMs = 40 * DAY_MS;
      await saatUygula(C);
      const d = await C.istemci.detay();
      a.kontrol("duvar +40 gün (kira bitişinin ötesi): OLCULEMEDI + SAAT_ILERI, güvenilir = monotonik tahmin", d.durum.gecerlilik === "OLCULEMEDI" && d.durum.saat.bulgu === "SAAT_ILERI" && Math.abs(Date.parse(d.durum.saat.guvenilir) - saticiSimdi()) < 60 * 60 * 1000, `${d.durum.gecerlilik} ${d.durum.saat.bulgu} ${d.durum.saat.kaynak}`);
      a.kontrol("kademe DÜŞMEDİ (EK_SURE/KISITLI yok; UYARI)", d.durum.hesaplananKademe === "UYARI" && d.durum.uygulananKademe === "UYARI", `${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}`);
      const p = await C.istemci.yokla();
      const d2 = await C.istemci.detay();
      a.kontrol("yoklamadan SONRA da kademe düşmez (iki anahtarın saat ayağı güvenilir saatte)", d2.durum.hesaplananKademe === "UYARI", `${p.outcome} ${p.code ?? ""} → ${d2.durum.hesaplananKademe}`);
      // D4: satıcı ISTEK_ZAMAN + sunucuSaati döner, fabrika BİR KEZ düzeltilmiş damgayla yeniden imzalar.
      a.kontrol(
        "yoklama başarılı (D4: satıcı saatiyle bir kez düzeltilmiş imza)",
        p.outcome === "BASARILI",
        `${p.outcome} ${p.code ?? ""} — saat ${Math.round(C.ekDuvarMs / DAY_MS)} gün ileride`,
      );
    });

    // ============================================================ L26
    // v2 (tasarım §3.1-2; lisans.md:15): üretim çekirdektir (HAK'ta olmasa da açık); HAK doğrulanabildikçe modül tavanı
    // belirsizlikte (OLCULEMEDI) de sürer — v1'deki "ölçülemedide tavan kalkar" kuralı kalktı.
    await adim("L26", "OLCULEMEDI'de production açık kalır (çekirdek); modül tavanı belirsizlikte sürer", async (a) => {
      C.ekDuvarMs = 0;
      await saatUygula(C);
      const s = await hakSurum({ moduller: ["finance.enabled"], uretimModuluCikarilsin: true, sebep: "Senaryo L üretimsiz hak" });
      a.kontrol("portal: üretimsiz HAK sürümü (açık onayla) → 201", s.status === 201, ozet(s));
      const kapaliModuller = async (): Promise<string[]> =>
        ((await C.istemci.istek("GET", "/api/feature-flags")).veri.license as { kapaliModuller?: string[] } | undefined)?.kapaliModuller ?? [];
      const p = await C.istemci.yokla();
      const w1 = await C.istemci.istek("GET", "/api/work-orders");
      const k1 = await kapaliModuller();
      a.kontrol(
        "GECERLI + HAK'ta üretim yok: GET /api/work-orders 200 (üretim çekirdek); tavan uygulanıyor (kapalı modül var, üretim değil)",
        p.outcome === "BASARILI" && w1.status === 200 && k1.length > 0 && !k1.includes("production.enabled"),
        `${p.outcome} ${ozet(w1)} kapalı=${k1.length}`,
      );
      C.ekDuvarMs = 40 * DAY_MS;
      await saatUygula(C);
      const d = await C.istemci.detay();
      const w2 = await C.istemci.istek("GET", "/api/work-orders");
      a.kontrol("OLCULEMEDI (saat ileri): üretim açık → GET /api/work-orders 200", d.durum.gecerlilik === "OLCULEMEDI" && w2.status === 200, `${d.durum.gecerlilik} ${ozet(w2)}`);
      const k2 = await kapaliModuller();
      a.kontrol("OLCULEMEDI: modül tavanı sürer (aynı kapalı modüller, üretim değil)", k2.length === k1.length && !k2.includes("production.enabled"), `adet=${k2.length}`);
      C.ekDuvarMs = 0;
      await saatUygula(C);
      const g = await hakSurum({ moduller: HAK_MODULLERI, sebep: "Senaryo L üretim geri" });
      await C.istemci.yokla();
      const w3 = await C.istemci.istek("GET", "/api/work-orders");
      a.kontrol("üretim HAK'a dönünce yine 200", g.status === 201 && w3.status === 200, `${ozet(g)} / ${ozet(w3)}`);
    });

    // ============================================================ L27
    await adim("L27", "kira zinciri: anlık görüntü geri alma → yakala, yalnız klasör → zincir sürer; ağ tekrarı → aynı kira; iki parmak izi → uyarı, ikinci pencerede kopyaya kapanış kirası", async (a) => {
      // (a) geri alma, lisans.md:30(a) iki ayrı hâl: makine anlık görüntüsü (klasör + DB izi) eski ucu sunar → YAKALA;
      // yalnız klasör geri alınırsa DB izindeki en yeni kira sunulur → zincir olağan sürer (NORMAL), geride kalmış uç yok.
      const izSatiri = async (): Promise<string | null> =>
        (await db(anaUrl).query<{ v: string }>(`SELECT value::text AS v FROM system_settings WHERE key = 'license.trace'`)).rows[0]?.v ?? null;
      const geriAlmaOlc = async (etiket: string, beklenen: "NORMAL" | "YAKALA", uc: string | undefined): Promise<void> => {
        const acik0 = ((await detayKurulum(S.anaDbId)).kopyaUyarilari as Array<{ durum: string }>).filter((u) => u.durum === "ACIK").length;
        await baslat(C);
        const py = await C.istemci.yokla();
        const pk = await detayKurulum(S.anaDbId);
        const satirlar = pk.kiralar as Array<{ id: string; karar: string; oncekiKiraId: string | null }>;
        const acik1 = (pk.kopyaUyarilari as Array<{ durum: string }>).filter((u) => u.durum === "ACIK").length;
        // NORMAL: uçtan sonra doğan her kira (açılış yoklaması dahil) NORMAL ve ilki ucun çocuğu; YAKALA: son kira.
        const ucIdx = uc ? satirlar.findIndex((k) => k.id === uc) : -1;
        const yeni = ucIdx > 0 ? satirlar.slice(0, ucIdx) : satirlar.slice(0, 1);
        const ok = beklenen === "NORMAL" ? ucIdx > 0 && yeni.every((k) => k.karar === "NORMAL") && yeni.some((k) => k.oncekiKiraId === uc) : satirlar[0]?.karar === "YAKALA";
        a.kontrol(
          `(a) ${etiket} → ${beklenen} kirası${beklenen === "NORMAL" ? " (zincir ucunun çocuğu)" : ""}, yeni uyarı YOK — lisans.md:30(a)`,
          py.outcome === "BASARILI" && ok && acik1 === acik0,
          `${py.outcome} kararlar=${yeni.map((k) => k.karar).join(",")} uç=${uc?.slice(0, 8) ?? "-"} acikUyari ${acik0}→${acik1}`,
        );
      };
      const snap = path.join(kok, "snapshot-C");
      fs.cpSync(C.lisansDizini, snap, { recursive: true });
      const snapIz = await izSatiri();
      await C.istemci.yokla();
      await C.istemci.yokla();
      const klasoruGeriAl = (): void => {
        for (const ad of ["kira.jws", "hak.jws", "durum.json"]) fs.copyFileSync(path.join(snap, ad), path.join(C.lisansDizini, ad));
      };
      const uc = (await C.istemci.detay()).kira?.kiraId;
      await durdur(C);
      klasoruGeriAl();
      await geriAlmaOlc("yalnız lisans klasörü geri (DB izi güncel)", "NORMAL", uc);
      await durdur(C);
      klasoruGeriAl();
      if (snapIz === null) await db(anaUrl).query(`DELETE FROM system_settings WHERE key = 'license.trace'`);
      else await db(anaUrl).query(`UPDATE system_settings SET value = $1::jsonb, "updatedAt" = now() WHERE key = 'license.trace'`, [snapIz]);
      await geriAlmaOlc("makine anlık görüntüsü (klasör + DB izi birlikte geri)", "YAKALA", undefined);
      // (b) ağ tekrarı: yanıt yolda kaybolur, fabrika aynı uçla yeniden dener
      await bekle(5500);
      C.aktarici.kipAyarla("yut");
      const k1 = await C.istemci.yokla();
      const yutulan = C.aktarici.kayitlar.filter((x) => x.yutuldu).pop();
      const yutulanKira = yutulan ? (parseJws((JSON.parse(yutulan.yanit) as { kira: string }).kira) as { ok: boolean; value?: { payload: { kiraId?: string } } }).value?.payload.kiraId : undefined;
      a.kontrol("yanıt yolda kayboldu → fabrikada BASARISIZ (ağ)", k1.outcome === "BASARISIZ" && Boolean(yutulanKira), `${k1.outcome} ${k1.code ?? ""} satıcıKira=${yutulanKira?.slice(0, 8)}`);
      const k2 = await C.istemci.yokla();
      const d2 = await C.istemci.detay();
      const pk2 = await detayKurulum(S.anaDbId);
      const son = (pk2.yoklamalar as Array<{ sonuc: string; kiraId: string | null }>)[0];
      a.kontrol("(b) yeniden deneme → satıcı AYNI kirayı döndürür (TEKRAR), fabrika onu kabul eder", k2.outcome === "BASARILI" && d2.kira?.kiraId === yutulanKira && son?.sonuc === "TEKRAR", `${k2.outcome} ${d2.kira?.kiraId.slice(0, 8)} sonuc=${son?.sonuc}`);
      // (c) iki farklı parmak izi aynı ucu ilerletir
      const B2 = await yeniFabrika("B2", await rolDb("B2"), PARMAK_IZLERI.B2);
      fs.cpSync(C.lisansDizini, B2.lisansDizini, { recursive: true });
      await baslat(B2);
      const b1 = await B2.istemci.yokla();
      const c1 = await C.istemci.yokla();
      const pk3 = await detayKurulum(S.anaDbId);
      const acik = (pk3.kopyaUyarilari as Array<{ tur: string; durum: string; redZamani: string | null }>).filter((u) => u.durum === "ACIK");
      a.kontrol("(c) ilk pencere: kopyaya da kira verilir, yalnız portal uyarısı; sahip (C) etkilenmez", b1.outcome === "BASARILI" && c1.outcome === "BASARILI" && acik.length > 0, `B2=${b1.outcome} C=${c1.outcome} uyari=${acik.map((u) => u.tur).join(",")}`);
      await bekle(21_000); // KOPYA_PENCERE_SN=20
      // v2 (tasarım §1.2 K6; lisans.md:30 (c)): ikinci pencerede kopyaya imzalı KAPANIŞ kirası (K3 + ek süre) gider.
      const b2 = await B2.istemci.yokla();
      const c2 = await C.istemci.yokla();
      const dk = await B2.istemci.detay();
      const kB2 = kiraSatiri(await detayKurulum(S.anaDbId), dk.kira?.kiraId);
      a.kontrol(
        "(c) ikinci pencere: kopyanın elindeki kira KAPANIŞ (neden KOPYA; K3, kısıtlamaya ~30 gün, anında KISITLI değil), sahip yine BASARILI",
        kB2?.karar === "KAPANIS" && kB2.kapanisNedeni === "KOPYA" && dk.kira?.yaptirim.kademe === "K3" && dk.durum.kisitlamaKalanGun !== null &&
          dk.durum.kisitlamaKalanGun >= 29 && dk.durum.kisitlamaKalanGun <= 30 && dk.durum.hesaplananKademe !== "KISITLI" && c2.outcome === "BASARILI",
        `B2 yoklama=${b2.outcome} ${b2.code ?? ""} karar=${kB2?.karar} neden=${kB2?.kapanisNedeni} yaptirim=${dk.kira?.yaptirim.kademe} kisitlamaKalanGun=${dk.durum.kisitlamaKalanGun} ${dk.durum.hesaplananKademe} C=${c2.outcome}`,
      );
      B2.ekDuvarMs = 31 * DAY_MS;
      B2.ekMonoMs = 31 * DAY_MS;
      await saatUygula(B2);
      const db2 = await B2.istemci.detay();
      a.kontrol("(c) kopya: kapanış kirasının kısıtlama tarihi (+30 gün) geçince KISITLI — yalnız ek süre sonunda", db2.durum.hesaplananKademe === "KISITLI", `${db2.durum.hesaplananKademe} kisitlamaKalanGun=${db2.durum.kisitlamaKalanGun}`);
      await durdur(B2);
      for (const u of ((await detayKurulum(S.anaDbId)).kopyaUyarilari as Array<{ id: string; durum: string }>).filter((x) => x.durum === "ACIK")) {
        await portal.istek("POST", `/kopya-uyarilari/${u.id}/kapat`, { sebep: "Senaryo L27 incelendi", digerParmakIziniKabulEt: false });
      }
    });

    // ============================================================ L28
    await adim("L28", "kimliksiz istek → rotanın 401'i (kimlik önce, kademe sızmaz); kimlik istemeyen kapalı uçta genel LICENSE_GATE; K5'te /api/admin/health + /api/mobile/* açık", async (a) => {
      await zilBekle(C, 30_000);
      const k5 = await agirYaptirim("K5");
      const b = await C.istemci.bekle((d) => d.durum.uygulananKademe === "DURDURULMUS", 20_000);
      a.kontrol("K5 → DURDURULMUS", k5.status === 201 && b.ms !== null, ozet(k5));
      const anon = await C.istemci.anonim("POST", "/api/orders", {});
      a.kontrol("kimliksiz POST /api/orders → 401 (kapı önce kimlik; lisans kodu/kademe yok)", anon.status === 401 && !String(anon.kod ?? "").startsWith("LICENSE") && anon.details.kademe === undefined, `${ozet(anon)} ${JSON.stringify(anon.details)}`);
      const bozuk = await C.istemci.anonim("POST", "/api/orders", {}, { authorization: "Bearer bozuk.token.degeri" });
      a.kontrol("geçersiz token → 401", bozuk.status === 401 && !String(bozuk.kod ?? "").startsWith("LICENSE"), ozet(bozuk));
      const duyuru = await C.istemci.anonim("POST", "/api/devices/announce", {});
      a.kontrol("kimlik istemeyen kapalı uç (POST /api/devices/announce) → 403 LICENSE_GATE, details yalnız {code}", duyuru.status === 403 && duyuru.kod === "LICENSE_GATE" && Object.keys(duyuru.details).join(",") === "code", `${ozet(duyuru)} ${JSON.stringify(duyuru.details)}`);
      const anonDurum = await C.istemci.anonim("GET", "/api/license/durum");
      a.kontrol("kimliksiz /api/license/durum → {ayrinti:false} (K5 sinyali sızmaz)", anonDurum.status === 200 && anonDurum.veri.ayrinti === false && Object.keys(anonDurum.veri).length === 1, JSON.stringify(anonDurum.veri));
      const saglik = await C.istemci.istek("GET", "/api/admin/health");
      a.kontrol("K5'te GET /api/admin/health (oturumlu) → 200 + license bloğu", saglik.status === 200 && JSON.stringify(saglik.json).includes("DURDURULMUS"), ozet(saglik));
      const mobil = await C.istemci.anonim("GET", "/api/mobile/updates/manifest");
      a.kontrol("K5'te kimliksiz GET /api/mobile/updates/* kapıdan geçer (LICENSE_* değil)", !String(mobil.kod ?? "").startsWith("LICENSE"), ozet(mobil));
      const lm = await C.istemci.anonim("GET", "/api/auth/login-methods");
      const lisansAnahtarlari = Object.keys(lm.veri).filter((k) => !["enabled", "primary", "companyName", "lisansDurduruldu"].includes(k));
      a.kontrol(
        "K5'te kimliksiz GET /api/auth/login-methods → 200, lisansDurduruldu:true (tek lisans bilgisi, başka anahtar yok)",
        lm.status === 200 && lm.veri.lisansDurduruldu === true && lisansAnahtarlari.length === 0,
        `${ozet(lm)} ${JSON.stringify(Object.keys(lm.veri))}`,
      );
      await geriAl(String(k5.veri.id));
      const n = await C.istemci.bekle((d) => d.durum.uygulananKademe === "NORMAL", 20_000);
      a.kontrol("K5 geri alındı → NORMAL", n.ms !== null);
      const lm2 = await C.istemci.anonim("GET", "/api/auth/login-methods");
      a.kontrol("K5 kalkınca login-methods lisansDurduruldu:false (giriş ekranı normale döner)", lm2.status === 200 && lm2.veri.lisansDurduruldu === false, ozet(lm2));
    });

    // ============================================================ L29
    await adim("L29", "DR devralımı sonrası eski ana yeniden bağlanınca DEVREDILDI → KISITLI", async (a) => {
      C.aktarici.kipAyarla("kesik");
      await baslat(D);
      const dr = await D.istemci.istek("POST", "/api/license/dr-devral", { anaKurulumId: S.anaLisansId, gerekce: "Senaryo L29: ana ağdan koptu" });
      a.kontrol("ana kopukken D devraldı → 200", dr.status === 200, ozet(dr));
      const once = await C.istemci.detay();
      a.kontrol("kopuk ana henüz bilmiyor (devredildi=false)", !once.durum.devredildi);
      C.aktarici.kipAyarla("acik");
      const p = await C.istemci.yokla();
      const d = await C.istemci.detay();
      a.kontrol("ana yeniden bağlandı: devredildi kirası → KISITLI + tehlike bandı", p.outcome === "BASARILI" && d.durum.devredildi && d.durum.uygulananKademe === "KISITLI" && d.durum.uygulanan.bant?.ton === "tehlike", `${p.outcome} devredildi=${d.durum.devredildi} ${d.durum.uygulananKademe}`);
      const s = await C.istemci.istek("POST", "/api/orders", {});
      a.kontrol("POST /api/orders → 403 LICENSE_RESTRICTED, devredildi:true", s.status === 403 && s.kod === "LICENSE_RESTRICTED" && s.details.devredildi === true, `${ozet(s)} ${JSON.stringify(s.details)}`);
      const r = await C.istemci.istek("GET", "/api/orders");
      a.kontrol("veri erişimi açık (GET 200)", r.status === 200, ozet(r));
      await portal.istek("POST", `/kurulumlar/${S.anaDbId}/dr-geri-al`, { sebep: "Senaryo L sonu" });
      await durdur(D);
    });

    // ============================================================ L30
    await adim("L30", "K2 donmuş modül → şifreli modül açılmaz, çekirdek çalışır (Faz 2d)", async (a) => {
      await l30ModulOlc({
        kok,
        saticiEnv: { ...saticiEnv, ANAHTAR_DIZINI: hz.dizin, GUVEN_CAPASI_DOSYASI: hz.capaDosyasi },
        saticiDbUrl: saticiUrl,
        lisansDizini: C.lisansDizini,
        capaDosyasi: hz.capaDosyasi,
        yokla: () => C.istemci.yokla(),
        yaptirim,
        geriAl,
        istek: (yontem, yol) => C.istemci.istek(yontem, yol),
        kontrol: (ad, ok, ayrinti) => a.kontrol(ad, ok, ayrinti),
      });
    });

    // ============================================================ L31…L34 (lisans v2: P + iz merdiveni)
    // Her biri kendi rolünde, saat yalnız o fabrikada kayar (dünya ve C değişmez); sonda rol fabrikası durur.
    const merdiven = { portal, kokParolasi: hz.kokParolasi, kanal: KANAL, hakModulleri: HAK_MODULLERI, saticiSimdi, yeniFabrika, rolDb, baslat, durdur, saatUygula, db, detayKurulum, saticiDbUrl: saticiUrl };
    await adim("L31", "internetsiz 400 gün: P−30'a dek NORMAL → bilgi bandı → P sonrası EK_SURE → P+30 KISITLI (okuma/dışa aktarma/yedek açık)", (a) => l31Internetsiz400(merdiven, a));
    await adim("L32", "üç iz birden silinir (kira + durum kaydı + DB izi) → hemen EK_SURE; portalda sıra sıfırlanması + LISANS_IZI_KAYIP", (a) => l32UcIzSilme(merdiven, a));
    await adim("L33", "tek iz silinir → UYARI → 14 g → EK_SURE → KISITLI; başarılı yoklama izi onarır", (a) => l33TekIzSilme(merdiven, a));
    await adim("L34", "uzatma dosyası (internet kesik): portal üretir → panel yükler → P ileri, NORMAL; kurcalı/yabancı/eski dosya RED", (a) => l34UzatmaDosyasi(merdiven, a));

    // ============================================================ L35…L38 (lisans v2: G4 · kapanış kirası · donanım)
    // L36 dünyayı (satıcı + çalışan fabrikalar) ara imzacının bitişine dek ~60 g ileri alır ve geri alınamaz: SONA konur.
    const g4 = {
      ...merdiven,
      anahtarDizini: hz.dizin,
      kokKid: hz.kokKid,
      saticiEnv: { ...saticiEnv, ANAHTAR_DIZINI: hz.dizin, GUVEN_CAPASI_DOSYASI: hz.capaDosyasi },
      saticiGenel: satici.genel,
      dunyayiIlerlet,
      kidEkle: (kid: string) => olusturulanlar.kidler.push(kid),
      kurulumKimligiEkle: (id: string) => ekKurulumKimlikleri.push(id),
    };
    await adim("L35", "iptal turu: ara-1 imzalı HAK → iptal belgesi (kapıda bekler) → ara-2 ile yeniden basım + emekliye → kirayla yayılır; iptal edilmiş arayla imzalı HAK RED; iki kopya da yoksa IPTAL_BELGESI_KAYIP", (a) => l35IptalTuru(g4, a));
    await adim("L37", "kapanış kirası uçtan uca: kopya (ikinci pencere) + taşınan eski anahtar → K3 + ek süre → kısıtlama tarihinde KISITLI; asıl kurulum etkilenmez", (a) => l37KapanisKirasi(g4, a));
    await adim("L38", "donanım değişikliği: çevrimiçi bildir → portal onayı → yeni küme; internetsiz zarf → BEKLIYOR (409) → onay → ONAYLANDI kirası kabul", (a) => l38Donanim(g4, a));
    await adim("L36", "tören atlanması: ara imzacı 30/15/7/1 g uyarı penceresinde — kök işi kuyrukta, kira sürer, NORMAL; süre dolunca HAK değişikliği kuyrukta, kira yine sürer", (a) => l36TorenAtlanmasi(g4, a));
  } catch (err) {
    if (err instanceof DurNoktasi) console.log(`\n⏹  --son=${err.message}: sonraki adımlar koşulmadı`);
    else {
      console.error(`\n❌ Düzenek çöktü: ${(err as Error).stack ?? err}`);
      cikis = 2;
    }
  } finally {
    for (const f of fabrikalar.values()) {
      await durdur(f).catch(() => undefined);
      await f.aktarici.durdur().catch(() => undefined);
    }
    await satici?.durdur().catch(() => undefined);
    for (const [anahtar, deger] of flagOncesi) {
      await (deger === null
        ? db(anaUrl).query(`DELETE FROM system_settings WHERE key = $1`, [anahtar])
        : db(anaUrl).query(`UPDATE system_settings SET value = $2::jsonb, "updatedAt" = now() WHERE key = $1`, [anahtar, deger])
      ).catch(() => undefined);
    }
    await db(anaUrl).query(`DELETE FROM colors WHERE id = ANY($1::uuid[])`, [senaryoRenkleri]).catch((err: Error) => console.error(`⚠️ renk temizliği: ${err.message}`));
    const lisansKimlikleri = [S.anaLisansId, ...ekKurulumKimlikleri, ...[...fabrikalar.values()].map((f) => lisansKimligiOku(f.lisansDizini))];
    const dbKimlikleri = await Promise.all([anaUrl, drUrl, bayiUrl].map(kurulumKimligi).map((p) => p.catch(() => null)));
    const kimlikler = [...new Set([...lisansKimlikleri, ...dbKimlikleri].filter((x): x is string => Boolean(x)))];
    try {
      saticiYardimcisi(saticiEnv, [
        "temizle",
        `--kurulum-idleri=${kimlikler.join(",")}`,
        `--kullanicilar=${olusturulanlar.kullanicilar.join(",")}`,
        `--bayiler=${olusturulanlar.bayiler.join(",")}`,
        `--kidler=${olusturulanlar.kidler.join(",")}`,
        "--bayi-adi-oneki=Senaryo L Bayi",
        `--kanallar=${KANAL}`,
        `--iptal-yukleyen=${IPTAL_YUKLEYEN}`,
      ]);
    } catch (err) {
      console.error(`⚠️ satıcı temizliği: ${(err as Error).message}`);
    }
    for (const p of havuzlar.values()) await p.end().catch(() => undefined);
    fs.rmSync(hz.dizin, { recursive: true, force: true });
    if (process.env.SENARYO_LOG_SAKLA !== "1") fs.rmSync(kok, { recursive: true, force: true });
    else console.log(`🗂  loglar saklandı: ${logDizini}`);
  }

  // ---------------------------------------------------------------- rapor
  console.log("\n| Adım | Sonuç | Başlık |\n|---|---|---|");
  for (const s of sonuclar) console.log(`| ${s.no} | ${s.sonuc === "YESIL" ? "✅ yeşil" : s.sonuc === "KISMI" ? "⚠️ kısmi" : "❌ kırmızı"} | ${s.baslik} |`);
  const yesil = sonuclar.filter((s) => s.sonuc === "YESIL").length;
  const kismi = sonuclar.filter((s) => s.sonuc === "KISMI").length;
  const kirmizi = sonuclar.filter((s) => s.sonuc === "KIRMIZI").length;
  console.log(`\n=== Senaryo L: ${yesil} yeşil · ${kismi} kısmi · ${kirmizi} kırmızı (${sonuclar.length}/${ADIM_SAYISI} adım koştu) ===`);
  if (jsonCikti) fs.writeFileSync(jsonCikti, JSON.stringify({ sonuclar, ozet: { yesil, kismi, kirmizi } }, null, 2));
  if (cikis !== 0) return cikis;
  return yesil === ADIM_SAYISI ? 0 : 1;
}

main().then(
  (kod) => process.exit(kod),
  (err: Error) => {
    console.error(`❌ Senaryo L çöktü: ${err.stack ?? err.message}`);
    process.exit(2);
  },
);
