// SENARYO L — süreç ve ağ düzeneği: satıcı sunucusu + fabrika backend'leri GERÇEK süreçler olarak
// (127.0.0.1, `_test` DB), aralarında koşucunun "internet"i olan HTTPS aktarıcı ve kurumsal proxy
// canlandırması (CONNECT). `test_` öneki yok → koşucu bunu bekçi saymaz.
//   · Aktarıcı: fabrika → (HTTPS, kendinden imzalı; fabrikaya NODE_EXTRA_CA_CERTS) → satıcı (HTTP).
//     Kipler: açık · kesik (dışarı çıkış yok) · yut (satıcı işler, yanıt fabrikaya ULAŞMAZ).
//   · Saat: her süreç `senaryo-saat.ts` ile açılır; koşucu IPC ile duvar/monotonik kaydırır.
//   · Kapanış yalnız KENDİ doğurduğumuz PID'lere (SIGTERM, 8 sn sonra SIGKILL).
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEKS_KOKU = path.resolve(__dirname, "..", "..");
export const SATICI_KOKU = path.resolve(TEKS_KOKU, "..", "satici", "sunucu");
const SAAT_ON_YUKLEME = path.join(__dirname, "senaryo-saat.ts");

export function bosPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export function bekle(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Kendinden imzalı TLS (127.0.0.1 + localhost). Anahtar geçici dizinde kalır, koşum sonunda silinir. */
export function tlsSertifikasiUret(dizin: string): { anahtar: string; sertifika: string } {
  const anahtar = path.join(dizin, "tls-anahtar.pem");
  const sertifika = path.join(dizin, "tls-sertifika.pem");
  const r = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", anahtar, "-out", sertifika,
      "-days", "3", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`openssl sertifika üretemedi: ${r.stderr}`);
  return { anahtar, sertifika };
}

// ---------------------------------------------------------------- saat (IPC)
export interface SaatKaydirmasi {
  readonly duvarMs: number;
  readonly monoMs: number;
}

function saatGonder(surec: ChildProcess, k: SaatKaydirmasi): Promise<void> {
  return new Promise((resolve, reject) => {
    const zaman = setTimeout(() => reject(new Error("saat IPC yanıt vermedi")), 5000);
    const dinle = (m: unknown): void => {
      if (m && typeof m === "object" && (m as { tip?: string }).tip === "senaryo-saat-tamam") {
        clearTimeout(zaman);
        surec.off("message", dinle);
        resolve();
      }
    };
    surec.on("message", dinle);
    surec.send({ tip: "senaryo-saat", duvarMs: k.duvarMs, monoMs: k.monoMs });
  });
}

function butunlukGonder(
  surec: ChildProcess,
  kok: string | null,
  anahtar: { kid: string; x: string } | null,
): Promise<{ durum: string | null; kod: string | null }> {
  return new Promise((resolve, reject) => {
    const zaman = setTimeout(() => reject(new Error("bütünlük IPC yanıt vermedi")), 15_000);
    const dinle = (m: unknown): void => {
      if (typeof m !== "object" || m === null || Reflect.get(m, "tip") !== "senaryo-butunluk-tamam") return;
      clearTimeout(zaman);
      surec.off("message", dinle);
      const durum: unknown = Reflect.get(m, "durum");
      const kod: unknown = Reflect.get(m, "kod");
      resolve({ durum: typeof durum === "string" ? durum : null, kod: typeof kod === "string" ? kod : null });
    };
    surec.on("message", dinle);
    surec.send({ tip: "senaryo-butunluk", kok, anahtar });
  });
}

/** Genel IPC: mesajı gönderir, `yanitTipi` tipli ilk yanıtı döner (senaryo girişlerinin test kancaları). */
function ipcIstek<T>(surec: ChildProcess, mesaj: Record<string, unknown>, yanitTipi: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const zaman = setTimeout(() => {
      surec.off("message", dinle);
      reject(new Error(`IPC ${yanitTipi} ${ms} ms'de gelmedi`));
    }, ms);
    const dinle = (m: unknown): void => {
      if (m && typeof m === "object" && (m as { tip?: string }).tip === yanitTipi) {
        clearTimeout(zaman);
        surec.off("message", dinle);
        resolve(m as T);
      }
    };
    surec.on("message", dinle);
    surec.send(mesaj);
  });
}

function surecDurdur(surec: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (surec.exitCode !== null || surec.signalCode !== null) return resolve();
    const zor = setTimeout(() => surec.kill("SIGKILL"), 8000);
    surec.once("exit", () => {
      clearTimeout(zor);
      resolve();
    });
    surec.kill("SIGTERM");
  });
}

// ---------------------------------------------------------------- satıcı sunucusu
/** Satıcı bekçilerinin ERİŞİM düzeneği (`satici/sunucu/scripts/lib/erisim-duzenegi.ts`) — tek kaynak, kopyalanmaz. */
export interface ErisimDuzenegi {
  readonly ERISIM_BASLIGI: string;
  erisimJetonu(g?: { eposta?: string; simdiMs?: number }): string;
  erisimOrtami(): Record<string, string>;
}

/** Dinamik içe aktarma: satıcı kökü bu projenin `rootDir`'inin dışındadır (tip kontrolü dosyayı derleme kapsamına çekmesin). */
export async function erisimDuzeneginiYukle(): Promise<ErisimDuzenegi> {
  return (await import(pathToFileURL(path.join(SATICI_KOKU, "scripts", "lib", "erisim-duzenegi.ts")).href)) as ErisimDuzenegi;
}

export interface SaticiSureci {
  readonly genel: string;
  /** Satıcı portalı = ERİŞİM dinleyicisi (tünel yok); ortamda PORT_ERISIM + Access ayarı yoksa null. */
  readonly portal: string | null;
  saat(k: SaatKaydirmasi): Promise<void>;
  durdur(): Promise<void>;
  log(): string;
}

/**
 * ERİŞİM JWKS dosyasının yazım zamanını satıcının (kaydırılmış) saatine çeker: sunucu, kaynağın yaşını KENDİ saatiyle
 * ölçer ve 7 günü aşan kümeyi reddeder; koşucu saati günlerce ileri alınca dosya "bayat" görünmesin.
 */
function jwksSaatineCek(dosya: string | undefined, k: SaatKaydirmasi): void {
  if (!dosya) return;
  const t = (Date.now() + k.duvarMs) / 1000;
  fs.utimesSync(dosya, t, t);
}

export function saticiBaslat(g: { env: NodeJS.ProcessEnv; saat: SaatKaydirmasi; logDosyasi: string }): Promise<SaticiSureci> {
  const surec = spawn(process.execPath, ["--import", "tsx", "--import", SAAT_ON_YUKLEME, "src/server.ts"], {
    cwd: SATICI_KOKU,
    env: { ...g.env, SENARYO_SAAT_DUVAR_MS: String(g.saat.duvarMs), SENARYO_SAAT_MONO_MS: String(g.saat.monoMs) },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let log = "";
  const yaz = (c: Buffer): void => {
    log += c.toString("utf8");
    fs.appendFileSync(g.logDosyasi, c);
  };
  surec.stdout!.on("data", yaz);
  surec.stderr!.on("data", yaz);
  return new Promise((resolve, reject) => {
    const zaman = setTimeout(() => {
      surec.kill("SIGKILL");
      reject(new Error(`satıcı 30 sn'de dinlemedi:\n${log}`));
    }, 30_000);
    const bak = setInterval(() => {
      const m = /SATICI_DINLIYOR genel=(\d+) ic=(?:\d+|kapali) erisim=(\d+|kapali)/.exec(log);
      if (!m) return;
      clearInterval(bak);
      clearTimeout(zaman);
      resolve({
        genel: `http://127.0.0.1:${m[1]}`,
        portal: m[2] === "kapali" ? null : `http://127.0.0.1:${m[2]}`,
        saat: async (k) => {
          await saatGonder(surec, k);
          jwksSaatineCek(g.env.CF_ACCESS_JWKS_DOSYASI, k);
        },
        durdur: () => surecDurdur(surec),
        log: () => log,
      });
    }, 100);
    surec.once("exit", (kod) => {
      clearInterval(bak);
      clearTimeout(zaman);
      reject(new Error(`satıcı erken çıktı (${kod}):\n${log}`));
    });
  });
}

/** Satıcı kökünde tek atımlık yardımcı (`scripts/lib/senaryo-satici.ts`); `SENARYO_JSON` satırını döndürür. */
export function saticiYardimcisi<T>(env: NodeJS.ProcessEnv, argv: readonly string[]): T {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/lib/senaryo-satici.ts", ...argv], {
    cwd: SATICI_KOKU,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  const satir = r.stdout.split("\n").find((s) => s.startsWith("SENARYO_JSON "));
  if (r.status !== 0 || !satir) throw new Error(`satıcı yardımcısı (${argv[0]}) düştü: ${r.stderr.slice(-2000)}`);
  return JSON.parse(satir.slice("SENARYO_JSON ".length)) as T;
}

/** Gerçek anahtar CLI'ı (`scripts/anahtar.ts bayi-uret`): parolalar stdin'den (argv/env değil). */
export function bayiAnahtariUret(env: NodeJS.ProcessEnv, g: { dizin: string; kid: string; bayiId: string; moduller: string[]; siniflar: string[]; kokKid: string; kokParolasi: string; bayiParolasi: string }): void {
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/anahtar.ts", "bayi-uret", `--kid=${g.kid}`, `--bayi-id=${g.bayiId}`, `--moduller=${g.moduller.join(",")}`,
      `--siniflar=${g.siniflar.join(",")}`, `--kok=${g.kokKid}`, `--dizin=${g.dizin}`],
    { cwd: SATICI_KOKU, env, input: `${g.kokParolasi}\n${g.bayiParolasi}\n`, encoding: "utf8", timeout: 60_000 },
  );
  if (r.status !== 0) throw new Error(`bayi-uret düştü: ${r.stderr}`);
}

// ---------------------------------------------------------------- fabrika backend'i
export interface FabrikaSureci {
  readonly ad: string;
  readonly url: string;
  readonly lisansDizini: string;
  readonly pid: number;
  saat(k: SaatKaydirmasi): Promise<void>;
  /** L18: süreçte bütünlük denetimini verilen kök + geçici PAKET anahtarıyla koşturur (`kok: null` sıfırlar). */
  butunluk(kok: string | null, anahtar: { kid: string; x: string } | null): Promise<{ durum: string | null; kod: string | null }>;
  /** Giriş dosyasının IPC test kancası (yalnız kanca taşıyan girişlerde yanıt gelir). */
  ipc<T>(mesaj: Record<string, unknown>, yanitTipi: string, ms?: number): Promise<T>;
  durdur(): Promise<void>;
  log(): string;
}

/** Sahte makine kimliği: darwin `ioreg` değerleri; `etkenler` verilirse toplayıcı bu f1..f4 kümesini Linux yollarından
 *  okunmuş gibi döndürür (güçlü etken ≥ 2 olan makine; `senaryo-lisans-ayar.ts` ④). `null` = yol hata verdi, "" = değer yok. */
export interface SahteMakine {
  makine: string;
  seri: string;
  etkenler?: Partial<Record<"f1" | "f2" | "f3" | "f4", string | null>>;
}

export interface FabrikaSecenekleri {
  readonly ad: string;
  readonly databaseUrl: string;
  readonly lisansDizini: string;
  readonly yedekDizini: string;
  readonly saticiAdresi: string;
  readonly capaDosyasi: string;
  readonly tlsSertifikasi: string;
  readonly parmakIzi: SahteMakine;
  readonly jwtSecret: string;
  readonly saat: SaatKaydirmasi;
  readonly logDosyasi: string;
  readonly pgBinDir: string | undefined;
  /** Giriş dosyası (TEKS_KOKU'ya göre); varsayılan Senaryo L girişi. */
  readonly giris?: string;
  /** Ek ortam (örn. PATRON_CLOUD_URL) — temel ortamın ÜSTÜNE yazılır. */
  readonly ekEnv?: NodeJS.ProcessEnv;
}

export async function fabrikaBaslat(g: FabrikaSecenekleri): Promise<FabrikaSureci> {
  const port = await bosPort();
  // Boş dize dotenv'in .env'den doldurmasını da keser (bekci-http.ts ile aynı düzen).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: g.databaseUrl,
    JWT_SECRET: g.jwtSecret,
    PORT: String(port),
    HOST: "127.0.0.1",
    REMOTE_PORT: "",
    DISCOVERY_MDNS_ENABLED: "false",
    BACKUP_SCHEDULE_ENABLED: "false",
    BACKUP_DIR: g.yedekDizini,
    BACKUP_OFFSITE_DIR: "",
    BACKUP_RCLONE_REMOTE: "",
    BACKUP_KEY_DIR: "",
    TEKSERP_PROFIL: "",
    LICENSE_DIR: g.lisansDizini,
    LICENSE_SERVER_URL: g.saticiAdresi,
    NODE_EXTRA_CA_CERTS: g.tlsSertifikasi,
    HTTPS_PROXY: "",
    HTTP_PROXY: "",
    SENARYO_CAPA_DOSYASI: g.capaDosyasi,
    SENARYO_PARMAK_IZI: JSON.stringify({ makine: g.parmakIzi.makine, seri: g.parmakIzi.seri }),
    SENARYO_ETKENLER: g.parmakIzi.etkenler ? JSON.stringify(g.parmakIzi.etkenler) : "",
    SENARYO_SAAT_DUVAR_MS: String(g.saat.duvarMs),
    SENARYO_SAAT_MONO_MS: String(g.saat.monoMs),
    ...(g.pgBinDir ? { PG_BIN_DIR: g.pgBinDir } : {}),
    ...(g.ekEnv ?? {}),
  };
  fs.mkdirSync(g.lisansDizini, { recursive: true, mode: 0o700 });
  fs.mkdirSync(g.yedekDizini, { recursive: true });
  const surec = spawn(process.execPath, ["--import", "tsx", "--import", SAAT_ON_YUKLEME, g.giris ?? "scripts/lib/senaryo-lisans-sunucu.ts"], {
    cwd: TEKS_KOKU,
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let log = "";
  const yaz = (c: Buffer): void => {
    log += c.toString("utf8");
    fs.appendFileSync(g.logDosyasi, c);
  };
  surec.stdout!.on("data", yaz);
  surec.stderr!.on("data", yaz);
  let cikti: number | null = null;
  surec.once("exit", (kod) => (cikti = kod ?? -1));
  const url = `http://127.0.0.1:${port}`;
  const son = Date.now() + 60_000;
  for (;;) {
    if (cikti !== null) throw new Error(`${g.ad} backend'i erken çıktı (${cikti}):\n${log.slice(-3000)}`);
    if (Date.now() > son) {
      surec.kill("SIGKILL");
      throw new Error(`${g.ad} backend'i 60 sn'de ayağa kalkmadı:\n${log.slice(-3000)}`);
    }
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) break;
    } catch {
      /* henüz dinlemiyor */
    }
    await bekle(250);
  }
  return {
    ad: g.ad,
    url,
    lisansDizini: g.lisansDizini,
    pid: surec.pid ?? -1,
    saat: (k) => saatGonder(surec, k),
    butunluk: (kok, anahtar) => butunlukGonder(surec, kok, anahtar),
    ipc: <T>(mesaj: Record<string, unknown>, yanitTipi: string, ms = 120_000) => ipcIstek<T>(surec, mesaj, yanitTipi, ms),
    durdur: () => surecDurdur(surec),
    log: () => log,
  };
}

// ---------------------------------------------------------------- aktarıcı (fabrikanın interneti)
export type AktariciKipi = "acik" | "kesik" | "yut";

export interface AktarimKaydi {
  readonly yontem: string;
  readonly yol: string;
  readonly govde: string;
  readonly durum: number;
  readonly yanit: string;
  readonly yutuldu: boolean;
}

export class Aktarici {
  kip: AktariciKipi = "acik";
  readonly kayitlar: AktarimKaydi[] = [];
  private readonly acikAkislar = new Set<http.ServerResponse>();
  private sunucu: https.Server | null = null;
  adres = "";

  constructor(
    private readonly hedef: string,
    private readonly tls: { anahtar: string; sertifika: string },
  ) {}

  async baslat(): Promise<void> {
    this.sunucu = https.createServer({ key: fs.readFileSync(this.tls.anahtar), cert: fs.readFileSync(this.tls.sertifika) }, (req, res) =>
      this.isle(req, res),
    );
    await new Promise<void>((r) => this.sunucu!.listen(0, "127.0.0.1", () => r()));
    this.adres = `https://127.0.0.1:${(this.sunucu.address() as net.AddressInfo).port}`;
  }

  /** Kipi değiştirir; kesikte açık zil akışları da düşer (fabrika kopukluğu görsün). */
  kipAyarla(kip: AktariciKipi): void {
    this.kip = kip;
    if (kip === "kesik") {
      for (const r of this.acikAkislar) r.destroy();
      this.acikAkislar.clear();
    }
  }

  sonKayit(yol: string): AktarimKaydi | undefined {
    for (let i = this.kayitlar.length - 1; i >= 0; i--) if (this.kayitlar[i]!.yol === yol) return this.kayitlar[i];
    return undefined;
  }

  private isle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (this.kip === "kesik") {
      req.socket.destroy();
      return;
    }
    const parcalar: Buffer[] = [];
    req.on("data", (c: Buffer) => parcalar.push(c));
    req.on("end", () => {
      const govde = Buffer.concat(parcalar);
      const basliklar = { ...req.headers };
      delete basliklar.host;
      delete basliklar.connection;
      const yut = this.kip === "yut" && req.method === "POST" && req.url === "/v1/yokla";
      if (yut) this.kip = "acik";
      const ileri = http.request(`${this.hedef}${req.url ?? "/"}`, { method: req.method, headers: basliklar }, (yr) => {
        if (req.method === "GET" && req.url?.startsWith("/v1/zil")) {
          res.writeHead(yr.statusCode ?? 502, yr.headers);
          this.acikAkislar.add(res);
          res.on("close", () => this.acikAkislar.delete(res));
          yr.pipe(res);
          return;
        }
        const yp: Buffer[] = [];
        yr.on("data", (c: Buffer) => yp.push(c));
        yr.on("end", () => {
          const yanit = Buffer.concat(yp);
          this.kayitlar.push({ yontem: req.method ?? "", yol: req.url ?? "", govde: govde.toString("utf8"), durum: yr.statusCode ?? 0, yanit: yanit.toString("utf8"), yutuldu: yut });
          if (this.kayitlar.length > 400) this.kayitlar.splice(0, 100);
          if (yut) {
            req.socket.destroy();
            return;
          }
          res.writeHead(yr.statusCode ?? 502, yr.headers);
          res.end(yanit);
        });
      });
      ileri.on("error", () => req.socket.destroy());
      ileri.end(govde);
    });
  }

  async durdur(): Promise<void> {
    for (const r of this.acikAkislar) r.destroy();
    if (!this.sunucu) return;
    this.sunucu.closeAllConnections();
    await new Promise<void>((r) => this.sunucu!.close(() => r()));
  }
}

// ---------------------------------------------------------------- kurumsal proxy (CONNECT)
export class ConnectVekili {
  readonly hedefler: string[] = [];
  private sunucu: http.Server | null = null;
  adres = "";

  async baslat(): Promise<void> {
    this.sunucu = http.createServer((_req, res) => {
      res.writeHead(405);
      res.end();
    });
    this.sunucu.on("connect", (req: http.IncomingMessage, istemci: net.Socket, bas: Buffer) => {
      this.hedefler.push(req.url ?? "");
      const [host, port] = (req.url ?? "").split(":");
      const yukari = net.connect(Number(port), host, () => {
        istemci.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        yukari.write(bas);
        yukari.pipe(istemci);
        istemci.pipe(yukari);
      });
      yukari.on("error", () => istemci.destroy());
      istemci.on("error", () => yukari.destroy());
    });
    await new Promise<void>((r) => this.sunucu!.listen(0, "127.0.0.1", () => r()));
    this.adres = `http://127.0.0.1:${(this.sunucu.address() as net.AddressInfo).port}`;
  }

  async durdur(): Promise<void> {
    if (!this.sunucu) return;
    this.sunucu.closeAllConnections();
    await new Promise<void>((r) => this.sunucu!.close(() => r()));
  }
}
