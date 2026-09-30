//! Yerel sözleşmenin (docs/design/GUNCELLEYICI.md §4) adları — TEK KAYNAK: konak, güncelleyici ve
//! kurulum komutları bu sabitleri okur. Dizin adları backend'in `Teks-Erp/src/lib/hizmet-duzeni.ts`
//! `SERVICE_DIRS`iyle AYNIDIR (D3); ortam adları oradaki sabitlerle aynıdır.

/// Backend hizmetinin VARSAYILAN adı (konak bu adla kaydolur; güncelleyici bu adı durdurur/başlatır).
/// Aynı makinede ikinci kanal kendi adını alır (kanal kaydı `backend.hizmetAdi`, `hizmet-kur --ad`).
pub const BACKEND_SERVICE: &str = "TeksERP-Backend";
pub const BACKEND_DISPLAY_NAME: &str = "TeksERP Backend";
pub const BACKEND_DESCRIPTION: &str = "TeksERP ERP sunucusu (Node) — hizmet konağı; güncelleyici yönetir.";
/// Düşük yetkili sanal hizmet hesabı (parolasız) — varsayılan adın; genel biçim `service_account`.
pub const BACKEND_ACCOUNT: &str = "NT SERVICE\\TeksERP-Backend";
/// Backend hesabının ayrıcalıkları (D3: SeImpersonate bilerek YOK).
pub const BACKEND_PRIVILEGES: [&str; 2] = ["SeChangeNotifyPrivilege", "SeCreateGlobalPrivilege"];

pub const UPDATER_SERVICE: &str = "TeksERP-Guncelleyici";
pub const UPDATER_DISPLAY_NAME: &str = "TeksERP Güncelleyici";
pub const UPDATER_DESCRIPTION: &str = "TeksERP backend güncellemelerini imzalı paketten doğrular, uygular ve gerekirse geri alır.";

/// Kendi PostgreSQL örneğinin hizmeti (D4); backend buna bağımlı kaydedilir (varsa).
pub const PG_SERVICE: &str = "TeksERP-PostgreSQL";

/// Hizmet adı argümanı (`hizmet` · `hizmet-kur` · `hizmet-kaldir` · `on-planda`): yoksa varsayılan ad.
pub const ARG_SERVICE_NAME: &str = "--ad";

/// Hizmet adı: harf/rakamla başlar; harf · rakam · `.` · `_` · `-`; en çok 80 karakter (SCM adı, olay
/// kaynağı ve `NT SERVICE\<ad>` sanal hesabı olur — boşluk, ters bölü ve yol ayıracı YOK).
pub fn valid_service_name(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 80
        && b[0].is_ascii_alphanumeric()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

/// Hizmetin sanal hesabı: `NT SERVICE\<ad>` (hizmet kaydıyla DOĞAR — ACL kayıttan SONRA, §4.2).
pub fn service_account(name: &str) -> String {
    format!("NT SERVICE\\{name}")
}

/// Argümanlardaki `--ad` değeri (doğrulanmış) ya da varsayılan.
pub fn service_name_arg(args: &[String], default: &str) -> Result<String, String> {
    match args.iter().position(|a| a == ARG_SERVICE_NAME).map(|i| args.get(i + 1)) {
        None => Ok(default.to_string()),
        Some(Some(n)) if valid_service_name(n) => Ok(n.clone()),
        Some(_) => Err(format!("{ARG_SERVICE_NAME} <ad> biçimsiz (harf/rakamla başlar; harf · rakam · . _ -; ≤ 80)")),
    }
}

/// Doğrulama kipi: güncelleyici backend'i bu başlatma argümanıyla açar (yalnız 127.0.0.1, arka plan işi yok).
pub const VERIFY_ARG: &str = "--dogrulama";

/// Konağın node'a verdiği ortam (D3 `hizmet-duzeni.ts`: `ROOT_ENV` · `SERVICE_NAME_ENV` · `SHUTDOWN_CHANNEL_ENV`).
pub const ENV_ROOT: &str = "TEKSERP_KOK";
pub const ENV_SERVICE_NAME: &str = "TEKSERP_HIZMET_ADI";
pub const ENV_SHUTDOWN_CHANNEL: &str = "TEKSERP_KAPANIS";
pub const SHUTDOWN_CHANNEL_STDIN: &str = "stdin";
pub const ENV_VERIFY_MODE: &str = "TEKSERP_DOGRULAMA_KIPI";
/// Node bunu yalnız AÇILIŞTA okur (`.env`den gelirse etkisiz) — konak verir.
pub const ENV_SYSTEM_CA: &str = "NODE_USE_SYSTEM_CA";
/// Konağın SİLDİĞİ ortam (bütünlük: `--require/--import/--inspect` yükleyici enjeksiyonu).
pub const ENV_REMOVED: [&str; 1] = ["NODE_OPTIONS"];
/// Düzgün kapanış isteği: node'un stdin'ine bu satır yazılır (boru kapanması da aynı anlam).
pub const SHUTDOWN_LINE: &str = "kapat\n";

/// Konağın hizmete özgü çıkış kodları (SCM kurtarmasını tetikler; 0 = istenen durdurma).
pub mod exit {
    pub const OK: u32 = 0;
    pub const NODE_UNEXPECTED: u32 = 10;
    pub const NODE_NOT_STARTED: u32 = 11;
    pub const ENV_FILE: u32 = 12;
    pub const JOB_OBJECT: u32 = 13;
    pub const CURRENT_LINK: u32 = 14;
}

/// `<KOK>` altındaki adlar (§4.1) = D3 `SERVICE_DIRS`.
pub mod path {
    pub const VERSIONS: &str = "surumler";
    pub const CURRENT: &str = "current";
    pub const CONFIG: &str = "yapilandirma";
    pub const ENV_FILE: &str = ".env";
    pub const LICENSE: &str = "lisans";
    pub const BACKUPS: &str = "backups";
    pub const BACKUP_KEYS: &str = "yedek-anahtar";
    pub const LOGS: &str = "logs";
    pub const DATA: &str = "veri";
    pub const PGSQL: &str = "pgsql";
    /// Güncelleyicinin kendi dizini (SYSTEM/Administrators): ikili + `ayar.json` + `gunluk\`.
    pub const UPDATER: &str = "guncelleyici";
    pub const INSTALL_HISTORY: &str = "kurulum-gecmisi.jsonl";
    /// Sürüm dizininde çalışma zamanı: node + iki Rust ikilisi (imzalı kapsamda).
    pub const RUNTIME: &str = "runtime";
    pub const SERVER_SCRIPT: [&str; 2] = ["dist", "server.js"];
    pub const HOST_EXE: &str = "tekserp-hizmet.exe";
    pub const UPDATER_EXE: &str = "tekserp-guncelleyici.exe";
    /// Konağın günlükleri `logs\` altında (D3: iki dosya ayrı kalır).
    pub const LOG_OUT: &str = "backend-out";
    pub const LOG_ERR: &str = "backend-err";
    pub const LOG_HOST: &str = "hizmet";
}

/// Node yürütülebilir dosyasının adı (paket düzeni `runtime\node.exe`; Windows dışı geliştirme `runtime/node`).
pub fn node_file_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_names() {
        assert!(valid_service_name("TeksERP-Backend") && valid_service_name("TeksERP-Backend-testfabrika"));
        for bad in ["", "-x", "Teks ERP", "a\\b", "a/b", "é", &"a".repeat(81)] {
            assert!(!valid_service_name(bad), "{bad}");
        }
        assert_eq!(service_account("TeksERP-Backend"), BACKEND_ACCOUNT);
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(service_name_arg(&args(&["hizmet"]), BACKEND_SERVICE).unwrap(), BACKEND_SERVICE);
        assert_eq!(service_name_arg(&args(&["hizmet", "--ad", "TeksERP-Backend-demo"]), BACKEND_SERVICE).unwrap(), "TeksERP-Backend-demo");
        assert!(service_name_arg(&args(&["hizmet", "--ad"]), BACKEND_SERVICE).is_err());
        assert!(service_name_arg(&args(&["hizmet", "--ad", "a b"]), BACKEND_SERVICE).is_err());
    }
}
