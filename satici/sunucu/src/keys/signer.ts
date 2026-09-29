// Kök/bayi imzası: parola İMZA ALT SÜRECİNE yalnız stdin'den gider (argv/env ASLA).
// Ana süreç anahtarı hiç açmaz; alt süreç imzalar, Buffer'ları sıfırlar ve çıkar.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { KeyFileError } from "./key-files";

const SIGNER_TIMEOUT_MS = 60_000;

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
  readonly typ: "tekserp-hak" | "tekserp-sertifika";
  readonly payload: Record<string, unknown>;
  /** Çağıran sıfırlar; burada da iş bitince sıfırlanır. */
  readonly password: Buffer;
  /** Bekçi için: önceden başlatılmış alt süreç. */
  readonly child?: ChildProcess;
}

export async function signWithWrappedKey(g: SignWithWrappedKeyInput): Promise<string> {
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
  if (parsed.kod === "YANLIS_PAROLA") throw new KeyFileError("YANLIS_PAROLA", "Kök parolası hatalı");
  throw new Error(`İmza reddedildi (${parsed.kod ?? "?"}): ${parsed.mesaj ?? ""}`);
}
