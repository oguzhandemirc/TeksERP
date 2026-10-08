//! Windows PG arka ucu (`platform::PgArkaUcu`): PG hizmetinin komut satırı SCM ImagePath'idir, ICU sürümü
//! `bin\icuuc<N>.dll` adından okunur, SQL kurulu sürümün `psql`iyle koşar (D4 U5–U9).
use crate::env::{Cmd, Env, EnvResult};
use crate::settings::BackendEnv;
use crate::tools::describe_failure;
use std::path::Path;
use std::time::Duration;

pub struct ImagePathPg;

impl crate::platform::PgArkaUcu for ImagePathPg {
    fn image_path(&self, env: &Env, service: &str) -> EnvResult<String> {
        env.svc.image_path(service)
    }

    fn set_image_path(&self, env: &Env, service: &str, command_line: &str) -> EnvResult<()> {
        env.svc.set_image_path(service, command_line)
    }

    /// ImagePath'teki eski sürüm dizinini yenisiyle değiştirir (Windows'ta büyük/küçük harf duyarsız).
    fn replace_dir(&self, command_line: &str, old_dir: &Path, new_dir: &Path) -> Option<String> {
        replace_dir(command_line, old_dir, new_dir)
    }

    /// `bin\icuuc<N>.dll` → N.
    fn icu_version(&self, env: &Env, dir: &Path) -> Option<String> {
        env.fs.list(&dir.join("bin")).ok()?.into_iter().find_map(|n| {
            let l = n.to_ascii_lowercase();
            let rest = l.strip_prefix("icuuc")?.strip_suffix(".dll")?;
            (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())).then(|| rest.to_string())
        })
    }

    fn reindex_icu(&self, env: &Env, be: &BackendEnv, pg_dir: &Path, sql: &str) -> Result<(), String> {
        let db = &be.db;
        let psql = pg_dir.join("bin").join(crate::platform::executable("psql"));
        let c = Cmd::new(&psql)
            .env("PGPASSWORD", &db.password)
            .args([
                "-X",
                "-w",
                "-h",
                &db.host,
                "-p",
                &db.port.to_string(),
                "-U",
                &db.user,
                "-d",
                &db.database,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
            ])
            .timeout(Duration::from_secs(3600));
        let out = env.procs.run(&c).map_err(|e| e.0)?;
        if !out.ok() {
            return Err(describe_failure("ICU yeniden dizinleme", &out));
        }
        Ok(())
    }
}

fn replace_dir(command_line: &str, old_dir: &Path, new_dir: &Path) -> Option<String> {
    let old = old_dir.to_string_lossy().to_string();
    let new = new_dir.to_string_lossy().to_string();
    let fold = crate::platform::case_insensitive_paths();
    let hay = if fold { command_line.to_ascii_lowercase() } else { command_line.to_string() };
    let needle = if fold { old.to_ascii_lowercase() } else { old.clone() };
    let i = hay.find(&needle)?;
    Some(format!("{}{}{}", &command_line[..i], new, &command_line[i + old.len()..]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn image_path_dir_replacement() {
        let old = PathBuf::from("/k/pgsql/16.9-1");
        let new = PathBuf::from("/k/pgsql/16.15-4");
        let cl = "\"/k/pgsql/16.9-1/bin/pg_ctl\" runservice -N \"TeksERP-PostgreSQL\" -D \"/k/pgveri\" -w";
        assert_eq!(
            replace_dir(cl, &old, &new).as_deref(),
            Some("\"/k/pgsql/16.15-4/bin/pg_ctl\" runservice -N \"TeksERP-PostgreSQL\" -D \"/k/pgveri\" -w")
        );
        assert_eq!(replace_dir("\"/baska/bin/pg_ctl\"", &old, &new), None);
    }
}
