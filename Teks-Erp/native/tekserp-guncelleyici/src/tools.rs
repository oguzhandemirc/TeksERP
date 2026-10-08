//! Araç çağrıları — hepsi KISA ÖMÜRLÜ çocuk süreç (uzun ömürlü ikinci Node sunucusu DEĞİL): PG araçları,
//! yedek aracı ve göç aracı. NASIL koşulacakları platform arka ucunun işidir (`platform::Araclar`: Windows'ta
//! kurulu PG araçları + sürüm dizininin `runtime\node`u); buradaki işlevler çekirdeğin tek giriş noktasıdır.
//! Parola yalnız ortamla gider; argümana ve günlüğe girmez.
use crate::env::{Cmd, CmdOut, Env};
use crate::settings::{redact, BackendEnv};
use std::path::{Path, PathBuf};
use std::time::Duration;

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

/// `_prisma_migrations`: bitmiş + toplam satır — başlamış-bitmemiş göç de ölçülsün.
pub fn migration_count(env: &Env, be: &BackendEnv) -> Result<MigrationCount, String> {
    env.arka.araclar.migration_count(env, be)
}

/// Bitmiş göç ADLARI (`sema::FINISHED_MIGRATIONS_SQL`) — şema hizası, backend çalışırken salt okuma.
pub fn finished_migrations(env: &Env, be: &BackendEnv) -> Result<Vec<String>, String> {
    env.arka.araclar.finished_migrations(env, be)
}

/// Özel biçimli döküm, backend DURMUŞKEN.
pub fn pg_dump(env: &Env, be: &BackendEnv, out_file: &Path, timeout: Duration) -> Result<(), String> {
    env.arka.araclar.pg_dump(env, be, out_file, timeout)
}

pub fn pg_restore_list(env: &Env, be: &BackendEnv, dump: &Path) -> Result<(), String> {
    env.arka.araclar.pg_restore_list(env, be, dump)
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

/// Geri yükleme: `public` şeması sıfırlanır, döküm aynı rolle geri yüklenir. Backend DURMUŞ olmalı. Başarının
/// asıl ölçüsü çağıranın göç sayısı denetimidir.
pub fn restore_db(env: &Env, be: &BackendEnv, dump: &Path, timeout: Duration) -> Result<(), String> {
    env.arka.araclar.restore_db(env, be, dump, timeout)
}

/// `SHOW server_version` (PG küçük sürüm doğrulaması; harici kipte `pg.enAz`).
pub fn server_version(env: &Env, be: &BackendEnv, bin: &Path) -> Result<String, String> {
    env.arka.araclar.server_version(env, be, bin)
}

/// Sürüm dizini (`tools_dir`) yedek aracını taşıyor mu — taşımıyorsa yedek yeni sürümün aracıyla alınır.
pub fn usable_for_backup(env: &Env, tools_dir: &Path) -> bool {
    env.arka.araclar.usable_for_backup(env, tools_dir)
}

/// Yedek aracıyla geçici X25519 çifti (§8.3): düz özel yarı `private_out`a (çağıran hemen sarar ve siler).
pub fn backup_keygen(env: &Env, tools_dir: &Path, dir: &Path, private_out: &Path) -> Result<(), String> {
    env.arka.araclar.backup_keygen(env, tools_dir, dir, private_out)
}

pub fn backup_encrypt(
    env: &Env,
    tools_dir: &Path,
    input: &Path,
    output: &Path,
    recipients: &[PathBuf],
    timeout: Duration,
) -> Result<(), String> {
    env.arka.araclar.backup_encrypt(env, tools_dir, input, output, recipients, timeout)
}

pub fn backup_decrypt(env: &Env, tools_dir: &Path, input: &Path, output: &Path, key: &Path, timeout: Duration) -> Result<(), String> {
    env.arka.araclar.backup_decrypt(env, tools_dir, input, output, key, timeout)
}

/// `prisma migrate deploy` — sürümün kendi göç aracı (çalışma dizini sürüm dizini).
pub fn migrate_deploy(env: &Env, version_dir: &Path, be: &BackendEnv, timeout: Duration) -> Result<CmdOut, String> {
    env.arka.araclar.migrate_deploy(env, version_dir, be, timeout)
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
