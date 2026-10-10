//! Linux kurulum ve geçiş araçları (L7, `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §8.1 · §8.2):
//!
//!   kur   --tar <paket> --proje <p> [--kok] [--veri] [--ad] [--sunucu <url>] [--uygula]
//!   gecis --kok <elle kurulumun dizini> --tar <paket> [--ad] [--sunucu <url>] [--uygula --onay <N>]
//!   gecis --geri-al --kok <dizin> [--uygula --onay <N>]
//!
//! Üçü de varsayılan KURU: ölçer, planı basar, hiçbir şeye yazmaz. İmaj adımı güncelleyicinin yükleme işlevidir
//! (`DockerAraclar::imaj_kaydet_ya_da_yukle` — R17: etiket kaydı olmadan backend başlamaz). `gecis` sağlıklı olana dek
//! her hatada kendiliğinden geri alır; yaptığı her şeyi `<kök>/gecis/<damga>/gunluk.jsonl`e yazar ve geri alma o
//! kayıttan yürür. Hiçbir yol birim ya da imaj silmez; geri alınan dosyalar `geri-alinan/`e TAŞINIR.
use super::docker::{self, DockerAraclar, DockerKomut, DockerServices};
use super::duzen;
use crate::env::{Cmd, CmdOut, Env, EnvError, EnvResult, HttpResponse};
use crate::health::{self, Criteria, Health};
use crate::layout::Layout;
use crate::settings::{self, OrtamKipi};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_hizmet::contract::path as p;

/// Kurulumun güncelleme sunucusu (`ayar.json` `guncellemeSunucusu`; plan §8.1 madde 2) — ortak paketin
/// indirme kökü (`deploy/dagitim.json` `indirmeKoku`, sondaki `/` yok); eşliği `test_kurulum_betikleri` §16 ölçer.
pub const VARSAYILAN_SUNUCU: &str = "https://indir.etkiliyazilim.com";
/// Yeni kurulumun PG imajı (`pg.env` yoksa) — şablonun varsayılanıyla aynı (eşliği test ölçer).
pub const VARSAYILAN_PG_IMAJI: &str = "postgres:16-bookworm";
/// Geçişin varlığını ölçtüğü birimler (F5 = PG küme kimliği · lisans birimi = kurulum anahtarı; plan §8.2).
pub const GEREKLI_BIRIMLER: [&str; 2] = ["pg_data", duzen::LISANS_BIRIMI];
/// Elle kurulumun dosyaları (`LINUX-DOCKER-KURULUM.md` §2 · §10): geçişten sonra `gecis/<damga>/geri/`e taşınır.
pub const ESKI_COMPOSE: &str = "docker-compose.yml";
pub const ESKI_OVERRIDE: &str = "docker-compose.override.yml";
pub const ESKI_ENV: &str = ".env";
pub const GECIS_DIZINI: &str = "gecis";
pub const GUNLUK: &str = "gunluk.jsonl";

/// Çıkış kodları: 0 tamam/kuru · 3 DUR (hiçbir şey yapılmadı ya da yarım kurulum yeniden koşulabilir) · 4 hata,
/// kendiliğinden GERİ ALINDI · 5 geri alma EKSİK (insan bakmalı; günlük ve ekrandaki satırlar).
pub mod cikis {
    pub const TAMAM: u32 = 0;
    pub const DUR: u32 = 3;
    pub const GERI_ALINDI: u32 = 4;
    pub const GERI_ALMA_EKSIK: u32 = 5;
}

/// Konağın yan etkileri (root · sahiplik · systemd): gerçeği `hizmet.rs`, testte sahte.
pub trait Konak {
    fn root(&self) -> bool;
    fn sahiplen(&self, yol: &Path, uid: u32) -> Result<(), String>;
    fn birim_var(&self, ad: &str) -> bool;
    fn birim_kur(&self, kok: &Path, veri: &Path, ad: &str) -> Result<(), String>;
    fn birim_kaldir(&self, ad: &str) -> Result<(), String>;
    fn birim_baslat(&self, ad: &str) -> Result<(), String>;
    fn birim_etkin(&self, ad: &str) -> bool;
}

pub struct GercekKonak;

impl Konak for GercekKonak {
    fn root(&self) -> bool {
        super::sys::euid() == 0
    }
    fn sahiplen(&self, yol: &Path, uid: u32) -> Result<(), String> {
        std::os::unix::fs::chown(yol, Some(uid), Some(uid)).map_err(|e| format!("{}: sahiplik: {e}", yol.display()))
    }
    fn birim_var(&self, ad: &str) -> bool {
        super::birim::birim_dosyasi(Path::new(super::birim::SYSTEMD_DIZINI), ad).exists()
    }
    fn birim_kur(&self, kok: &Path, veri: &Path, ad: &str) -> Result<(), String> {
        super::hizmet::birim_kaydet(kok, veri, ad).map(|_| ())
    }
    fn birim_kaldir(&self, ad: &str) -> Result<(), String> {
        super::hizmet::birim_sil(ad)
    }
    fn birim_baslat(&self, ad: &str) -> Result<(), String> {
        super::hizmet::systemctl(&["start", &format!("{ad}.service")])
    }
    fn birim_etkin(&self, ad: &str) -> bool {
        super::hizmet::systemctl(&["is-active", "--quiet", &format!("{ad}.service")]).is_ok()
    }
}

/// Komutun girdileri (CLI'dan ya da testten).
#[derive(Debug, Clone)]
pub struct Secenek {
    pub kok: PathBuf,
    pub veri: PathBuf,
    /// systemd birim adı.
    pub ad: String,
    pub sunucu: String,
    pub tar: Option<PathBuf>,
    /// `kur`: compose proje adı (zorunlu); `gecis` `.env`den okur.
    pub proje: Option<String>,
    pub uygula: bool,
    pub onay: Option<usize>,
    /// Geçiş dizininin adı (UTC `YYYYMMDD-HHMMSS`).
    pub damga: String,
    pub yedek_alan: u64,
}

pub struct Baglam<'a> {
    pub env: &'a Env,
    pub konak: &'a dyn Konak,
    pub trust: &'a PackageTrust,
    pub yaz: &'a dyn Fn(&str),
}

// ── Ortak ölçüler ───────────────────────────────────────────────────────────────────────────────

/// `.env`/`pg.env` anahtarı — backend ve güncelleyiciyle AYNI ayrıştırıcı (`tekserp_hizmet::envfile`). Değer ekrana basılmaz.
fn env_degeri(yol: &Path, k: &str) -> Option<String> {
    let b = std::fs::read(yol).ok()?;
    tekserp_hizmet::envfile::parse_bytes(&b).get(k).map(str::to_string)
}

fn calistir(env: &Env, c: &Cmd, ne: &str) -> Result<CmdOut, String> {
    let out = env.procs.run(c).map_err(|e| format!("{ne}: {e}"))?;
    if !out.ok() {
        return Err(crate::tools::describe_failure(ne, &out));
    }
    Ok(out)
}

fn docker_cmd() -> Cmd {
    Cmd::new(Path::new("docker")).timeout(Duration::from_secs(120))
}

/// Projenin çalışan konteyneri (compose etiketleriyle — compose dosyası gerekmez).
fn proje_konteyneri(env: &Env, proje: &str, svc: &str) -> Result<Option<String>, String> {
    let c = docker_cmd().args([
        "ps",
        "-q",
        "--filter",
        &format!("label=com.docker.compose.project={proje}"),
        "--filter",
        &format!("label=com.docker.compose.service={svc}"),
    ]);
    let out = calistir(env, &c, "docker ps")?;
    let ids: Vec<String> = String::from_utf8_lossy(&out.stdout).split_whitespace().map(str::to_string).collect();
    match ids.as_slice() {
        [] => Ok(None),
        [id] => Ok(Some(id.clone())),
        _ => Err(format!("{proje}/{svc}: birden çok çalışan konteyner ({})", ids.len())),
    }
}

/// Compose dosyasından bağımsız sağlık: projenin backend konteynerinin İÇİNDEN (`docker exec`). Geçişte eski
/// (elle) kurulumun ve geri alınan kurulumun ölçüsü.
pub struct ProjeSaglik {
    pub proje: String,
}

impl crate::platform::Saglik for ProjeSaglik {
    fn probe(&self, env: &Env, port: u16, path: &str) -> EnvResult<HttpResponse> {
        let id = proje_konteyneri(env, &self.proje, docker::BACKEND)
            .map_err(EnvError)?
            .ok_or_else(|| EnvError("backend konteyneri yok".into()))?;
        let c =
            docker_cmd().args(["exec", id.as_str(), "node", "-e"]).arg(docker::sonda_betigi(port, path)).timeout(Duration::from_secs(30));
        let out = env.procs.run(&c)?;
        if !out.ok() {
            return Err(EnvError(format!("sağlık sondası: çıkış {:?}", out.code)));
        }
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let (first, body) = text.split_once('\n').unwrap_or((text.as_str(), ""));
        let status = first.trim().parse::<u16>().map_err(|_| EnvError(format!("sağlık sondası: durum satırı {:?}", first.trim())))?;
        Ok(HttpResponse { status, headers: vec![], body: Box::new(std::io::Cursor::new(body.as_bytes().to_vec())) })
    }
    fn address(&self, port: u16, path: &str) -> String {
        format!("{} projesinin backend konteyneri içinden 127.0.0.1:{port}{path}", self.proje)
    }
    fn exit_meaning(&self, code: u32) -> &'static str {
        docker::acilis_kodu(code)
    }
}

fn proje_env(env: &Env, proje: &str) -> Env {
    let mut arka = env.arka.clone();
    arka.saglik = Arc::new(ProjeSaglik { proje: proje.to_string() });
    Env { arka, ..env.clone() }
}

/// Kuruluma (layout + proje) bağlı Docker ortamı: `platform::baglam`ın aynısı, ayar dosyası yazılmadan önce.
fn docker_env(env: &Env, komut: &Arc<DockerKomut>) -> Env {
    let svc = Arc::new(DockerServices::new(Arc::clone(komut), Arc::clone(&env.procs), Arc::clone(&env.fs), 60));
    Env { svc, arka: docker::arka_ucu(Arc::clone(komut)), ..env.clone() }
}

fn sha256_dosya(p: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("{}: {e}", p.display()))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn kip(yol: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(yol, std::fs::Permissions::from_mode(mode)).map_err(|e| format!("{}: izin: {e}", yol.display()))
}

fn var(yol: &Path) -> bool {
    std::fs::symlink_metadata(yol).is_ok()
}

/// Dosyayı geçici ad + `rename` ile yazar (yarım dosya kalmaz), kipini koyar.
fn dosya_yaz(yol: &Path, icerik: &[u8], mode: u32) -> Result<(), String> {
    let gecici = yol.with_extension("gecis-yazim");
    let _ = std::fs::remove_file(&gecici);
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&gecici).map_err(|e| format!("{}: {e}", gecici.display()))?;
    f.write_all(icerik).and_then(|()| f.sync_all()).map_err(|e| format!("{}: {e}", gecici.display()))?;
    drop(f);
    kip(&gecici, mode)?;
    std::fs::rename(&gecici, yol).map_err(|e| format!("{}: {e}", yol.display()))
}

// ── Geri alma kaydı ─────────────────────────────────────────────────────────────────────────────

/// Yapılan her yan etkinin tersi; günlüğe YAPILMADAN ÖNCE yazılır (yarım etki de geri alınır).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Geri {
    /// Bu geçişin yarattığı dosya/dizin/bağ: `geri-alinan/`e taşınır.
    Yaratildi(PathBuf),
    /// Bu geçişin yarattığı dizin (boşsa kaldırılır; doluysa kalır).
    Dizin(PathBuf),
    /// Taşınan dosya: yerine geri taşınır.
    Tasindi { kaynak: PathBuf, hedef: PathBuf },
    /// Yeni compose ile `up` koşuldu: eski compose ile yeniden `up` + eski kurulumun sağlığı.
    EskiCompose,
    /// systemd birimi kuruldu: durdur + kaldır.
    Birim(String),
}

impl Geri {
    fn json(&self) -> Value {
        let s = |x: &Path| x.to_string_lossy().into_owned();
        match self {
            Geri::Yaratildi(y) => json!({ "tip": "yaratildi", "yol": s(y) }),
            Geri::Dizin(y) => json!({ "tip": "dizin", "yol": s(y) }),
            Geri::Tasindi { kaynak, hedef } => json!({ "tip": "tasindi", "kaynak": s(kaynak), "hedef": s(hedef) }),
            Geri::EskiCompose => json!({ "tip": "eskiCompose" }),
            Geri::Birim(ad) => json!({ "tip": "birim", "ad": ad }),
        }
    }
    fn coz(v: &Value) -> Option<Geri> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(PathBuf::from);
        Some(match v.get("tip")?.as_str()? {
            "yaratildi" => Geri::Yaratildi(s("yol")?),
            "dizin" => Geri::Dizin(s("yol")?),
            "tasindi" => Geri::Tasindi { kaynak: s("kaynak")?, hedef: s("hedef")? },
            "eskiCompose" => Geri::EskiCompose,
            "birim" => Geri::Birim(v.get("ad")?.as_str()?.to_string()),
            _ => return None,
        })
    }
    fn anlat(&self) -> String {
        match self {
            Geri::Yaratildi(y) => format!("{} → geri-alinan/", y.display()),
            Geri::Dizin(y) => format!("{} (boşsa kaldırılır)", y.display()),
            Geri::Tasindi { kaynak, hedef } => format!("{} → {}", hedef.display(), kaynak.display()),
            Geri::EskiCompose => "eski compose ile `up -d` + eski kurulumun sağlığı".into(),
            Geri::Birim(ad) => format!("{ad}.service durdurulur ve kaldırılır"),
        }
    }
}

/// `<kök>/gecis/<damga>/gunluk.jsonl`: başlık · kalem BASLADI/BITTI · geri kayıtları · SONUC. Her satır fsync'lenir.
pub struct Gunluk {
    pub dizin: PathBuf,
    yol: PathBuf,
}

impl Gunluk {
    fn ac(dizin: &Path) -> Result<Gunluk, String> {
        std::fs::create_dir_all(dizin).map_err(|e| format!("{}: {e}", dizin.display()))?;
        Ok(Gunluk { dizin: dizin.to_path_buf(), yol: dizin.join(GUNLUK) })
    }
    fn yaz(&self, v: Value) -> Result<(), String> {
        let mut f =
            std::fs::OpenOptions::new().create(true).append(true).open(&self.yol).map_err(|e| format!("{}: {e}", self.yol.display()))?;
        writeln!(f, "{v}").and_then(|()| f.sync_data()).map_err(|e| format!("{}: {e}", self.yol.display()))
    }
    fn satirlar(yol: &Path) -> Vec<Value> {
        std::fs::read_to_string(yol).unwrap_or_default().lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }
}

/// Bir geçiş günlüğünün özeti.
#[derive(Debug, Clone)]
pub struct GecisKaydi {
    pub dizin: PathBuf,
    pub surum: String,
    pub proje: String,
    /// Son SONUC (`BASARILI` · `GERI_ALINDI` · `GERI_ALMA_EKSIK`); yoksa yarım.
    pub sonuc: Option<String>,
    pub geri: Vec<Geri>,
}

fn gecis_kaydi(dizin: &Path) -> Option<GecisKaydi> {
    let lines = Gunluk::satirlar(&dizin.join(GUNLUK));
    let bas = lines.iter().find(|v| v.get("tur").and_then(Value::as_str) == Some("BASLIK"))?;
    let s = |k: &str| bas.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let sonuc = lines
        .iter()
        .rev()
        .find(|v| v.get("tur").and_then(Value::as_str) == Some("SONUC"))
        .and_then(|v| v.get("sonuc")?.as_str().map(str::to_string));
    let geri =
        lines.iter().filter(|v| v.get("tur").and_then(Value::as_str) == Some("GERI")).filter_map(|v| Geri::coz(v.get("geri")?)).collect();
    Some(GecisKaydi { dizin: dizin.to_path_buf(), surum: s("surum"), proje: s("proje"), sonuc, geri })
}

/// Kökteki geçiş günlükleri, eskiden yeniye (damga sırası).
pub fn gecis_kayitlari(kok: &Path) -> Vec<GecisKaydi> {
    let mut adlar: Vec<String> = std::fs::read_dir(kok.join(GECIS_DIZINI))
        .map(|it| it.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    adlar.sort();
    adlar.iter().filter_map(|a| gecis_kaydi(&kok.join(GECIS_DIZINI).join(a))).collect()
}

/// Uygulayıcı: kalem kalem yürür, her yan etkiyi önce günlüğe yazar.
struct Uygulayici<'a> {
    b: &'a Baglam<'a>,
    gunluk: Gunluk,
    geri: Vec<Geri>,
}

impl Uygulayici<'_> {
    fn kayit(&mut self, g: Geri) -> Result<(), String> {
        self.gunluk.yaz(json!({ "tur": "GERI", "geri": g.json() }))?;
        self.geri.push(g);
        Ok(())
    }
    /// Yoksa yaratır (kipiyle; sahibi verilirse sahiplenir) ve geri kaydını düşer; varsa yalnız kipi/sahibi denetler.
    fn dizin(&mut self, yol: &Path, mode: u32, sahip: Option<u32>) -> Result<(), String> {
        if !var(yol) {
            if let Some(ust) = yol.parent() {
                if !var(ust) {
                    self.dizin(ust, 0o755, None)?;
                }
            }
            self.kayit(Geri::Dizin(yol.to_path_buf()))?;
            std::fs::create_dir(yol).map_err(|e| format!("{}: {e}", yol.display()))?;
        }
        kip(yol, mode)?;
        if let Some(uid) = sahip {
            self.b.konak.sahiplen(yol, uid)?;
        }
        Ok(())
    }
    fn kalem<T>(&mut self, ad: &str, f: impl FnOnce(&mut Self) -> Result<T, String>) -> Result<T, String> {
        (self.b.yaz)(&format!("▶ {ad}"));
        self.gunluk.yaz(json!({ "tur": "KALEM", "kalem": ad, "durum": "BASLADI" }))?;
        let r = f(self);
        let durum = if r.is_ok() { "BITTI" } else { "DUSTU" };
        let _ = self.gunluk.yaz(json!({ "tur": "KALEM", "kalem": ad, "durum": durum, "hata": r.as_ref().err() }));
        r
    }
}

// ── İskelet (kur ve gecis ortak) ────────────────────────────────────────────────────────────────

fn iskelet(u: &mut Uygulayici, l: &Layout, proje: &str, sunucu: &str, pg_imaj: &str, yedek_alan: u64) -> Result<(), String> {
    u.dizin(&l.versions(), 0o755, None)?;
    u.dizin(&l.root.join(p::CONFIG), 0o700, None)?;
    u.dizin(&l.updater_dir(), 0o755, None)?;
    for d in duzen::ipc_dizinleri(l) {
        let uid = match d.sahip {
            duzen::Sahip::Backend => Some(duzen::BACKEND_UID),
            duzen::Sahip::Guncelleyici => None,
        };
        u.dizin(&d.yol, d.kip, uid)?;
    }
    let ayar = l.settings_file();
    if !var(&ayar) {
        u.kayit(Geri::Yaratildi(ayar.clone()))?;
        let v = json!({ "guncellemeSunucusu": sunucu, "composeProje": proje });
        dosya_yaz(&ayar, format!("{}\n", serde_json::to_string_pretty(&v).unwrap_or_default()).as_bytes(), 0o600)?;
    }
    let pg = duzen::pg_env(l);
    if !var(&pg) {
        u.kayit(Geri::Yaratildi(pg.clone()))?;
        dosya_yaz(&pg, format!("TEKSERP_PG_IMAJ={pg_imaj}\n").as_bytes(), 0o600)?;
    }
    let ra = l.reserve_file();
    if !var(&ra) {
        u.kayit(Geri::Yaratildi(ra))?;
    }
    crate::reserve::ensure(u.b.env.fs.as_ref(), l, yedek_alan).map_err(|e| format!("yedek alan: {e}"))?;
    Ok(())
}

/// İskeletin ölçümü: var olan ayar/pg.env kurulumla çelişiyor mu (çelişki = DUR; üzerine yazılmaz).
fn iskelet_celiskisi(l: &Layout, proje: &str, sunucu: &str, pg_imaj: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    if var(&l.settings_file()) {
        match settings::read_settings(&crate::env::RealFs, l) {
            Ok(s) if s.compose_project() == proje && s.server.as_deref() == Some(sunucu) => {}
            Ok(s) => out.push(format!(
                "{}: composeProje {:?} / sunucu {:?} — beklenen {proje} / {sunucu}",
                l.settings_file().display(),
                s.compose_project(),
                s.server
            )),
            Err(e) => out.push(e),
        }
    }
    if let (Some(img), true) = (pg_imaj, var(&duzen::pg_env(l))) {
        if env_degeri(&duzen::pg_env(l), "TEKSERP_PG_IMAJ").as_deref() != Some(img) {
            out.push(format!("{}: TEKSERP_PG_IMAJ çalışan PG imajı ({img}) değil", duzen::pg_env(l).display()));
        }
    }
    out
}

/// Paketi `surumler/<v>`e açar (`kurulum-paket --tar` ile aynı doğrulama) ya da var olanı yeniden ölçer.
fn paket(u: &mut Uygulayici, l: &Layout, tar: &Path, v: &str) -> Result<crate::oci::OciKunye, String> {
    let hedef = l.version_dir(v);
    if var(&hedef) {
        return crate::oci::verify_dir(&hedef, &crate::env::RealFs, u.b.trust)
            .map_err(|e| format!("{}: {}: {}", hedef.display(), e.code, e.message));
    }
    u.kayit(Geri::Yaratildi(hedef.clone()))?;
    crate::kurulum::oci_paketi(tar, &hedef, u.b.trust).map(|(_, k)| k).map_err(|e| format!("{}: {}", e.kod, e.mesaj))
}

fn current_kur(u: &mut Uygulayici, l: &Layout, v: &str) -> Result<(), String> {
    match u.b.env.fs.link_target(&l.current()) {
        Ok(Some(t)) if t.file_name().is_some_and(|n| n == v) => return Ok(()),
        Ok(Some(t)) => return Err(format!("current başka sürümü gösteriyor: {}", t.display())),
        _ if var(&l.current()) => return Err(format!("{} bağlantı değil", l.current().display())),
        _ => {}
    }
    u.kayit(Geri::Yaratildi(l.current()))?;
    u.b.env.fs.set_link(&l.current(), &l.version_dir(v)).map_err(|e| format!("current: {e}"))
}

/// Paketteki ikiliyi asıl yere (`guncelleyici/tekserp-guncelleyici`, 0755) koyar ve özetini künyeyle ölçer.
fn ikili_koy(u: &mut Uygulayici, l: &Layout, v: &str, sha: &str) -> Result<(), String> {
    let asil = super::birim::asil_ikili(&l.root);
    if sha256_dosya(&asil).ok().as_deref() == Some(sha) {
        return Ok(());
    }
    if var(&asil) {
        let geri = u.gunluk.dizin.join("geri").join(super::birim::IKILI);
        std::fs::create_dir_all(geri.parent().unwrap_or(&u.gunluk.dizin)).map_err(|e| e.to_string())?;
        u.kayit(Geri::Tasindi { kaynak: asil.clone(), hedef: geri.clone() })?;
        std::fs::rename(&asil, &geri).map_err(|e| format!("{}: {e}", asil.display()))?;
    }
    u.kayit(Geri::Yaratildi(asil.clone()))?;
    let icerik = std::fs::read(l.version_dir(v).join(crate::oci::GUNCELLEYICI)).map_err(|e| format!("paketteki ikili: {e}"))?;
    dosya_yaz(&asil, &icerik, 0o755)?;
    let olc = sha256_dosya(&asil)?;
    if olc != sha {
        return Err(format!("{} özeti {olc} — künye {sha}", asil.display()));
    }
    Ok(())
}

fn guncelleyici(u: &mut Uygulayici, l: &Layout, ad: &str) -> Result<(), String> {
    if !u.b.konak.birim_var(ad) {
        u.kayit(Geri::Birim(ad.to_string()))?;
    }
    u.b.konak.birim_kur(&l.root, &l.data, ad)?;
    u.b.konak.birim_baslat(ad)?;
    if !u.b.konak.birim_etkin(ad) {
        return Err(format!("{ad}.service başlatıldı ama etkin değil (journalctl -u {ad})"));
    }
    Ok(())
}

/// Sağlık bekleme süresi: kurulumun `ayar.json`ı (yoksa varsayılan).
fn sure(l: &Layout) -> Duration {
    settings::read_settings(&crate::env::RealFs, l).unwrap_or_default().health_timeout()
}

fn yeni_saglik(env: &Env, v: &str, taban: Option<&Health>, timeout: Duration) -> Result<Health, String> {
    let c = Criteria {
        version: v.to_string(),
        require_license: taban.is_some_and(|h| h.local),
        baseline: taban.and_then(|h| h.license.clone()),
    };
    health::wait_healthy(env, 4000, &c, timeout, None).map_err(|(k, m)| format!("{k}: {m}"))
}

/// Yeni compose ile bütün proje (`up -d`; etiket kaydı önce ölçülür — kayıtsız etiketle başlamaz).
fn yeni_up(env: &Env, komut: &DockerKomut) -> Result<(), String> {
    docker::etiket_dogrula(env.fs.as_ref(), env.procs.as_ref(), komut)?;
    let c = komut.compose().args(["up", "-d"]).env("TEKSERP_DOGRULAMA_KIPI", "").timeout(Duration::from_secs(600));
    calistir(env, &c, "compose up").map(|_| ())
}

// ── gecis ───────────────────────────────────────────────────────────────────────────────────────

/// Elle kurulumun ölçümü (salt-okur).
#[derive(Debug, Clone)]
pub struct Envanter {
    pub proje: String,
    pub surum: String,
    pub override_var: bool,
    pub pg_imaj: String,
    pub taban: Health,
}

fn dur(b: &Baglam, neden: &str) -> u32 {
    (b.yaz)(&format!("DUR: {neden}"));
    cikis::DUR
}

/// Elle kurulumun eski compose başı (dosyalar kökte ya da `geri/`de): elle `docker compose up -d`nin aynısı.
fn eski_compose(kok: &Path, dizin: &Path, proje: &str) -> Cmd {
    let s = |x: PathBuf| x.to_string_lossy().into_owned();
    let mut c = docker_cmd().args(["compose", "-p", proje, "--project-directory"]).arg(s(kok.to_path_buf()));
    c = c.arg("-f").arg(s(dizin.join(ESKI_COMPOSE)));
    if var(&dizin.join(ESKI_OVERRIDE)) {
        c = c.arg("-f").arg(s(dizin.join(ESKI_OVERRIDE)));
    }
    c.arg("--env-file").arg(s(dizin.join(ESKI_ENV)))
}

pub fn envanter(b: &Baglam, s: &Secenek) -> Result<Envanter, String> {
    let kok = &s.kok;
    for f in [ESKI_COMPOSE, ESKI_ENV] {
        if !kok.join(f).is_file() {
            return Err(format!("{}: elle kurulumun dosyası yok", kok.join(f).display()));
        }
    }
    let l = Layout::new(kok, &s.veri);
    if var(&l.current()) {
        return Err(format!("{} var — kök zaten güncelleyici düzeninde", l.current().display()));
    }
    if std::fs::metadata(l.journal_file()).is_ok_and(|m| m.len() > 0) {
        return Err(format!("{} dolu — bu veri kökünde güncelleyici çalışmış", l.journal_file().display()));
    }
    if b.konak.birim_var(&s.ad) {
        return Err(format!("{}.service zaten kayıtlı", s.ad));
    }
    let eski_env = kok.join(ESKI_ENV);
    let proje = env_degeri(&eski_env, "TEKSERP_PROJE").unwrap_or_else(|| settings::DEFAULT_COMPOSE_PROJECT.to_string());
    if !duzen::valid_project(&proje) {
        return Err(format!("TEKSERP_PROJE geçersiz: {proje:?}"));
    }
    let tar = s.tar.as_deref().ok_or("--tar <paket> gerekli")?;
    let surum = crate::kurulum::oci_surumu(tar).map_err(|e| format!("{}: {}", e.kod, e.mesaj))?;
    let etiket = crate::oci::image_tag(&surum);
    match env_degeri(&eski_env, "TEKSERP_IMAJ") {
        Some(i) if i == etiket => {}
        other => return Err(format!("elle kurulumun imajı {other:?}, paket {etiket} — aynı sürümün paketi gerekir")),
    }
    for v in GEREKLI_BIRIMLER {
        let ad = duzen::birim_adi(&proje, v);
        calistir(b.env, &docker_cmd().args(["volume", "inspect", "--format", "{{.Name}}", ad.as_str()]), "docker volume inspect")
            .map_err(|_| format!("Docker birimi {ad} yok — proje adı ya da kurulum beklenen değil"))?;
    }
    proje_konteyneri(b.env, &proje, docker::BACKEND)?.ok_or_else(|| format!("{proje} projesinde çalışan backend yok"))?;
    let pg = proje_konteyneri(b.env, &proje, "postgres")?.ok_or_else(|| format!("{proje} projesinde çalışan postgres yok"))?;
    let pg_imaj = String::from_utf8_lossy(
        &calistir(b.env, &docker_cmd().args(["inspect", "--format", "{{.Config.Image}}", pg.as_str()]), "docker inspect")?.stdout,
    )
    .trim()
    .to_string();
    if pg_imaj.is_empty() {
        return Err("çalışan postgres konteynerinin imajı okunamadı".into());
    }
    let taban = health::probe(&proje_env(b.env, &proje), 4000).ok_or("eski backend'in sağlığı ölçülemedi")?;
    if !taban.up || !taban.db_up || taban.version.as_deref() != Some(surum.as_str()) {
        return Err(format!("eski backend sağlıklı değil ya da sürümü {:?} (paket {surum})", taban.version));
    }
    let celiski = iskelet_celiskisi(&l, &proje, &s.sunucu, Some(&pg_imaj));
    if !celiski.is_empty() {
        return Err(celiski.join(" · "));
    }
    Ok(Envanter { proje, surum, override_var: kok.join(ESKI_OVERRIDE).is_file(), pg_imaj, taban })
}

pub const GECIS_KALEMLERI: [(&str, &str); 10] = [
    ("GUNLUK", "gecis/<damga>/gunluk.jsonl açılır"),
    ("ISKELET", "dizinler + izinler, guncelleyici/ayar.json, yapilandirma/pg.env (çalışan PG imajı), yedek alan"),
    ("PAKET", "paket surumler/<v>'e açılır ve imzasıyla doğrulanır"),
    ("YAPILANDIRMA", ".env → yapilandirma/.env (kopya, 0600); override → yapilandirma/docker-compose.yerel.yml"),
    ("COMPOSE", "imzalı compose + yerel dosya birlikte kurallardan geçer"),
    ("IMAJ", "yüklü imaj ölçülür (yeniden yüklenmez) ve etiket kaydı yazılır"),
    ("CURRENT", "current → surumler/<v>"),
    ("GECIS", "yeni compose ile up -d + sağlık (sürüm aynı, lisans kötüleşmez)"),
    ("ESKI_DOSYALAR", "docker-compose.yml, .env, override → gecis/<damga>/geri/"),
    ("GUNCELLEYICI", "ikili guncelleyici/'ye, systemd birimi kurulur ve başlatılır"),
];

pub fn gecis(b: &Baglam, s: &Secenek) -> u32 {
    let kayitlar = gecis_kayitlari(&s.kok);
    if let Some(k) = kayitlar.iter().find(|k| k.sonuc.is_none()) {
        return dur(b, &format!("yarım geçiş var: {} — önce `gecis --geri-al` ya da elle inceleme", k.dizin.display()));
    }
    let env_ = match envanter(b, s) {
        Ok(e) => e,
        Err(e) => return dur(b, &e),
    };
    let n = GECIS_KALEMLERI.len();
    (b.yaz)(&format!(
        "ENVANTER: kök {} · proje {} · sürüm {} · override {} · PG imajı {} · eski backend sağlıklı ({})",
        s.kok.display(),
        env_.proje,
        env_.surum,
        if env_.override_var { "var" } else { "yok" },
        env_.pg_imaj,
        health::url(&proje_env(b.env, &env_.proje), 4000)
    ));
    (b.yaz)(&format!("PLAN ({n} kalem):"));
    for (i, (ad, ne)) in GECIS_KALEMLERI.iter().enumerate() {
        (b.yaz)(&format!("  {}. {ad} — {ne}", i + 1));
    }
    if !s.uygula {
        (b.yaz)(&format!(
            "KURU koşum: hiçbir şey yazılmadı. Uygulamak için: gecis --kok {} --tar <paket> --uygula --onay {n}",
            s.kok.display()
        ));
        return cikis::TAMAM;
    }
    if s.onay != Some(n) {
        return dur(b, &format!("--onay {n} gerekli (plan {n} kalem; verilen {:?})", s.onay));
    }
    if !b.konak.root() {
        return dur(b, "gecis --uygula root ister (sudo)");
    }
    let dizin = s.kok.join(GECIS_DIZINI).join(&s.damga);
    if var(&dizin) {
        return dur(b, &format!("{} zaten var", dizin.display()));
    }
    let gunluk = match Gunluk::ac(&dizin) {
        Ok(g) => g,
        Err(e) => return dur(b, &e),
    };
    let mut u = Uygulayici { b, gunluk, geri: vec![] };
    let bas = json!({ "tur": "BASLIK", "v": 1, "komut": "gecis", "surum": env_.surum, "proje": env_.proje, "kok": s.kok, "veri": s.veri, "ad": s.ad });
    if let Err(e) = u.gunluk.yaz(bas) {
        return dur(b, &e);
    }
    match gecis_uygula(&mut u, s, &env_) {
        Ok(()) => {
            let _ = u.gunluk.yaz(json!({ "tur": "SONUC", "sonuc": "BASARILI" }));
            (b.yaz)(&format!(
                "TAMAM: {} güncelleyici düzeninde (sürüm {}); günlük {}. Geri almak için: gecis --geri-al --kok {}",
                s.kok.display(),
                env_.surum,
                u.gunluk.yol.display(),
                s.kok.display()
            ));
            cikis::TAMAM
        }
        Err(e) => {
            (b.yaz)(&format!("HATA: {e} — geçiş kendiliğinden geri alınıyor"));
            let geri = std::mem::take(&mut u.geri);
            geri_al_sonuc(&u, &geri, s, &env_.proje, &env_.surum)
        }
    }
}

fn gecis_uygula(u: &mut Uygulayici, s: &Secenek, e: &Envanter) -> Result<(), String> {
    let l = Layout::new(&s.kok, &s.veri);
    u.kalem("GUNLUK", |_| Ok(()))?;
    u.kalem("ISKELET", |u| iskelet(u, &l, &e.proje, &s.sunucu, &e.pg_imaj, s.yedek_alan))?;
    let kunye = u.kalem("PAKET", |u| paket(u, &l, s.tar.as_deref().unwrap_or(Path::new("")), &e.surum))?;
    u.kalem("YAPILANDIRMA", |u| {
        for (kaynak, hedef) in [(s.kok.join(ESKI_ENV), l.backend_env()), (s.kok.join(ESKI_OVERRIDE), duzen::yerel_compose(&l))] {
            if !kaynak.is_file() {
                continue;
            }
            if var(&hedef) {
                return Err(format!("{} zaten var", hedef.display()));
            }
            u.kayit(Geri::Yaratildi(hedef.clone()))?;
            let icerik = std::fs::read(&kaynak).map_err(|e| format!("{}: {e}", kaynak.display()))?;
            dosya_yaz(&hedef, &icerik, 0o600)?;
        }
        settings::read_backend_env_in(&crate::env::RealFs, &l, OrtamKipi::Compose).map(|_| ()).map_err(|f| format!("{}: {}", f.0, f.1))
    })?;
    let komut = Arc::new(DockerKomut::new(&l, &e.proje)?);
    let denv = docker_env(u.b.env, &komut);
    let araclar = DockerAraclar::new(Arc::clone(&komut));
    let dir = l.version_dir(&e.surum);
    u.kalem("COMPOSE", |_| araclar.compose_denetle(&denv, &dir, &e.surum))?;
    u.kalem("IMAJ", |u| {
        let kd = crate::imaj::kayit_dizini(&l);
        if !var(&kd) {
            u.kayit(Geri::Dizin(kd))?;
        }
        let kayit = crate::imaj::kayit_yolu(&l, &e.surum);
        if !var(&kayit) {
            u.kayit(Geri::Yaratildi(kayit))?;
        }
        let arsiv = dir.join(crate::oci::image_archive(&e.surum));
        araclar.imaj_kaydet_ya_da_yukle(&denv, &arsiv, &e.surum, &kunye.image_id).map(|_| ()).map_err(|(k, m)| format!("{k}: {m}"))
    })?;
    u.kalem("CURRENT", |u| current_kur(u, &l, &e.surum))?;
    u.kalem("GECIS", |u| {
        u.kayit(Geri::EskiCompose)?;
        yeni_up(&denv, &komut)?;
        yeni_saglik(&denv, &e.surum, Some(&e.taban), sure(&l)).map(|_| ())
    })?;
    u.kalem("ESKI_DOSYALAR", |u| {
        let geri = u.gunluk.dizin.join("geri");
        std::fs::create_dir_all(&geri).map_err(|e| format!("{}: {e}", geri.display()))?;
        for f in [ESKI_COMPOSE, ESKI_ENV, ESKI_OVERRIDE] {
            let kaynak = s.kok.join(f);
            if !var(&kaynak) {
                continue;
            }
            u.kayit(Geri::Tasindi { kaynak: kaynak.clone(), hedef: geri.join(f) })?;
            std::fs::rename(&kaynak, geri.join(f)).map_err(|e| format!("{}: {e}", kaynak.display()))?;
        }
        Ok(())
    })?;
    u.kalem("GUNCELLEYICI", |u| {
        ikili_koy(u, &l, &e.surum, &kunye.updater_sha256)?;
        guncelleyici(u, &l, &s.ad)
    })
}

/// Bir geri kaydını uygular; `false` = başaramadı (ekrana ve günlüğe yazıldı).
fn geri_uygula(u: &Uygulayici, g: &Geri, s: &Secenek, proje: &str, surum: &str, sira: usize) -> bool {
    let alinan = u.gunluk.dizin.join("geri-alinan");
    let r: Result<(), String> = match g {
        Geri::Birim(ad) => u.b.konak.birim_kaldir(ad),
        Geri::Tasindi { kaynak, hedef } => {
            if var(hedef) && !var(kaynak) {
                std::fs::rename(hedef, kaynak).map_err(|e| format!("{}: {e}", hedef.display()))
            } else {
                Ok(())
            }
        }
        Geri::Yaratildi(y) => {
            if var(y) {
                let ad = y.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                let to = alinan.join(format!("{sira:02}-{ad}"));
                std::fs::create_dir_all(&alinan)
                    .and_then(|()| std::fs::rename(y, &to))
                    .or_else(|_| std::fs::copy(y, &to).and_then(|_| std::fs::remove_file(y)))
                    .map_err(|e| format!("{}: {e}", y.display()))
            } else {
                Ok(())
            }
        }
        Geri::Dizin(y) => {
            let _ = std::fs::remove_dir(y);
            Ok(())
        }
        Geri::EskiCompose => {
            let c =
                eski_compose(&s.kok, &s.kok, proje).args(["up", "-d"]).env("TEKSERP_DOGRULAMA_KIPI", "").timeout(Duration::from_secs(600));
            calistir(u.b.env, &c, "eski compose up").and_then(|_| {
                let pe = proje_env(u.b.env, proje);
                let c = Criteria { version: surum.to_string(), require_license: false, baseline: None };
                health::wait_healthy(&pe, 4000, &c, sure(&Layout::new(&s.kok, &s.veri)), None)
                    .map(|_| ())
                    .map_err(|(k, m)| format!("eski kurulumun sağlığı: {k}: {m}"))
            })
        }
    };
    let _ = u.gunluk.yaz(json!({ "tur": "GERI_ALINDI", "geri": g.json(), "hata": r.as_ref().err() }));
    match r {
        Ok(()) => {
            (u.b.yaz)(&format!("  geri: {}", g.anlat()));
            true
        }
        Err(e) => {
            (u.b.yaz)(&format!("  GERİ ALINAMADI: {} — {e}", g.anlat()));
            false
        }
    }
}

fn geri_al_sonuc(u: &Uygulayici, geri: &[Geri], s: &Secenek, proje: &str, surum: &str) -> u32 {
    let mut eksik = false;
    for (i, g) in geri.iter().enumerate().rev() {
        eksik |= !geri_uygula(u, g, s, proje, surum, i);
    }
    let sonuc = if eksik { "GERI_ALMA_EKSIK" } else { "GERI_ALINDI" };
    let _ = u.gunluk.yaz(json!({ "tur": "SONUC", "sonuc": sonuc }));
    (u.b.yaz)(&format!("{sonuc}: günlük {}", u.gunluk.yol.display()));
    if eksik {
        cikis::GERI_ALMA_EKSIK
    } else {
        cikis::GERI_ALINDI
    }
}

/// `gecis --geri-al`: son BAŞARILI geçişi tersine çevirir — yalnız güncelleyici hiç işlem yapmadıysa ve `current` hâlâ
/// geçişin sürümündeyse (yoksa geri alma elle/yedekten).
pub fn gecis_geri_al(b: &Baglam, s: &Secenek) -> u32 {
    let kayitlar = gecis_kayitlari(&s.kok);
    let Some(k) = kayitlar.last().filter(|k| k.sonuc.as_deref() == Some("BASARILI")) else {
        return dur(b, "geri alınacak başarılı geçiş yok (son geçiş başarılı değil ya da hiç yok)");
    };
    let l = Layout::new(&s.kok, &s.veri);
    if std::fs::metadata(l.journal_file()).is_ok_and(|m| m.len() > 0) {
        return dur(b, &format!("güncelleyici işlem yaptı ({}) — geri alma elle/yedekten", l.journal_file().display()));
    }
    match b.env.fs.link_target(&l.current()) {
        Ok(Some(t)) if t.file_name().is_some_and(|n| n.to_string_lossy() == k.surum) => {}
        other => return dur(b, &format!("current geçişin sürümünde ({}) değil: {other:?} — geri alma elle/yedekten", k.surum)),
    }
    let n = k.geri.len();
    (b.yaz)(&format!("GERİ ALMA PLANI ({n} kalem, sondan başa; geçiş {}):", k.dizin.display()));
    for (i, g) in k.geri.iter().enumerate().rev() {
        (b.yaz)(&format!("  {}. {}", n - i, g.anlat()));
    }
    if !s.uygula {
        (b.yaz)(&format!(
            "KURU koşum: hiçbir şey yazılmadı. Uygulamak için: gecis --geri-al --kok {} --uygula --onay {n}",
            s.kok.display()
        ));
        return cikis::TAMAM;
    }
    if s.onay != Some(n) {
        return dur(b, &format!("--onay {n} gerekli (plan {n} kalem; verilen {:?})", s.onay));
    }
    if !b.konak.root() {
        return dur(b, "gecis --geri-al --uygula root ister (sudo)");
    }
    let u = Uygulayici { b, gunluk: Gunluk { dizin: k.dizin.clone(), yol: k.dizin.join(GUNLUK) }, geri: vec![] };
    let _ = u.gunluk.yaz(json!({ "tur": "GERI_AL", "durum": "BASLADI" }));
    match geri_al_sonuc(&u, &k.geri, s, &k.proje, &k.surum) {
        cikis::GERI_ALINDI => cikis::TAMAM,
        r => r,
    }
}

// ── kur ─────────────────────────────────────────────────────────────────────────────────────────

/// Yeni kurulum (§8.1 madde 2–5; kur.mjs adım 6–7). Önkoşul `yapilandirma/.env` (kurulum aracı yazar). Her adım
/// ölçer → gerekiyorsa yapar → doğrular; ikinci koşum yapılacak bir şey bulmaz. Geri alma yok: yarım kurulum yeniden
/// koşulur.
pub fn kur(b: &Baglam, s: &Secenek) -> u32 {
    let Some(proje) = s.proje.clone().filter(|p| duzen::valid_project(p)) else {
        return dur(b, "--proje <ad> gerekli ([a-z0-9][a-z0-9_-]*)");
    };
    let Some(tar) = s.tar.clone() else { return dur(b, "--tar <paket> gerekli") };
    let l = Layout::new(&s.kok, &s.veri);
    if !l.backend_env().is_file() {
        return dur(b, &format!("{} yok — kurulum aracı önce .env'i yazar", l.backend_env().display()));
    }
    let v = match crate::kurulum::oci_surumu(&tar) {
        Ok(v) => v,
        Err(e) => return dur(b, &format!("{}: {}", e.kod, e.mesaj)),
    };
    if let Ok(Some(t)) = b.env.fs.link_target(&l.current()) {
        if t.file_name().is_none_or(|n| n.to_string_lossy() != v) {
            return dur(b, &format!("current başka sürümü gösteriyor ({}) — kurulum güncellemenin yerine geçmez", t.display()));
        }
    }
    let pg_imaj = env_degeri(&duzen::pg_env(&l), "TEKSERP_PG_IMAJ").unwrap_or_else(|| VARSAYILAN_PG_IMAJI.to_string());
    let celiski = iskelet_celiskisi(&l, &proje, &s.sunucu, None);
    if !celiski.is_empty() {
        return dur(b, &celiski.join(" · "));
    }
    let komut = match DockerKomut::new(&l, &proje) {
        Ok(k) => Arc::new(k),
        Err(e) => return dur(b, &e),
    };
    let denv = docker_env(b.env, &komut);
    let araclar = DockerAraclar::new(Arc::clone(&komut));
    if calistir(b.env, &docker_cmd().args(["image", "inspect", "--format", "{{.Id}}", pg_imaj.as_str()]), "docker image inspect").is_err() {
        return dur(b, &format!("PG imajı {pg_imaj} yerelde yok (pull_policy: never) — önce `docker pull {pg_imaj}`"));
    }
    // Ölç: neler hazır.
    let paket_var = var(&l.version_dir(&v));
    let imaj_hazir = paket_var && {
        let kunye = crate::oci::verify_dir(&l.version_dir(&v), &crate::env::RealFs, b.trust).ok();
        kunye.is_some_and(|k| crate::platform::Araclar::imaj_hazir(&araclar, &denv, &v, &k.image_id))
    };
    let saglikli =
        var(&l.current()) && health::probe(&denv, 4000).is_some_and(|h| h.up && h.db_up && h.version.as_deref() == Some(v.as_str()));
    let ikili_tamam = paket_var
        && crate::oci::verify_dir(&l.version_dir(&v), &crate::env::RealFs, b.trust)
            .ok()
            .is_some_and(|k| sha256_dosya(&super::birim::asil_ikili(&l.root)).ok() == Some(k.updater_sha256));
    let birim_tamam = ikili_tamam && b.konak.birim_var(&s.ad) && b.konak.birim_etkin(&s.ad);
    let iskelet_tamam = [l.versions(), l.root.join(p::CONFIG), l.updater_dir(), l.settings_file(), duzen::pg_env(&l), l.reserve_file()]
        .iter()
        .all(|y| var(y))
        && duzen::ipc_dizinleri(&l).iter().all(|d| var(&d.yol));
    let mut plan: Vec<(&str, String)> = Vec::new();
    if !iskelet_tamam {
        plan.push(("ISKELET", "dizinler + izinler, ayar.json, pg.env, yedek alan".into()));
    }
    if !paket_var {
        plan.push(("PAKET", format!("paket surumler/{v}'e açılır ve doğrulanır")));
    }
    plan.push(("COMPOSE", "imzalı compose (+ yerel dosya) kurallardan geçer".into()));
    if !imaj_hazir {
        plan.push(("IMAJ", format!("{} yüklenir/ölçülür, etiket kaydı yazılır", crate::oci::image_tag(&v))));
    }
    if !var(&l.current()) {
        plan.push(("CURRENT", format!("current → surumler/{v}")));
    }
    if !saglikli {
        plan.push(("ILK_GOC", "postgres başlatılır, göç aracı koşar".into()));
        plan.push(("BASLAT", "etiket ölçülür, compose up -d, sağlık".into()));
    }
    if !birim_tamam {
        plan.push(("GUNCELLEYICI", format!("ikili guncelleyici/'ye, {}.service kurulur ve başlatılır", s.ad)));
    }
    let yapilacak = plan.iter().filter(|(a, _)| *a != "COMPOSE").count();
    (b.yaz)(&format!("KURULUM: kök {} · veri {} · proje {proje} · sürüm {v} · PG imajı {pg_imaj}", s.kok.display(), s.veri.display()));
    if yapilacak == 0 {
        (b.yaz)("kurulum tam — yapılacak bir şey yok");
        return cikis::TAMAM;
    }
    (b.yaz)(&format!("PLAN ({} kalem):", plan.len()));
    for (i, (ad, ne)) in plan.iter().enumerate() {
        (b.yaz)(&format!("  {}. {ad} — {ne}", i + 1));
    }
    if !s.uygula {
        (b.yaz)("KURU koşum: hiçbir şey yazılmadı. Uygulamak için aynı komut + --uygula");
        return cikis::TAMAM;
    }
    if !b.konak.root() {
        return dur(b, "kur --uygula root ister (sudo)");
    }
    let dizin = l.work().join("kurulum");
    let gunluk = match std::fs::create_dir_all(l.work()).map_err(|e| e.to_string()).and_then(|()| Gunluk::ac(&dizin)) {
        Ok(g) => g,
        Err(e) => return dur(b, &e),
    };
    let mut u = Uygulayici { b, gunluk, geri: vec![] };
    let _ = u.gunluk.yaz(json!({ "tur": "BASLIK", "v": 1, "komut": "kur", "surum": v, "proje": proje, "damga": s.damga }));
    let r = (|| -> Result<(), String> {
        let adlar: Vec<&str> = plan.iter().map(|(a, _)| *a).collect();
        if adlar.contains(&"ISKELET") {
            u.kalem("ISKELET", |u| iskelet(u, &l, &proje, &s.sunucu, &pg_imaj, s.yedek_alan))?;
        }
        let kunye = u.kalem("PAKET", |u| paket(u, &l, &tar, &v))?;
        let dir = l.version_dir(&v);
        u.kalem("COMPOSE", |_| araclar.compose_denetle(&denv, &dir, &v))?;
        u.kalem("IMAJ", |_| {
            araclar
                .imaj_kaydet_ya_da_yukle(&denv, &dir.join(crate::oci::image_archive(&v)), &v, &kunye.image_id)
                .map(|_| ())
                .map_err(|(k, m)| format!("{k}: {m}"))
        })?;
        u.kalem("CURRENT", |u| current_kur(u, &l, &v))?;
        if adlar.contains(&"ILK_GOC") {
            u.kalem("ILK_GOC", |_| {
                let c = komut.compose().args(["up", "-d", "--wait", "postgres"]).timeout(Duration::from_secs(600));
                calistir(&denv, &c, "compose up postgres")?;
                let be =
                    settings::read_backend_env_in(&crate::env::RealFs, &l, OrtamKipi::Compose).map_err(|f| format!("{}: {}", f.0, f.1))?;
                let out = crate::platform::Araclar::migrate_deploy(&araclar, &denv, &dir, &be, Duration::from_secs(1800))?;
                if out.ok() {
                    Ok(())
                } else {
                    let k = out.code.and_then(|c| u32::try_from(c).ok()).unwrap_or(1);
                    Err(format!("göç aracı: {} ({})", crate::tools::describe_failure("goc", &out), docker::acilis_kodu(k)))
                }
            })?;
            u.kalem("BASLAT", |_| {
                yeni_up(&denv, &komut)?;
                yeni_saglik(&denv, &v, None, sure(&l)).map(|_| ())
            })?;
        }
        u.kalem("GUNCELLEYICI", |u| {
            ikili_koy(u, &l, &v, &kunye.updater_sha256)?;
            guncelleyici(u, &l, &s.ad)
        })
    })();
    match r {
        Ok(()) => {
            let _ = u.gunluk.yaz(json!({ "tur": "SONUC", "sonuc": "BASARILI" }));
            (b.yaz)(&format!("TAMAM: kurulum {v}; güncelleyici {}.service etkin", s.ad));
            cikis::TAMAM
        }
        Err(e) => {
            let _ = u.gunluk.yaz(json!({ "tur": "SONUC", "sonuc": "YARIM", "hata": e }));
            dur(b, &format!("{e} — kurulum yarım; düzeltip aynı komutla yeniden koşun (tamamlananlar atlanır)"))
        }
    }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

fn damga(ms: i64) -> String {
    let iso = tekserp_hizmet::timefmt::iso_millis(ms);
    iso.chars().filter(|c| c.is_ascii_digit() || *c == 'T').take(15).collect::<String>().replace('T', "-")
}

/// `kur` · `gecis`. Gerçek komutta veri kökü `/var/lib/tekserp`tir (compose şablonunun bağ kaynağı sabit).
pub fn komut(command: &str, args: &[String]) -> Result<u32, String> {
    use crate::cli::flag_value;
    let kok = match flag_value(args, "--kok") {
        Some(_) => crate::cli::root_arg(args)?,
        None if command == "kur" => PathBuf::from(duzen::VARSAYILAN_KOK),
        None => return Err(format!("{command}: --kok <dizin> gerekli")),
    };
    let veri = flag_value(args, "--veri").map_or_else(|| PathBuf::from(duzen::VARSAYILAN_VERI), PathBuf::from);
    if veri != Path::new(duzen::VARSAYILAN_VERI) {
        return Err(format!("--veri yalnız {} olabilir (compose şablonunun bağ kaynağı sabit)", duzen::VARSAYILAN_VERI));
    }
    let onay = match flag_value(args, "--onay") {
        Some(n) => Some(n.parse::<usize>().map_err(|_| format!("--onay sayı olmalı: {n:?}"))?),
        None => None,
    };
    let env = crate::env::real(None, "tekserp-kurulum")?;
    let s = Secenek {
        kok,
        veri,
        ad: super::hizmet::ad_arg(args)?,
        sunucu: flag_value(args, "--sunucu").unwrap_or_else(|| VARSAYILAN_SUNUCU.to_string()),
        tar: flag_value(args, "--tar").map(PathBuf::from),
        proje: flag_value(args, "--proje"),
        uygula: args.iter().any(|a| a == "--uygula"),
        onay,
        damga: damga(env.clock.now_ms()),
        yedek_alan: crate::reserve::RESERVE_BYTES,
    };
    let anchor = crate::trust::TrustAnchor::for_process()?;
    let trust = crate::kurulum::kurulum_guveni(&anchor, tekserp_dogrulama::paket_zinciri::PackageMode::Kabul, env.clock.now_ms() as f64);
    let yaz = |m: &str| println!("{m}");
    let b = Baglam { env: &env, konak: &GercekKonak, trust: &trust, yaz: &yaz };
    Ok(match command {
        "kur" => kur(&b, &s),
        "gecis" if args.iter().any(|a| a == "--geri-al") => gecis_geri_al(&b, &s),
        "gecis" => gecis(&b, &s),
        _ => return Err(format!("bilinmeyen komut: {command}")),
    })
}
