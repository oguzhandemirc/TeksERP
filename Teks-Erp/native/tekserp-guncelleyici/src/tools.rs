//! Araç çağrıları — hepsi KISA ÖMÜRLÜ çocuk süreç (uzun ömürlü ikinci Node sunucusu DEĞİL): PG
//! araçları (`PG_BIN_DIR`), paketteki yedek aracı (`dist\tools\yedek-sifrele.cjs`) ve göç aracı
//! (`node_modules\prisma\build\index.js migrate deploy`) — hep SÜRÜMÜN KENDİ `runtime\node`u ile.
//! Parola yalnız `PGPASSWORD` ortamıyla gider; argümana ve günlüğe girmez.
use crate::env::{Cmd, CmdOut, Env};
use crate::settings::{redact, BackendEnv, DbUrl};
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

/// Çıktının son satırları (sır maskeli) — hata iletisi için.
pub fn tail(out: &CmdOut) -> String {
    let text = String::from_utf8_lossy(if out.stderr.is_empty() { &out.stdout } else { &out.stderr }).to_string();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    redact(&lines[lines.len().saturating_sub(6)..].join(" | "))
}

fn describe(what: &str, out: &CmdOut) -> String {
    if out.timed_out {
        format!("{what}: zaman aşımı")
    } else {
        format!("{what}: çıkış {:?} — {}", out.code, tail(out))
    }
}

fn pg_cmd(be: &BackendEnv, tool: &str, db: &DbUrl) -> Cmd {
    Cmd::new(&be.pg_tool(tool)).env("PGPASSWORD", &db.password).env("PGCONNECT_TIMEOUT", "15")
}

fn conn_args(db: &DbUrl) -> Vec<String> {
    vec!["-h".into(), db.host.clone(), "-p".into(), db.port.to_string(), "-U".into(), db.user.clone(), "-d".into(), db.database.clone()]
}

fn run(env: &Env, c: &Cmd, what: &str) -> Result<CmdOut, String> {
    let out = env.procs.run(c).map_err(|e| format!("{what}: {e}"))?;
    if !out.ok() {
        return Err(describe(what, &out));
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MigrationCount {
    #[serde(rename = "bitmis")]
    pub finished: u64,
    #[serde(rename = "toplam")]
    pub total: u64,
}

/// `_prisma_migrations`: bitmiş (kur.ps1'in sorgusu) + toplam satır — başlamış-bitmemiş göç de ölçülsün.
pub fn migration_count(env: &Env, be: &BackendEnv) -> Result<MigrationCount, String> {
    let db = &be.db;
    let sql = "SELECT (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) || ' ' || (SELECT count(*) FROM _prisma_migrations)";
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
pub fn finished_migrations(env: &Env, be: &BackendEnv) -> Result<Vec<String>, String> {
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
pub fn pg_dump(env: &Env, be: &BackendEnv, out_file: &Path, timeout: Duration) -> Result<(), String> {
    let db = &be.db;
    let c = pg_cmd(be, "pg_dump", db).arg("-w").args(conn_args(db)).args(["-Fc", "-f"]).arg(out_file.as_os_str()).timeout(timeout);
    run(env, &c, "pg_dump").map(|_| ())
}

pub fn pg_restore_list(env: &Env, be: &BackendEnv, dump: &Path) -> Result<(), String> {
    let c = Cmd::new(&be.pg_tool("pg_restore")).arg("--list").arg(dump.as_os_str()).timeout(Duration::from_secs(600));
    run(env, &c, "pg_restore --list").map(|_| ())
}

/// pg_restore'un yok sayılabilir hataları (sıfırlanmış şemaya aynı rolle geri yüklemede beklenen).
const BENIGN_RESTORE_ERRORS: [&str; 3] =
    ["schema \"public\" already exists", "must be owner of extension plpgsql", "must be owner of schema public"];

/// pg_restore çıktısındaki hata satırlarından yok sayılamayanlar.
pub fn restore_errors(stderr: &str) -> Vec<String> {
    stderr
        .lines()
        .filter(|l| l.contains("error:") || l.contains("ERROR:"))
        .filter(|l| !BENIGN_RESTORE_ERRORS.iter().any(|b| l.contains(b)))
        .map(redact)
        .collect()
}

/// Geri yükleme: `public` şeması sıfırlanır (göçün doğurduğu yeni nesne kalmasın; veritabanı ve onun
/// düzeyindeki ayarlar KORUNUR) → döküm aynı rolle geri yüklenir. Backend DURMUŞ olmalı; kilit
/// beklemesi 30 sn. Başarının asıl ölçüsü çağıranın göç sayısı denetimidir.
pub fn restore_db(env: &Env, be: &BackendEnv, dump: &Path, timeout: Duration) -> Result<(), String> {
    let db = &be.db;
    let reset = "SET lock_timeout = '30s'; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION pg_database_owner;";
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
            return Err(format!("pg_restore: çıkış {:?} — {}", out.code, errors.iter().take(4).cloned().collect::<Vec<_>>().join(" | ")));
        }
    }
    Ok(())
}

/// `SHOW server_version` (PG küçük sürüm doğrulaması; harici kipte `pg.enAz`).
pub fn server_version(env: &Env, be: &BackendEnv, bin: &Path) -> Result<String, String> {
    let db = &be.db;
    let exe = bin.join(if cfg!(windows) { "psql.exe" } else { "psql" });
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

/// Yedek aracıyla geçici X25519 çifti (§8.3): düz özel yarı `private_out`a (çağıran hemen sarar ve siler).
pub fn backup_keygen(env: &Env, rt: &Runtime, dir: &Path, private_out: &Path) -> Result<(), String> {
    let c = Cmd::new(&rt.node)
        .arg(rt.backup_tool().as_os_str())
        .args(["anahtar-uret", "--ad", "guncelleme", "--dizin"])
        .arg(dir.as_os_str())
        .arg("--ozel-cikti")
        .arg(private_out.as_os_str())
        .timeout(Duration::from_secs(120));
    run(env, &c, "yedek-sifrele anahtar-uret").map(|_| ())
}

pub fn backup_encrypt(
    env: &Env,
    rt: &Runtime,
    input: &Path,
    output: &Path,
    recipients: &[PathBuf],
    timeout: Duration,
) -> Result<(), String> {
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

pub fn backup_decrypt(env: &Env, rt: &Runtime, input: &Path, output: &Path, key: &Path, timeout: Duration) -> Result<(), String> {
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
pub fn migrate_deploy(env: &Env, rt: &Runtime, version_dir: &Path, be: &BackendEnv, timeout: Duration) -> Result<CmdOut, String> {
    let c = Cmd::new(&rt.node)
        .arg(rt.prisma_cli().as_os_str())
        .args(["migrate", "deploy"])
        .cwd(version_dir)
        .envs(&be.tool_env())
        .timeout(timeout);
    env.procs.run(&c).map_err(|e| format!("migrate deploy: {e}"))
}

/// Güncelleyicinin kendi künyesi (kendini güncellemede yeni ikilinin sınanması).
pub fn identity_of(env: &Env, exe: &Path) -> Result<serde_json::Value, String> {
    let c = Cmd::new(exe).arg("kunye").timeout(Duration::from_secs(30));
    let out = run(env, &c, "künye")?;
    serde_json::from_slice(&out.stdout).map_err(|e| format!("künye JSON değil: {e}"))
}

pub fn describe_failure(what: &str, out: &CmdOut) -> String {
    describe(what, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_error_filter() {
        let e = "pg_restore: error: could not execute query: ERROR:  schema \"public\" already exists\npg_restore: error: could not execute query: ERROR:  must be owner of extension plpgsql\n";
        assert!(restore_errors(e).is_empty());
        let e = "pg_restore: error: could not execute query: ERROR:  relation \"x\" does not exist postgresql://u:gizli@h/db\n";
        let r = restore_errors(e);
        assert_eq!(r.len(), 1);
        assert!(!r[0].contains("gizli"));
    }
}
