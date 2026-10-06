// =============================================================================
// TEST SUNUCUSU — matris koşucusunun KENDİ süreci (127.0.0.1, `_test` DB)
// =============================================================================
// `bekci-http.ts` ile aynı düzen (kendi boş portu, yalnız kendi süreç grubunu kapatır);
// o dosya import'ta main koştuğu için yardımcılar burada ayrıca durur.
// =============================================================================
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEKS = join(__dirname, "..", "..");
const TSX = join(TEKS, "node_modules", ".bin", "tsx");
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TestSunucusu {
  base: string;
  port: number;
  logYolu: string;
  kapat(): Promise<void>;
}

function bosPort(): Promise<number> {
  return new Promise((coz, reddet) => {
    const s = createServer();
    s.on("error", reddet);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => coz(port));
    });
  });
}

function logKuyrugu(yol: string, satir = 25): string {
  try {
    return readFileSync(yol, "utf8").trimEnd().split("\n").slice(-satir).map((l) => `    │ ${l}`).join("\n");
  } catch {
    return "    │ (log okunamadı)";
  }
}

/** DATABASE_URL + JWT_SECRET ile `src/server.ts`i açar; /health db=UP olunca döner. */
export async function sunucuAc(databaseUrl: string, jwtSecret: string, saglikSuresiMs = 120_000): Promise<TestSunucusu> {
  const port = await bosPort();
  const base = `http://127.0.0.1:${port}`;
  const dizin = mkdtempSync(join(tmpdir(), "tekserp-profil-matrisi-"));
  const yedek = join(dizin, "yedek");
  const logYolu = join(dizin, "sunucu.log");
  const ortam: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: jwtSecret,
    PORT: String(port),
    HOST: "127.0.0.1",
    REMOTE_PORT: "",
    DISCOVERY_MDNS_ENABLED: "false",
    BACKUP_SCHEDULE_ENABLED: "false",
    BACKUP_DIR: yedek,
    BACKUP_OFFSITE_DIR: "",
    BACKUP_RCLONE_REMOTE: "",
    TEKSERP_PROFIL: "",
  };
  const fd = openSync(logYolu, "w");
  const cocuk: ChildProcess = spawn(TSX, ["src/server.ts"], { cwd: TEKS, env: ortam, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);

  const kapat = async (): Promise<void> => {
    if (cocuk.pid && cocuk.exitCode === null && !cocuk.signalCode) {
      const cikti = new Promise<void>((r) => cocuk.once("exit", () => r()));
      try { process.kill(-cocuk.pid, "SIGTERM"); } catch { /* grup yok */ }
      const zamanAsimi = bekle(8000).then(() => "zaman-asimi" as const);
      if ((await Promise.race([cikti, zamanAsimi])) === "zaman-asimi") {
        try { process.kill(-cocuk.pid, "SIGKILL"); } catch { /* grup yok */ }
        await cikti;
      }
    }
    rmSync(dizin, { recursive: true, force: true });
  };

  const son = Date.now() + saglikSuresiMs;
  let sonDurum = "yanıt yok";
  while (Date.now() < son) {
    if (cocuk.exitCode !== null || cocuk.signalCode) {
      const k = logKuyrugu(logYolu);
      await kapat();
      throw new Error(`sunucu açılırken çıktı (kod ${cocuk.exitCode ?? cocuk.signalCode}); log:\n${k}`);
    }
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      const govde = (await r.json().catch(() => ({}))) as { db?: string };
      if (r.ok && govde.db === "UP") return { base, port, logYolu, kapat };
      sonDurum = `HTTP ${r.status}, db=${String(govde.db)}`;
    } catch {
      // henüz dinlemiyor
    }
    await bekle(500);
  }
  const k = logKuyrugu(logYolu);
  await kapat();
  throw new Error(`/health ${saglikSuresiMs / 1000} sn'de hazır olmadı (${sonDurum}); log:\n${k}`);
}
