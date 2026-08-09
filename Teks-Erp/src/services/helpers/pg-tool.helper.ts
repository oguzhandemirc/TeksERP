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
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: password },
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stderr = "";
    let timedOut = false;
    child.stderr?.on("data", (d) => {
      // Üst sınır: bozuk bir çağrı megabaytlarca stderr üretip belleği şişirmesin.
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    child.on("error", (err) => resolve({ code: -1, stderr, spawnError: err.message }));
    child.on("close", (code, signal) => {
      // Node timeout'ta `killSignal` ile öldürür → code null, signal dolu gelir.
      timedOut = signal === "SIGKILL" && code === null;
      resolve({
        code: code ?? -1,
        stderr: timedOut
          ? `${stderr}\n[pg-tool] ${Math.round(timeoutMs / 1000)} sn zaman aşımı — süreç öldürüldü.`
          : stderr,
        spawnError: null,
        timedOut,
      });
    });
  });
}
