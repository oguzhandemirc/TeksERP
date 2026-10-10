//! Sahte dünya: gerçek dosya sistemi (geçici dizin) + sahte hizmet/süreç/ağ/saat/DB + "süreç burada
//! öldü" enjeksiyonu. Enjeksiyon PANİKLE yapılır (`Killed`): hata yakalama kodundan geçemez, tıpkı
//! elektrik kesintisi gibi o anda her şeyi keser. Yeniden başlatma = aynı dünyada YENİ bir motor.
#![allow(dead_code)]

use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekserp_dogrulama::b64;
use tekserp_dogrulama::chain::RootKey;
use tekserp_guncelleyici::engine::{Engine, TickResult};
use tekserp_guncelleyici::env::{
    start_mode, Clock, Cmd, CmdOut, Env, EnvError, EnvResult, Events, Fs, HttpResponse, Net, Procs, Protect, ReadSeek, RealFs, Services,
    SvcState, SyncWrite,
};
use tekserp_guncelleyici::imaj;
use tekserp_guncelleyici::ipc::{self, State, StatusDoc};
use tekserp_guncelleyici::journal::Journal;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::package::{ExtractLimits, ExtractStats};
use tekserp_guncelleyici::trust::TrustAnchor;
use tekserp_hizmet::logfile::{Level, RotatingLog};

pub mod eski_bicim;

pub const CHANNEL: &str = "testkanal";
pub const OLD: &str = "2.12.0";
pub const NEW: &str = "2.13.0";
pub const BACKEND: &str = "TeksERP-Backend";
pub const PG: &str = "TeksERP-PostgreSQL";
/// Güncelleyicinin kendi hizmeti (W1b: W-A ImagePath'i ve `onar` onu işaret eder).
pub const UPDATER: &str = "TeksERP-Guncelleyici";
/// Sabit test saati: 2026-09-30T23:30:00Z (İstanbul 02:30).
pub const T0: i64 = 1_790_811_000_000;
pub const HOUR: i64 = 3_600_000;
pub const DAY: i64 = 24 * HOUR;
/// Paketin imzalı künyesiyle bildirimin bağlandığı alanlar (sözleşme §1.5).
pub const PACKAGE_ID: &str = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
pub const BUILT_AT: &str = "2026-09-30T00:00:00Z";
pub const COMMIT: &str = "abcdef1234";
pub const TOKEN: &str = "belirtec.test.imza";

/// Enjekte edilen ölüm (panik yükü).
#[derive(Debug)]
pub struct Killed;

#[derive(Default)]
pub struct Crash {
    pub count: AtomicU64,
    pub at: AtomicU64,
    pub torn: AtomicBool,
    pub log: Mutex<Vec<String>>,
    /// Her noktada (ölümden önce) çağrılan gözlem; açılış kararını dünyayı değiştirmeden her noktada ölçmek için.
    pub probe: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    /// `enospc_at` (W3a): bu noktadan sonraki İLK yer isteyen yazımda disk dolar ve DOLU KALIR — yedek alan dosyası
    /// silinene (ya da test `free_disk` diyene) dek yer isteyen her yazım ENOSPC. 0 = kapalı.
    pub enospc_at: AtomicU64,
    enospc_fired: AtomicBool,
    pub disk_full: AtomicBool,
    /// Dolu diskte küçük yazımlar (≤ `SMALL_WRITE`) sığar — W1b onarımı: kopya megabaytlar, durum dosyası yüzlerce bayt.
    pub small_fits: AtomicBool,
    /// Yer isteyen noktaların numaraları: sayım koşusundan bekçinin dolaşacağı noktalar.
    pub space_points: Mutex<Vec<u64>>,
    /// Yedek alan dosyası sığmıyor (kalan yer ondan az), başka her yazım sığar — işlem başlatma kapısının sondası.
    pub reserve_blocked: AtomicBool,
    /// GÖZLEM: diske inen her `durum.json`un `durum`u (sırayla) — ara durumlar da ölçülsün (ör. geçici `HATA`).
    pub status_trail: Mutex<Vec<String>>,
}

/// `Crash::small_fits` sınırı.
pub const SMALL_WRITE: u64 = 4096;
/// Sahte dünyanın yedek alan boyu (gerçeği 64 MB; yüzlerce dünyada yazılmasın).
pub const TEST_RESERVE: u64 = 4096;

impl Crash {
    /// Değiştiren her çağrıdan ÖNCE: sayaç enjeksiyon noktasına gelince süreç "ölür". Noktanın numarasını döner.
    pub fn point(&self, what: &str) -> u64 {
        let n = self.count.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut l) = self.log.lock() {
            l.push(format!("{n}:{what}"));
        }
        if let Some(probe) = self.probe.lock().unwrap().as_ref() {
            probe();
        }
        if self.at.load(Ordering::SeqCst) == n {
            std::panic::panic_any(Killed);
        }
        n
    }
    /// `n`inci nokta `bytes` bayt yer ister: disk doluysa (ya da `enospc_at` burada tetiklenirse) ENOSPC.
    pub fn space(&self, n: u64, bytes: u64) -> std::io::Result<()> {
        self.space_points.lock().unwrap().push(n);
        let at = self.enospc_at.load(Ordering::SeqCst);
        if at != 0 && n >= at && !self.enospc_fired.swap(true, Ordering::SeqCst) {
            self.disk_full.store(true, Ordering::SeqCst);
        }
        if self.disk_full.load(Ordering::SeqCst) && !(self.small_fits.load(Ordering::SeqCst) && bytes <= SMALL_WRITE) {
            return Err(std::io::Error::from(std::io::ErrorKind::StorageFull));
        }
        Ok(())
    }
    pub fn arm_enospc(&self, at: u64) {
        self.count.store(0, Ordering::SeqCst);
        self.enospc_at.store(at, Ordering::SeqCst);
        self.enospc_fired.store(false, Ordering::SeqCst);
        self.disk_full.store(false, Ordering::SeqCst);
    }
    pub fn enospc_fired(&self) -> bool {
        self.enospc_fired.load(Ordering::SeqCst)
    }
    /// Disk şimdi dolar (`small_fits`: küçük yazımlar sığar).
    pub fn fill_disk(&self, small_fits: bool) {
        self.small_fits.store(small_fits, Ordering::SeqCst);
        self.disk_full.store(true, Ordering::SeqCst);
    }
    /// İnsan yer açtı.
    pub fn free_disk(&self) {
        self.disk_full.store(false, Ordering::SeqCst);
        self.small_fits.store(false, Ordering::SeqCst);
    }
    pub fn arm(&self, at: u64, torn: bool) {
        self.count.store(0, Ordering::SeqCst);
        self.at.store(at, Ordering::SeqCst);
        self.torn.store(torn, Ordering::SeqCst);
        self.log.lock().unwrap().clear();
    }
    pub fn disarm(&self) {
        self.arm(0, false);
    }
    pub fn hit(&self) -> bool {
        let at = self.at.load(Ordering::SeqCst);
        at != 0 && self.count.load(Ordering::SeqCst) >= at
    }
}

/// Gerçek dosya sistemi + enjeksiyon.
pub struct CrashFs {
    pub inner: RealFs,
    pub crash: Arc<Crash>,
    pub free: AtomicU64,
    /// Benzetilen bağlama noktaları (önek, aygıt, boş alan): en uzun önek kazanır; eşleşmeyen yol gerçek aygıtı ve
    /// `free`i görür. Aynı aygıt adını taşıyan önekler aynı boş alanı taşımalı.
    pub mounts: Mutex<Vec<(PathBuf, String, u64)>>,
    /// Yabancı yazara açık sayılan yollar (izin ölçümü testte BENZETİLİR: Windows CI'nın geçici
    /// dizin ACL'i ölçüme karışmasın; gerçek DACL ölçümünün kendi Windows testi var).
    pub foreign: Mutex<Vec<PathBuf>>,
    /// İzni ölçülemeyen yollar (ölçüm hatası).
    pub unmeasurable: Mutex<Vec<PathBuf>>,
    /// Kopya, doğrulama ile kopyalama arasında değişmiş gibi bir bayt fazla yazılır.
    pub corrupt_copy: AtomicBool,
    /// Başka süreçte açık sayılan adlar: silme/yeniden adlandırma "erişim engellendi" ile düşer (thinkpad-1 D8b 3I).
    pub locked: Mutex<Vec<String>>,
}

/// Güç kesintisi modeli (`Crash::torn`): gerçek `RealFs` her yazımı ve yeniden adlandırmayı (Unix'te üst dizin dahil)
/// diske boşaltır; kayıp penceresi ölüm anındaki TEK çağrının içidir. O çağrı bir kopya ya da atomik yazımsa geçici
/// dosyasında yarım/çöp bayt kalır (diske boşaltılmamış sayfa) ve hedef hiç değişmez.
fn torn_tmp(crash: &Crash, to: &Path, data: &[u8]) {
    let n = crash.count.load(Ordering::SeqCst) + 1;
    if crash.torn.load(Ordering::SeqCst) && crash.at.load(Ordering::SeqCst) == n {
        let mut tmp = to.file_name().map(|n| n.to_os_string()).unwrap_or_default();
        tmp.push(".tmp");
        let mut half = data[..data.len() / 2].to_vec();
        half.extend_from_slice(&[0u8; 16]);
        let _ = std::fs::write(to.with_file_name(tmp), half);
    }
}

impl CrashFs {
    fn mount(&self, p: &Path) -> Option<(String, u64)> {
        let m = self.mounts.lock().unwrap();
        m.iter().filter(|(pre, _, _)| p.starts_with(pre)).max_by_key(|(pre, _, _)| pre.as_os_str().len()).map(|(_, d, f)| (d.clone(), *f))
    }
    fn check_lock(&self, p: &Path) -> std::io::Result<()> {
        if self.locked.lock().unwrap().iter().any(|n| *n == name(p)) {
            return Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        }
        Ok(())
    }
}

impl Fs for CrashFs {
    fn read(&self, p: &Path) -> std::io::Result<Vec<u8>> {
        self.inner.read(p)
    }
    fn read_untrusted(&self, p: &Path, max: u64) -> std::io::Result<Vec<u8>> {
        self.inner.read_untrusted(p, max)
    }
    fn is_link(&self, p: &Path) -> bool {
        self.inner.is_link(p)
    }
    fn write_atomic(&self, p: &Path, data: &[u8]) -> std::io::Result<()> {
        torn_tmp(&self.crash, p, data);
        let n = self.crash.point(&format!("yaz {}", name(p)));
        self.crash.space(n, data.len() as u64)?;
        if self.crash.reserve_blocked.load(Ordering::SeqCst) && name(p) == tekserp_guncelleyici::reserve::FILE_NAME {
            return Err(std::io::Error::from(std::io::ErrorKind::StorageFull));
        }
        if name(p) == "durum.json" {
            let state = serde_json::from_slice::<Value>(data).ok().and_then(|v| v["durum"].as_str().map(str::to_string));
            self.crash.status_trail.lock().unwrap().push(state.unwrap_or_default());
        }
        self.inner.write_atomic(p, data)
    }
    fn append_sync(&self, p: &Path, line: &[u8]) -> std::io::Result<()> {
        let n = self.crash.count.load(Ordering::SeqCst) + 1;
        if self.crash.torn.load(Ordering::SeqCst) && self.crash.at.load(Ordering::SeqCst) == n {
            // Yırtık yazım: satırın yarısı diske iner, sonra süreç ölür.
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p)?;
            f.write_all(&line[..line.len() / 2])?;
        }
        let n = self.crash.point(&format!("ekle {}", name(p)));
        self.crash.space(n, line.len() as u64)?;
        self.inner.append_sync(p, line)
    }
    fn exists(&self, p: &Path) -> bool {
        self.inner.exists(p)
    }
    fn is_dir(&self, p: &Path) -> bool {
        self.inner.is_dir(p)
    }
    fn create_dir_all(&self, p: &Path) -> std::io::Result<()> {
        let n = self.crash.point(&format!("dizin {}", name(p)));
        if !self.inner.is_dir(p) {
            self.crash.space(n, 0)?;
        }
        self.inner.create_dir_all(p)
    }
    fn remove_file(&self, p: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("sil {}", name(p)));
        self.inner.remove_file(p)?;
        // Yedek alan bırakıldı: açılan yer (gerçekte 64 MB) günlüğe ve telafiye yeter.
        if name(p) == tekserp_guncelleyici::reserve::FILE_NAME {
            self.crash.disk_full.store(false, Ordering::SeqCst);
        }
        Ok(())
    }
    fn remove_dir_all(&self, p: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("dizinsil {}", name(p)));
        self.check_lock(p)?;
        self.inner.remove_dir_all(p)
    }
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        self.crash.point(&format!("adlandir {}→{}", name(from), name(to)));
        self.check_lock(from)?;
        self.inner.rename(from, to)
    }
    fn list(&self, p: &Path) -> std::io::Result<Vec<String>> {
        self.inner.list(p)
    }
    fn link_target(&self, link: &Path) -> std::io::Result<Option<PathBuf>> {
        self.inner.link_target(link)
    }
    fn set_link(&self, link: &Path, target: &Path) -> std::io::Result<()> {
        let n = self.crash.point(&format!("baglanti {}→{}", name(link), name(target)));
        self.crash.space(n, 0)?;
        self.inner.set_link(link, target)
    }
    fn free_space(&self, p: &Path) -> std::io::Result<u64> {
        Ok(self.mount(p).map_or_else(|| self.free.load(Ordering::SeqCst), |(_, f)| f))
    }
    fn volume_id(&self, p: &Path) -> std::io::Result<String> {
        match self.mount(p) {
            Some((d, _)) => Ok(d),
            None => self.inner.volume_id(p),
        }
    }
    fn foreign_writers(&self, p: &Path) -> std::io::Result<Vec<String>> {
        if self.unmeasurable.lock().unwrap().iter().any(|f| f == p) {
            return Err(std::io::Error::other("erişim reddedildi (test)"));
        }
        Ok(if self.foreign.lock().unwrap().iter().any(|f| f == p) { vec!["S-1-5-11 yazabilir (test)".into()] } else { vec![] })
    }
    fn file_len(&self, p: &Path) -> std::io::Result<u64> {
        self.inner.file_len(p)
    }
    fn open_read(&self, p: &Path) -> std::io::Result<Box<dyn ReadSeek>> {
        self.inner.open_read(p)
    }
    fn open_append(&self, p: &Path) -> std::io::Result<Box<dyn SyncWrite>> {
        let n = self.crash.point(&format!("acekle {}", name(p)));
        self.crash.space(n, u64::MAX)?;
        self.inner.open_append(p)
    }
    fn copy(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        torn_tmp(&self.crash, to, &std::fs::read(from).unwrap_or_default());
        let n = self.crash.point(&format!("kopyala {}", name(from)));
        self.crash.space(n, std::fs::metadata(from).map_or(u64::MAX, |m| m.len().max(SMALL_WRITE + 1)))?;
        self.inner.copy(from, to)?;
        if self.corrupt_copy.load(Ordering::SeqCst) {
            let mut b = std::fs::read(to)?;
            b.push(b' ');
            std::fs::write(to, b)?;
        }
        Ok(())
    }
    fn extract_zip(&self, archive: &Path, dest: &Path, limits: &ExtractLimits) -> Result<ExtractStats, String> {
        let n = self.crash.point(&format!("ac {}", name(archive)));
        self.crash.space(n, u64::MAX).map_err(|e| e.to_string())?;
        self.inner.extract_zip(archive, dest, limits)
    }
    fn extract_tar(&self, archive: &Path, dest: &Path, members: &[String], limits: &ExtractLimits) -> Result<ExtractStats, String> {
        let n = self.crash.point(&format!("ac {}", name(archive)));
        self.crash.space(n, u64::MAX).map_err(|e| e.to_string())?;
        self.inner.extract_tar(archive, dest, members, limits)
    }
}

pub fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// DB modeli: bitmiş/toplam göç satırı + "veri" (istemci yazısı sayacı).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Db {
    pub finished: u64,
    pub total: u64,
    pub data: u64,
}

#[derive(Default)]
pub struct Faults {
    /// Linux disk formülünün `pg_database_size` cevabı (bayt).
    pub db_bytes: AtomicU64,
    /// Bu sürüm çalışırken sağlık `status: DOWN`.
    pub unhealthy_version: Mutex<Option<String>>,
    /// Bu sürüm AÇILIŞTA düşer: ilk sağlık sondasında konak çıkış 10 ile durur (SCM kurtarması açıksa 5 sn sonra
    /// `current` ne gösteriyorsa onu yeniden başlatır).
    pub crash_on_start_version: Mutex<Option<String>>,
    /// SCM kurtarması: çökerek duran hizmet 5 sn sonra yeniden başlar (gerçek kayıt 5/5/30).
    pub scm_recovery: AtomicBool,
    /// Geri yükleme (DROP SCHEMA + pg_restore) saat ilerletir (8 sn) — kurtarmanın arada hizmeti açması ölçülür.
    pub slow_restore: AtomicBool,
    /// Her sürüm sağlıksız (geri dönüş de düşer → HATA).
    pub unhealthy_all: AtomicBool,
    /// Bu sürüm sözleşme 4 öncesi: `/health/yerel` → 404 (yalnız public `/health` var).
    pub legacy_health_version: Mutex<Option<String>>,
    /// Public `/health` (kurala aykırı) `lisans` da taşır — güncelleyici onu yine de KULLANMAMALI.
    pub public_health_has_license: AtomicBool,
    /// Bu sürüm çalışırken lisans bütünlüğü GEÇERSİZ.
    pub license_broken_version: Mutex<Option<String>>,
    /// Veritabanının SON bitmiş göçünün adı bu (paketin bilmediği, sayı aynı): şema hizası ad ölçer, sayı değil.
    pub foreign_migration: Mutex<Option<String>>,
    /// Bitmiş göç ADLARI sorgusu düşer (yalnız o; göç sayısı ve göç adımı çalışır): şema hizası ÖLÇÜLEMEDİ.
    pub finished_migrations_unreadable: AtomicBool,
    /// `migrate deploy` yarıda düşer (bir göç başlar, biter değil).
    pub migrate_fails: AtomicBool,
    /// ImagePath bu parçayı taşırken (ör. yeni PG dizini) sunucu yanlış sürüm bildirir.
    pub pg_wrong_for: Mutex<Option<String>>,
    /// ImagePath bu parçayı taşırken ICU yeniden dizinlemesi düşer.
    pub reindex_fail_for: Mutex<Option<String>>,
    /// Ağ yanıtı bu kadar bayttan sonra kesilir (0 = kesilmez).
    pub cut_after: AtomicU64,
    /// Paket yerine bozuk bayt sunulur.
    pub serve_tampered: AtomicBool,
    /// GÖZLEM: künyesi alınmak için koşturulan güncelleyici ikilileri (hangi kopya çalıştı).
    pub executed: Mutex<Vec<PathBuf>>,
    /// Linux profili (Docker): çöken konteyneri `unless-stopped` HEMEN yeniden başlatır (elle durdurulanı asla).
    pub docker: AtomicBool,
    /// Docker `RestartCount` (konteyner başına; `--force-recreate` sıfırlar).
    pub restarts: Mutex<HashMap<String, u64>>,
    /// Gerçek biçimli (PE başlıklı) fikstür ikilisinin `kunye` çıktısı, ikilinin sha256'sına göre; yoksa sahte ikili
    /// künyenin kendisidir (dosya içeriği).
    pub identities: Mutex<HashMap<String, String>>,
    /// Yöneticinin "Devre dışı" yaptığı hizmetler (W1b §4.7 madde 7).
    pub disabled_services: Mutex<Vec<String>>,
    /// Windows başlangıç türleri (W2 çiti); yoksa `OTOMATIK_GECIKMELI` (`hizmet-kur` gibi).
    pub start_modes: Mutex<HashMap<String, String>>,
    /// Başlangıç türü yazımı düşer (izin/SCM arızası) → `CIT_HATASI`.
    pub start_mode_write_fails: AtomicBool,
    /// Linux konteynerlerinin yeniden başlatma politikası (yoksa şablonun `unless-stopped`'ı).
    pub restart_policy: Mutex<Option<String>>,
    /// Docker'ın "elle durduruldu" bildiği konteynerler (`compose stop`; `up` siler) — açılışta başlatılmazlar.
    pub docker_stopped: Mutex<HashSet<String>>,
    /// `reboot_at`: sıradaki enjekte ölüm konak yeniden açılışıdır (`World::boot`).
    pub reboot: AtomicBool,
    /// Yeniden açılışların gözlemi (backend için).
    pub boots: Mutex<Vec<BootReport>>,
    /// Testin kurduğu işlem öncesi başlangıç türü (değişmez ölçer son durumda bunu bekler; yoksa `OTOMATIK_GECIKMELI`).
    pub backend_mode_before: Mutex<Option<String>>,
    /// Linux: sahte Docker imaj deposu (L4c-2).
    pub images: Mutex<Vec<FakeImage>>,
    /// `docker load` çağrı sayısı.
    pub image_loads: AtomicU64,
    /// `docker load` daemon hatasıyla düşer (hiçbir şey yüklenmez).
    pub load_fails: AtomicBool,
    /// `docker load` etiketli imajı bırakıp düşer (yarım yükleme artığı).
    pub load_partial: AtomicBool,
    /// Yüklenen imajın katmanları arşivdekinden sapar.
    pub load_wrong_layers: AtomicBool,
    /// `docker load` sürerken `current` bu dizine çevrilir (yükleme sırasında elle müdahale).
    pub load_repoints_current: Mutex<Option<PathBuf>>,
    /// GÖZLEM: güncelleme sunucusuna (CDN Worker) giden her isteğin yolu (W5 sorgu sayımı).
    pub update_requests: Mutex<Vec<String>>,
    /// Güncelleme sunucusu erişilemez (bağlantı hatası; istek yine sayılır).
    pub update_server_down: AtomicBool,
}

/// Açılışın bir hizmet için kararı (`WorldRefs::boot_plan`): gerçek açılış da her noktadaki önizleme de bunu uygular.
#[derive(Debug, Clone, PartialEq)]
pub struct BootStep {
    pub name: String,
    pub before: (SvcState, Vec<String>),
    pub version: Option<String>,
    pub starts: bool,
    pub mode: String,
    pub manual: bool,
}

/// Bir noktadaki açılış önizlemesi: kararlar + işlem günlüğünün satır sayısı (adım kimliği) + değişmez ihlali.
#[derive(Debug, Clone, PartialEq)]
pub struct BootPlan {
    pub open: bool,
    pub journal_lines: usize,
    pub current: Option<String>,
    pub steps: Vec<BootStep>,
    pub violation: Option<String>,
}

impl BootPlan {
    pub fn backend(&self, name: &str) -> &BootStep {
        self.steps.iter().find(|s| s.name == name).expect("backend hizmeti yok")
    }
}

/// Bir konak açılışının backend gözlemi (`World::boot`).
#[derive(Debug, Clone)]
pub struct BootReport {
    /// Açılış anında işlem günlüğünde yarım işlem vardı.
    pub open: bool,
    /// Açılıştan hemen önce backend: durum + başlatma argümanları.
    pub before: (SvcState, Vec<String>),
    /// Açılış backend'i başlattı (Windows: başlangıç türü; Linux: yeniden başlatma politikası).
    pub started: bool,
    /// Açılış anındaki başlangıç türü / politika.
    pub mode: String,
}

/// Sahte Docker deposunun bir imajı: yerel tutamaç (`.Id`), etiketler, `RootFS.Layers`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FakeImage {
    pub id: String,
    pub tags: Vec<String>,
    pub layers: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Svc {
    pub state: SvcState,
    pub args: Vec<String>,
    pub version: Option<String>,
    pub image: String,
    pub starts: u64,
    /// Çökerek durduysa konağın kodu (temiz durdurmada `None`).
    pub crash: Option<u32>,
    /// SCM kurtarmasının bekleyen yeniden başlatması (saat ms).
    pub restart_at: Option<i64>,
}

pub struct World {
    pub dir: PathBuf,
    pub layout: Layout,
    pub crash: Arc<Crash>,
    pub fs: Arc<CrashFs>,
    pub db: Arc<Mutex<Db>>,
    pub svcs: Arc<Mutex<HashMap<String, Svc>>>,
    pub faults: Arc<Faults>,
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub clock: Arc<AtomicI64>,
    pub events: Arc<Mutex<Vec<String>>>,
    pub backend_name: Arc<Mutex<String>>,
    pub keys: Keys,
    pub anchor: TrustAnchor,
    /// Kendi yerleşimi: `false` = Windows W-A (sürümlü ImagePath; varsayılan profil), `true` = Linux L-A (tek atomik
    /// yeniden adlandırma). Aynı kendini güncelleme/onarım testleri iki yerleşimde koşar.
    pub atomic_layout: AtomicBool,
}

/// Sahte Docker'ın adlı birimlerinin konak dizini (`docker volume inspect` `Mountpoint`): `<test>/docker-birim/<ad>/_data`.
pub fn docker_volume_dir(root: &Path, name: &str) -> PathBuf {
    root.parent().unwrap().join("docker-birim").join(name).join("_data")
}

/// `hizmet-kur`un kurduğu komut satırı biçimi (tırnaklı ikili + argümanlar).
pub fn updater_image(exe: &Path, root: &Path) -> String {
    format!("\"{}\" hizmet --kok \"{}\" --ad {UPDATER}", exe.display(), root.display())
}

pub struct Keys {
    pub root: SigningKey,
    pub alt: SigningKey,
    pub package: SigningKey,
    /// Emekli hazırlık PAKET anahtarı (`paket-hazirlik`) — çapada YOK; onunla imzalı paket reddedilmeli.
    pub legacy: SigningKey,
}

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

/// Sahte dünyanın anahtarları (sabit tohumlar) — dumanın fikstürü de aynılarını kullanır.
pub fn test_keys() -> Keys {
    Keys { root: key(1), alt: key(2), package: key(3), legacy: key(4) }
}

/// Test kökü + `paket-2026` PAKET anahtarı (emekli `paket-hazirlik` YOK).
pub fn test_anchor(k: &Keys) -> TrustAnchor {
    TrustAnchor {
        roots: vec![RootKey { kid: "kok-test-1".into(), x: x_of(&k.root), classes: vec!["URETIM".into(), "TEST".into()] }],
        package_keys: vec![("paket-2026".into(), x_of(&k.package))],
    }
}

pub fn x_of(k: &SigningKey) -> String {
    b64::encode(k.verifying_key().as_bytes())
}

pub fn sign(k: &SigningKey, typ: &str, kid: &str, payload: &Value) -> String {
    let h = b64::encode(json!({ "alg": "EdDSA", "typ": typ, "kid": kid }).to_string().as_bytes());
    let p = b64::encode(payload.to_string().as_bytes());
    let s = k.sign(format!("{h}.{p}").as_bytes());
    format!("{h}.{p}.{}", b64::encode(&s.to_bytes()))
}

pub fn sha_b64u(b: &[u8]) -> String {
    b64::encode(&Sha256::digest(b))
}

pub fn sha_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

pub fn iso(ms: i64) -> String {
    tekserp_hizmet::timefmt::iso_seconds(ms)
}

pub fn migrations_of(v: &str) -> u64 {
    match v {
        OLD => 2,
        NEW => 4,
        _ => 5,
    }
}

// ── Sahte hizmet/süreç/ağ/saat ────────────────────────────────────────────────────────────────

pub struct FakeServices {
    pub w: WorldRefs,
}

#[derive(Clone)]
pub struct WorldRefs {
    pub root: PathBuf,
    pub crash: Arc<Crash>,
    pub db: Arc<Mutex<Db>>,
    pub svcs: Arc<Mutex<HashMap<String, Svc>>>,
    pub faults: Arc<Faults>,
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub clock: Arc<AtomicI64>,
    pub events: Arc<Mutex<Vec<String>>>,
    /// Backend hizmetinin adı (varsayılan `TeksERP-Backend`; `ayar.json` `backendHizmeti` ile değişir).
    pub backend_name: Arc<Mutex<String>>,
}

impl WorldRefs {
    /// SCM kurtarması: zamanı gelen bekleyen yeniden başlatmayı uygular (sahte saatle).
    pub fn scm_tick(&self) {
        let now = self.clock.load(Ordering::SeqCst);
        let backend = self.backend_name.lock().unwrap().clone();
        let mut svcs = self.svcs.lock().unwrap();
        for (name, s) in svcs.iter_mut() {
            if s.state == SvcState::Stopped && s.restart_at.is_some_and(|t| now >= t) {
                s.state = SvcState::Running;
                s.crash = None;
                s.restart_at = None;
                s.starts += 1;
                if *name == backend {
                    s.version = current_version(&self.root);
                }
                if self.faults.docker.load(Ordering::SeqCst) {
                    *self.faults.restarts.lock().unwrap().entry(name.clone()).or_insert(0) += 1;
                }
                self.events.lock().unwrap().push(format!("scm-kurtarma {name} {:?}", s.version));
            }
        }
    }
}

impl WorldRefs {
    /// Konak açılışının kararı, dünyayı DEĞİŞTİRMEDEN: her hizmet durur; Windows'ta başlangıç türü otomatik olanı SCM,
    /// Linux'ta yeniden başlatma politikası izin vereni Docker başlatır (`unless-stopped`: elle durdurulan HARİÇ). Değişmez
    /// (A3): işlem açıkken açılış yalnız güncelleyicinin o an ÇALIŞTIRDIĞI backend'i AYNI kipte geri getirebilir.
    pub fn boot_plan(&self, journal: &Path) -> BootPlan {
        let open = Journal::open(&RealFs, journal).map(|j| j.unfinished().is_some()).unwrap_or(false);
        let journal_lines = std::fs::read_to_string(journal).map(|t| t.lines().count()).unwrap_or(0);
        let backend = self.backend_name.lock().unwrap().clone();
        let linux = self.faults.docker.load(Ordering::SeqCst);
        let policy = self.faults.restart_policy.lock().unwrap().clone().unwrap_or_else(|| "unless-stopped".into());
        let mut names: Vec<String> = self.svcs.lock().unwrap().keys().filter(|n| n.as_str() != UPDATER).cloned().collect();
        names.sort();
        let mut steps = vec![];
        let mut violation = None;
        for name in names {
            let mode = if linux { policy.clone() } else { self.start_mode_of(&name) };
            let manual = self.faults.docker_stopped.lock().unwrap().contains(&name);
            let svcs = self.svcs.lock().unwrap();
            let s = &svcs[&name];
            let before = (s.state, s.args.clone());
            let starts = if linux {
                match policy.as_str() {
                    "always" => true,
                    "unless-stopped" => !manual,
                    "on-failure" => s.restart_at.is_some(),
                    _ => false,
                }
            } else {
                matches!(mode.as_str(), start_mode::AUTO | start_mode::AUTO_DELAYED)
            };
            // Linux'ta Docker konteyneri argümanlarıyla geri getirir; Windows'ta SCM argümansız başlatır.
            let after_args = if starts && linux { before.1.clone() } else { vec![] };
            let restored = before.0 == SvcState::Running && before.1 == after_args;
            if name == backend && open && starts && !restored {
                violation = Some(format!("işlem açıkken açılış backend'i başlattı ({mode}; önce {before:?})"));
            }
            steps.push(BootStep { name, before, version: s.version.clone(), starts, mode, manual });
        }
        BootPlan { open, journal_lines, current: current_version(&self.root), steps, violation }
    }

    /// Sahte SCM'in başlangıç türü (Windows profili).
    pub fn start_mode_of(&self, name: &str) -> String {
        if !self.svcs.lock().unwrap().contains_key(name) {
            return start_mode::MISSING.into();
        }
        if self.faults.disabled_services.lock().unwrap().iter().any(|n| n == name) {
            return start_mode::DISABLED.into();
        }
        self.faults.start_modes.lock().unwrap().get(name).cloned().unwrap_or_else(|| start_mode::AUTO_DELAYED.into())
    }
}

fn current_version(root: &Path) -> Option<String> {
    RealFs.link_target(&root.join("current")).ok().flatten().and_then(|t| t.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// ImagePath → `pgsql<ayraç><surum>-<derleme>` → sunucu sürümü (`16.15`).
fn pg_version_of_image(image: &str) -> Option<String> {
    let norm = image.replace('\\', "/");
    let i = norm.find("pgsql/")? + 6;
    let tag = norm[i..].split('/').next()?;
    Some(tag.split('-').next()?.to_string())
}

impl Services for FakeServices {
    fn state(&self, name: &str) -> EnvResult<SvcState> {
        self.w.scm_tick();
        Ok(self.w.svcs.lock().unwrap().get(name).map_or(SvcState::Missing, |s| s.state))
    }
    fn crash_exit_code(&self, name: &str) -> EnvResult<Option<u32>> {
        self.w.scm_tick();
        Ok(self.w.svcs.lock().unwrap().get(name).filter(|s| s.state == SvcState::Stopped).and_then(|s| s.crash))
    }
    fn start(&self, name: &str, args: &[&str]) -> EnvResult<()> {
        self.w.crash.point(&format!("baslat {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let Some(s) = svcs.get_mut(name) else { return Err(EnvError(format!("{name} yok"))) };
        if s.state == SvcState::Running {
            return Ok(());
        }
        s.state = SvcState::Running;
        s.crash = None;
        s.restart_at = None;
        s.args = args.iter().map(|a| a.to_string()).collect();
        s.starts += 1;
        let is_backend = *self.w.backend_name.lock().unwrap() == name;
        s.version = if is_backend { current_version(&self.w.root) } else { pg_version_of_image(&s.image) };
        Ok(())
    }
    fn stop(&self, name: &str) -> EnvResult<()> {
        self.w.crash.point(&format!("durdur {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let Some(s) = svcs.get_mut(name) else { return Err(EnvError(format!("{name} yok"))) };
        if s.state != SvcState::Stopped {
            // Temiz durdurma: çıkış 0, kurtarma yok. (Zaten durmuş hizmete durdurma kurtarmayı İPTAL ETMEZ.)
            s.crash = None;
            s.restart_at = None;
        }
        s.state = SvcState::Stopped;
        s.args.clear();
        Ok(())
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        self.w.svcs.lock().unwrap().get(name).map(|s| s.image.clone()).ok_or_else(|| EnvError(format!("{name} yok")))
    }
    fn disabled(&self, name: &str) -> EnvResult<bool> {
        Ok(self.w.faults.disabled_services.lock().unwrap().iter().any(|n| n == name))
    }
    fn start_mode(&self, name: &str) -> EnvResult<String> {
        Ok(self.w.start_mode_of(name))
    }
    fn set_start_mode(&self, name: &str, mode: &str) -> EnvResult<()> {
        self.w.crash.point(&format!("tur {name}"));
        if self.w.faults.start_mode_write_fails.load(Ordering::SeqCst) {
            return Err(EnvError(format!("{name}: başlangıç türü yazılamadı: Erişim engellendi")));
        }
        if !self.w.svcs.lock().unwrap().contains_key(name) {
            return Err(EnvError(format!("{name} yok")));
        }
        let mut disabled = self.w.faults.disabled_services.lock().unwrap();
        disabled.retain(|n| n != name);
        if mode == start_mode::DISABLED {
            disabled.push(name.to_string());
        }
        self.w.faults.start_modes.lock().unwrap().insert(name.to_string(), mode.to_string());
        Ok(())
    }
    fn set_image_path(&self, name: &str, cl: &str) -> EnvResult<()> {
        self.w.crash.point(&format!("yol {name}"));
        let mut svcs = self.w.svcs.lock().unwrap();
        let s = svcs.get_mut(name).ok_or_else(|| EnvError(format!("{name} yok")))?;
        s.image = cl.to_string();
        Ok(())
    }
}

pub struct FakeProcs {
    pub w: WorldRefs,
}

fn arg_after(c: &Cmd, flag: &str) -> Option<PathBuf> {
    c.args.iter().position(|a| a == flag).and_then(|i| c.args.get(i + 1)).map(PathBuf::from)
}

fn ok_out(stdout: &str) -> CmdOut {
    CmdOut { code: Some(0), stdout: stdout.as_bytes().to_vec(), stderr: vec![], timed_out: false }
}

fn fail_out(code: i32, stderr: &str) -> CmdOut {
    CmdOut { code: Some(code), stdout: vec![], stderr: stderr.as_bytes().to_vec(), timed_out: false }
}

impl FakeProcs {
    /// Geri yükleme süresi (isteğe bağlı) + değişmez: DB geri yüklenirken backend ÇALIŞMAZ.
    fn restore_window(&self) {
        if self.w.faults.slow_restore.load(Ordering::SeqCst) {
            self.w.clock.fetch_add(8_000, Ordering::SeqCst);
        }
        self.w.scm_tick();
        let backend = self.w.backend_name.lock().unwrap().clone();
        if self.w.svcs.lock().unwrap().get(&backend).is_some_and(|s| s.state != SvcState::Stopped) {
            self.w.events.lock().unwrap().push("IHLAL: geri yükleme sırasında backend çalışıyor".into());
        }
    }
}

/// Sahte `docker` CLI (Linux profili): compose servisleri dünyanın hizmet tablosudur (`backend` → backend hizmeti,
/// `postgres` → PG); araç konteynerleri bağlı dizinleri konak yoluna çevirip aynı sahte araçları koşar (parola
/// compose ortamından gelir — `PGPASSWORD` argümanda değil).
impl FakeProcs {
    fn svc_name(&self, svc: &str) -> String {
        match svc {
            "backend" => self.w.backend_name.lock().unwrap().clone(),
            "postgres" => PG.to_string(),
            other => other.to_string(),
        }
    }

    fn docker(&self, c: &Cmd, args: &[String]) -> CmdOut {
        let fake = FakeServices { w: self.w.clone() };
        let sub: Vec<String> = if let Some((files, i)) = tekserp_guncelleyici::platform::linux::duzen::compose_basi_coz(args) {
            assert_eq!(args.get(3).map(String::as_str), Some("--project-directory"), "compose başı: {args:?}");
            let f = PathBuf::from(files.first().copied().unwrap_or_else(|| panic!("compose başında -f yok: {args:?}")));
            // `config` hazırlıkta paketin kendi dosyasını denetler; geri kalan her çağrı `current`ten.
            if args.get(i).map(String::as_str) == Some("config") {
                return compose_config(&f);
            }
            assert!(f.ends_with("current/docker-compose.yml"), "compose dosyası current'ten: {f:?}");
            args[i..].to_vec()
        } else {
            args.to_vec()
        };
        let s: Vec<&str> = sub.iter().map(String::as_str).collect();
        match s.as_slice() {
            ["rm", "-f", _] => ok_out(""),
            ["info", ..] => ok_out(&format!("{}\n", self.w.root.display())),
            ["volume", "inspect", "--format", fmt, name] if *fmt == tekserp_guncelleyici::platform::linux::docker::BIRIM_YOLU_FORMAT => {
                let d = docker_volume_dir(&self.w.root, name);
                if d.is_dir() {
                    ok_out(&format!("{}\n", d.display()))
                } else {
                    fail_out(1, &format!("Error response from daemon: get {name}: no such volume"))
                }
            }
            ["load", "-i", path] => self.docker_load(Path::new(path)),
            ["image", "inspect", "--format", fmt, r] => {
                let images = self.w.faults.images.lock().unwrap();
                let Some(i) = images.iter().find(|i| i.id == *r || i.tags.iter().any(|t| t == r)) else {
                    return fail_out(1, &format!("Error response from daemon: No such image: {r}"));
                };
                match *fmt {
                    imaj::INSPECT_FORMAT => ok_out(&format!("{}|{}\n", i.id, serde_json::to_string(&i.layers).unwrap())),
                    "{{json .RepoTags}}" => ok_out(&format!("{}\n", serde_json::to_string(&i.tags).unwrap())),
                    other => fail_out(125, &format!("sahte docker: bilinmeyen biçim {other:?}")),
                }
            }
            ["image", "rm", r] => {
                let mut images = self.w.faults.images.lock().unwrap();
                let Some(n) = images.iter().position(|i| i.id == *r || i.tags.iter().any(|t| t == r)) else {
                    return fail_out(1, &format!("Error response from daemon: No such image: {r}"));
                };
                images[n].tags.retain(|t| t != r);
                if images[n].id == *r || images[n].tags.is_empty() {
                    images.remove(n);
                }
                ok_out("")
            }
            ["image", "ls", "-a", "-q", "--no-trunc"] => {
                ok_out(&self.w.faults.images.lock().unwrap().iter().map(|i| format!("{}\n", i.id)).collect::<String>())
            }
            ["image", "ls", "--format", "{{.Tag}}", repo] => {
                let pre = format!("{repo}:");
                let images = self.w.faults.images.lock().unwrap();
                let tags = images.iter().flat_map(|i| i.tags.iter()).filter_map(|t| t.strip_prefix(&pre));
                ok_out(&tags.map(|t| format!("{t}\n")).collect::<String>())
            }
            ["ps", "-a", "-q", svc] => {
                let name = self.svc_name(svc);
                let known = self.w.svcs.lock().unwrap().contains_key(&name);
                ok_out(&if known { format!("id-{svc}\n") } else { String::new() })
            }
            ["inspect", "--format", f, id] if *f == tekserp_guncelleyici::platform::linux::docker::RESTART_POLICY_FORMAT => {
                if !self.w.svcs.lock().unwrap().contains_key(&self.svc_name(id.trim_start_matches("id-"))) {
                    return fail_out(1, "No such object");
                }
                let policy = self.w.faults.restart_policy.lock().unwrap().clone();
                ok_out(&format!("{}\n", policy.as_deref().unwrap_or("unless-stopped")))
            }
            ["inspect", "--format", _, id] => {
                self.w.scm_tick();
                let name = self.svc_name(id.trim_start_matches("id-"));
                let svcs = self.w.svcs.lock().unwrap();
                let Some(x) = svcs.get(&name) else { return fail_out(1, "No such object") };
                let n = self.w.faults.restarts.lock().unwrap().get(&name).copied().unwrap_or(0);
                let line = match (x.state, x.restart_at, x.crash) {
                    (SvcState::Running, _, _) => format!("running|0|{n}|"),
                    (SvcState::Stopped, Some(_), code) => format!("restarting|{}|{n}|", code.unwrap_or(1)),
                    (SvcState::Stopped, None, code) => format!("exited|{}|{n}|", code.unwrap_or(0)),
                    (other, _, _) => format!("{other:?}|0|{n}|").to_lowercase(),
                };
                ok_out(&format!("{line}\n"))
            }
            ["up", "-d", "--no-deps", "--force-recreate", svc] => {
                let name = self.svc_name(svc);
                let verify = c.env.iter().any(|(k, v)| k == "TEKSERP_DOGRULAMA_KIPI" && v == "1");
                let a: &[&str] = if verify { &[tekserp_hizmet::contract::VERIFY_ARG] } else { &[] };
                // `--force-recreate`: çalışan konteyner de yeniden yaratılır.
                let _ = fake.stop(&name);
                self.w.faults.restarts.lock().unwrap().insert(name.clone(), 0);
                match fake.start(&name, a) {
                    Ok(()) => {
                        self.w.faults.docker_stopped.lock().unwrap().remove(&name);
                        ok_out("")
                    }
                    Err(e) => fail_out(1, &e.0),
                }
            }
            ["stop", "-t", _, svc] => {
                // Docker: elle durdurma `restarting` konteynerin bekleyen yeniden başlatmasını da İPTAL EDER (SCM'den farkı).
                let name = self.svc_name(svc);
                if let Some(x) = self.w.svcs.lock().unwrap().get_mut(&name) {
                    x.restart_at = None;
                }
                match fake.stop(&name) {
                    Ok(()) => {
                        self.w.faults.docker_stopped.lock().unwrap().insert(name);
                        ok_out("")
                    }
                    Err(e) => fail_out(1, &e.0),
                }
            }
            ["exec", "-T", "backend", "node", "-e", script] => {
                let path = script
                    .split("127.0.0.1:")
                    .nth(1)
                    .and_then(|r| r.split_once('/'))
                    .map(|(_, p)| p.split('\'').next().unwrap_or_default());
                let net = FakeNet { w: self.w.clone() };
                match net.get(&format!("http://127.0.0.1:4999/{}", path.unwrap_or_default()), &[], Duration::from_secs(5)) {
                    Ok(mut r) => {
                        let mut body = String::new();
                        let _ = std::io::Read::read_to_string(&mut r.body, &mut body);
                        ok_out(&format!("{}\n{body}", r.status))
                    }
                    Err(_) => fail_out(3, ""),
                }
            }
            ["run", "--rm", "--no-deps", "-T", "--name", _, rest @ ..] => self.tool_container(rest),
            _ => fail_out(125, &format!("sahte docker: bilinmeyen {sub:?}")),
        }
    }

    /// `migrate deploy`: DB `n` göçe çıkar (ya da enjekte göç hatası).
    fn migrate(&self, n: u64) -> CmdOut {
        let mut d = self.w.db.lock().unwrap();
        if self.w.faults.migrate_fails.load(Ordering::SeqCst) {
            d.finished += 1;
            d.total = d.finished + 1;
            return fail_out(1, "Error: P3018 migration failed postgresql://tekserp:gizli-parola@127.0.0.1:5432/db");
        }
        d.finished = n;
        d.total = n;
        ok_out("All migrations have been successfully applied.")
    }

    fn tool_container(&self, rest: &[&str]) -> CmdOut {
        let mut i = 0;
        let mut mounts: Vec<(String, String)> = Vec::new();
        while i < rest.len() {
            match rest[i] {
                "--user" => i += 2,
                "-v" => {
                    let mut it = rest[i + 1].rsplitn(3, ':');
                    let _mode = it.next();
                    let cont = it.next().unwrap().to_string();
                    mounts.push((cont, it.next().unwrap().to_string()));
                    i += 2;
                }
                _ => break,
            }
        }
        let (svc, cmd) = (rest[i], &rest[i + 1..]);
        let host = |a: &str| {
            mounts.iter().find_map(|(c, h)| a.strip_prefix(c.as_str()).map(|r| format!("{h}{r}"))).unwrap_or_else(|| a.to_string())
        };
        if svc == "backend" && cmd == ["goc"] {
            // Göçler imajın içinde: sürümün göç sayısı (paket dizininde `prisma/` yok — OCI teslim paketi).
            let cur = RealFs.link_target(&self.w.root.join("current")).unwrap().unwrap();
            let v = cur.file_name().unwrap().to_string_lossy().into_owned();
            return self.migrate(migrations_of(&v));
        }
        assert_eq!(svc, "yedek", "araç servisi");
        if cmd.first() == Some(&"ls") {
            return ok_out("");
        }
        let c = Cmd::new(Path::new(cmd[0])).args(cmd[1..].iter().map(|a| host(a))).env("PGPASSWORD", "gizli-parola");
        self.run(&c).unwrap()
    }
}

/// Sahte `compose config --format json`: fikstürün compose dosyası JSON'dur (YAML'ın alt kümesi), normalleştirilmiş
/// çıktı olduğu gibi döner; çözülemeyen dosya compose'un kendi hatasıyla düşer.
fn compose_config(f: &Path) -> CmdOut {
    match std::fs::read(f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) {
        Some(v) => ok_out(&v.to_string()),
        None => fail_out(15, "yaml: line 1: did not find expected key"),
    }
}

impl FakeProcs {
    /// Sahte `docker load`: arşivi ölçer (gerçek Docker gibi config + RepoTags), etiketi yeni imaja taşır.
    fn docker_load(&self, path: &Path) -> CmdOut {
        let f = &self.w.faults;
        f.image_loads.fetch_add(1, Ordering::SeqCst);
        if f.load_fails.load(Ordering::SeqCst) {
            return fail_out(1, "Error response from daemon: error processing tar file: unexpected EOF");
        }
        let Ok(m) = std::fs::read(path).map_err(|e| e.to_string()).and_then(|b| imaj::olc_okuyucu(Cursor::new(b))) else {
            return fail_out(1, "Error: archive/tar: invalid tar header");
        };
        let mut layers = m.katmanlar.clone();
        if let Some(to) = f.load_repoints_current.lock().unwrap().as_ref() {
            RealFs.set_link(&self.w.root.join("current"), to).unwrap();
        }
        if f.load_wrong_layers.load(Ordering::SeqCst) {
            layers.push(format!("sha256:{}", "f".repeat(64)));
        }
        let id = docker_handle(&m.kimlik);
        let mut images = f.images.lock().unwrap();
        for i in images.iter_mut() {
            i.tags.retain(|t| !m.etiketler.contains(t));
        }
        images.retain(|i| i.id != id);
        images.push(FakeImage { id, tags: m.etiketler.clone(), layers });
        if f.load_partial.load(Ordering::SeqCst) {
            return fail_out(1, "Error: unexpected EOF");
        }
        ok_out(&m.etiketler.iter().map(|t| format!("Loaded image: {t}\n")).collect::<String>())
    }
}

/// Yer isteyen araç: döküm, geri yükleme, şifreleme, göç, DB'yi yeniden yazan SQL ve imaj yükleme (Docker deposu).
fn writes_disk(prog: &str, args: &[String]) -> bool {
    match prog {
        "pg_dump" | "node" => true,
        "docker" => args.first().is_some_and(|a| a == "load"),
        "pg_restore" => !args.iter().any(|a| a == "--list"),
        "psql" => args.last().is_some_and(|sql| sql.contains("DROP SCHEMA") || sql.contains("REINDEX")),
        _ => false,
    }
}

/// `docker [compose <baş>] <alt komut>` salt-okur mu (durum/kök/etiket sorgusu).
fn docker_salt_okur(args: &[String]) -> bool {
    let sub = match tekserp_guncelleyici::platform::linux::duzen::compose_basi_coz(args) {
        Some((_, i)) => args.get(i..),
        None => args.get(..),
    };
    matches!(
        sub.unwrap_or_default().iter().map(String::as_str).collect::<Vec<_>>().as_slice(),
        ["ps" | "inspect" | "info" | "config", ..] | ["image", "ls" | "inspect", ..] | ["volume", "inspect", ..]
    )
}

impl Procs for FakeProcs {
    fn run(&self, c: &Cmd) -> EnvResult<CmdOut> {
        let prog = c.program_name();
        let args: Vec<String> = c.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        // Docker'ın salt-okur sorguları (`ps`/`inspect`/`info`/`image ls`) Windows profilindeki `state()` gibi
        // öldürme noktası DEĞİLDİR: K1 her DEĞİŞTİREN işlemden önce öldürür; yoklama noktaları yalnız süre katlar.
        if !(prog == "docker" && docker_salt_okur(&args)) {
            let n = self.w.crash.point(&format!("surec {prog} {}", args.first().cloned().unwrap_or_default()));
            // Diske (DB dahil — aynı dosya sistemi) yazan araçlar disk doluyken düşer.
            if writes_disk(&prog, &args) && self.w.crash.space(n, u64::MAX).is_err() {
                if prog == "docker" {
                    return Ok(fail_out(
                        1,
                        "Error response from daemon: write /var/lib/docker/tmp/docker-import-1: no space left on device",
                    ));
                }
                return Ok(fail_out(1, &format!("{prog}: could not write: No space left on device")));
            }
        }
        let pw_ok = c.env.iter().any(|(k, v)| k == "PGPASSWORD" && v == "gizli-parola");
        match prog.as_str() {
            "psql" => {
                if !pw_ok {
                    return Ok(fail_out(2, "psql: error: password authentication failed"));
                }
                let pg_running = self.w.svcs.lock().unwrap().get(PG).is_some_and(|s| s.state == SvcState::Running);
                if !pg_running {
                    return Ok(fail_out(2, "psql: error: connection refused"));
                }
                let sql = args.last().cloned().unwrap_or_default();
                if sql == tekserp_guncelleyici::sema::FINISHED_MIGRATIONS_SQL
                    && self.w.faults.finished_migrations_unreadable.load(Ordering::SeqCst)
                {
                    return Ok(fail_out(1, "ERROR:  permission denied for table _prisma_migrations"));
                }
                if sql == tekserp_guncelleyici::sema::FINISHED_MIGRATIONS_SQL {
                    // Bitmiş göç adları: paketin adlandırmasıyla (`{i:04}_goc`); yabancı göç SON adın yerine geçer.
                    let d = self.w.db.lock().unwrap();
                    let mut names: Vec<String> = (1..=d.finished).map(|i| format!("{i:04}_goc")).collect();
                    if let (Some(last), Some(foreign)) = (names.last_mut(), self.w.faults.foreign_migration.lock().unwrap().clone()) {
                        *last = foreign;
                    }
                    return Ok(ok_out(&names.iter().map(|n| format!("{n}\n")).collect::<String>()));
                }
                if sql.contains("_prisma_migrations") {
                    let d = self.w.db.lock().unwrap();
                    return Ok(ok_out(&format!("{} {}\n", d.finished, d.total)));
                }
                if sql == tekserp_guncelleyici::package::DB_BOYU_SQL {
                    return Ok(ok_out(&format!("{}\n", self.w.faults.db_bytes.load(Ordering::SeqCst))));
                }
                if sql.contains("SHOW server_version") {
                    let svcs = self.w.svcs.lock().unwrap();
                    let pg = svcs.get(PG).cloned();
                    let v = pg.as_ref().and_then(|s| s.version.clone()).unwrap_or_default();
                    let wrong = self.w.faults.pg_wrong_for.lock().unwrap().clone();
                    let v = if wrong.is_some_and(|t| pg.is_some_and(|p| p.image.contains(&t))) { "99.9".to_string() } else { v };
                    return Ok(ok_out(&format!("{v} (fake)\n")));
                }
                if sql.contains("DROP SCHEMA") {
                    self.restore_window();
                    *self.w.db.lock().unwrap() = Db { finished: 0, total: 0, data: 0 };
                    return Ok(ok_out("CREATE SCHEMA\n"));
                }
                if sql.contains("REINDEX") {
                    let image = self.w.svcs.lock().unwrap().get(PG).map(|p| p.image.clone()).unwrap_or_default();
                    if self.w.faults.reindex_fail_for.lock().unwrap().as_ref().is_some_and(|t| image.contains(t.as_str())) {
                        return Ok(fail_out(1, "psql: ERROR: could not create unique index"));
                    }
                    self.w.events.lock().unwrap().push("reindex".into());
                    return Ok(ok_out("DO\n"));
                }
                Ok(fail_out(1, "bilinmeyen sql"))
            }
            "pg_dump" => {
                if !pw_ok {
                    return Ok(fail_out(1, "auth"));
                }
                let out = arg_after(c, "-f").expect("-f");
                let d = self.w.db.lock().unwrap().clone();
                std::fs::write(&out, serde_json::to_vec(&d).unwrap()).unwrap();
                Ok(ok_out(""))
            }
            "pg_restore" => {
                let file = PathBuf::from(args.last().cloned().unwrap_or_default());
                let Ok(bytes) = std::fs::read(&file) else { return Ok(fail_out(1, "pg_restore: error: dosya yok")) };
                let Ok(d) = serde_json::from_slice::<Db>(&bytes) else { return Ok(fail_out(1, "pg_restore: error: arşiv değil")) };
                if args.iter().any(|a| a == "--list") {
                    return Ok(ok_out(";\n; Archive created\n"));
                }
                self.restore_window();
                *self.w.db.lock().unwrap() = d;
                Ok(ok_out(""))
            }
            "postgres" => {
                let marker = c.program.parent().unwrap().join("SURUM");
                let v = std::fs::read_to_string(marker).unwrap_or_default();
                Ok(ok_out(&format!("postgres (PostgreSQL) {}\n", v.trim())))
            }
            "node" => {
                let script = args.first().cloned().unwrap_or_default();
                if script.ends_with("yedek-sifrele.cjs") {
                    return Ok(match args.get(1).map(String::as_str) {
                        Some("anahtar-uret") => {
                            let dir = arg_after(c, "--dizin").expect("--dizin");
                            let private = arg_after(c, "--ozel-cikti").expect("--ozel-cikti");
                            std::fs::write(dir.join("guncelleme.tkpub"), "tkpub1:PUB\n").unwrap();
                            std::fs::write(private, "tksec1:SECRET\n").unwrap();
                            ok_out("")
                        }
                        Some("sifrele") => {
                            let input = std::fs::read(arg_after(c, "--girdi").unwrap()).unwrap();
                            let recipients = args.iter().filter(|a| *a == "--alici").count();
                            let mut enc = format!("ENC{recipients}:").into_bytes();
                            enc.extend(input);
                            std::fs::write(arg_after(c, "--cikti").unwrap(), enc).unwrap();
                            ok_out("")
                        }
                        Some("coz") => {
                            let k = std::fs::read_to_string(arg_after(c, "--anahtar").unwrap()).unwrap_or_default();
                            if !k.starts_with("tksec1:SECRET") {
                                return Ok(fail_out(2, "yanlis anahtar"));
                            }
                            let enc = std::fs::read(arg_after(c, "--girdi").unwrap()).unwrap();
                            let at = enc.iter().position(|b| *b == b':').unwrap() + 1;
                            std::fs::write(arg_after(c, "--cikti").unwrap(), &enc[at..]).unwrap();
                            ok_out("")
                        }
                        _ => fail_out(1, "kullanim"),
                    });
                }
                if script.ends_with("index.js") && args.get(1).map(String::as_str) == Some("migrate") {
                    let cwd = c.cwd.clone().expect("cwd");
                    let n = std::fs::read_dir(cwd.join("prisma").join("migrations")).map(|r| r.count() as u64).unwrap_or(0);
                    return Ok(self.migrate(n));
                }
                Ok(fail_out(1, "bilinmeyen betik"))
            }
            "docker" => Ok(self.docker(c, &args)),
            p if p.starts_with("tekserp-guncelleyici") => {
                self.w.faults.executed.lock().unwrap().push(c.program.clone());
                let bytes = std::fs::read(&c.program).unwrap_or_default();
                let known = self.w.faults.identities.lock().unwrap().get(&sha_hex(&bytes)).cloned();
                Ok(ok_out(&known.unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned())))
            }
            other => Ok(fail_out(127, &format!("bilinmeyen program {other}"))),
        }
    }
}

pub struct FakeNet {
    pub w: WorldRefs,
}

fn resp(status: u16, headers: Vec<(String, String)>, body: Vec<u8>) -> HttpResponse {
    HttpResponse { status, headers, body: Box::new(Cursor::new(body)) }
}

/// Belirli bayttan sonra kesilen akış (bağlantı koptu).
struct CutReader {
    inner: Cursor<Vec<u8>>,
    left: u64,
}

impl Read for CutReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::ConnectionReset, "bağlantı koptu"));
        }
        let n = buf.len().min(self.left as usize);
        let got = self.inner.read(&mut buf[..n])?;
        self.left -= got as u64;
        Ok(got)
    }
}

impl Net for FakeNet {
    fn get(&self, url: &str, headers: &[(String, String)], _timeout: Duration) -> EnvResult<HttpResponse> {
        // Backend'in iki sağlık ucu (D7, `app.ts`): `/health/yerel` yalnız döngüye, lisanslı; `/health` public,
        // DONMUŞ alan kümesi (lisans YOK).
        let health =
            url.strip_prefix("http://127.0.0.1:").and_then(|r| r.split_once('/')).filter(|(_, p)| matches!(*p, "health" | "health/yerel"));
        if let Some((port, path)) = health {
            assert_eq!(port, "4999");
            self.w.scm_tick();
            let backend = self.w.backend_name.lock().unwrap().clone();
            {
                let mut svcs = self.w.svcs.lock().unwrap();
                let crash_v = self.w.faults.crash_on_start_version.lock().unwrap().clone();
                if let Some(b) =
                    svcs.get_mut(&backend).filter(|s| s.state == SvcState::Running && s.version.is_some() && s.version == crash_v)
                {
                    b.state = SvcState::Stopped;
                    b.crash = Some(10);
                    b.args.clear();
                    if self.w.faults.docker.load(Ordering::SeqCst) {
                        // `unless-stopped`: 100 ms'den başlayan aralıkla hemen yeniden başlatır.
                        b.restart_at = Some(self.w.clock.load(Ordering::SeqCst) + 100);
                    } else if self.w.faults.scm_recovery.load(Ordering::SeqCst) {
                        b.restart_at = Some(self.w.clock.load(Ordering::SeqCst) + 5_000);
                    }
                    return Err(EnvError("bağlantı reddedildi (açılışta düştü)".into()));
                }
            }
            let svcs = self.w.svcs.lock().unwrap();
            let Some(b) = svcs.get(&backend).filter(|s| s.state == SvcState::Running) else {
                return Err(EnvError("bağlantı reddedildi".into()));
            };
            let v = b.version.clone().unwrap_or_default();
            let down = self.w.faults.unhealthy_version.lock().unwrap().as_deref() == Some(v.as_str())
                || self.w.faults.unhealthy_all.load(Ordering::SeqCst);
            let broken = self.w.faults.license_broken_version.lock().unwrap().as_deref() == Some(v.as_str());
            let legacy = self.w.faults.legacy_health_version.lock().unwrap().as_deref() == Some(v.as_str());
            let status = if down { "DOWN" } else { "UP" };
            let lisans = json!({ "kip": "NORMAL", "butunluk": if broken { "GECERSIZ" } else { "GECERLI" }, "cekirdek": "native" });
            let body = if path == "health/yerel" {
                if legacy {
                    let m = json!({ "success": false, "message": "Endpoint bulunamadı: GET /health/yerel" });
                    return Ok(resp(404, vec![], m.to_string().into_bytes()));
                }
                json!({ "status": status, "db": "UP", "version": v, "time": "2026-10-01T00:00:00.000Z", "lisans": lisans })
            } else {
                let mut b = json!({
                    "status": status, "message": "TeksERP API is running.", "api": "UP", "db": "UP", "version": v,
                    "time": "2026-10-01T00:00:00.000Z",
                });
                if self.w.faults.public_health_has_license.load(Ordering::SeqCst) {
                    b["lisans"] = lisans;
                }
                b
            };
            return Ok(resp(200, vec![], body.to_string().into_bytes()));
        }
        self.w.crash.point(&format!("ag {url}"));
        let path = url.strip_prefix("https://guncelleme.test").ok_or_else(|| EnvError(format!("bilinmeyen sunucu {url}")))?;
        self.w.faults.update_requests.lock().unwrap().push(path.to_string());
        if self.w.faults.update_server_down.load(Ordering::SeqCst) {
            return Err(EnvError("bağlantı kurulamadı (sunucu erişilemez)".into()));
        }
        let token = headers.iter().find(|(k, _)| k == "X-TKL-Indirme").map(|(_, v)| v.clone());
        if token.as_deref() != Some("belirtec.test.imza") {
            return Ok(resp(403, vec![("X-TKL-Kod".into(), "INDIRME_BELIRTEC_YOK".into())], vec![]));
        }
        let Some(mut body) = self.w.files.lock().unwrap().get(path).cloned() else {
            return Ok(resp(404, vec![], vec![]));
        };
        if self.w.faults.serve_tampered.load(Ordering::SeqCst) && (path.ends_with(".zip") || path.ends_with(".tar")) {
            let n = body.len();
            body[n / 2] ^= 0xff;
        }
        let total = body.len() as u64;
        let from = headers
            .iter()
            .find(|(k, _)| k == "Range")
            .and_then(|(_, v)| v.strip_prefix("bytes="))
            .and_then(|r| r.trim_end_matches('-').parse::<u64>().ok())
            .unwrap_or(0);
        let (status, part, mut hs) = if from > 0 {
            (206, body[from as usize..].to_vec(), vec![("Content-Range".to_string(), format!("bytes {from}-{}/{total}", total - 1))])
        } else {
            (200, body, vec![])
        };
        hs.push(("Content-Length".into(), part.len().to_string()));
        let cut = if path.ends_with(".zip") { self.w.faults.cut_after.swap(0, Ordering::SeqCst) } else { 0 };
        if cut > 0 {
            return Ok(HttpResponse { status, headers: hs, body: Box::new(CutReader { inner: Cursor::new(part), left: cut }) });
        }
        Ok(resp(status, hs, part))
    }
}

pub struct FakeClock(pub Arc<AtomicI64>);
impl Clock for FakeClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
    fn sleep(&self, d: Duration) {
        self.0.fetch_add(i64::try_from(d.as_millis()).unwrap(), Ordering::SeqCst);
    }
}

pub struct FakeEvents(pub Arc<Mutex<Vec<String>>>);
impl Events for FakeEvents {
    fn event(&self, level: Level, message: &str) {
        self.0.lock().unwrap().push(format!("{}: {message}", level.label()));
    }
}

pub struct FakeProtect;
impl Protect for FakeProtect {
    fn protect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        let mut v = b"DPAPI:".to_vec();
        v.extend_from_slice(data);
        Ok(v)
    }
    fn unprotect(&self, data: &[u8]) -> EnvResult<Vec<u8>> {
        data.strip_prefix(b"DPAPI:").map(<[u8]>::to_vec).ok_or_else(|| EnvError("DPAPI: bozuk".into()))
    }
}

// ── Paket ve belgeler ─────────────────────────────────────────────────────────────────────────

/// Sürüm dizininin dosyaları (göreli yol → içerik).
pub fn version_files(v: &str) -> Vec<(String, Vec<u8>)> {
    let mut out: Vec<(String, Vec<u8>)> = vec![
        ("package.json".into(), json!({ "name": "tekserp", "version": v }).to_string().into_bytes()),
        ("PAKET.json".into(), json!({ "commit": "abcdef1234" }).to_string().into_bytes()),
        ("dist/server.js".into(), format!("// sunucu {v}").into_bytes()),
        // Sıkışmayan 96 KB: indirme parçalı gelsin (kesilme/devam ölçümü).
        ("dist/buyuk.bin".into(), (0..96 * 1024u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect()),
        ("dist/tools/yedek-sifrele.cjs".into(), b"// yedek araci".to_vec()),
        ("runtime/node".into(), b"#!fake node".to_vec()),
        ("node_modules/prisma/build/index.js".into(), b"// prisma".to_vec()),
    ];
    for i in 1..=migrations_of(v) {
        out.push((format!("prisma/migrations/{i:04}_goc/migration.sql"), format!("-- {i}").into_bytes()));
    }
    out
}

/// Bütünlük listesi + PAKET imzalı `butunluk.jws` (kapsam: dist · runtime · node_modules · prisma/migrations · package.json).
pub fn integrity_files(
    files: &[(String, Vec<u8>)],
    v: &str,
    signer: &SigningKey,
    kid: &str,
    customer: Option<&str>,
) -> Vec<(String, Vec<u8>)> {
    let mut scoped: Vec<&(String, Vec<u8>)> = files
        .iter()
        .filter(|(p, _)| {
            ["dist/", "runtime/", "node_modules/", "prisma/migrations/"].iter().any(|d| p.starts_with(d)) || p == "package.json"
        })
        .collect();
    scoped.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut list = String::new();
    for (p, c) in &scoped {
        list.push_str(&format!("{}\t{}\t{}\n", sha_b64u(c), c.len(), p));
    }
    let payload = json!({
        "v": 1,
        "paketId": PACKAGE_ID,
        "urun": "backend",
        "surum": v,
        "derlemeTarihi": BUILT_AT,
        "musteri": customer,
        "liste": { "sha256": sha_b64u(list.as_bytes()), "boyut": list.len(), "dosyaSayisi": scoped.len() },
        "kapsam": { "dizinler": ["dist", "node_modules", "prisma/migrations", "runtime"], "dosyalar": ["package.json"] },
    });
    vec![
        ("butunluk-liste.txt".into(), list.into_bytes()),
        ("butunluk.jws".into(), sign(signer, "tekserp-butunluk", kid, &payload).into_bytes()),
    ]
}

pub fn zip_of(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (p, c) in files {
            z.start_file(p.as_str(), opts).unwrap();
            z.write_all(c).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

// ── Linux/OCI teslim paketi (L4c-1; biçim `Teks-Erp/scripts/lib/oci-paket.ts`) ─────────────────────

/// Test ustar başlığı — okuyucudan BAĞIMSIZ yazıcı (GNU tar `--format=ustar` alanları). Alanlar istenirse sonra
/// bozulur; `ustar_seal` sağlama toplamını koyar (bozuk sağlama sondası onu çağırmaz).
pub fn ustar_header(name: &str, typeflag: u8, size: u64, mode: u32) -> [u8; 512] {
    let mut h = [0u8; 512];
    assert!(name.len() <= 100, "ustar adı uzun: {name}");
    h[..name.len()].copy_from_slice(name.as_bytes());
    h[100..108].copy_from_slice(format!("{mode:07o}\0").as_bytes());
    h[108..116].copy_from_slice(b"0000000\0");
    h[116..124].copy_from_slice(b"0000000\0");
    h[124..136].copy_from_slice(format!("{size:011o}\0").as_bytes());
    h[136..148].copy_from_slice(b"15123456700\0");
    h[156] = typeflag;
    h[257..263].copy_from_slice(b"ustar\0");
    h[263..265].copy_from_slice(b"00");
    h
}

pub fn ustar_seal(mut h: [u8; 512]) -> [u8; 512] {
    h[148..156].copy_from_slice(b"        ");
    let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
    h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
    h
}

/// Başlık + veri dizisi → arşiv: veri 512'ye dolgulanır, iki sıfır blok, GNU gibi 10240'lık kayda dolgu.
pub fn ustar_raw(entries: &[([u8; 512], Vec<u8>)]) -> Vec<u8> {
    let mut v = Vec::new();
    for (h, data) in entries {
        v.extend_from_slice(h);
        v.extend_from_slice(data);
        v.resize(v.len().div_ceil(512) * 512, 0);
    }
    v.extend_from_slice(&[0u8; 1024]);
    v.resize(v.len().div_ceil(10240) * 10240, 0);
    v
}

/// Düz dosyalardan ustar (güncelleyici ikilisi 0755, diğerleri 0644 — `teslim-paketle.sh` gibi).
pub fn ustar_of(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let entries: Vec<([u8; 512], Vec<u8>)> = files
        .iter()
        .map(|(n, c)| {
            (ustar_seal(ustar_header(n, b'0', c.len() as u64, if n == "tekserp-guncelleyici" { 0o755 } else { 0o644 })), c.clone())
        })
        .collect();
    ustar_raw(&entries)
}

pub fn oci_package_name(v: &str) -> String {
    format!("tekserp-backend-oci-{v}.tar")
}

/// Sürümün tek katmanının `diff_id`si.
pub fn oci_layer_id(v: &str) -> String {
    format!("sha256:{}", sha_hex(format!("katman {v}").as_bytes()))
}

/// Sürüm imajının config blob'u; imaj kimliği onun özetidir (`imaj.rs`).
pub fn oci_config(v: &str) -> Vec<u8> {
    json!({ "architecture": "amd64", "os": "linux", "rootfs": { "type": "layers", "diff_ids": [oci_layer_id(v)] } })
        .to_string()
        .into_bytes()
}

/// İmaj kimliği = config özeti (gerçek arşivle aynı ölçü).
pub fn oci_image_id(v: &str) -> String {
    format!("sha256:{}", sha_hex(&oci_config(v)))
}

/// Docker'ın yerel tutamacı (containerd'de index özeti) — kimlikten başka bir değer.
pub fn docker_handle(kimlik: &str) -> String {
    format!("sha256:{}", sha_hex(format!("index {kimlik}").as_bytes()))
}

/// `docker save | gzip` biçiminde arşiv: config + tek katman + `manifest.json` (`RepoTags` = `tags`).
pub fn oci_image_archive_of(config: &[u8], tags: &[String]) -> Vec<u8> {
    let c = sha_hex(config);
    let layer = format!("katman-govdesi {c}").into_bytes();
    let l = sha_hex(&layer);
    let manifest = json!([{ "Config": format!("blobs/sha256/{c}"), "RepoTags": tags, "Layers": [format!("blobs/sha256/{l}")] }]);
    let tar = ustar_of(&[
        (format!("blobs/sha256/{c}"), config.to_vec()),
        (format!("blobs/sha256/{l}"), layer),
        ("manifest.json".into(), manifest.to_string().into_bytes()),
    ]);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    gz.write_all(&tar).unwrap();
    gz.finish().unwrap()
}

pub fn oci_image_archive(v: &str) -> Vec<u8> {
    oci_image_archive_of(&oci_config(v), &[format!("tekserp-korumali:{v}")])
}

/// Sertleştirilmiş compose (`config --format json` biçimi): kurallardan geçer (`platform::linux::compose`).
pub fn oci_compose(v: &str) -> Value {
    json!({ "name": "tekserp", "services": { "backend": {
        "image": format!("tekserp-korumali:{v}"), "pull_policy": "never", "read_only": true, "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges:true"], "user": "10001:10001",
        "ports": [{ "host_ip": "127.0.0.1", "target": 4000, "published": "4000" }] } } })
}

/// Sürümün güncelleyici ikilisi (paketin kökünde; bayt içeriği testin seçimi).
pub fn oci_default_updater() -> Vec<u8> {
    br#"{"ad":"tekserp-guncelleyici","surum":"0.9.0","hedef":"linux"}"#.to_vec()
}

/// OCI teslim paketinin üyeleri (`ociUyeler` sırası): imaj arşivi (sahte bayt), compose, `.env.ornek`, güncelleyici +
/// künyesi, imzalı teslim künyesi (`PAKET-DOCKER.json` + `.jws`, `tekserp-butunluk`), bütünlük listesi, `SHA256SUMS`.
/// `edit` imzadan ÖNCE künyeyi değiştirir (bağ sondaları).
pub fn oci_files(
    v: &str,
    updater: &[u8],
    signer: &SigningKey,
    kid: &str,
    customer: Option<&str>,
    edit: &dyn Fn(&mut Value),
) -> Vec<(String, Vec<u8>)> {
    oci_files_with(v, updater, signer, kid, customer, edit, oci_image_archive(v), &oci_compose(v))
}

/// `oci_files`, imaj arşivi ve compose testin seçimi (imzalı kapsamda — bütünlük tutar, imaj/compose kuralı sınanır).
#[allow(clippy::too_many_arguments)]
pub fn oci_files_with(
    v: &str,
    updater: &[u8],
    signer: &SigningKey,
    kid: &str,
    customer: Option<&str>,
    edit: &dyn Fn(&mut Value),
    image: Vec<u8>,
    compose: &Value,
) -> Vec<(String, Vec<u8>)> {
    let updater_kunye = br#"{"ad":"tekserp-guncelleyici","surum":"0.9.0","hedef":"linux","testCapasi":false,"capaKipi":"uretim"}"#.to_vec();
    oci_files_raw(v, updater, updater_kunye, signer, kid, customer, edit, image, serde_json::to_vec_pretty(compose).unwrap())
}

/// `oci_files_with`in bayt düzeyi: compose dosyası ve güncelleyici künyesi olduğu gibi (gerçek şablon · gerçek ikilinin
/// `kunye` çıktısı — T1 Linux dumanının fikstürü).
#[allow(clippy::too_many_arguments)]
pub fn oci_files_raw(
    v: &str,
    updater: &[u8],
    updater_kunye: Vec<u8>,
    signer: &SigningKey,
    kid: &str,
    customer: Option<&str>,
    edit: &dyn Fn(&mut Value),
    image: Vec<u8>,
    compose: Vec<u8>,
) -> Vec<(String, Vec<u8>)> {
    let archive = format!("tekserp-korumali_{v}_linux-amd64.tar.gz");
    let scope: Vec<(String, Vec<u8>)> = vec![
        (archive.clone(), image),
        ("docker-compose.yml".into(), compose),
        (".env.ornek".into(), b"POSTGRES_USER=tekserp\n".to_vec()),
        ("tekserp-guncelleyici".into(), updater.to_vec()),
        ("guncelleyici-kunye.json".into(), updater_kunye),
    ];
    let mut sorted: Vec<&(String, Vec<u8>)> = scope.iter().collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let list: String = sorted.iter().map(|(p, c)| format!("{}\t{}\t{}\n", sha_b64u(c), c.len(), p)).collect();
    let mut kunye = json!({
        "v": 1, "paketId": PACKAGE_ID, "urun": "backend-docker", "surum": v, "derlemeTarihi": BUILT_AT, "musteri": customer,
        "commit": COMMIT, "platform": "linux-x64-oci", "gocSayisi": migrations_of(v),
        "imaj": { "etiket": format!("tekserp-korumali:{v}"), "kimlik": oci_image_id(v), "platform": "linux/amd64", "arsiv": archive, "butunlukKid": kid },
        "sunucu": { "nodeSurum": "24.18.0", "v8Taban": "13.6.233.17", "jscSha256": "0".repeat(64), "nativeZorunlu": true },
        "guncelleyici": { "surum": "0.9.0", "sha256": sha_hex(updater) },
        "kapsam": { "dizinler": [], "dosyalar": scope.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>() },
        "liste": { "sha256": sha_b64u(list.as_bytes()), "boyut": list.len(), "dosyaSayisi": scope.len() },
    });
    edit(&mut kunye);
    let mut out = scope;
    out.push(("PAKET-DOCKER.json".into(), format!("{}\n", serde_json::to_string_pretty(&kunye).unwrap()).into_bytes()));
    out.push(("PAKET-DOCKER.json.jws".into(), format!("{}\n", sign(signer, "tekserp-butunluk", kid, &kunye)).into_bytes()));
    out.push(("butunluk-liste.txt".into(), list.into_bytes()));
    let sums: String = out.iter().map(|(n, c)| format!("{}  {n}\n", sha_hex(c))).collect();
    out.push(("SHA256SUMS".into(), sums.into_bytes()));
    out
}

/// Linux bildirimi (sözleşme 5): `platform` · `.tar` paket · `imaj` bloğu; `extra` üst düzey alanları ezer.
pub fn manifest_payload_oci(kid: &str, v: &str, tar: &[u8], extra: Option<&Value>) -> Value {
    let mut p = manifest_payload(kid, v, tar, None);
    p["platform"] = json!("linux-x64-oci");
    p["paket"]["ad"] = json!(oci_package_name(v));
    p["imaj"] = json!({ "kimlik": oci_image_id(v), "etiket": format!("tekserp-korumali:{v}") });
    if let Some(Value::Object(e)) = extra {
        for (a, b) in e {
            p[a] = b.clone();
        }
    }
    p
}

/// Kiranın `guncelleme` politikası (sözleşme §2): mutlak aralıklar ms çiftleri olarak verilir.
pub fn policy(kip: &str, intervals: &[(i64, i64)], target: Option<&str>) -> Value {
    let rule = (!intervals.is_empty() || kip == "OTOMATIK")
        .then(|| json!({ "baslangic": "02:00", "bitis": "05:00", "gunler": [1, 2, 3, 4, 5, 6, 7], "saatDilimi": "Europe/Istanbul" }));
    json!({
        "kip": kip,
        "pencere": rule,
        "araliklar": intervals.iter().map(|(a, b)| json!({ "baslangic": iso(*a), "bitis": iso(*b) })).collect::<Vec<_>>(),
        "hedefSurum": target,
    })
}

/// T0'ı içeren pencere (İstanbul 02:00–05:00 = 23:00–02:00Z) ve sonraki günlerinki.
pub fn open_window() -> Vec<(i64, i64)> {
    (0..5).map(|d| (T0 - 30 * 60_000 + d * DAY, T0 + 150 * 60_000 + d * DAY)).collect()
}

#[derive(Clone)]
pub struct LeaseOpts {
    /// `guncelleme` alanı (yoksa eski satıcı: varsayılan ONAYLI).
    pub update: Option<Value>,
    pub frozen_by_sanction: bool,
    pub class: &'static str,
    pub expired: bool,
    /// HAK `bakimBitis` (ms); `None` = HAK dosyası yok.
    pub maintenance_end: Option<i64>,
    /// Kanalın güncel backend sürümü (`kanal.guncelSurumler.backend`); `None` = alan yok.
    pub channel_backend: Option<&'static str>,
}

impl Default for LeaseOpts {
    fn default() -> Self {
        LeaseOpts {
            update: Some(policy("OTOMATIK", &open_window(), None)),
            frozen_by_sanction: false,
            class: "URETIM",
            expired: false,
            maintenance_end: Some(T0 + 365 * DAY),
            channel_backend: Some(NEW),
        }
    }
}

const HAK_ID: &str = "11111111-1111-4111-8111-111111111111";
pub const KURULUM_ID: &str = "22222222-2222-4222-8222-222222222222";

/// (kira, HAK) — HAK `maintenance_end` yoksa `None`.
pub fn lease_and_entitlement(k: &Keys, o: &LeaseOpts, now: i64) -> (String, Option<String>) {
    lease_and_entitlement_in(k, o, now, CHANNEL)
}

/// `lease_and_entitlement`, kiranın kanal kodu verilerek (prova: ortak paketin grubu).
pub fn lease_and_entitlement_in(k: &Keys, o: &LeaseOpts, now: i64, channel: &str) -> (String, Option<String>) {
    let cert = sign(
        &k.root,
        "tekserp-sertifika",
        "kok-test-1",
        &json!({
            "v": 1, "sertifikaId": "33333333-3333-4333-8333-333333333333", "kullanim": "ALT", "kid": "alt-test-1",
            "x": x_of(&k.alt), "siniflar": ["URETIM", "TEST"], "baslangic": iso(now - 400 * DAY), "bitis": iso(now + 400 * DAY), "bayi": null,
        }),
    );
    let issued = if o.expired { now - 44 * DAY } else { now - DAY };
    let mut lease = json!({
        "v": 1, "kiraId": "44444444-4444-4444-8444-444444444444", "hakId": HAK_ID, "hakSurum": 1, "kurulumId": KURULUM_ID,
        "kurulumAnahtarKimligi": format!("kur-{}", "A".repeat(43)),
        "parmakIzi": { "f1": null, "f2": null, "f3": null, "f4": null, "f5": null },
        "verilis": iso(issued), "bitis": iso(issued + 30 * DAY), "sunucuSaati": iso(issued), "ekSureGun": if o.expired { 0 } else { 30 },
        "zorlama": false, "gecerlilikBitis": null,
        "yaptirim": { "kademe": null, "mesaj": null, "kisitlamaTarihi": null, "donmusModuller": [], "guncellemeDonuk": o.frozen_by_sanction },
        "yoklamaAraligiDk": 60, "esitlemeAraligiDk": null, "patronBulutBitis": null, "devredildi": false,
        "kanal": { "kod": channel, "guncelSurumler": o.channel_backend.map_or_else(|| json!({}), |v| json!({ "backend": v })) },
        "altSertifika": cert,
    });
    if let Some(u) = &o.update {
        lease["guncelleme"] = u.clone();
    }
    let hak = o.maintenance_end.map(|end| {
        let hak = json!({
            "v": 1, "hakId": HAK_ID, "surum": 1, "lisansNo": "TKS-2026-0001",
            "musteri": { "id": "55555555-5555-4555-8555-555555555555", "ad": "Test" },
            "tesis": { "id": "66666666-6666-4666-8666-666666666666", "ad": "Test tesis" },
            "kurulumId": KURULUM_ID, "sinif": o.class, "moduller": [], "kalici": true,
            "bakimBitis": iso(end), "verilis": iso(now - 10 * DAY),
        });
        sign(&k.root, "tekserp-hak", "kok-test-1", &hak)
    });
    (sign(&k.alt, "tekserp-kira", "alt-test-1", &lease), hak)
}

pub fn package_name(v: &str) -> String {
    format!("tekserp-backend-{v}.zip")
}

/// Sözleşme §1.3 bildirim yükü (TS `ReleaseManifestSchema` biçimi); `extra` üst düzey alanları ezer.
pub fn manifest_payload(kid: &str, v: &str, zip: &[u8], extra: Option<&Value>) -> Value {
    let mut p = json!({
        "v": 1, "urun": "backend", "platform": "win32-x64", "kanal": CHANNEL, "surum": v, "commit": COMMIT,
        "derlemeTarihi": BUILT_AT, "yayinZamani": "2026-09-30T01:00:00Z",
        "paket": { "ad": package_name(v), "boyut": zip.len(), "sha256": sha_hex(zip), "paketId": PACKAGE_ID },
        "paketImzaKid": kid, "minKaynakSurum": null, "gocSayisi": migrations_of(v),
        "pg": { "cizgi": 16, "enAz": "16.9", "hedef": null },
        "runtime": { "node": "24.18.0" }, "notlar": { "ozet": "Test sürümü" }, "zorunlu": false,
    });
    if let Some(Value::Object(e)) = extra {
        for (a, b) in e {
            p[a] = b.clone();
        }
    }
    p
}

/// İşaretçi (`son.json` · `<sürüm>/surum.json` · `pg.json`): `{v:1, bildirim}`.
pub fn pointer(token: &str) -> Vec<u8> {
    format!("{}\n", json!({ "v": 1, "bildirim": token })).into_bytes()
}

pub fn sign_manifest(k: &SigningKey, kid: &str, payload: &Value) -> String {
    sign(k, "tekserp-surum", kid, payload)
}

/// Bildirimi yayınlar: `<sürüm>/surum.json` + `son.json` (+ paket, verilirse) — yayın sırası gibi.
/// Ürün dizini bildirimin platformundan (sözleşme 5: Linux `backend-oci`).
pub fn publish(files: &Mutex<HashMap<String, Vec<u8>>>, payload: &Value, token: &str, zip: Option<Vec<u8>>, latest: bool) {
    let v = payload["surum"].as_str().unwrap().to_string();
    let dir = if payload["platform"] == "linux-x64-oci" { "backend-oci" } else { "backend" };
    let mut f = files.lock().unwrap();
    if let Some(z) = zip {
        f.insert(format!("/{CHANNEL}/{dir}/{v}/{}", payload["paket"]["ad"].as_str().unwrap()), z);
    }
    f.insert(format!("/{CHANNEL}/{dir}/{v}/surum.json"), pointer(token));
    if latest {
        f.insert(format!("/{CHANNEL}/{dir}/son.json"), pointer(token));
    }
}

pub fn approval(id: &str, v: &str, timing: &str) -> Value {
    json!({ "onayId": id, "surum": v, "zamanlama": timing, "kullaniciId": "u-1", "ad": "Ayşe", "zaman": iso(T0) })
}

/// Niyet (§5.1): belirteç + (varsa) panel onayı.
pub fn intent(approval: Option<Value>) -> Value {
    json!({
        "v": 1, "yazildi": iso(T0),
        "indirme": { "belirtec": TOKEN, "bitis": iso(T0 + 30 * DAY) },
        "onay": approval,
    })
}

// ── Kendi PostgreSQL örneği (D4 §5) ──────────────────────────────────────────────────────────────

pub const PG_OLD_TAG: &str = "16.9-1";
pub const PG_NEW_TAG: &str = "16.15-4";
pub const PG_ZIP: &str = "postgresql-16.15-4-win-x64.zip";

pub fn pg_files(version: &str, icu: &str) -> Vec<(String, Vec<u8>)> {
    vec![
        ("bin/postgres".into(), b"#!fake postgres".to_vec()),
        ("bin/pg_ctl".into(), b"#!fake pg_ctl".to_vec()),
        ("bin/psql".into(), b"#!fake psql".to_vec()),
        ("bin/SURUM".into(), version.as_bytes().to_vec()),
        (format!("bin/icuuc{icu}.dll"), b"icu".to_vec()),
        ("share/timezone/UTC".into(), b"tz".to_vec()),
    ]
}

pub fn pg_image_for(root: &Path, tag: &str) -> String {
    format!(
        "\"{}\" runservice -N \"TeksERP-PostgreSQL\" -D \"{}\" -w",
        root.join("pgsql").join(tag).join("bin").join("pg_ctl").display(),
        root.join("pgveri").display()
    )
}

/// Sözleşme §1.6: PG künyesi yükü (`tekserp-pg`, kanaldan bağımsız).
pub fn pg_manifest(zip: &[u8], content_hex: &str, icu: &str) -> Value {
    json!({
        "v": 1, "urun": "postgresql", "platform": "win32-x64", "cizgi": 16, "surum": "16.15", "derleme": 4,
        "paket": { "ad": PG_ZIP, "boyut": zip.len(), "sha256": sha_hex(zip) },
        "icerikSha256": content_hex, "icuSurum": icu, "yayinZamani": "2026-09-30T21:00:00Z",
    })
}

/// Backend bildiriminin `pg` bloğu künyeye bağlanır (§1.6); `hedef` künyenin alanlarıdır.
pub fn pg_requirement(k: &Value) -> Value {
    json!({ "cizgi": 16, "enAz": "16.9", "hedef": {
        "surum": k["surum"], "derleme": k["derleme"], "paket": k["paket"], "icerikSha256": k["icerikSha256"], "icuSurum": k["icuSurum"],
    } })
}

/// PG sahnesi (16.15 ikilileri) + `shasum -c` biçiminde içerik manifestosu `TEKSERP-ICERIK.sha256` (son dosya).
pub fn pg_stage_files(icu: &str) -> Vec<(String, Vec<u8>)> {
    let mut all = pg_files("16.15", icu);
    let mut manifest = String::new();
    for (p, c) in &all {
        manifest.push_str(&format!("{}  {p}\n", sha_hex(c)));
    }
    all.push(("TEKSERP-ICERIK.sha256".into(), manifest.into_bytes()));
    all
}

/// PG sahne zip'i ve içerik manifestosunun özeti (hex).
pub fn pg_stage_zip(icu: &str) -> (Vec<u8>, String) {
    let all = pg_stage_files(icu);
    let content = sha_hex(&all.last().unwrap().1);
    (zip_of(&all), content)
}

/// Kurulu PG örneği 16.9-1 (`kind` = kendi · harici): ikili + `pgsql\bin` bağı + veri dizini + ornek.json + ImagePath.
pub fn install_pg_instance(w: &World, kind: &str) {
    let root = w.layout.root.clone();
    for (p, c) in pg_files("16.9", "67") {
        let f = root.join("pgsql").join(PG_OLD_TAG).join(&p);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, c).unwrap();
    }
    RealFs.set_link(&w.layout.pg_bin_link(), &root.join("pgsql").join(PG_OLD_TAG).join("bin")).unwrap();
    std::fs::create_dir_all(root.join("pgveri")).unwrap();
    std::fs::write(root.join("pgveri").join("PG_VERSION"), "16\n").unwrap();
    let instance = json!({
        "bicim": 1, "kip": kind, "hizmet": PG, "surum": "16.9", "derleme": "1",
        "ikiliDizin": root.join("pgsql").join(PG_OLD_TAG), "oncekiIkiliDizin": null,
        "veriDizini": root.join("pgveri"), "port": 5432, "kuruldu": "2026-09-01T00:00:00Z", "guncellendi": null,
    });
    std::fs::write(w.layout.pg_instance_file(), serde_json::to_vec_pretty(&instance).unwrap()).unwrap();
    let mut svcs = w.svcs.lock().unwrap();
    let pg = svcs.get_mut(PG).unwrap();
    pg.image = pg_image_for(&root, PG_OLD_TAG);
    pg.version = Some("16.9".into());
}

// ── Platform profilleri (GUNCELLEYICI-SAGLAMLIK §9.2) ───────────────────────────────────────────

/// Sahte dünyanın taklit ettiği arka uç. Bugün yalnız Windows (SCM kurtarması, junction); Linux profili (Docker
/// `unless-stopped`, `exec` sağlık sondası) eklenince `PROFILLER`e girer ve `senaryo` ile yazılmış her test iki profilde koşar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profil {
    Windows,
    Linux,
}

pub const PROFILLER: &[Profil] = &[Profil::Windows, Profil::Linux];

impl Profil {
    /// Bu profilin işlem günlüğüne yazdığı `platform` (arka ucun adı, `platform::Arka::platform`).
    pub fn platform(self) -> &'static str {
        match self {
            Profil::Windows => "win32-x64",
            Profil::Linux => "linux-x64-oci",
        }
    }
}

/// Senaryoyu her etkin profilde koşar; ikinci argüman başarısızlık iletisinin öneki (`ad [profil]`).
pub fn senaryo(ad: &str, f: impl Fn(Profil, &str)) {
    for p in PROFILLER {
        f(*p, &format!("{ad} [{p:?}]"));
    }
}

// ── Dünya ─────────────────────────────────────────────────────────────────────────────────────

pub struct Setup {
    pub lease: LeaseOpts,
    pub package_signer_legacy: bool,
    pub customer: Option<&'static str>,
    pub extra_file_in_scope: bool,
    pub manifest_extra: Option<Value>,
    pub intent: Option<Value>,
    /// Yeni paketin `runtime/tekserp-guncelleyici.exe`i (sahte ikili = künye JSON'u, ya da `Faults::identities`li
    /// gerçek biçimli bayt); `None` = paket taşımaz.
    pub packaged_updater: Option<Vec<u8>>,
}

impl Default for Setup {
    fn default() -> Self {
        Setup {
            lease: LeaseOpts::default(),
            package_signer_legacy: false,
            customer: Some(CHANNEL),
            extra_file_in_scope: false,
            manifest_extra: None,
            intent: Some(intent(None)),
            packaged_updater: None,
        }
    }
}

static SEQ: AtomicU64 = AtomicU64::new(0);
static QUIET: std::sync::Once = std::sync::Once::new();

/// Enjekte ölümler (`Killed`) panik çıktısını boğmasın; diğer panikler olduğu gibi basılır.
fn quiet_injected_panics() {
    QUIET.call_once(|| {
        let default = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !info.payload().is::<Killed>() {
                default(info);
            }
        }));
    });
}

impl World {
    /// Profilin dünyası. Linux: compose `.env`i (`POSTGRES_*`, adres şablondan), gerçek `DockerServices` + Docker arka
    /// ucu sahte `docker` CLI'ya karşı, `unless-stopped` yeniden başlatma; sunucuda `backend-oci` yolunda Linux bildirimi
    /// ve GERÇEK ustar teslim paketi (L4c-1 hazırlığı). İmaj yükleme (`docker load`) L4c-2'nin.
    pub fn new_in(profil: Profil, tag: &str, s: Setup) -> World {
        let linux = profil == Profil::Linux;
        assert!(!(linux && s.extra_file_in_scope), "Linux'ta fazla dosya bir tar üyesidir — `tests/linux_paket.rs`");
        let oci = (s.package_signer_legacy, s.customer, s.manifest_extra.clone(), s.packaged_updater.clone());
        let w = World::new(tag, s);
        if linux {
            w.faults.docker.store(true, Ordering::SeqCst);
            // Backend kirayı compose biriminde tutar; konakta `<KOK>/lisans` YOK (deneme sunucusunun gerçeği).
            let birim = w.license_dir();
            std::fs::create_dir_all(birim.parent().unwrap()).unwrap();
            std::fs::rename(w.layout.root.join("lisans"), &birim).unwrap();
            w.docker_seed(OLD);
            std::fs::write(w.layout.backend_env(), "POSTGRES_USER=tekserp\nPOSTGRES_PASSWORD=gizli-parola\nPOSTGRES_DB=tekserp\n").unwrap();
            let (legacy, customer, extra, updater) = oci;
            let (signer, kid) = if legacy { (&w.keys.legacy, "paket-hazirlik") } else { (&w.keys.package, "paket-2026") };
            let files = oci_files(NEW, &updater.unwrap_or_else(oci_default_updater), signer, kid, customer, &|_| {});
            w.serve_oci_signed(NEW, ustar_of(&files), extra.as_ref(), signer, kid);
        }
        w
    }

    /// Linux profilinin sunucusu: `backend-oci` altında `tar` ve onu ilan eden imzalı bildirim (PAKET `paket-2026`);
    /// Windows yolu boşaltılır — Linux güncelleyicisi onu zaten okumaz.
    pub fn serve_oci(&self, v: &str, tar: Vec<u8>, extra: Option<&Value>) {
        self.serve_oci_signed(v, tar, extra, &self.keys.package, "paket-2026");
    }

    fn serve_oci_signed(&self, v: &str, tar: Vec<u8>, extra: Option<&Value>, signer: &SigningKey, kid: &str) {
        let payload = manifest_payload_oci(kid, v, &tar, extra);
        self.files.lock().unwrap().clear();
        publish(&self.files, &payload, &sign_manifest(signer, kid, &payload), Some(tar), true);
    }

    /// Kurulumun yüklediği imaj: depoda etiketli + güncelleyicinin kaydı (`is/imaj/<v>.json`).
    pub fn docker_seed(&self, v: &str) {
        let kimlik = oci_image_id(v);
        let tag = format!("tekserp-korumali:{v}");
        let img = FakeImage { id: docker_handle(&kimlik), tags: vec![tag.clone()], layers: vec![oci_layer_id(v)] };
        let k = imaj::Kayit {
            v: 1,
            surum: v.into(),
            etiket: tag,
            kimlik,
            katmanlar: img.layers.clone(),
            docker_id: img.id.clone(),
            zaman: String::new(),
        };
        imaj::kayit_yaz(&RealFs, &self.layout, &k).unwrap();
        self.faults.images.lock().unwrap().push(img);
    }

    /// Etiket başka (yabancı) bir imaja taşınır — `docker tag` ile yeniden etiketleme.
    pub fn docker_retag(&self, tag: &str) {
        let mut images = self.faults.images.lock().unwrap();
        for i in images.iter_mut() {
            i.tags.retain(|t| t != tag);
        }
        let id = format!("sha256:{}", sha_hex(format!("yabanci {tag}").as_bytes()));
        images.push(FakeImage { id, tags: vec![tag.into()], layers: vec![format!("sha256:{}", "a".repeat(64))] });
    }

    /// Etiketli imaj elle silinir (`docker image rm`).
    pub fn docker_forget(&self, tag: &str) {
        self.faults.images.lock().unwrap().retain(|i| !i.tags.iter().any(|t| t == tag));
    }

    pub fn docker_tags(&self) -> Vec<String> {
        let mut t: Vec<String> = self.faults.images.lock().unwrap().iter().flat_map(|i| i.tags.clone()).collect();
        t.sort();
        t
    }

    /// Backend'in lisans dizini: Windows `<KOK>\lisans`, Linux `tekserp_lisans` biriminin konak dizini.
    pub fn license_dir(&self) -> PathBuf {
        match self.profil() {
            Profil::Windows => self.layout.root.join("lisans"),
            Profil::Linux => docker_volume_dir(&self.layout.root, "tekserp_lisans"),
        }
    }

    pub fn profil(&self) -> Profil {
        if self.faults.docker.load(Ordering::SeqCst) {
            Profil::Linux
        } else {
            Profil::Windows
        }
    }

    pub fn new(tag: &str, s: Setup) -> World {
        quiet_injected_panics();
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("tekserp-gy-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("kok");
        let data = dir.join("programdata");
        std::fs::create_dir_all(&root).unwrap();
        let layout = Layout::new(&root, &data);
        let keys = test_keys();
        let anchor = test_anchor(&keys);
        // Kurulu sürüm + current
        for (p, c) in version_files(OLD) {
            let f = layout.version_dir(OLD).join(&p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, c).unwrap();
        }
        RealFs.set_link(&layout.current(), &layout.version_dir(OLD)).unwrap();
        std::fs::create_dir_all(root.join("yapilandirma")).unwrap();
        std::fs::write(
            layout.backend_env(),
            "PORT=4999\nDATABASE_URL=\"postgresql://tekserp:gizli-parola@127.0.0.1:5432/tekserp?schema=public\"\nPG_BIN_DIR=/fake/pgbin\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("yedek-anahtar")).unwrap();
        std::fs::write(root.join("yedek-anahtar").join("musteri.tkpub"), "tkpub1:MUSTERI\n").unwrap();
        std::fs::create_dir_all(layout.updater_dir()).unwrap();
        std::fs::write(layout.settings_file(), json!({ "v": 1, "guncellemeSunucusu": "https://guncelleme.test" }).to_string()).unwrap();
        // Kira + HAK
        let (lease, hak) = lease_and_entitlement(&keys, &s.lease, T0);
        std::fs::create_dir_all(root.join("lisans")).unwrap();
        std::fs::write(root.join("lisans").join("kira.jws"), lease).unwrap();
        if let Some(h) = hak {
            std::fs::write(root.join("lisans").join("hak.jws"), h).unwrap();
        }
        // Yeni paket + imzalı bildirim + işaretçiler (sunucuda)
        let mut files = version_files(NEW);
        if let Some(u) = &s.packaged_updater {
            files.push(("runtime/tekserp-guncelleyici.exe".into(), u.clone()));
        }
        let (signer, kid) = if s.package_signer_legacy { (&keys.legacy, "paket-hazirlik") } else { (&keys.package, "paket-2026") };
        let mut all = files.clone();
        all.extend(integrity_files(&files, NEW, signer, kid, s.customer));
        if s.extra_file_in_scope {
            all.push(("dist/arka-kapi.js".into(), b"// imzasiz".to_vec()));
        }
        let zip = zip_of(&all);
        let payload = manifest_payload(kid, NEW, &zip, s.manifest_extra.as_ref());
        let served = Mutex::new(HashMap::new());
        publish(&served, &payload, &sign_manifest(signer, kid, &payload), Some(zip), true);
        let served = served.into_inner().unwrap();
        if let Some(i) = &s.intent {
            std::fs::create_dir_all(layout.intent_file().parent().unwrap()).unwrap();
            std::fs::write(layout.intent_file(), i.to_string()).unwrap();
        }
        let mut svcs = HashMap::new();
        svcs.insert(
            BACKEND.to_string(),
            Svc {
                state: SvcState::Running,
                args: vec![],
                version: Some(OLD.into()),
                image: "konak".into(),
                starts: 0,
                crash: None,
                restart_at: None,
            },
        );
        svcs.insert(
            PG.to_string(),
            Svc {
                state: SvcState::Running,
                args: vec![],
                version: Some("16.9".into()),
                image: String::new(),
                starts: 0,
                crash: None,
                restart_at: None,
            },
        );
        svcs.insert(
            UPDATER.to_string(),
            Svc {
                state: SvcState::Running,
                args: vec![],
                version: None,
                image: updater_image(&layout.updater_dir().join("tekserp-guncelleyici.exe"), &root),
                starts: 0,
                crash: None,
                restart_at: None,
            },
        );
        let crash = Arc::new(Crash::default());
        World {
            fs: Arc::new(CrashFs {
                inner: RealFs,
                crash: Arc::clone(&crash),
                free: AtomicU64::new(u64::MAX),
                mounts: Mutex::new(vec![]),
                foreign: Mutex::new(vec![]),
                unmeasurable: Mutex::new(vec![]),
                corrupt_copy: AtomicBool::new(false),
                locked: Mutex::new(vec![]),
            }),
            dir,
            layout,
            crash,
            db: Arc::new(Mutex::new(Db { finished: migrations_of(OLD), total: migrations_of(OLD), data: 42 })),
            svcs: Arc::new(Mutex::new(svcs)),
            faults: Arc::new(Faults::default()),
            files: Arc::new(Mutex::new(served)),
            clock: Arc::new(AtomicI64::new(T0)),
            events: Arc::new(Mutex::new(vec![])),
            backend_name: Arc::new(Mutex::new(BACKEND.to_string())),
            keys,
            anchor,
            atomic_layout: AtomicBool::new(false),
        }
    }

    /// Backend hizmetini başka adla yeniden kaydeder ve güncelleyiciye `ayar.json` `backendHizmeti`yle söyler
    /// (aynı makinede ikinci kanal).
    pub fn rename_backend(&self, name: &str) {
        let mut svcs = self.svcs.lock().unwrap();
        let svc = svcs.remove(BACKEND).unwrap();
        svcs.insert(name.to_string(), svc);
        *self.backend_name.lock().unwrap() = name.to_string();
        std::fs::write(
            self.layout.settings_file(),
            json!({ "v": 1, "guncellemeSunucusu": "https://guncelleme.test", "backendHizmeti": name }).to_string(),
        )
        .unwrap();
    }

    pub fn refs(&self) -> WorldRefs {
        WorldRefs {
            root: self.layout.root.clone(),
            crash: Arc::clone(&self.crash),
            db: Arc::clone(&self.db),
            svcs: Arc::clone(&self.svcs),
            faults: Arc::clone(&self.faults),
            files: Arc::clone(&self.files),
            clock: Arc::clone(&self.clock),
            events: Arc::clone(&self.events),
            backend_name: Arc::clone(&self.backend_name),
        }
    }

    pub fn env(&self) -> Env {
        let r = self.refs();
        let env = Env {
            fs: Arc::clone(&self.fs) as Arc<dyn Fs>,
            svc: Arc::new(FakeServices { w: r.clone() }),
            procs: Arc::new(FakeProcs { w: r.clone() }),
            net: Arc::new(FakeNet { w: r.clone() }),
            clock: Arc::new(FakeClock(Arc::clone(&self.clock))),
            events: Arc::new(FakeEvents(Arc::clone(&self.events))),
            protect: Arc::new(FakeProtect),
            arka: {
                let mut a = tekserp_guncelleyici::platform::windows::arka_ucu();
                if self.atomic_layout.load(Ordering::SeqCst) {
                    a.kendi = Arc::new(tekserp_guncelleyici::platform::linux::kendi::AtomikAdlandirma);
                }
                a
            },
        };
        if self.profil() == Profil::Windows {
            return env;
        }
        use tekserp_guncelleyici::platform::linux::docker;
        let komut = Arc::new(docker::DockerKomut::new(&self.layout, "tekserp").unwrap());
        Env {
            svc: Arc::new(docker::DockerServices::new(Arc::clone(&komut), Arc::clone(&env.procs), Arc::clone(&env.fs), 60)),
            arka: docker::arka_ucu(komut),
            ..env
        }
    }

    /// "Süreç başlangıcı": yeni motor (bellekteki hiçbir durum taşınmaz).
    pub fn engine(&self) -> Engine {
        let mut e = Engine::new(self.env(), self.layout.clone(), self.anchor.clone(), Arc::new(RotatingLog::disabled()), None);
        e.reserve_bytes = TEST_RESERVE;
        e
    }

    pub fn status(&self) -> Option<StatusDoc> {
        ipc::read_status(&RealFs, &self.layout)
    }

    pub fn state(&self) -> Option<State> {
        self.status().map(|s| s.state)
    }

    pub fn unfinished(&self) -> bool {
        Journal::open(&RealFs, &self.layout.journal_file()).map(|j| j.unfinished().is_some()).unwrap_or(false)
    }

    pub fn current(&self) -> Option<String> {
        current_version(&self.layout.root)
    }

    pub fn backend(&self) -> Svc {
        let name = self.backend_name.lock().unwrap().clone();
        self.svcs.lock().unwrap().get(&name).cloned().unwrap()
    }

    pub fn db(&self) -> Db {
        self.db.lock().unwrap().clone()
    }

    pub fn write_intent(&self, v: &Value) {
        std::fs::create_dir_all(self.layout.intent_file().parent().unwrap()).unwrap();
        std::fs::write(self.layout.intent_file(), v.to_string()).unwrap();
    }

    /// Bir süreç ömrü: `ticks` tura kadar; enjekte ölüm `Err(Killed)`.
    pub fn run(&self, ticks: usize) -> Result<Vec<TickResult>, Killed> {
        let engine = self.engine();
        let mut out = vec![];
        for _ in 0..ticks {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.tick(&|| false))) {
                Ok(r) => out.push(r),
                Err(p) if p.is::<Killed>() => {
                    if self.faults.reboot.swap(false, Ordering::SeqCst) {
                        self.boot();
                    }
                    return Err(Killed);
                }
                Err(p) => std::panic::resume_unwind(p),
            }
        }
        Ok(out)
    }

    /// `run` gibi bir süreç ömrü, ama günlük DOSYAYA yazılır (`<dünya>\gunluk\guncelleyici.log`); dönüş: içeriği.
    pub fn run_logged(&self, ticks: usize) -> String {
        let log = Arc::new(RotatingLog::open(&self.dir.join("gunluk"), "guncelleyici", tekserp_hizmet::logfile::LogSpec::SERVICE));
        let mut engine = Engine::new(self.env(), self.layout.clone(), self.anchor.clone(), Arc::clone(&log), None);
        engine.reserve_bytes = TEST_RESERVE;
        for _ in 0..ticks {
            engine.tick(&|| false);
        }
        std::fs::read_to_string(log.path()).unwrap_or_default()
    }

    /// Terminal duruma (BAŞARILI/GERİ DÖNDÜ/HATA, yarım işlem yok) varana dek yeniden başlatarak koşar.
    pub fn run_to_rest(&self, max_restarts: usize) -> usize {
        for restarts in 0..=max_restarts {
            match self.run(3) {
                Ok(_) => {
                    if !self.unfinished() && matches!(self.state(), Some(State::Succeeded | State::RolledBack | State::Failed)) {
                        return restarts;
                    }
                }
                Err(Killed) => {
                    self.crash.disarm();
                }
            }
        }
        let st = self.status();
        panic!(
            "dünya dinlenmeye varmadı: durum {:?} {:?} {:?}, yarım {}",
            st.as_ref().map(|s| s.state),
            st.as_ref().and_then(|s| s.error_code.clone()),
            st.as_ref().and_then(|s| s.message.clone()),
            self.unfinished()
        );
    }

    /// `reboot_at(k)` arızası (§9.3): k'ıncı noktada süreç ölür VE konak yeniden açılır — platformun açılış davranışı
    /// (`boot`) uygulanır, sonra güncelleyici yeniden başlar (`run_to_rest`).
    /// `k`ıncı noktadan sonraki ilk yer isteyen yazımda disk dolar ve dolu kalır (yedek alan bırakılana dek).
    pub fn enospc_at(&self, k: u64) {
        self.crash.arm_enospc(k);
    }

    pub fn reboot_at(&self, k: u64) {
        self.crash.arm(k, false);
        self.faults.reboot.store(true, Ordering::SeqCst);
    }

    /// Testin işlem öncesi başlangıç türü (Windows).
    pub fn set_backend_start_mode(&self, mode: &str) {
        let name = self.backend_name.lock().unwrap().clone();
        self.faults.start_modes.lock().unwrap().insert(name, mode.to_string());
        *self.faults.backend_mode_before.lock().unwrap() = Some(mode.to_string());
    }

    /// Konak açılışı: `WorldRefs::boot_plan`ın kararını uygular; A3 ihlali `IHLAL: açılış yarışı` olayıdır.
    pub fn boot(&self) -> BootReport {
        let refs = self.refs();
        let plan = refs.boot_plan(&self.layout.journal_file());
        let backend = self.backend_name.lock().unwrap().clone();
        let linux = self.profil() == Profil::Linux;
        for step in &plan.steps {
            let mut svcs = self.svcs.lock().unwrap();
            let s = svcs.get_mut(&step.name).unwrap();
            s.state = SvcState::Stopped;
            s.crash = None;
            s.restart_at = None;
            if step.starts {
                s.state = SvcState::Running;
                s.starts += 1;
                if !linux {
                    s.args.clear();
                    if step.name == backend {
                        s.version = plan.current.clone();
                    }
                }
            } else {
                s.args.clear();
            }
        }
        if let Some(v) = &plan.violation {
            self.events.lock().unwrap().push(format!("IHLAL: açılış yarışı — {v}"));
        }
        let b = plan.backend(&backend);
        let report = BootReport { open: plan.open, before: b.before.clone(), started: b.starts, mode: b.mode.clone() };
        self.faults.boots.lock().unwrap().push(report.clone());
        self.events.lock().unwrap().push(format!("açılış {report:?}"));
        report
    }

    /// Ölümsüz sayaç koşumu; her noktada açılış önizlemesi (`boot_plan`) — dizinin `k-1`'inci elemanı k'ıncı noktanın.
    pub fn boot_plans(&self) -> Vec<BootPlan> {
        let plans = Arc::new(Mutex::new(vec![]));
        let (refs, journal, sink) = (self.refs(), self.layout.journal_file(), Arc::clone(&plans));
        *self.crash.probe.lock().unwrap() = Some(Box::new(move || {
            let plan = refs.boot_plan(&journal);
            sink.lock().unwrap().push(plan);
        }));
        let points = self.count_points();
        *self.crash.probe.lock().unwrap() = None;
        let plans = std::mem::take(&mut *plans.lock().unwrap());
        assert_eq!(plans.len() as u64, points, "her noktada bir önizleme");
        plans
    }

    /// Sayaçlı "ölümsüz" koşum: kaç enjeksiyon noktası var.
    pub fn count_points(&self) -> u64 {
        self.crash.disarm();
        let _ = self.run(3);
        self.crash.count.load(Ordering::SeqCst)
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Her son durumda geçerli olması gereken değişmezler (§7).
pub fn assert_invariants(w: &World, ctx: &str) {
    let st = w.status().unwrap_or_else(|| panic!("{ctx}: durum.json yok"));
    let b = w.backend();
    assert_eq!(b.state, SvcState::Running, "{ctx}: backend çalışmıyor");
    assert!(b.args.is_empty(), "{ctx}: backend doğrulama kipinde kalmış: {:?}", b.args);
    let cur = w.current().unwrap_or_else(|| panic!("{ctx}: current yok"));
    assert_eq!(b.version.as_deref(), Some(cur.as_str()), "{ctx}: backend current'ın sürümünü koşmuyor");
    let db = w.db();
    match st.state {
        State::Succeeded => {
            assert_eq!(cur, NEW, "{ctx}: BAŞARILI ama current {cur}");
            assert_eq!((db.finished, db.total), (migrations_of(NEW), migrations_of(NEW)), "{ctx}: yeni sürümün göçleri tam değil");
            assert_eq!(db.data, 42, "{ctx}: veri kayboldu");
        }
        State::RolledBack => {
            assert_eq!(cur, OLD, "{ctx}: GERİ DÖNDÜ ama current {cur}");
            assert_eq!(
                db,
                Db { finished: migrations_of(OLD), total: migrations_of(OLD), data: 42 },
                "{ctx}: DB işlem öncesi hâlinde değil"
            );
        }
        other => panic!("{ctx}: beklenmeyen son durum {other:?} ({:?}: {:?})", st.error_code, st.message),
    }
    // W2 çiti son durumda kalkmış: işaret yok, işlem öncesi başlangıç türü geri yazılmış, açılış yarışı yok.
    assert!(!w.layout.fence_marker().exists(), "{ctx}: çit işareti kalmış");
    if w.profil() == Profil::Windows {
        let want = w.faults.backend_mode_before.lock().unwrap().clone().unwrap_or_else(|| start_mode::AUTO_DELAYED.into());
        let name = w.backend_name.lock().unwrap().clone();
        assert_eq!(w.refs().start_mode_of(&name), want, "{ctx}: backend başlangıç türü geri yazılmamış");
    }
    let races: Vec<String> = w.events.lock().unwrap().iter().filter(|e| e.starts_with("IHLAL: açılış")).cloned().collect();
    assert!(races.is_empty(), "{ctx}: {races:?}");
    for stray in ["current.yeni", "current.eski"] {
        assert!(std::fs::symlink_metadata(w.layout.root.join(stray)).is_err(), "{ctx}: artık bağlantı {stray}");
    }
    let mut leftovers = vec![];
    walk(&w.dir, &mut |p| {
        let n = name(p);
        if n == "db.dump"
            || n == "db.dump.geri"
            || n.ends_with(".tksec")
            || n.ends_with(".tksec.gecici")
            || n.ends_with(".part") && n.contains(".dump")
        {
            leftovers.push(p.display().to_string());
        }
    });
    assert!(leftovers.is_empty(), "{ctx}: düz yedek/anahtar artığı: {leftovers:?}");
}

pub fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        let meta = std::fs::symlink_metadata(&p).unwrap();
        if meta.is_dir() {
            walk(&p, f);
        } else {
            f(&p);
        }
    }
}

/// Kurulum geçmişindeki satırlar (kayitId tekil sayılır — okuyucu gibi).
pub fn install_records(w: &World) -> Vec<Value> {
    let text = std::fs::read_to_string(w.layout.install_history()).unwrap_or_default();
    let mut by_id: Vec<(String, Value)> = vec![];
    for l in text.lines().filter(|l| !l.trim().is_empty()) {
        // Okuyucu (`install-history.ts`) gibi: biçimsiz (yırtık) satır atlanır, geçerli kayıt KAYBOLMAMALI.
        let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
        let id = v["kayitId"].as_str().unwrap().to_string();
        by_id.retain(|(k, _)| *k != id);
        by_id.push((id, v));
    }
    by_id.into_iter().map(|(_, v)| v).collect()
}
