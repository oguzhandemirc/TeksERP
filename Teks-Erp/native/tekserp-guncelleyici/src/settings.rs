//! Güncelleyicinin kendi ayarı (`<KOK>\guncelleyici\ayar.json`, yalnız SYSTEM/Administrators yazar,
//! §6.1) ve backend ortamından (`<KOK>\ayar\backend.env`) okunan değerler. Sırlar (DATABASE_URL
//! parolası) yalnız çocuk sürecin ORTAMINA gider; günlüğe/duruma yazılmaz.
use crate::env::Fs;
use crate::layout::Layout;
use serde::Deserialize;
use std::path::PathBuf;
use std::time::Duration;
use tekserp_hizmet::envfile::{self, EnvFile};

#[derive(Debug, Clone, Deserialize)]
pub struct UpdaterSettings {
    #[serde(rename = "guncellemeSunucusu")]
    pub server: Option<String>,
    #[serde(rename = "vekil")]
    pub proxy: Option<String>,
    #[serde(rename = "saglikZamanAsimiSn", default = "default_health")]
    pub health_timeout_s: u64,
    #[serde(rename = "durdurmaZamanAsimiSn", default = "default_stop")]
    pub stop_timeout_s: u64,
    #[serde(rename = "gocZamanAsimiSn", default = "default_migrate")]
    pub migrate_timeout_s: u64,
    #[serde(rename = "yedekZamanAsimiSn", default = "default_backup")]
    pub backup_timeout_s: u64,
    #[serde(rename = "turAraligiSn", default = "default_tick")]
    pub tick_s: u64,
}

fn default_health() -> u64 {
    180
}
fn default_stop() -> u64 {
    60
}
fn default_migrate() -> u64 {
    1800
}
fn default_backup() -> u64 {
    3600
}
fn default_tick() -> u64 {
    60
}

impl Default for UpdaterSettings {
    fn default() -> Self {
        UpdaterSettings {
            server: None,
            proxy: None,
            health_timeout_s: default_health(),
            stop_timeout_s: default_stop(),
            migrate_timeout_s: default_migrate(),
            backup_timeout_s: default_backup(),
            tick_s: default_tick(),
        }
    }
}

impl UpdaterSettings {
    pub fn health_timeout(&self) -> Duration {
        Duration::from_secs(self.health_timeout_s.clamp(30, 3600))
    }
    pub fn stop_timeout(&self) -> Duration {
        Duration::from_secs(self.stop_timeout_s.clamp(10, 600))
    }
    pub fn migrate_timeout(&self) -> Duration {
        Duration::from_secs(self.migrate_timeout_s.clamp(60, 6 * 3600))
    }
    pub fn backup_timeout(&self) -> Duration {
        Duration::from_secs(self.backup_timeout_s.clamp(60, 12 * 3600))
    }

    /// Sunucu kökü YALNIZ `https://` (test derlemesinde döngü adresine `http://` da).
    pub fn server_base(&self) -> Result<String, String> {
        let s = self.server.as_deref().ok_or("ayar.json'da guncellemeSunucusu yok")?.trim_end_matches('/');
        let loopback = s.starts_with("http://127.0.0.1:") || s.starts_with("http://localhost:");
        if !(s.starts_with("https://") || (crate::trust::TEST_ANCHOR && loopback)) {
            return Err("guncellemeSunucusu https:// olmalı".into());
        }
        if s.contains(['?', '#', '@', ' ']) || s.len() > 200 {
            return Err("guncellemeSunucusu biçimsiz".into());
        }
        Ok(s.to_string())
    }
}

pub fn read_settings(fs: &dyn Fs, layout: &Layout) -> Result<UpdaterSettings, String> {
    match fs.read(&layout.settings_file()) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(UpdaterSettings::default()),
        Err(e) => Err(format!("ayar.json okunamadı: {e}")),
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("ayar.json biçimsiz: {e}")),
    }
}

/// `postgres(ql)://kullanıcı:parola@ana:port/veritabanı?…` — Prisma'nın `DATABASE_URL`i.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbUrl {
    pub user: String,
    pub password: String,
    pub host: String,
    pub port: u16,
    pub database: String,
}

fn pct_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn parse_db_url(url: &str) -> Option<DbUrl> {
    let rest = url.strip_prefix("postgresql://").or_else(|| url.strip_prefix("postgres://"))?;
    let rest = rest.split(['?', '#']).next()?;
    let (auth, hostpath) = match rest.rsplit_once('@') {
        Some((a, h)) => (Some(a), h),
        None => (None, rest),
    };
    let (user, password) = match auth {
        Some(a) => match a.split_once(':') {
            Some((u, p)) => (pct_decode(u)?, pct_decode(p)?),
            None => (pct_decode(a)?, String::new()),
        },
        None => (String::new(), String::new()),
    };
    let (hostport, db) = hostpath.split_once('/')?;
    let (host, port) = if let Some(v6) = hostport.strip_prefix('[') {
        let (h, after) = v6.split_once(']')?;
        (h.to_string(), after.strip_prefix(':').map_or(Some(5432), |p| p.parse().ok())?)
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().ok()?),
            None => (hostport.to_string(), 5432),
        }
    };
    let database = pct_decode(db)?;
    if database.is_empty() {
        return None;
    }
    Some(DbUrl { user, password, host: if host.is_empty() { "localhost".into() } else { host }, port, database })
}

/// Backend ortamından güncelleyicinin ihtiyaç duyduğu değerler.
#[derive(Debug, Clone)]
pub struct BackendEnv {
    pub file: EnvFile,
    pub port: u16,
    pub license_dir: PathBuf,
    pub backup_key_dir: PathBuf,
    pub pg_bin_dir: PathBuf,
    /// pg_dump/pg_restore/psql kimliği: `BACKUP_PG_USER/PASSWORD` varsa onlar, yoksa DATABASE_URL.
    pub db: Option<DbUrl>,
    pub env_file: PathBuf,
}

pub fn read_backend_env(fs: &dyn Fs, layout: &Layout) -> Result<BackendEnv, String> {
    let bytes = fs.read_untrusted(&layout.backend_env(), 256 * 1024).map_err(|e| format!("yapilandirma\\.env okunamadı: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| "yapilandirma\\.env UTF-8 değil".to_string())?;
    let file = envfile::parse(&text)?;
    let port = file.get("PORT").map_or(Ok(4000), |p| p.parse::<u16>()).map_err(|_| ".env PORT sayı değil".to_string())?;
    let license_dir = file.get("LICENSE_DIR").map_or_else(|| layout.default_license_dir(), PathBuf::from);
    let backup_key_dir = file.get("BACKUP_KEY_DIR").map_or_else(|| layout.default_backup_keys(), PathBuf::from);
    // D4: `PG_BIN_DIR` = `<KOK>\pgsql\bin` junction'ı (kendi örnekte etkin sürüm, harici kipte o PG'nin bin'i).
    let pg_bin_dir = file.get("PG_BIN_DIR").map_or_else(|| layout.pg_bin_link(), PathBuf::from);
    let db = file.get("DATABASE_URL").and_then(parse_db_url).map(|mut d| {
        if let Some(u) = file.get("BACKUP_PG_USER") {
            d.user = u.to_string();
            d.password = file.get("BACKUP_PG_PASSWORD").unwrap_or_default().to_string();
        }
        d
    });
    Ok(BackendEnv { file, port, license_dir, backup_key_dir, pg_bin_dir, db, env_file: layout.backend_env() })
}

impl BackendEnv {
    /// Çocuk araç ortamı (göç · `dist\tools`): `prisma.config.js` ve araçlar `dotenv/config` kullanır ve
    /// `TEKSERP_KOK` okumaz ⇒ `.env` yolu AÇIKÇA verilir (D3); sırlar ortama kopyalanmaz.
    pub fn tool_env(&self) -> Vec<(String, String)> {
        vec![("DOTENV_CONFIG_PATH".into(), self.env_file.to_string_lossy().into_owned()), ("NODE_ENV".into(), "production".into())]
    }

    pub fn pg_tool(&self, name: &str) -> PathBuf {
        let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
        self.pg_bin_dir.join(exe)
    }
}

/// Günlüğe giden metinde `şema://kullanıcı:parola@` kimliğini maskeler (araç çıktısı sır sızdırmasın).
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("://") {
        let (head, tail) = rest.split_at(i + 3);
        out.push_str(head);
        let end = tail.find(|c: char| c.is_whitespace() || c == '"' || c == '\'').unwrap_or(tail.len());
        let token = &tail[..end];
        match token.rfind('@') {
            Some(at) => {
                out.push_str("***");
                out.push_str(&token[at..]);
            }
            None => out.push_str(token),
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_url() {
        let d = parse_db_url("postgresql://tekserp:p%40ss%3Aw@127.0.0.1:5433/tekserp_yeni?schema=public").expect("url");
        assert_eq!(
            (d.user.as_str(), d.password.as_str(), d.host.as_str(), d.port, d.database.as_str()),
            ("tekserp", "p@ss:w", "127.0.0.1", 5433, "tekserp_yeni")
        );
        let d = parse_db_url("postgres://u@[::1]/db").expect("v6");
        assert_eq!((d.host.as_str(), d.port, d.password.as_str()), ("::1", 5432, ""));
        assert!(parse_db_url("mysql://x@y/z").is_none());
        assert!(parse_db_url("postgresql://u:p@h:5432/").is_none());
    }

    #[test]
    fn redacts_credentials() {
        assert_eq!(
            redact("Error: P1001 postgresql://tekserp:gizli@127.0.0.1:5432/db failed; see https://pris.ly/x"),
            "Error: P1001 postgresql://***@127.0.0.1:5432/db failed; see https://pris.ly/x"
        );
    }
}
