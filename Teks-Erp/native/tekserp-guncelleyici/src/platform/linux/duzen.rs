//! Linux dizin düzeni (§1.2): çekirdeğin `Layout`u iki platformda aynı adları kullanır (`surumler/` · `current` ·
//! `yapilandirma/.env` · `guncelleyici/` · `<veri>/guncelleme/{niyet,durum,is}`); Linux'a özgü olan varsayılan
//! kökler, compose dosyası/ortamı ve IPC dizinlerinin sahip/izin beyanı burada tek yerde durur.
use crate::layout::Layout;
use std::path::{Path, PathBuf};
use tekserp_hizmet::contract::path as p;

/// `<KOK>` (`--kok` verilmezse kurulumun yazdığı yer).
pub const VARSAYILAN_KOK: &str = "/opt/tekserp";
/// Veri kökü (`--veri` verilmezse): IPC `<veri>/guncelleme/` — backend konteynerine bağlanan dizin.
pub const VARSAYILAN_VERI: &str = "/var/lib/tekserp";
/// Backend konteynerinin kullanıcısı (imaj `USER 10001`): niyet dizininin sahibi.
pub const BACKEND_UID: u32 = 10001;
/// Sürüm dizinindeki (imzalı) compose dosyası.
pub const COMPOSE_DOSYASI: &str = "docker-compose.yml";
/// PG imajının tek yazarı güncelleyici (Windows ImagePath karşılığı, L8).
pub const PG_ENV: &str = "pg.env";

/// `current/docker-compose.yml` — GECIS bağı çevirince compose dosyası da sürümle birlikte değişir.
pub fn compose_file(l: &Layout) -> PathBuf {
    l.current().join(COMPOSE_DOSYASI)
}

/// `yapilandirma/pg.env`.
pub fn pg_env(l: &Layout) -> PathBuf {
    l.root.join(p::CONFIG).join(PG_ENV)
}

/// Compose proje adı (`ayar.json`; aynı konakta iki kanal = iki proje): Docker kuralı `[a-z0-9][a-z0-9_-]*`.
pub fn valid_project(name: &str) -> bool {
    let mut it = name.bytes();
    it.next().is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && it.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
        && name.len() <= 63
}

/// HER `docker compose` çağrısının ortak başı (§1.2): `compose -p <proje> -f current/docker-compose.yml
/// --env-file yapilandirma/.env --env-file yapilandirma/pg.env` — elle müdahale de aynı satırı kullanır.
pub fn compose_args(l: &Layout, project: &str) -> Result<Vec<String>, String> {
    if !valid_project(project) {
        return Err(format!("compose proje adı geçersiz: {project:?}"));
    }
    let s = |x: PathBuf| x.to_string_lossy().into_owned();
    Ok(vec![
        "compose".into(),
        "-p".into(),
        project.into(),
        "-f".into(),
        s(compose_file(l)),
        "--env-file".into(),
        s(l.backend_env()),
        "--env-file".into(),
        s(pg_env(l)),
    ])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sahip {
    /// Güncelleyicinin kendisi (üretimde root).
    Guncelleyici,
    /// Backend konteyneri (`BACKEND_UID`).
    Backend,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IpcDizini {
    pub yol: PathBuf,
    pub sahip: Sahip,
    pub kip: u32,
}

/// IPC dizinlerinin beyanı (§1.2): `niyet/` backend yazar (rw bağ) · `durum/` güncelleyici yazar, backend okur
/// (ro bağ) · `is/` güncelleyicinin özel alanı.
pub fn ipc_dizinleri(l: &Layout) -> Vec<IpcDizini> {
    let intent = l.intent_file().parent().map(Path::to_path_buf).unwrap_or_default();
    vec![
        IpcDizini { yol: intent, sahip: Sahip::Backend, kip: 0o700 },
        IpcDizini { yol: l.status_dir(), sahip: Sahip::Guncelleyici, kip: 0o755 },
        IpcDizini { yol: l.work(), sahip: Sahip::Guncelleyici, kip: 0o700 },
    ]
}

/// Beyandan sapmalar (yok · bağlantı · sahip · izin); boş = uygun. Kurulum/tanı ölçer, güncelleyici yazmaz.
#[cfg(unix)]
pub fn ipc_sapmalari(l: &Layout) -> Vec<String> {
    use std::os::unix::fs::MetadataExt;
    let me = super::sys::euid();
    let mut out = Vec::new();
    for d in ipc_dizinleri(l) {
        let uid = match d.sahip {
            Sahip::Guncelleyici => me,
            Sahip::Backend => BACKEND_UID,
        };
        match std::fs::symlink_metadata(&d.yol) {
            Err(_) => out.push(format!("{}: yok", d.yol.display())),
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => out.push(format!("{}: dizin değil ya da bağlantı", d.yol.display())),
            Ok(m) => {
                if m.uid() != uid {
                    out.push(format!("{}: sahibi uid {} (beklenen {uid})", d.yol.display(), m.uid()));
                }
                if m.mode() & 0o7777 != d.kip {
                    out.push(format!("{}: izni {:o} (beklenen {:o})", d.yol.display(), m.mode() & 0o7777, d.kip));
                }
            }
        }
    }
    out
}

// Yol karşılaştırmaları `/` ayraçlı — Windows hedefinde koşmaz.
#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn linux_duzeni_plandaki_yollar() {
        let l = Layout::new(Path::new(VARSAYILAN_KOK), Path::new(VARSAYILAN_VERI));
        assert_eq!(compose_file(&l), Path::new("/opt/tekserp/current/docker-compose.yml"));
        assert_eq!(l.backend_env(), Path::new("/opt/tekserp/yapilandirma/.env"));
        assert_eq!(pg_env(&l), Path::new("/opt/tekserp/yapilandirma/pg.env"));
        assert_eq!(l.journal_file(), Path::new("/var/lib/tekserp/guncelleme/is/islem.jsonl"));
        let dirs: Vec<(String, Sahip, u32)> =
            ipc_dizinleri(&l).into_iter().map(|d| (d.yol.to_string_lossy().into_owned(), d.sahip, d.kip)).collect();
        assert_eq!(
            dirs,
            vec![
                ("/var/lib/tekserp/guncelleme/niyet".into(), Sahip::Backend, 0o700),
                ("/var/lib/tekserp/guncelleme/durum".into(), Sahip::Guncelleyici, 0o755),
                ("/var/lib/tekserp/guncelleme/is".into(), Sahip::Guncelleyici, 0o700),
            ]
        );
        assert_eq!(
            compose_args(&l, "tekserp").unwrap().join(" "),
            "compose -p tekserp -f /opt/tekserp/current/docker-compose.yml --env-file /opt/tekserp/yapilandirma/.env --env-file /opt/tekserp/yapilandirma/pg.env"
        );
        for bad in ["", "Tekserp", "-x", "a b", "a;b", "_x"] {
            assert!(compose_args(&l, bad).is_err(), "{bad:?}");
        }
        assert!(valid_project("tekserp-hazirlik_2"));
    }

    #[test]
    fn ipc_sapmalari_olculur() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("gl4a-ipc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let l = Layout::new(&d.join("kok"), &d.join("veri"));
        assert_eq!(ipc_sapmalari(&l).len(), 3, "hiç yokken üç sapma");
        for x in ipc_dizinleri(&l) {
            std::fs::create_dir_all(&x.yol).unwrap();
            std::fs::set_permissions(&x.yol, std::fs::Permissions::from_mode(x.kip)).unwrap();
        }
        let s = ipc_sapmalari(&l);
        // Root değilken niyet dizininin sahibi backend olamaz: tek sapma o.
        if super::super::sys::euid() == BACKEND_UID {
            assert!(s.is_empty(), "{s:?}");
        } else {
            assert_eq!(s.len(), 1, "{s:?}");
            assert!(s[0].contains("niyet") && s[0].contains("sahibi"), "{s:?}");
        }
        std::fs::set_permissions(l.work(), std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(ipc_sapmalari(&l).iter().any(|m| m.contains("/is: izni 755")), "izin sapması görülmedi");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
