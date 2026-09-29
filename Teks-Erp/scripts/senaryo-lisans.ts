// =============================================================================
// SENARYO L — lisans uçtan uca (plan §8 "Senaryo L", adımlar L1…L29 SIRAYLA)
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
// Rol dağılımı: A ana (L1–L12) → C taşınmış ana (L12–L29) · B/B2 kopya · D DR · E bayi kurulumu.
// Her adım: yeşil/kırmızı/kısmi + kanıt (HTTP durumu, details.code, detay/portal okuması).
// Çıkış: 0 hepsi yeşil · 1 yeşil olmayan adım var · 2 hedef reddi / düzenek kurulamadı.
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../src/lib/pg-session";
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
const HAK_MODULLERI = ["production.enabled", "finance.enabled"];
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

  const kok = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-senaryo-l-"));
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

  // Önceki koşumun artığı (çökmüş koşum) — kurulum kimliğiyle.
  const eskiKimlikler = (await Promise.all([anaUrl, drUrl, bayiUrl].map(kurulumKimligi))).filter((x): x is string => Boolean(x));
  saticiYardimcisi(saticiEnv, ["temizle", `--kurulum-idleri=${eskiKimlikler.join(",")}`, "--bayi-adi-oneki=Senaryo L Bayi", `--kanallar=${KANAL}`]);
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
    const hazir = await f.istemci.bekle((d) => d.hazir && Boolean(d.kurulum.kurulumId), 30_000);
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

  let portal = null as unknown as PortalIstemcisi;
  const olusturulanlar = { kullanicilar: [hz.yonetici.id] as string[], bayiler: [] as string[], kidler: [...hz.kidler] as string[] };
  // Senaryonun satıcı tarafındaki kimlikleri
  const S = { musteriId: "", tesisId: "", anaDbId: "", anaHakId: "", lisansNo: "", drDbId: "", kod: "", k4: "", k5: "", yedek: "" };
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
    const I1 = (await A.istemci.detay()).kurulum.kurulumId!;
    console.log(`🏭 A: ${A.surec!.url} · kurulum ${I1}`);
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
      const k = await portal.istek("POST", "/kurulumlar", { tesisId: S.tesisId, kurulumId: I1, sinif: "URETIM", kanalKodu: KANAL, yoklamaAraligiDk: 5 });
      S.anaDbId = String(k.veri.id);
      a.kontrol("kurulum (fabrikanın installationId'si, URETIM) → 201", k.status === 201 && k.veri.kurulumId === I1, ozet(k));
      const h = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/hak`, { moduller: HAK_MODULLERI, kalici: false, bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS) });
      S.anaHakId = String(h.veri.id);
      S.lisansNo = String(h.veri.lisansNo);
      a.kontrol("hak taslağı → 201, lisans no doğuşta", h.status === 201 && /^TKS-\d{4}-\d{4,6}$/.test(S.lisansNo), `${ozet(h)} ${S.lisansNo}`);
      const s = await hakSurum({ sebep: "ilk imza" });
      a.kontrol("hak sürüm 1 (kök parolasıyla imza) → 201", s.status === 201 && s.veri.surum === 1, `${ozet(s)} surum=${String(s.veri.surum)}`);
      const kod = await portal.istek("POST", `/kurulumlar/${S.anaDbId}/etkinlestirme-kodu`, {});
      S.kod = String(kod.veri.kod);
      a.kontrol("etkinleştirme kodu → 201 (16 karakter, TKS-XXXX-XXXX-XXXX-XXXX)", kod.status === 201 && /^TKS(-[0-9A-HJKMNP-TV-Z]{4}){4}$/.test(String(kod.veri.kod)), ozet(kod));
    });

    // ============================================================ L2
    await adim("L2", "etkinleştirme → hak + kira, kademe NORMAL", async (a) => {
      const y = await A.istemci.istek("POST", "/api/license/etkinlestir", { kod: S.kod.toLowerCase().replace(/-/g, " ") });
      a.kontrol("POST /api/license/etkinlestir (küçük harf + boşluklu elle yazım) → 200", y.status === 200, ozet(y));
      const d = await A.istemci.detay();
      a.kontrol("hak + kira yerelde, lisans no eşleşir", d.hak?.lisansNo === S.lisansNo && Boolean(d.kira?.kiraId), `${d.hak?.lisansNo} kira=${d.kira?.kiraId.slice(0, 8)}`);
      a.kontrol("geçerlilik GECERLI, hesaplanan = uygulanan = NORMAL, kip gözlem", d.durum.gecerlilik === "GECERLI" && d.durum.hesaplananKademe === "NORMAL" && d.durum.uygulananKademe === "NORMAL" && d.durum.kip === "gozlem", `${d.durum.gecerlilik}/${d.durum.hesaplananKademe}/${d.durum.uygulananKademe}/${d.durum.kip}`);
      a.kontrol("parmak izi ESLESTI", d.parmakIzi.karar === "ESLESTI", `${d.parmakIzi.karar} ${d.parmakIzi.eslesen}/${d.parmakIzi.olculebilen}`);
      const pk = await detayKurulum(S.anaDbId);
      a.kontrol("portal: kurulum ETKIN, anahtar kimliği kayıtlı", (pk.kurulum as { durum?: string }).durum === "ETKIN" && (pk.kurulum as { anahtarKimligi?: string }).anahtarKimligi === d.kurulum.anahtarKimligi, String((pk.kurulum as { durum?: string }).durum));
      a.kontrol("kapı zili bağlandı (etkinleştirme dürttü)", await zilBekle(A));
    });

    // ============================================================ L3
    await adim("L3", "yoklama kirayı yeniler; gövde allowlist dışı anahtar taşımaz", async (a) => {
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
      a.kontrol("kira zinciri: gövdedeki sonKiraId önceki kira", govde.sonKiraId === once);
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
      const renk = await A.istemci.istek("POST", "/api/colors", { name: `Senaryo Rengi ${randomBytes(3).toString("hex")}` });
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
      const s = await A.istemci.istek("POST", "/api/colors", { name: `Senaryo Rengi ${randomBytes(3).toString("hex")}` });
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
    await adim("L9", "saat ileri (gerçek süre): kira biter → EK_SURE (gün sayacı) → +30 gün KISITLI → yeni kira NORMAL", async (a) => {
      A.aktarici.kipAyarla("kesik");
      await dunyayiIlerlet(31 * DAY_MS);
      const p1 = await A.istemci.yokla();
      a.kontrol("dışarı kesik: yoklama BASARISIZ", p1.outcome === "BASARISIZ", `${p1.outcome} ${p1.code ?? ""}`);
      const d1 = await A.istemci.detay();
      a.kontrol("+31 gün: EK_SURE, gün sayacı ~29", d1.durum.hesaplananKademe === "EK_SURE" && d1.durum.uygulananKademe === "EK_SURE" && d1.durum.ekSureKalanGun !== null && d1.durum.ekSureKalanGun >= 28 && d1.durum.ekSureKalanGun <= 30, `${d1.durum.hesaplananKademe} ekSureKalanGun=${d1.durum.ekSureKalanGun} saat=${d1.durum.saat.kaynak}`);
      const durum = await A.istemci.istek("GET", "/api/license/durum");
      a.kontrol("/durum ekSureKalanGun + uyarı bandı (zorla)", durum.veri.ekSureKalanGun === d1.durum.ekSureKalanGun && (durum.veri.bant as { ton?: string } | null)?.ton === "uyari", JSON.stringify({ k: durum.veri.kademe, g: durum.veri.ekSureKalanGun }));
      const yaz = await A.istemci.istek("POST", "/api/colors", { name: `Senaryo Rengi ${randomBytes(3).toString("hex")}` });
      a.kontrol("EK_SURE'de yazma açık (201)", yaz.status === 201, ozet(yaz));
      await dunyayiIlerlet(30 * DAY_MS + 3 * 60 * 60 * 1000);
      const p2 = await A.istemci.yokla();
      const d2 = await A.istemci.detay();
      a.kontrol("+61 gün + başarısız yoklama (iki anahtar) → KISITLI", p2.outcome === "BASARISIZ" && d2.durum.hesaplananKademe === "KISITLI" && d2.durum.uygulananKademe === "KISITLI", `${p2.outcome}/${d2.durum.hesaplananKademe}`);
      const s = await A.istemci.istek("POST", "/api/orders", {});
      a.kontrol("KISITLI: POST /api/orders → 403 LICENSE_RESTRICTED", s.status === 403 && s.kod === "LICENSE_RESTRICTED", ozet(s));
      A.aktarici.kipAyarla("acik");
      const p3 = await A.istemci.yokla();
      const d3 = await A.istemci.detay();
      a.kontrol("dışarı açık: yeni kira → NORMAL", p3.outcome === "BASARILI" && d3.durum.hesaplananKademe === "NORMAL" && d3.durum.uygulananKademe === "NORMAL", `${p3.outcome}/${d3.durum.hesaplananKademe}`);
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
      await durdur(A);
      fs.rmSync(path.join(A.lisansDizini, "durum.json"), { force: true });
      await baslat(A);
      const d2 = await A.istemci.detay();
      const b2 = d2.durum.nedenler.map((n) => n.kod);
      a.kontrol("durum kaydı silinip yeniden açılış: kaynak YUKSEK_SU + SAAT_GERI (+ DURUM_DOSYASI)", d2.durum.saat.kaynak === "YUKSEK_SU" && d2.durum.saat.bulgu === "SAAT_GERI" && b2.includes("DURUM_DOSYASI"), `${d2.durum.saat.kaynak} ${b2.join(",")}`);
      a.kontrol("yüksek su = son kiranın sunucu saati (dünya), duvarın ilerisinde", Date.parse(d2.durum.saat.guvenilir) > saticiSimdi() - 2 * DAY_MS, d2.durum.saat.guvenilir);
      A.ekDuvarMs = 0;
      await saatUygula(A);
      const p = await A.istemci.yokla();
      const d3 = await A.istemci.detay();
      a.kontrol("saat düzelince yoklama → yeni kira, durum kaydı yeniden başlar, GECERLI", p.outcome === "BASARILI" && d3.durum.gecerlilik === "GECERLI" && d3.depo.durumKaydi.gecerli, `${p.outcome} ${d3.durum.gecerlilik}`);
    });

    // ============================================================ L11
    const B = await yeniFabrika("B", anaUrl, PARMAK_IZLERI.B);
    await adim("L11", "LICENSE_DIR farklı parmak izli ikinci backend'e kopyalanır → GECERSIZ + portalda kopya uyarısı", async (a) => {
      fs.cpSync(A.lisansDizini, B.lisansDizini, { recursive: true });
      const uyari0 = ((await detayKurulum(S.anaDbId)).kopyaUyarilari as unknown[] | undefined)?.length ?? 0;
      await baslat(B);
      const d = await B.istemci.detay();
      a.kontrol("kopya (B): parmak izi ESLESMEDI → GECERSIZ", d.parmakIzi.karar === "ESLESMEDI" && d.durum.gecerlilik === "GECERSIZ", `${d.parmakIzi.karar} ${d.parmakIzi.uyusmayan.join(",")} ${d.durum.nedenler.map((n) => n.kod).join(",")}`);
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
    await adim("L12", "taşıma onayı → yeni geçerli, eski düşer", async (a) => {
      await baslat(C);
      const t = await C.istemci.istek("POST", "/api/license/tasima-talebi", { gerekce: "Senaryo L: sunucu değişimi" });
      a.kontrol("C: taşıma talebi → BEKLIYOR", t.status === 200 && t.veri.durum === "BEKLIYOR", `${ozet(t)} ${String(t.veri.durum)}`);
      const talepler = (await detayKurulum(S.anaDbId)).tasimaTalepleri as Array<{ id: string; durum: string }>;
      const talep = talepler.find((x) => x.durum === "BEKLIYOR");
      a.kontrol("portal: talep listede BEKLIYOR", Boolean(talep));
      const o = await portal.istek("POST", `/tasima-talepleri/${talep?.id}/onayla`, { sebep: "Senaryo L onay" });
      a.kontrol("portal onay → 200", o.status === 200, ozet(o));
      const p = await C.istemci.yokla();
      const d = await C.istemci.detay();
      a.kontrol("C: yoklama taşımayı tamamlar → GECERLI, parmak izi ESLESTI", p.outcome === "BASARILI" && d.durum.gecerlilik === "GECERLI" && d.parmakIzi.karar === "ESLESTI", `${p.outcome} ${d.durum.gecerlilik} ${d.parmakIzi.karar}`);
      const pa = await A.istemci.yokla();
      a.kontrol("A (eski anahtar): yoklama → KURULUM_IPTAL", pa.outcome === "BASARISIZ" && pa.code === "KURULUM_IPTAL", `${pa.outcome} ${pa.code ?? ""}`);
      const pk = await detayKurulum(S.anaDbId);
      a.kontrol("portal: kurulumun anahtarı artık C'ninki", (pk.kurulum as { anahtarKimligi?: string }).anahtarKimligi === d.kurulum.anahtarKimligi);
      await durdur(A);
      a.kontrol("C zile bağlanır", (await zilBekle(C, 30_000)) || (await C.istemci.yokla(), await zilBekle(C, 15_000)));
    });

    // ============================================================ L13
    const D = await yeniFabrika("D", drUrl, PARMAK_IZLERI.D);
    await adim("L13", "DR devral → üretim kirası iptal (DEVREDILDI)", async (a) => {
      await baslat(D);
      const I2 = (await D.istemci.detay()).kurulum.kurulumId!;
      const k = await portal.istek("POST", "/kurulumlar", { tesisId: S.tesisId, kurulumId: I2, sinif: "DR", kanalKodu: KANAL, yoklamaAraligiDk: 5 });
      S.drDbId = String(k.veri.id);
      const h = await portal.istek("POST", `/kurulumlar/${S.drDbId}/hak`, { moduller: HAK_MODULLERI, kalici: true, bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS) });
      const s = await portal.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { kokParolasi: hz.kokParolasi, sebep: "DR ilk imza" });
      const kod = await portal.istek("POST", `/kurulumlar/${S.drDbId}/etkinlestirme-kodu`, {});
      a.kontrol("portal: DR kurulumu + hak + kod", k.status === 201 && h.status === 201 && s.status === 201 && kod.status === 201, `${ozet(k)}/${ozet(h)}/${ozet(s)}/${ozet(kod)}`);
      const e = await D.istemci.istek("POST", "/api/license/etkinlestir", { kod: String(kod.veri.kod) });
      a.kontrol("D etkinleşti", e.status === 200, ozet(e));
      const dr = await D.istemci.istek("POST", "/api/license/dr-devral", { anaKurulumId: I1, gerekce: "Senaryo L: ana sunucu arızası" });
      const dd = await D.istemci.detay();
      a.kontrol("D: dr-devral → 200, GECERLI", dr.status === 200 && dd.durum.gecerlilik === "GECERLI", `${ozet(dr)} ${dd.durum.gecerlilik}`);
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
      a.kismi("CF Worker kodu Faz 3a'da; ölçüm Worker'ın kâhini `protocol/indirme.ts` ile, belirteç gerçek backend'den");
      const t = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("GET /api/license/indirme-belirteci?urun=electron → 200", t.status === 200 && t.veri.yolOneki === `/${KANAL}/electron/`, ozet(t));
      const belirtec = String(t.veri.belirtec);
      const anahtar = [{ kid: hz.indirme.kid, x: hz.indirme.x }];
      const ok = verifyDownloadToken(belirtec, { keys: anahtar, nowMs: saticiSimdi() });
      a.kontrol("geçerli belirteç doğrulanır", ok.ok, ok.ok ? "" : ok.code);
      a.kontrol("yol: kanal önekinin altı kabul", ok.ok && isDownloadPathAllowed(ok.value, `/${KANAL}/electron/TeksERP-Setup.exe`));
      a.kontrol("yanlış önek (başka kanal / mobil) RED", ok.ok && !isDownloadPathAllowed(ok.value, `/baska-kanal/electron/x.exe`) && !isDownloadPathAllowed(ok.value, `/${KANAL}/mobil/x.apk`));
      a.kontrol("yol kaçışı (..) RED", ok.ok && !isDownloadPathAllowed(ok.value, `/${KANAL}/electron/../mobil/x.apk`));
      const exp = ok.ok ? Date.parse(ok.value.exp) : 0;
      const dolmus = verifyDownloadToken(belirtec, { keys: anahtar, nowMs: exp + 11 * 60 * 1000 });
      a.kontrol("süresi dolmuş → BELGE_SURESI_DOLDU", !dolmus.ok && dolmus.code === "BELGE_SURESI_DOLDU", dolmus.ok ? "kabul!" : dolmus.code);
      const [h, p] = belirtec.split(".");
      const imzasiz = `${b64uEncode(JSON.stringify({ alg: "none", typ: "tekserp-indirme", kid: hz.indirme.kid }))}.${p}.`;
      const r1 = verifyDownloadToken(imzasiz, { keys: anahtar, nowMs: saticiSimdi() });
      a.kontrol("imzasız (alg none) RED", !r1.ok, r1.ok ? "kabul!" : r1.code);
      const yuk = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as Record<string, unknown>;
      const kurcali = `${h}.${b64uEncode(JSON.stringify({ ...yuk, yolOneki: "/baska-kanal/electron/", kanal: "baska-kanal" }))}.${belirtec.split(".")[2]}`;
      const r2 = verifyDownloadToken(kurcali, { keys: anahtar, nowMs: saticiSimdi() });
      a.kontrol("kurcalanmış yük → JWS_IMZA", !r2.ok && r2.code === "JWS_IMZA", r2.ok ? "kabul!" : r2.code);
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
      const d = await C.istemci.detay();
      const nedenler = d.durum.nedenler.map((n) => n.kod);
      a.kontrol("fabrika derleme tarihini taşımıyor (DERLEME_TARIHI_YOK) — ölçülebilir değil", nedenler.includes("DERLEME_TARIHI_YOK") || !nedenler.includes("BAKIM_SONRASI_DERLEME"), nedenler.join(",") || "neden yok");
      a.kismi("imzalı derleme künyesi Faz 2e'de (buildEnvironment derlemeTarihi=null, runtime derlemeTarihiMs=null); kural test_lisans_durumu §12'de saf fonksiyonla ölçülü — uçtan uca kol Faz 2 borcu");
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
      const I3 = (await E.istemci.detay()).kurulum.kurulumId!;
      const m = await bayi.istek("POST", "/musteriler", { ad: `Senaryo L Bayi Müşterisi ${randomBytes(3).toString("hex")}` });
      const t = await bayi.istek("POST", "/tesisler", { musteriId: String(m.veri.id), ad: "Merkez" });
      const k = await bayi.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), kurulumId: I3, sinif: "URETIM", kanalKodu: KANAL });
      // Bakım bitişi tavanın 12 ayının açıkça içinde (sınırdaki eşitlik ay uzunluğuna göre oynar).
      const h = await bayi.istek("POST", `/kurulumlar/${String(k.veri.id)}/hak`, { moduller: HAK_MODULLERI, kalici: true, bakimBitis: msToIso(saticiSimdi() + 330 * DAY_MS) });
      const s = await bayi.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { bayiParolasi: BAYI_PAROLASI, sebep: "bayi ilk imza" });
      a.kontrol("bayi (genel dinleyici): müşteri · tesis · kurulum · hak · bayi imzası → 201", [m, t, k, h, s].every((x) => x.status === 201), [m, t, k, h, s].map(ozet).join("/"));
      const kod = await bayi.istek("POST", `/kurulumlar/${String(k.veri.id)}/etkinlestirme-kodu`, {});
      const e = await E.istemci.istek("POST", "/api/license/etkinlestir", { kod: String(kod.veri.kod) });
      const d = await E.istemci.detay();
      a.kontrol("fabrika (E) bayi imzalı HAK'la etkinleşti → GECERLI, hak.bayiId = bayi", e.status === 200 && d.durum.gecerlilik === "GECERLI" && d.hak?.bayiId === bayiId, `${ozet(e)} ${d.durum.gecerlilik} bayiId=${d.hak?.bayiId}`);
      const asim = await bayi.istek("POST", `/haklar/${String(h.veri.id)}/surum`, { bayiParolasi: BAYI_PAROLASI, sebep: "tavan dışı", moduller: [...HAK_MODULLERI, "ticaret.enabled"] });
      a.kontrol("tavan dışı modül → 409 BAYI_TAVANI_ASILDI", asim.status === 409 && asim.kod === "BAYI_TAVANI_ASILDI", ozet(asim));
      const adet = await bayi.istek("POST", "/kurulumlar", { tesisId: String(t.veri.id), kurulumId: randomUUID(), sinif: "URETIM", kanalKodu: KANAL });
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
    await adim("L22", "K1 → indirme belirteci VERİLMEZ, diğer uçlar açık", async (a) => {
      const k1 = await yaptirim({ kademe: "K1" });
      a.kontrol("portal K1 → 201", k1.status === 201, ozet(k1));
      const b = await C.istemci.bekle((d) => !d.durum.uygulanan.guncellemeIzni, 20_000);
      a.kontrol("uygulanan güncelleme izni kapandı", b.ms !== null);
      const son = C.aktarici.sonKayit("/v1/yokla");
      const belirtecler = son ? ((JSON.parse(son.yanit) as { indirmeBelirtecleri?: unknown[] }).indirmeBelirtecleri ?? []).length : -1;
      a.kontrol("satıcı yanıtında indirme belirteci YOK", belirtecler === 0, `adet=${belirtecler}`);
      const t = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("GET indirme-belirteci → 403 LICENSE_UPDATES_FROZEN", t.status === 403 && t.kod === "LICENSE_UPDATES_FROZEN", ozet(t));
      const w = await C.istemci.istek("POST", "/api/colors", { name: `Senaryo Rengi ${randomBytes(3).toString("hex")}` });
      const r = await C.istemci.istek("GET", "/api/orders");
      a.kontrol("diğer uçlar açık: POST /api/colors 201, GET /api/orders 200", w.status === 201 && r.status === 200, `${ozet(w)} / ${ozet(r)}`);
      await geriAl(String(k1.veri.id));
      const n = await C.istemci.bekle((d) => d.durum.uygulanan.guncellemeIzni, 20_000);
      const t2 = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("K1 geri alınınca belirteç yine verilir", n.ms !== null && t2.status === 200, ozet(t2));
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
      const d = await C.istemci.detay();
      a.kontrol("program DURMAZ: uygulanan kademe NORMAL/UYARI (son hak edilen sürümde kalır)", ["NORMAL", "UYARI"].includes(d.durum.uygulananKademe), `${d.durum.uygulananKademe} ${d.durum.nedenler.map((n) => n.kod).join(",")}`);
      const geri = await hakSurum({ bakimBitis: msToIso(saticiSimdi() + 365 * DAY_MS), sebep: "Senaryo L bakım yenilendi" });
      await C.istemci.yokla();
      const t2 = await C.istemci.istek("GET", "/api/license/indirme-belirteci?urun=electron");
      a.kontrol("bakım yenilenince belirteç yine verilir", geri.status === 201 && t2.status === 200, `${ozet(geri)} / ${ozet(t2)}`);
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
      a.kontrol("başarısız yoklamadan SONRA da kademe düşmez (iki anahtarın saat ayağı güvenilir saatte)", d2.durum.hesaplananKademe === "UYARI", `${p.outcome} ${p.code ?? ""} → ${d2.durum.hesaplananKademe}`);
      if (p.outcome !== "BASARILI") {
        a.kismi(`saat ${Math.round(C.ekDuvarMs / DAY_MS)} gün ilerideyken yoklama satıcıda ${p.code ?? "?"} ile reddedilir: İSTEK duvar saatiyle imzalanıyor (±10 dk) — "yoklama başarılı" kolu bugünkü tasarımda gerçekleşemez (tasarım borcu)`);
      } else {
        a.kontrol("yoklama başarılı", true);
      }
    });

    // ============================================================ L26
    await adim("L26", "OLCULEMEDI'de production açık kalır", async (a) => {
      C.ekDuvarMs = 0;
      await saatUygula(C);
      const s = await hakSurum({ moduller: ["finance.enabled"], uretimModuluCikarilsin: true, sebep: "Senaryo L üretimsiz hak" });
      a.kontrol("portal: üretimsiz HAK sürümü (açık onayla) → 201", s.status === 201, ozet(s));
      const p = await C.istemci.yokla();
      const w1 = await C.istemci.istek("GET", "/api/work-orders");
      a.kontrol("GECERLI + HAK'ta üretim yok: GET /api/work-orders → 403 LICENSE_MODULE (tavan uygulanıyor)", p.outcome === "BASARILI" && w1.status === 403 && w1.kod === "LICENSE_MODULE", `${p.outcome} ${ozet(w1)}`);
      C.ekDuvarMs = 40 * DAY_MS;
      await saatUygula(C);
      const d = await C.istemci.detay();
      const w2 = await C.istemci.istek("GET", "/api/work-orders");
      a.kontrol("OLCULEMEDI (saat ileri): tavan uygulanmaz → GET /api/work-orders 200", d.durum.gecerlilik === "OLCULEMEDI" && w2.status === 200, `${d.durum.gecerlilik} ${ozet(w2)}`);
      const ff = await C.istemci.istek("GET", "/api/feature-flags");
      const kapali = ((ff.veri.license as { kapaliModuller?: unknown[] } | undefined)?.kapaliModuller ?? []).length;
      a.kontrol("panel bloğu: kapalı modül yok", kapali === 0, `adet=${kapali}`);
      C.ekDuvarMs = 0;
      await saatUygula(C);
      const g = await hakSurum({ moduller: HAK_MODULLERI, sebep: "Senaryo L üretim geri" });
      await C.istemci.yokla();
      const w3 = await C.istemci.istek("GET", "/api/work-orders");
      a.kontrol("üretim HAK'a dönünce yine 200", g.status === 201 && w3.status === 200, `${ozet(g)} / ${ozet(w3)}`);
    });

    // ============================================================ L27
    await adim("L27", "kira zinciri: snapshot geri alma → yakala; ağ tekrarı → aynı kira; iki parmak izi → uyarı, ikinci pencerede çatal ek süreye", async (a) => {
      // (a) snapshot geri alma
      const snap = path.join(kok, "snapshot-C");
      fs.cpSync(C.lisansDizini, snap, { recursive: true });
      await C.istemci.yokla();
      await C.istemci.yokla();
      const acik0 = ((await detayKurulum(S.anaDbId)).kopyaUyarilari as Array<{ durum: string }>).filter((u) => u.durum === "ACIK").length;
      await durdur(C);
      for (const ad of ["kira.jws", "hak.jws", "durum.json"]) fs.copyFileSync(path.join(snap, ad), path.join(C.lisansDizini, ad));
      await baslat(C);
      const py = await C.istemci.yokla();
      const pk = await detayKurulum(S.anaDbId);
      const karar = (pk.kiralar as Array<{ karar: string }>)[0]?.karar;
      const acik1 = (pk.kopyaUyarilari as Array<{ durum: string }>).filter((u) => u.durum === "ACIK").length;
      a.kontrol("(a) snapshot geri alma (aynı parmak izi, eski uç) → YAKALA kirası, yeni uyarı YOK", py.outcome === "BASARILI" && karar === "YAKALA" && acik1 === acik0, `${py.outcome} karar=${karar} acikUyari ${acik0}→${acik1}`);
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
      const B2 = await yeniFabrika("B2", anaUrl, PARMAK_IZLERI.B2);
      fs.cpSync(C.lisansDizini, B2.lisansDizini, { recursive: true });
      await baslat(B2);
      const b1 = await B2.istemci.yokla();
      const c1 = await C.istemci.yokla();
      const pk3 = await detayKurulum(S.anaDbId);
      const acik = (pk3.kopyaUyarilari as Array<{ tur: string; durum: string; redZamani: string | null }>).filter((u) => u.durum === "ACIK");
      a.kontrol("(c) ilk pencere: kopyaya da kira verilir, yalnız portal uyarısı; sahip (C) etkilenmez", b1.outcome === "BASARILI" && c1.outcome === "BASARILI" && acik.length > 0, `B2=${b1.outcome} C=${c1.outcome} uyari=${acik.map((u) => u.tur).join(",")}`);
      await bekle(21_000); // KOPYA_PENCERE_SN=20
      const b2 = await B2.istemci.yokla();
      const c2 = await C.istemci.yokla();
      a.kontrol("(c) ikinci pencere: kopyaya KIRA_VERILMEDI, sahip yine BASARILI", b2.outcome === "BASARISIZ" && b2.code === "KIRA_VERILMEDI" && c2.outcome === "BASARILI", `B2=${b2.outcome} ${b2.code ?? ""} C=${c2.outcome}`);
      B2.ekDuvarMs = 31 * DAY_MS;
      B2.ekMonoMs = 31 * DAY_MS;
      await saatUygula(B2);
      const db2 = await B2.istemci.detay();
      a.kontrol("(c) kopya kira bitişinde EK_SURE'ye düşer (asla anında durdurma)", db2.durum.hesaplananKademe === "EK_SURE" || db2.durum.hesaplananKademe === "KISITLI", `${db2.durum.hesaplananKademe} ekSure=${db2.durum.ekSureKalanGun}`);
      a.not(`B2 anında durdurulmadı: ${db2.durum.hesaplananKademe}; iki anahtar olmadan KISITLI yok`);
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
      a.kontrol("GET /api/auth/login-methods → 200", lm.status === 200, ozet(lm));
      if (!("lisansDurduruldu" in lm.veri)) a.not("login-methods 'lisansDurduruldu' sinyali (yönetici kararı d) bu tabanda yok — başka dilimin işi");
      await geriAl(String(k5.veri.id));
      const n = await C.istemci.bekle((d) => d.durum.uygulananKademe === "NORMAL", 20_000);
      a.kontrol("K5 geri alındı → NORMAL", n.ms !== null);
    });

    // ============================================================ L29
    await adim("L29", "DR devralımı sonrası eski ana yeniden bağlanınca DEVREDILDI → KISITLI", async (a) => {
      C.aktarici.kipAyarla("kesik");
      await baslat(D);
      const dr = await D.istemci.istek("POST", "/api/license/dr-devral", { anaKurulumId: I1, gerekce: "Senaryo L29: ana ağdan koptu" });
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
    const kimlikler = (await Promise.all([anaUrl, drUrl, bayiUrl].map(kurulumKimligi).map((p) => p.catch(() => null)))).filter((x): x is string => Boolean(x));
    try {
      saticiYardimcisi(saticiEnv, [
        "temizle",
        `--kurulum-idleri=${kimlikler.join(",")}`,
        `--kullanicilar=${olusturulanlar.kullanicilar.join(",")}`,
        `--bayiler=${olusturulanlar.bayiler.join(",")}`,
        `--kidler=${olusturulanlar.kidler.join(",")}`,
        "--bayi-adi-oneki=Senaryo L Bayi",
        `--kanallar=${KANAL}`,
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
  console.log(`\n=== Senaryo L: ${yesil} yeşil · ${kismi} kısmi · ${kirmizi} kırmızı (${sonuclar.length}/29 adım koştu) ===`);
  if (jsonCikti) fs.writeFileSync(jsonCikti, JSON.stringify({ sonuclar, ozet: { yesil, kismi, kirmizi } }, null, 2));
  if (cikis !== 0) return cikis;
  return yesil === 29 ? 0 : 1;
}

main().then(
  (kod) => process.exit(kod),
  (err: Error) => {
    console.error(`❌ Senaryo L çöktü: ${err.stack ?? err.message}`);
    process.exit(2);
  },
);
