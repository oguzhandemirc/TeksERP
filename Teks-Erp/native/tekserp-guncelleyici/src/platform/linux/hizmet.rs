//! systemd hizmet yapıştırıcısı (L6, §4.3): `hizmet` (birimin `ExecStart`ı) · `hizmet-kur` · `hizmet-kaldir` ·
//! `onar --yalniz-asil-ad` (taban birimin onarım satırı). Windows'taki SCM yapıştırıcısının karşılığı: açılışta İLK iş
//! kendini güncelleme sayacı, sonra kilit, `READY=1`, ek dosya hizası, motor turları; `SIGTERM` = durdur. Kendini
//! güncelleme `EXIT_SELF_UPDATE` ile çıkar, `Restart=always` yeni ikiliyle başlatır. `sd_notify` yeni crate'siz: Unix
//! datagram soketi (`NOTIFY_SOCKET`).
use super::birim;
use crate::codes;
use crate::engine::{Engine, TickResult};
use crate::layout::Layout;
use crate::selfupdate::{self, Startup};
use crate::trust::TrustAnchor;
use std::ffi::OsStr;
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tekserp_hizmet::logfile::{Level, LogSpec, RotatingLog};

// ── sd_notify ────────────────────────────────────────────────────────────────────────────────

/// `durum`u verilen bildirim soketine yollar (`/yol` ya da Linux soyut adı `@ad`).
pub fn bildir_adrese(yer: &OsStr, durum: &str) -> io::Result<()> {
    let b = yer.as_bytes();
    let soket = UnixDatagram::unbound()?;
    match b.first() {
        Some(b'/') => soket.send_to(durum.as_bytes(), Path::new(yer)).map(|_| ()),
        #[cfg(target_os = "linux")]
        Some(b'@') => {
            use std::os::linux::net::SocketAddrExt;
            let adres = std::os::unix::net::SocketAddr::from_abstract_name(&b[1..])?;
            soket.send_to_addr(durum.as_bytes(), &adres).map(|_| ())
        }
        _ => Err(io::Error::new(io::ErrorKind::Unsupported, "NOTIFY_SOCKET biçimi desteklenmiyor")),
    }
}

/// systemd'ye bildirim; birim dışında (`NOTIFY_SOCKET` yok) sessizce `false`.
pub fn bildir(durum: &str) -> bool {
    std::env::var_os("NOTIFY_SOCKET").is_some_and(|yer| bildir_adrese(&yer, durum).is_ok())
}

/// Gözcü aralığı: `WATCHDOG_USEC`in üçte biri (yalnız bu süreç için kurulduysa — `WATCHDOG_PID`).
pub fn gozcu_araligi() -> Option<Duration> {
    if let Some(pid) = std::env::var("WATCHDOG_PID").ok().and_then(|p| p.parse::<u32>().ok()) {
        if pid != std::process::id() {
            return None;
        }
    }
    let usec: u64 = std::env::var("WATCHDOG_USEC").ok()?.parse().ok()?;
    (usec > 0).then(|| Duration::from_micros(usec / 3).max(Duration::from_secs(1)))
}

// ── sinyaller ────────────────────────────────────────────────────────────────────────────────

static DURDUR: AtomicBool = AtomicBool::new(false);

extern "C" fn sinyal(_: libc::c_int) {
    DURDUR.store(true, Ordering::SeqCst);
}

fn sinyalleri_kur() {
    for s in [libc::SIGTERM, libc::SIGINT] {
        // SAFETY: işleyici yalnız atomik bir bayrak yazar (async-signal-safe).
        unsafe {
            let mut sa: libc::sigaction = std::mem::zeroed();
            sa.sa_sigaction = sinyal as extern "C" fn(libc::c_int) as libc::sighandler_t;
            libc::sigemptyset(&mut sa.sa_mask);
            libc::sigaction(s, &sa, std::ptr::null_mut());
        }
    }
}

// ── hizmet döngüsü ───────────────────────────────────────────────────────────────────────────

fn simdi_ms() -> i64 {
    tekserp_hizmet::timefmt::now_ms()
}

fn ad_arg(args: &[String]) -> Result<String, String> {
    let ad = crate::cli::flag_value(args, tekserp_hizmet::contract::ARG_SERVICE_NAME).unwrap_or_else(|| birim::VARSAYILAN_AD.into());
    if birim::ad_gecerli(&ad) {
        Ok(ad)
    } else {
        Err(format!("birim adı geçersiz: {ad:?}"))
    }
}

/// Gözcü iş parçacığı: aralıkta bir, döngü canlıysa `WATCHDOG=1`. Eşik aşılınca susar (bir kez günlüğe yazar).
fn gozcu_baslat(layout: Layout, dongu: Arc<AtomicI64>, log: Arc<RotatingLog>, events: Arc<dyn crate::env::Events>) {
    let Some(aralik) = gozcu_araligi() else { return };
    std::thread::spawn(move || {
        let mut sustu = false;
        while !DURDUR.load(Ordering::SeqCst) {
            std::thread::sleep(aralik);
            let durum = crate::ipc::read_status(&crate::env::RealFs, &layout).and_then(|d| {
                let kalp = tekserp_dogrulama::iso::date_parse_ms(&d.heartbeat);
                #[allow(clippy::cast_possible_truncation)]
                kalp.is_finite().then_some((kalp as i64, d.liveness_threshold_s))
            });
            if birim::gozcu_canli(simdi_ms(), dongu.load(Ordering::SeqCst), durum) {
                sustu = false;
                bildir("WATCHDOG=1");
            } else if !sustu {
                sustu = true;
                let m = "kalp atışı eşiği aşıldı — gözcü bildirimi kesildi (systemd yeniden başlatacak; yarım işlem sürdürülür)";
                log.error(m);
                events.event(Level::Error, m);
            }
        }
    });
}

/// Ek dosyayı gömülü şablona getirir; yalnız farklıysa yazar. `true` = yazıldı (`daemon-reload` gerekir). Şablon
/// izin listesini aşıyorsa HİÇ yazmaz (fail-closed).
pub fn ek_dosyayi_yaz(dizin: &Path, ad: &str) -> Result<bool, String> {
    let ihlal = birim::ek_dosya_denetle(birim::EK_DOSYA_SABLONU);
    if !ihlal.is_empty() {
        return Err(format!("gömülü ek dosya şablonu izin listesini aşıyor (yazılmadı): {}", ihlal.join("; ")));
    }
    let hedef = birim::ek_dosya(dizin, ad);
    if std::fs::read(&hedef).is_ok_and(|b| b == birim::EK_DOSYA_SABLONU.as_bytes()) {
        return Ok(false);
    }
    dosya_yaz(&hedef, birim::EK_DOSYA_SABLONU.as_bytes()).map_err(|e| format!("{}: {e}", hedef.display()))?;
    Ok(true)
}

/// Atomik yazım (`RealFs::write_atomic`: geçici dosya + fsync + `rename(2)`), sonra 0644 (systemd birim dosyası).
fn dosya_yaz(hedef: &Path, icerik: &[u8]) -> io::Result<()> {
    use crate::env::Fs;
    crate::env::RealFs.write_atomic(hedef, icerik)?;
    std::fs::set_permissions(hedef, std::fs::Permissions::from_mode(0o644))
}

fn systemctl(args: &[&str]) -> Result<(), String> {
    let out = std::process::Command::new("systemctl").args(args).output().map_err(|e| format!("systemctl {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("systemctl {} → {}: {}", args.join(" "), out.status, String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Birimin `ExecStart`ı. Dönen kod sürecin çıkış kodudur (`Restart=always` her çıkışta yeniden başlatır).
fn calis(args: &[String]) -> Result<u32, String> {
    let root = crate::cli::root_arg(args)?;
    let data = crate::cli::data_arg(args, &root);
    let ad = ad_arg(args)?;
    let layout = Layout::new(&root, &data);
    let log = Arc::new(RotatingLog::open(&layout.log_dir(), "guncelleyici", LogSpec::SERVICE));
    sinyalleri_kur();
    let own = std::env::current_exe().ok();
    let settings = crate::settings::read_settings(&crate::env::RealFs, &layout).unwrap_or_default();
    // `tur` ile aynı bağlama: hizmet + arka uç Docker'a (L4b) — yoksa systemd altında iskelet arka uç koşar.
    let env = match crate::env::real(settings.proxy.as_deref(), &ad).and_then(|e| crate::platform::baglam(e, &layout, &settings)) {
        Ok(e) => e,
        Err(e) => {
            log.error(&format!("ortam kurulamadı: {e}"));
            return Ok(2);
        }
    };
    if let Some(own) = &own {
        if selfupdate::on_startup(&env, &layout, own, env!("CARGO_PKG_VERSION")) == Startup::RevertedRestart {
            let m = "yeni güncelleyici ikilisi 3 açılışta doğrulanamadı — eski ikili geri kondu";
            log.error(m);
            env.events.event(Level::Error, m);
            return Ok(codes::EXIT_SELF_UPDATE);
        }
    }
    let anchor = match TrustAnchor::for_process() {
        Ok(a) => a,
        Err(e) => {
            log.error(&format!("güven çapası: {e}"));
            return Ok(2);
        }
    };
    let _lock = match crate::lock::acquire(&layout.lock_file()) {
        Ok(l) => l,
        Err(e) => {
            log.error(&format!("{}: {e}", codes::KILIT_DOLU));
            return Ok(3);
        }
    };
    let dongu = Arc::new(AtomicI64::new(simdi_ms()));
    bildir(&format!("READY=1\nSTATUS=güncelleyici {} çalışıyor", env!("CARGO_PKG_VERSION")));
    log.info(&format!("güncelleyici başladı (sürüm {}; systemd birimi {ad})", env!("CARGO_PKG_VERSION")));
    // Ek dosya yalnız systemd altında ve READY'den SONRA hizalanır (başlatma işi sürerken daemon-reload yok; elle
    // koşulan `hizmet` /etc'ye yazmaz); etkisi bir sonraki başlatmada.
    if std::env::var_os("NOTIFY_SOCKET").is_some() {
        match ek_dosyayi_yaz(Path::new(birim::SYSTEMD_DIZINI), &ad) {
            Ok(false) => {}
            Ok(true) => match systemctl(&["daemon-reload"]) {
                Ok(()) => log.info("systemd ek dosyası gömülü şablona hizalandı (bir sonraki başlatmada etkin)"),
                Err(e) => log.warn(&format!("ek dosya yazıldı, daemon-reload düştü: {e}")),
            },
            Err(e) => {
                log.warn(&format!("systemd ek dosyası hizalanamadı: {e}"));
                env.events.event(Level::Warn, &format!("systemd ek dosyası hizalanamadı: {e}"));
            }
        }
    }
    gozcu_baslat(layout.clone(), Arc::clone(&dongu), Arc::clone(&log), Arc::clone(&env.events));
    let engine = Engine::new(env.clone(), layout.clone(), anchor, Arc::clone(&log), own);
    let should_stop = || {
        dongu.store(simdi_ms(), Ordering::SeqCst);
        DURDUR.load(Ordering::SeqCst)
    };
    let mut kod = 0;
    while !should_stop() {
        match engine.tick(&should_stop) {
            TickResult::RestartForSelfUpdate => {
                kod = codes::EXIT_SELF_UPDATE;
                break;
            }
            TickResult::Idle(d) => crate::wait::until_change_or(&env, &layout, d, &should_stop),
        }
    }
    bildir("STOPPING=1");
    log.info(if kod == 0 {
        "güncelleyici duruyor (istenen durdurma)"
    } else {
        "güncelleyici yeni ikiliyle yeniden başlamak için çıkıyor"
    });
    Ok(kod)
}

fn root_gerekli(komut: &str) -> Result<(), String> {
    if super::sys::euid() == 0 {
        Ok(())
    } else {
        Err(format!("{komut} root ister (sudo)"))
    }
}

/// `hizmet-kur`: taban birim + ek dosya + `daemon-reload` + `enable` (başlatmaz — kurulum başlatır).
fn kur(args: &[String]) -> Result<u32, String> {
    let kok = crate::cli::root_arg(args)?;
    let veri = crate::cli::flag_value(args, "--veri").map_or_else(|| PathBuf::from(super::duzen::VARSAYILAN_VERI), PathBuf::from);
    let ad = ad_arg(args)?;
    let metin = birim::taban_birim(&kok, &veri, &ad)?;
    root_gerekli("hizmet-kur")?;
    let dizin = Path::new(birim::SYSTEMD_DIZINI);
    let dosya = birim::birim_dosyasi(dizin, &ad);
    let onceki = std::fs::read(&dosya).ok();
    if onceki.as_deref() != Some(metin.as_bytes()) {
        dosya_yaz(&dosya, metin.as_bytes()).map_err(|e| format!("{}: {e}", dosya.display()))?;
    }
    ek_dosyayi_yaz(dizin, &ad)?;
    systemctl(&["daemon-reload"])?;
    systemctl(&["enable", &format!("{ad}.service")])?;
    if !birim::asil_ikili(&kok).is_file() {
        eprintln!("UYARI: {} yok — birim başlatılmadan önce ikili oraya konmalı", birim::asil_ikili(&kok).display());
    }
    let ne = match onceki {
        None => "kaydedildi",
        Some(b) if b == metin.as_bytes() => "zaten kayıtlı (taban birim aynı)",
        Some(_) => "taban birimi yeniden yazıldı",
    };
    println!("{ad}.service {ne} (kök {}, veri {}); başlatmak için: systemctl start {ad}.service", kok.display(), veri.display());
    Ok(0)
}

/// `hizmet-kaldir`: durdur + devre dışı + yalnız kendi dosyalarımızı sil.
fn kaldir(args: &[String]) -> Result<u32, String> {
    let ad = ad_arg(args)?;
    root_gerekli("hizmet-kaldir")?;
    let birim_adi = format!("{ad}.service");
    if let Err(e) = systemctl(&["disable", "--now", &birim_adi]) {
        eprintln!("UYARI: {e}");
    }
    let dizin = Path::new(birim::SYSTEMD_DIZINI);
    let ek = birim::ek_dosya(dizin, &ad);
    let _ = std::fs::remove_file(&ek);
    if let Some(d) = ek.parent() {
        let _ = std::fs::remove_dir(d); // boşsa (yerel ek dosyalar kalırsa dizin de kalır)
    }
    match std::fs::remove_file(birim::birim_dosyasi(dizin, &ad)) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("taban birim silinemedi: {e}")),
    }
    systemctl(&["daemon-reload"])?;
    let _ = systemctl(&["reset-failed", &birim_adi]);
    println!("{birim_adi} kaldırıldı");
    Ok(0)
}

/// Taban birimin onarım satırı (`onar --yalniz-asil-ad`). L6: yalnız ÖLÇER — asıl ad sağlamsa sessiz; değilse görünür
/// uyarı. Asıl adı doğrulanmış kaynaktan geri koyan onarım W1b'nindir (§4.7 madde 1–6). Hep 0 (satır `-` önekli).
fn asil_ad_onar(args: &[String]) -> Result<u32, String> {
    let kok = crate::cli::root_arg(args)?;
    let asil = birim::asil_ikili(&kok);
    let saglam = std::fs::metadata(&asil).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0);
    if !saglam {
        eprintln!("<4>UYARI: güncelleyicinin asıl ikilisi yok ya da çalıştırılamaz: {} (onarım W1b)", asil.display());
    }
    Ok(0)
}

pub fn komut(command: &str, args: &[String]) -> Result<u32, String> {
    match command {
        "hizmet" => calis(args),
        "hizmet-kur" => kur(args),
        "hizmet-kaldir" => kaldir(args),
        "onar" => asil_ad_onar(args),
        _ => Err(format!("bilinmeyen komut: {command}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gecici(ad: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gl6-{ad}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn sd_notify_yol_soketine_yazar() {
        let d = gecici("bildir");
        let yer = d.join("n");
        let alici = UnixDatagram::bind(&yer).unwrap();
        bildir_adrese(yer.as_os_str(), "READY=1").unwrap();
        let mut b = [0u8; 64];
        let n = alici.recv(&mut b).unwrap();
        assert_eq!(&b[..n], b"READY=1");
        assert!(bildir_adrese(OsStr::new("goreli"), "x").is_err(), "göreli adres reddedilir");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn sd_notify_soyut_ada_yazar() {
        use std::os::linux::net::SocketAddrExt;
        let ad = format!("gl6-bildir-{}", std::process::id());
        let alici = UnixDatagram::bind_addr(&std::os::unix::net::SocketAddr::from_abstract_name(ad.as_bytes()).unwrap()).unwrap();
        bildir_adrese(OsStr::new(&format!("@{ad}")), "WATCHDOG=1").unwrap();
        let mut b = [0u8; 64];
        let n = alici.recv(&mut b).unwrap();
        assert_eq!(&b[..n], b"WATCHDOG=1");
    }

    #[test]
    fn ek_dosya_yalniz_farkliysa_yazilir() {
        let d = gecici("ek");
        assert_eq!(ek_dosyayi_yaz(&d, "tekserp-guncelleyici"), Ok(true));
        let f = birim::ek_dosya(&d, "tekserp-guncelleyici");
        assert_eq!(std::fs::read_to_string(&f).unwrap(), birim::EK_DOSYA_SABLONU);
        assert_eq!(std::fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o644);
        assert_eq!(ek_dosyayi_yaz(&d, "tekserp-guncelleyici"), Ok(false), "aynıysa yazılmaz");
        std::fs::write(&f, "[Service]\nExecStart=/bin/sh\n").unwrap();
        assert_eq!(ek_dosyayi_yaz(&d, "tekserp-guncelleyici"), Ok(true), "elle değişiklik geri yazılır");
        assert_eq!(std::fs::read_to_string(&f).unwrap(), birim::EK_DOSYA_SABLONU);
        let artik: Vec<_> = std::fs::read_dir(f.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(artik.len(), 1, "geçici dosya kalmaz: {artik:?}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn asil_ad_onar_tur_kosmaz_hep_sifir() {
        let d = gecici("onar");
        let args: Vec<String> = ["onar", "--yalniz-asil-ad", "--kok", &d.to_string_lossy()].iter().map(|s| s.to_string()).collect();
        assert_eq!(komut("onar", &args), Ok(0));
        assert!(!d.join("programdata").exists() && std::fs::read_dir(&d).unwrap().next().is_none(), "onarım satırı hiçbir şey yazmaz");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
