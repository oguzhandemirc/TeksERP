// Kök/bayi/ara imzacı imzası: parola İMZA ALT SÜRECİNE yalnız stdin'den gider (argv/env ASLA).
// Ana süreç anahtarı hiç açmaz; alt süreç imzalar, Buffer'ları sıfırlar ve çıkar. Parolalı anahtarla imzanın TEK
// boğazı burasıdır: istek kapsamı (dinleyici) anahtarın DOSYADAKİ türüne göre denetlenir (keys/signing-scope.ts).
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { VendorError } from "../lib/errors";
import { KeyFileError, readWrappedKeyFile } from "./key-files";
import { assertSigningScope, signingKindOf } from "./signing-scope";

const SIGNER_TIMEOUT_MS = 60_000;
/** Slot bekleyen imza isteği tavanı: kuyruk dolarsa yeni istek beklemez, 429 alır. */
const MAX_WAITING = 8;

/**
 * İmza alt süreci SEMAFORU (D11): her alt süreç scrypt ile ~64 MB bellek ister ve parola tahmininin
 * birimidir — eşzamanlı alt süreç sayısı 1–2 slotla sınırlı (IMZA_ESZAMANLI), fazlası sıraya girer.
 */
class SignerSlots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(public limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      if (this.waiting.length >= MAX_WAITING) throw new VendorError(429, "HIZ_SINIRI", "İmza kuyruğu dolu; biraz sonra deneyin");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    };
  }

  inUse(): number {
    return this.active;
  }
}

const slots = new SignerSlots(1);

/** Açılışta yapılandırmadan (IMZA_ESZAMANLI, 1–2). */
export function setSignerConcurrency(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw new Error("İmza eşzamanlılığı 1–2 olmalı");
  slots.limit = limit;
}

/** Bekçi için: şu an çalışan imza alt süreci sayısı. */
export function signerSlotsInUse(): number {
  return slots.inUse();
}

/** Alt süreç giriş dosyası: tsx altında .ts, derlenmişte .js — ana dosyanın uzantısı. */
export function signerEntryPath(): string {
  return path.join(__dirname, `signer-child${path.extname(__filename)}`);
}

/** Alt sürecin ortamı: yalnız çalışma zamanının gerektirdiği anahtarlar — sır taşıyan hiçbir şey. */
function minimalEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "SystemRoot", "TEMP", "TMP", "NODE_OPTIONS"];
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (keep.includes(k) || k.startsWith("TSX_")) env[k] = v;
  }
  return env;
}

/** Alt süreci başlatır (bekçi argv/env'ini ölçebilsin diye ayrı). */
export function spawnSignerProcess(): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, signerEntryPath()], {
    stdio: ["pipe", "pipe", "pipe"],
    env: minimalEnv(),
  });
}

export interface SignWithWrappedKeyInput {
  readonly keyFile: string;
  readonly typ: "tekserp-hak" | "tekserp-sertifika" | "tekserp-iptal";
  readonly payload: Record<string, unknown>;
  /** Çağıran sıfırlar; burada da iş bitince sıfırlanır. */
  readonly password: Buffer;
  /** Bekçi için: önceden başlatılmış alt süreç. */
  readonly child?: ChildProcess;
}

export async function signWithWrappedKey(g: SignWithWrappedKeyInput): Promise<string> {
  let release: () => void;
  try {
    // Kapsam alt süreçten ve slottan ÖNCE: izinsiz yoldan gelen parola hiçbir sürece gitmez.
    assertSigningScope(signingKindOf(readWrappedKeyFile(g.keyFile).tur));
    release = await slots.acquire();
  } catch (err) {
    g.password.fill(0);
    throw err;
  }
  try {
    return await signInChild(g);
  } finally {
    release();
  }
}

async function signInChild(g: SignWithWrappedKeyInput): Promise<string> {
  const child = g.child ?? spawnSignerProcess();
  const request = Buffer.from(`${JSON.stringify({ anahtarDosyasi: g.keyFile, typ: g.typ, yuk: g.payload })}\n`, "utf8");
  let stderrTail = "";
  let exitCode: number | null = null;
  const output = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("İmza alt süreci zaman aşımına uğradı"));
    }, SIGNER_TIMEOUT_MS);
    child.stdout!.on("data", (c: Buffer) => chunks.push(c));
    // Alt süreç parolayı hiçbir çıktıya yazmaz; stderr yalnız başlatma arızasının teşhisidir.
    child.stderr!.on("data", (c: Buffer) => (stderrTail = (stderrTail + c.toString("utf8")).slice(-400)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      exitCode = code;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
  // Parola ayrı parça olarak yazılır ve AKIŞ BOŞALINCA sıfırlanır (erken sıfırlama tamponu bozar).
  child.stdin!.write(request);
  child.stdin!.end(g.password, () => g.password.fill(0));
  let text: string;
  try {
    text = (await output).trim();
  } finally {
    g.password.fill(0);
  }
  let parsed: { ok: boolean; belge?: string; kod?: string; mesaj?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error(`İmza alt süreci çıktı vermedi (çıkış ${String(exitCode)}): ${stderrTail.trim().split("\n").pop() ?? ""}`);
  }
  if (parsed.ok && typeof parsed.belge === "string") return parsed.belge;
  if (parsed.kod === "YANLIS_PAROLA") throw new KeyFileError("YANLIS_PAROLA", "İmza parolası hatalı");
  throw new Error(`İmza reddedildi (${parsed.kod ?? "?"}): ${parsed.mesaj ?? ""}`);
}
