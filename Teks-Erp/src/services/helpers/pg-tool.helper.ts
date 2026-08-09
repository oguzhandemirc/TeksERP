// =============================================================================
// PostgreSQL komut satırı araçlarını çalıştırma (pg_dump / pg_restore / psql)
// =============================================================================
// `backup.service.ts`'ten ayıklandı — geri yükleme kopyası akışı da aynı iki
// yardımcıya ihtiyaç duyuyor (`pg_restore` kopyaya, `psql` yolu takas komutuna).
// =============================================================================

import { spawn } from "child_process";

export type PgToolName = "pg_dump" | "pg_restore" | "psql";

/**
 * Aracın tam yolu. `PG_BIN_DIR` **çağrı anında** okunur (modül-yükleme anında
 * değil) — böylece test env'i değiştirip hatalı-yol dalını doğrulayabilir,
 * üretimde davranış aynı kalır (env pm2 start'ta sabitlenir).
 *
 * Windows'ta PostgreSQL bin klasörü PATH'te olmaz → env ile verilir
 * (örn. C:\Program Files\PostgreSQL\18\bin). Boşsa PATH denenir.
 */
export function pgTool(name: PgToolName): string {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const dir = process.env.PG_BIN_DIR;
  return dir ? `${dir.replace(/[\\/]$/, "")}/${exe}` : exe;
}

export interface ToolResult {
  code: number;
  stderr: string;
  spawnError: string | null;
  /** Zaman aşımı nedeniyle öldürüldü mü — çağıran "başarısız" ile "asıldı"yı ayırabilsin. */
  timedOut?: boolean;
  /** Yalnız `captureStdout` istendiğinde dolar (örn. `rclone lsf`). */
  stdout?: string;
}

export interface RunProcessOptions {
  timeoutMs?: number;
  /** `process.env` ÜZERİNE eklenir (üzerine yazmaz — çağıran neyi ezdiğini bilir). */
  env?: NodeJS.ProcessEnv;
  /**
   * stdout'u topla. VARSAYILAN KAPALI ve bu bilinçli: `pg_dump -Fc -f` dosyaya
   * yazar, `pg_restore --list` çıktısı bizi ilgilendirmez. Yalnız çıktısı VERİ
   * olan araçlar için aç (`rclone lsf`).
   */
  captureStdout?: boolean;
}

/**
 * Varsayılan üst sınır: 3 saat. Dolu bir fabrika veritabanının `pg_dump`'ı
 * dakikalar sürer; 3 saat "bu iş artık bitmez" demenin cömert eşiğidir ve
 * `backup-scheduler`'ın kendi watchdog'uyla (3 saat) hizalıdır.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * Aracı çalıştırır, exit code + stderr toplar.
 *
 * stdout TÜKETİLMEZ: `pg_dump -Fc -f` dosyaya yazar, `pg_restore --list` çıktısı
 * bizi ilgilendirmez (yalnız exit code). stderr'i tüketmek ŞART — yoksa pipe
 * dolduğunda child asılır.
 *
 * Şifre yalnız `PGPASSWORD` env'i ile geçer: komut satırına yazılmaz (ps
 * çıktısında görünmesin) ve log'a düşmez.
 *
 * ⚠️ ZAMAN AŞIMI ZORUNLU (denetim 2026-08-09, F-OPS-VER-004). Eskiden `spawn`a
 * hiçbir üst sınır verilmiyordu: child asılırsa (ağ sürücüsü yanıt vermiyor, PG
 * kilitli, disk dolu) ne `error` ne `close` olayı gelir, promise HİÇ SETTLE
 * ETMEZ ve zincirin üstündeki `runBackupJob` da dönmez — yani o gece için ne
 * `BACKUP_COMPLETED` ne `BACKUP_FAILED` audit kaydı doğar. Yedek sessizce
 * alınmamış olur ve damga işin BAŞINDA yazıldığı için tekrar da denenmez.
 * `timeout` verildiğinde Node child'ı öldürür, `close` tetiklenir ve mevcut
 * hata yolu (audit + `fs.rm` temizliği) KENDİLİĞİNDEN çalışır.
 */
export function runTool(
  file: string,
  args: string[],
  password: string,
  timeoutMs: number = DEFAULT_TOOL_TIMEOUT_MS,
): Promise<ToolResult> {
  return runProcess(file, args, { timeoutMs, env: { PGPASSWORD: password } });
}

/**
 * `runTool`'un altındaki genel çocuk-süreç disiplini. PG'ye özgü DEĞİLDİR;
 * offsite kopya (`rclone`) da buradan geçer.
 *
 * ⚠️ TEK UYGULAMA NOKTASI OLARAK KALMALI. Zaman aşımı + `SIGKILL` + stderr
 * tüketimi + `error`/`close` ayrımı burada bir kez doğru yazıldı (F-OPS-VER-004:
 * üst sınırsız `spawn` asılırsa promise HİÇ settle etmez ve o gecenin yedeği
 * sessizce kaybolur). Yeni bir dış araç eklerken `spawn`ı doğrudan çağırma —
 * o disiplini yeniden yazman gerekir ve bir yerini atlarsan aynı sessiz kayıp
 * bu kez başka bir yoldan geri gelir.
 *
 * stderr'i tüketmek ŞART (yoksa pipe dolduğunda child asılır). stdout yalnız
 * istendiğinde toplanır; ikisi de 64 KB ile sınırlı — bozuk bir çağrı
 * megabaytlarca çıktı üretip belleği şişirmesin.
 */
export function runProcess(
  file: string,
  args: string[],
  opts: RunProcessOptions = {},
): Promise<ToolResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, ...(opts.env ?? {}) },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let stdout = "";
    child.stderr?.on("data", (d) => {
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    if (opts.captureStdout) {
      child.stdout?.on("data", (d) => {
        if (stdout.length < 64 * 1024) stdout += d.toString();
      });
    }
    child.on("error", (err) =>
      resolve({ code: -1, stderr, spawnError: err.message, ...(opts.captureStdout ? { stdout } : {}) }),
    );
    child.on("close", (code, signal) => {
      // Node timeout'ta `killSignal` ile öldürür → code null, signal dolu gelir.
      const timedOut = signal === "SIGKILL" && code === null;
      resolve({
        code: code ?? -1,
        stderr: timedOut
          ? `${stderr}\n[pg-tool] ${Math.round(timeoutMs / 1000)} sn zaman aşımı — süreç öldürüldü.`
          : stderr,
        spawnError: null,
        timedOut,
        ...(opts.captureStdout ? { stdout } : {}),
      });
    });
  });
}
