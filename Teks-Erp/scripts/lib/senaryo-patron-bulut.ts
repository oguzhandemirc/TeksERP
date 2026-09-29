// SENARYO P — patron bulutu tarafı: GERÇEK `patron/sunucu` süreci (kendi `_test` DB'si, üç rol) +
// hesap API istemcisi (parola + TOTP). Kurulum kaydı sahte satıcı iç API'sinden (`KURULUM_KAYNAGI=satici`).
// Yönetici daveti satıcı CLI'siyle (`scripts/tesis.ts yonetici-davet`; portal dilimi ayrı). `test_` öneki yok.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TEKS_KOKU, bekle } from "./senaryo-lisans-surec";

export const PATRON_KOKU = path.resolve(TEKS_KOKU, "..", "patron", "sunucu");

export interface BulutYanit {
  readonly status: number;
  readonly veri: Record<string, unknown>;
  readonly kod: string | undefined;
  readonly mesaj: string;
}

export async function bulutIstek(url: string, yontem: string, yol: string, govde?: unknown, belirtec?: string): Promise<BulutYanit> {
  const basliklar: Record<string, string> = { accept: "application/json" };
  if (govde !== undefined) basliklar["content-type"] = "application/json";
  if (belirtec) basliklar.authorization = `Bearer ${belirtec}`;
  const r = await fetch(`${url}/api${yol}`, { method: yontem, headers: basliklar, body: govde === undefined ? undefined : JSON.stringify(govde) });
  const metin = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(metin) as Record<string, unknown>;
  } catch {
    j = { message: metin.slice(0, 200) };
  }
  const details = (j.details ?? {}) as { code?: unknown };
  const veri = (j.data && typeof j.data === "object" ? j.data : {}) as Record<string, unknown>;
  return { status: r.status, veri, kod: typeof details.code === "string" ? details.code : undefined, mesaj: typeof j.message === "string" ? j.message : "" };
}

/** RFC 6238 (SHA-1, 30 sn, 6 hane) — bulutun `auth/totp.ts`iyle aynı; base32 sır. */
export function totp(sir: string, ms: number): string {
  const alfabe = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bitler = "";
  for (const c of sir.replace(/=+$/, "").toUpperCase()) bitler += alfabe.indexOf(c).toString(2).padStart(5, "0");
  const bayt = Buffer.from((bitler.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const sayac = Buffer.alloc(8);
  sayac.writeBigUInt64BE(BigInt(Math.floor(ms / 30_000)));
  const h = createHmac("sha1", bayt).update(sayac).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export interface BulutHesabi {
  readonly id: string;
  readonly eposta: string;
  readonly belirtec: string;
}

/** Davet → kabul → TOTP onay → oturum (onaydan sonra bir sonraki TOTP adımı beklenir: aynı kod iki kez geçmez). */
export async function davetiTamamla(url: string, davet: string, eposta: string): Promise<BulutHesabi> {
  const parola = `SenP-${randomUUID()}`;
  const kabul = await bulutIstek(url, "POST", "/davet/kabul", { davet, parola });
  const sir = String(kabul.veri.totpSirri ?? "");
  if (kabul.status !== 200 || !sir) throw new Error(`davet kabul ${kabul.status} ${kabul.mesaj}`);
  const t0 = Date.now();
  const onay = await bulutIstek(url, "POST", "/davet/onay", { davet, totp: totp(sir, t0) });
  if (onay.status !== 200) throw new Error(`davet onay ${onay.status} ${onay.mesaj}`);
  while (Math.floor(Date.now() / 30_000) === Math.floor(t0 / 30_000)) await bekle(500);
  const giris = await bulutIstek(url, "POST", "/oturum/ac", { eposta, parola, totp: totp(sir, Date.now()) });
  const belirtec = String(giris.veri.belirtec ?? "");
  if (giris.status !== 200 || !belirtec) throw new Error(`oturum ${giris.status} ${giris.mesaj}`);
  const hesap = (giris.veri.hesap ?? {}) as { id?: string };
  return { id: String(hesap.id ?? ""), eposta, belirtec };
}

/** Satıcı CLI'si: tesis yöneticisi daveti (belirteç YALNIZ çıktıda, bir kez). */
export function yoneticiDavetEt(env: NodeJS.ProcessEnv, tesisId: string, eposta: string): string {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/tesis.ts", "yonetici-davet", `--tesis=${tesisId}`, `--eposta=${eposta}`, "--ad=Senaryo P Patron"], {
    cwd: PATRON_KOKU,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  const davet = /Davet belirteci[^:]*: (\S+)/.exec(r.stdout ?? "")?.[1];
  if (r.status !== 0 || !davet) throw new Error(`yonetici-davet düştü: ${r.stderr || r.stdout}`);
  return davet;
}

export interface PatronSureci {
  readonly url: string;
  readonly pid: number;
  log(): string;
  durdur(): Promise<void>;
}

export async function patronBaslat(env: NodeJS.ProcessEnv, logDosyasi: string): Promise<PatronSureci> {
  const surec: ChildProcess = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: PATRON_KOKU, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const yaz = (c: Buffer): void => {
    log += c.toString("utf8");
    fs.appendFileSync(logDosyasi, c);
  };
  surec.stdout!.on("data", yaz);
  surec.stderr!.on("data", yaz);
  let cikti: number | null = null;
  surec.once("exit", (k) => (cikti = k ?? -1));
  const son = Date.now() + 60_000;
  let port = 0;
  while (!port) {
    if (cikti !== null) throw new Error(`patron süreci erken çıktı (${cikti}):\n${log.slice(-2000)}`);
    if (Date.now() > son) {
      surec.kill("SIGKILL");
      throw new Error(`patron süreci 60 sn'de dinlemedi:\n${log.slice(-2000)}`);
    }
    port = Number(/PATRON_DINLIYOR port=(\d+)/.exec(log)?.[1] ?? 0);
    if (!port) await bekle(200);
  }
  return {
    url: `http://127.0.0.1:${port}`,
    pid: surec.pid ?? -1,
    log: () => log,
    durdur: () =>
      new Promise<void>((resolve) => {
        if (surec.exitCode !== null || surec.signalCode !== null) return resolve();
        const zor = setTimeout(() => surec.kill("SIGKILL"), 8000);
        surec.once("exit", () => {
          clearTimeout(zor);
          resolve();
        });
        surec.kill("SIGTERM");
      }),
  };
}
