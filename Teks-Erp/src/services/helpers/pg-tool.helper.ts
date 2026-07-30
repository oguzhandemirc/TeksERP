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
}

/**
 * Aracı çalıştırır, exit code + stderr toplar.
 *
 * stdout TÜKETİLMEZ: `pg_dump -Fc -f` dosyaya yazar, `pg_restore --list` çıktısı
 * bizi ilgilendirmez (yalnız exit code). stderr'i tüketmek ŞART — yoksa pipe
 * dolduğunda child asılır.
 *
 * Şifre yalnız `PGPASSWORD` env'i ile geçer: komut satırına yazılmaz (ps
 * çıktısında görünmesin) ve log'a düşmez.
 */
export function runTool(file: string, args: string[], password: string): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: password },
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      // Üst sınır: bozuk bir çağrı megabaytlarca stderr üretip belleği şişirmesin.
      if (stderr.length < 64 * 1024) stderr += d.toString();
    });
    child.on("error", (err) => resolve({ code: -1, stderr, spawnError: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr, spawnError: null }));
  });
}
