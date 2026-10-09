//! Windows araçları (`platform::Araclar`): PG araçları `PG_BIN_DIR`den, yedek aracı paketteki
//! `dist\tools\yedek-sifrele.cjs`, göç aracı `node_modules\prisma\build\index.js migrate deploy` — hepsi
//! KISA ÖMÜRLÜ çocuk süreç, hep SÜRÜMÜN KENDİ `runtime\node`u ile. Parola yalnız `PGPASSWORD` ortamıyla
//! gider; argümana ve günlüğe girmez.
use crate::env::{Cmd, CmdOut, Env};
use crate::settings::{BackendEnv, DbUrl};
use crate::tools::{describe_failure, restore_errors, MigrationCount};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tekserp_hizmet::contract;

/// Sürüm dizinindeki node + yedek aracı.
#[derive(Debug, Clone)]
pub struct Runtime {
    pub node: PathBuf,
    pub dir: PathBuf,
}

impl Runtime {
    pub fn of(version_dir: &Path) -> Runtime {
        Runtime { node: version_dir.join(contract::path::RUNTIME).join(contract::node_file_name()), dir: version_dir.to_path_buf() }
    }
    pub fn backup_tool(&self) -> PathBuf {
        self.dir.join("dist").join("tools").join("yedek-sifrele.cjs")
    }
    pub fn prisma_cli(&self) -> PathBuf {
        self.dir.join("node_modules").join("prisma").join("build").join("index.js")
    }
    pub fn usable_for_backup(&self, env: &Env) -> bool {
        env.fs.exists(&self.node) && env.fs.exists(&self.backup_tool())
    }
}

/// Bitmiş + toplam göç satırı (iki arka uç aynı sorguyu koşar).
pub const MIGRATION_COUNT_SQL: &str = "SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ' ' || (SELECT count(*) FROM _prisma_migrations)";
/// Geri yüklemeden önce `public` sıfırlanır (veritabanı ve onun düzeyindeki ayarlar korunur).
pub const RESET_SQL: &str =
    "SET lock_timeout = '30s'; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner;";

fn pg_cmd(be: &BackendEnv, tool: &str, db: &DbUrl) -> Cmd {
    Cmd::new(&be.pg_tool(tool)).env("PGPASSWORD", &db.password).env("PGCONNECT_TIMEOUT", "15")
}

fn conn_args(db: &DbUrl) -> Vec<String> {
    vec!["-h".into(), db.host.clone(), "-p".into(), db.port.to_string(), "-U".into(), db.user.clone(), "-d".into(), db.database.clone()]
}

fn run(env: &Env, c: &Cmd, what: &str) -> Result<CmdOut, String> {
    let out = env.procs.run(c).map_err(|e| format!("{what}: {e}"))?;
    if !out.ok() {
        return Err(describe_failure(what, &out));
    }
    Ok(out)
}

/// Windows hizmeti arka ucunun araçları: kurulu PG araçları + sürüm dizinindeki node.
pub struct NodeAraclar;

impl crate::platform::Araclar for NodeAraclar {
    /// `_prisma_migrations`: bitmiş (kur.ps1'in sorgusu) + toplam satır — başlamış-bitmemiş göç de ölçülsün.
    fn migration_count(&self, env: &Env, be: &BackendEnv) -> Result<MigrationCount, String> {
        let db = &be.db;
        let sql = MIGRATION_COUNT_SQL;
        let c = pg_cmd(be, "psql", db)
            .args(["-X", "-w"])
            .args(conn_args(db))
            .args(["-v", "ON_ERROR_STOP=1", "-tAc", sql])
            .timeout(Duration::from_secs(60));
        let out = run(env, &c, "göç sayısı (psql)")?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let mut it = text.split_whitespace().map(str::parse::<u64>);
        match (it.next(), it.next()) {
            (Some(Ok(finished)), Some(Ok(total))) => Ok(MigrationCount { finished, total }),
            _ => Err(format!("göç sayısı çözülemedi: {text:?}")),
        }
    }

    /// Bitmiş göç ADLARI (`sema::FINISHED_MIGRATIONS_SQL`) — şema hizası, backend çalışırken salt okuma.
    fn finished_migrations(&self, env: &Env, be: &BackendEnv) -> Result<Vec<String>, String> {
        let db = &be.db;
        let c = pg_cmd(be, "psql", db)
            .args(["-X", "-w"])
            .args(conn_args(db))
            .args(["-v", "ON_ERROR_STOP=1", "-tAc", crate::sema::FINISHED_MIGRATIONS_SQL])
            .timeout(Duration::from_secs(60));
        let out = run(env, &c, "bitmiş göç adları (psql)")?;
        Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
    }

    /// Özel biçimli döküm (`-Fc`), backend DURMUŞKEN.
    fn pg_dump(&self, env: &Env, be: &BackendEnv, out_file: &Path, timeout: Duration) -> Result<(), String> {
        let db = &be.db;
        let c = pg_cmd(be, "pg_dump", db).arg("-w").args(conn_args(db)).args(["-Fc", "-f"]).arg(out_file.as_os_str()).timeout(timeout);
        run(env, &c, "pg_dump").map(|_| ())
    }

    fn pg_restore_list(&self, env: &Env, be: &BackendEnv, dump: &Path) -> Result<(), String> {
        let c = Cmd::new(&be.pg_tool("pg_restore")).arg("--list").arg(dump.as_os_str()).timeout(Duration::from_secs(600));
        run(env, &c, "pg_restore --list").map(|_| ())
    }

    /// Geri yükleme: `public` şeması sıfırlanır (göçün doğurduğu yeni nesne kalmasın; veritabanı ve onun
    /// düzeyindeki ayarlar KORUNUR) → döküm aynı rolle geri yüklenir. Backend DURMUŞ olmalı; kilit
    /// beklemesi 30 sn. Başarının asıl ölçüsü çağıranın göç sayısı denetimidir.
    fn restore_db(&self, env: &Env, be: &BackendEnv, dump: &Path, timeout: Duration) -> Result<(), String> {
        let db = &be.db;
        let reset = RESET_SQL;
        let c = pg_cmd(be, "psql", db)
            .args(["-X", "-w"])
            .args(conn_args(db))
            .args(["-v", "ON_ERROR_STOP=1", "-c", reset])
            .timeout(Duration::from_secs(300));
        run(env, &c, "şema sıfırlama (psql)")?;
        let c = pg_cmd(be, "pg_restore", db).arg("-w").args(conn_args(db)).arg(dump.as_os_str()).timeout(timeout);
        let out = env.procs.run(&c).map_err(|e| format!("pg_restore: {e}"))?;
        if out.timed_out {
            return Err("pg_restore: zaman aşımı".into());
        }
        if out.code != Some(0) {
            let errors = restore_errors(&String::from_utf8_lossy(&out.stderr));
            if !errors.is_empty() || out.code.is_none() {
                return Err(format!(
                    "pg_restore: çıkış {:?} — {}",
                    out.code,
                    errors.iter().take(4).cloned().collect::<Vec<_>>().join(" | ")
                ));
            }
        }
        Ok(())
    }

    /// `SHOW server_version` (PG küçük sürüm doğrulaması; harici kipte `pg.enAz`).
    fn server_version(&self, env: &Env, be: &BackendEnv, bin: &Path) -> Result<String, String> {
        let db = &be.db;
        let exe = bin.join(crate::platform::executable("psql"));
        let c = Cmd::new(&exe)
            .env("PGPASSWORD", &db.password)
            .env("PGCONNECT_TIMEOUT", "15")
            .args(["-X", "-w"])
            .args(conn_args(db))
            .args(["-tAc", "SHOW server_version"])
            .timeout(Duration::from_secs(60));
        let out = run(env, &c, "SHOW server_version")?;
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        // "16.15 (…)" gibi eklerden arındır.
        Ok(v.split_whitespace().next().unwrap_or_default().to_string())
    }

    fn usable_for_backup(&self, env: &Env, tools_dir: &Path) -> bool {
        Runtime::of(tools_dir).usable_for_backup(env)
    }

    /// Yedek aracıyla geçici X25519 çifti (§8.3): düz özel yarı `private_out`a (çağıran hemen sarar ve siler).
    fn backup_keygen(&self, env: &Env, tools_dir: &Path, dir: &Path, private_out: &Path) -> Result<(), String> {
        let rt = Runtime::of(tools_dir);
        let c = Cmd::new(&rt.node)
            .arg(rt.backup_tool().as_os_str())
            .args(["anahtar-uret", "--ad", "guncelleme", "--dizin"])
            .arg(dir.as_os_str())
            .arg("--ozel-cikti")
            .arg(private_out.as_os_str())
            .timeout(Duration::from_secs(120));
        run(env, &c, "yedek-sifrele anahtar-uret").map(|_| ())
    }

    fn backup_encrypt(
        &self,
        env: &Env,
        tools_dir: &Path,
        input: &Path,
        output: &Path,
        recipients: &[PathBuf],
        timeout: Duration,
    ) -> Result<(), String> {
        let rt = Runtime::of(tools_dir);
        let mut c = Cmd::new(&rt.node)
            .arg(rt.backup_tool().as_os_str())
            .args(["sifrele", "--girdi"])
            .arg(input.as_os_str())
            .arg("--cikti")
            .arg(output.as_os_str())
            .timeout(timeout);
        for r in recipients {
            c = c.arg("--alici").arg(r.as_os_str());
        }
        run(env, &c, "yedek-sifrele sifrele").map(|_| ())
    }

    fn backup_decrypt(
        &self,
        env: &Env,
        tools_dir: &Path,
        input: &Path,
        output: &Path,
        key: &Path,
        timeout: Duration,
    ) -> Result<(), String> {
        let rt = Runtime::of(tools_dir);
        let c = Cmd::new(&rt.node)
            .arg(rt.backup_tool().as_os_str())
            .args(["coz", "--girdi"])
            .arg(input.as_os_str())
            .arg("--cikti")
            .arg(output.as_os_str())
            .arg("--anahtar")
            .arg(key.as_os_str())
            .timeout(timeout);
        run(env, &c, "yedek-sifrele coz").map(|_| ())
    }

    /// `prisma migrate deploy` — sürümün kendi node'u, çalışma dizini sürüm dizini (prisma.config.js orada).
    fn migrate_deploy(&self, env: &Env, version_dir: &Path, be: &BackendEnv, timeout: Duration) -> Result<CmdOut, String> {
        let rt = Runtime::of(version_dir);
        let c = Cmd::new(&rt.node)
            .arg(rt.prisma_cli().as_os_str())
            .args(["migrate", "deploy"])
            .cwd(version_dir)
            .envs(&be.tool_env())
            .timeout(timeout);
        env.procs.run(&c).map_err(|e| format!("migrate deploy: {e}"))
    }
}
