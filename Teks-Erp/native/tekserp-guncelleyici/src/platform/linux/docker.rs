//! Linux/Docker arka ucu II (`GUNCELLEYICI-SAGLAMLIK.md` §1.2, §2.2 — L4b): hizmet denetimi (`DockerServices`),
//! sağlık sondası (`DockerSaglik`, konteyner İÇİNDEN) ve araçlar (`DockerAraclar`, kısa ömürlü araç konteynerleri).
//! Docker'a YALNIZ `docker` CLI ile, `Procs` üzerinden konuşulur; her compose çağrısı `duzen::compose_args`
//! başıyla koşar. CLI çıktısından yalnız Go şablonuyla istenen tek değerler okunur, başarı ölçüsü çıkış kodudur.
use super::duzen;
use crate::codes;
use crate::env::{Cmd, CmdOut, Env, EnvError, EnvResult, Fs, HttpResponse, Procs, Services, SvcState};
use crate::imaj;
use crate::layout::Layout;
use crate::settings::{redact, BackendEnv};
use crate::tools::{describe_failure, restore_errors, MigrationCount};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekserp_hizmet::contract;

/// Compose servis adları (şablon `docker-compose.guncelleyici.yml`).
pub const BACKEND: &str = "backend";
/// Araç konteynerlerinin servisi: aynı imaj, PG istemcisi + yedek aracı, PG ortamı compose'tan.
pub const ARAC_HIZMETI: &str = "yedek";
/// İmaj içindeki yedek aracı.
pub const YEDEK_ARACI: &str = "/app/dist/tools/yedek-sifrele.cjs";
/// Tek yedek alıcısı dosyasının üst sınırı (açık anahtar ~120 bayt; birim içeriği güvenilmez okunur).
pub const ALICI_EN_BUYUK: u64 = 64 * 1024;
/// Backend imajının deposu (budama yalnız bunun etiketlerine dokunur).
pub const IMAJ_DEPOSU: &str = "tekserp-korumali";
/// `docker inspect` tek satır biçimi: durum | çıkış kodu | yeniden başlatma sayısı | sağlık.
pub const INSPECT_FORMAT: &str =
    "{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}";

/// Konteynerin yeniden başlatma politikası (bakım çiti W2: `stop` edilen konteyneri açılışta başlatmayan politika şart).
pub const RESTART_POLICY_FORMAT: &str = "{{.HostConfig.RestartPolicy.Name}}";

/// `docker volume inspect` tek değer: birimin konaktaki dizini.
pub const BIRIM_YOLU_FORMAT: &str = "{{.Mountpoint}}";

/// Bir kuruluma (compose projesine) bağlı komut kurucusu.
#[derive(Debug, Clone)]
pub struct DockerKomut {
    pub layout: Layout,
    pub proje: String,
    pub program: PathBuf,
}

impl DockerKomut {
    pub fn new(layout: &Layout, proje: &str) -> Result<DockerKomut, String> {
        duzen::compose_args(layout, proje)?;
        Ok(DockerKomut { layout: layout.clone(), proje: proje.to_string(), program: PathBuf::from("docker") })
    }
    pub fn docker(&self) -> Cmd {
        Cmd::new(&self.program).timeout(Duration::from_secs(120))
    }
    /// `docker compose -p … -f current/docker-compose.yml --env-file … --env-file …`.
    pub fn compose(&self) -> Cmd {
        self.docker().args(duzen::compose_args(&self.layout, &self.proje).unwrap_or_default())
    }
    /// Hazırlıkta paketin compose dosyasıyla aynı baş (`config` denetimi).
    pub fn compose_dosyali(&self, file: &Path) -> Cmd {
        self.docker().args(duzen::compose_args_for(&self.layout, &self.proje, file).unwrap_or_default())
    }
    /// Araç konteynerinin sabit adı: devam/telafi önce aynı adlıyı siler (yetim araç kalmaz).
    pub fn arac_adi(&self, arac: &str) -> String {
        format!("tekserp-arac-{}-{arac}", self.proje)
    }
}

/// Güncelleyicinin hizmet adı → compose servisi: Windows varsayılan adı (`TeksERP-Backend`) backend'dir; başka ad
/// compose kuralına uymalı (aynı konakta ikinci kanal ayrı PROJEDİR, ayrı servis adı değil).
pub fn compose_hizmeti(name: &str) -> Result<&str, String> {
    if name == contract::BACKEND_SERVICE {
        Ok(BACKEND)
    } else if duzen::valid_project(name) {
        Ok(name)
    } else {
        Err(format!("{name:?} bir compose servis adı değil"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KonteynerDurumu {
    pub status: String,
    pub exit: i64,
    pub restarts: u64,
    pub health: String,
}

pub fn durum_coz(line: &str) -> Option<KonteynerDurumu> {
    let mut it = line.trim().split('|');
    let status = it.next()?.to_string();
    let exit = it.next()?.parse().ok()?;
    let restarts = it.next()?.parse().ok()?;
    let health = it.next().unwrap_or_default().to_string();
    (!status.is_empty()).then_some(KonteynerDurumu { status, exit, restarts, health })
}

/// SIGTERM (143) / SIGKILL (137) ya da temiz çıkış: `compose stop`un sonucu, çökme değil.
pub fn kapanis_kodu(exit: i64) -> bool {
    matches!(exit, 0 | 137 | 143)
}

fn run(procs: &dyn Procs, c: &Cmd, what: &str) -> Result<CmdOut, String> {
    let out = procs.run(c).map_err(|e| format!("{what}: {e}"))?;
    if !out.ok() {
        return Err(describe_failure(what, &out));
    }
    Ok(out)
}

/// `Services` Linux uygulaması (§1.2 tablosu).
pub struct DockerServices {
    pub komut: Arc<DockerKomut>,
    pub procs: Arc<dyn Procs>,
    /// Etiket kaydı ve `current` okunur: backend başlatılmadan önce etiket ölçülür.
    pub fs: Arc<dyn Fs>,
    pub stop_timeout_s: u64,
    /// Bu süreçte `stop` ile durdurulanlar: Docker elle durdurulan konteyneri yeniden başlatmaz — çıkış kodu
    /// çökme sayılmaz (yatıştırma kendiliğinden).
    durduruldu: Mutex<HashSet<String>>,
}

impl DockerServices {
    pub fn new(komut: Arc<DockerKomut>, procs: Arc<dyn Procs>, fs: Arc<dyn Fs>, stop_timeout_s: u64) -> DockerServices {
        DockerServices { komut, procs, fs, stop_timeout_s, durduruldu: Mutex::new(HashSet::new()) }
    }

    pub fn konteyner(&self, svc: &str) -> EnvResult<Option<String>> {
        let c = self.komut.compose().args(["ps", "-a", "-q", svc]).timeout(Duration::from_secs(60));
        let out = run(self.procs.as_ref(), &c, "compose ps").map_err(EnvError)?;
        Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().next().map(str::to_string))
    }

    pub fn incele(&self, svc: &str) -> EnvResult<Option<KonteynerDurumu>> {
        let Some(id) = self.konteyner(svc)? else { return Ok(None) };
        let c = self.komut.docker().args(["inspect", "--format", INSPECT_FORMAT]).arg(&id).timeout(Duration::from_secs(60));
        let out = run(self.procs.as_ref(), &c, "docker inspect").map_err(EnvError)?;
        let text = String::from_utf8_lossy(&out.stdout);
        durum_coz(&text).map(Some).ok_or_else(|| EnvError(format!("docker inspect çıktısı çözülemedi: {:?}", text.trim())))
    }
}

impl Services for DockerServices {
    fn state(&self, name: &str) -> EnvResult<SvcState> {
        let svc = compose_hizmeti(name).map_err(EnvError)?;
        Ok(match self.incele(svc)?.as_ref().map(|d| d.status.as_str()) {
            None | Some("exited" | "created" | "dead") => SvcState::Stopped,
            Some("running") => SvcState::Running,
            Some("restarting") => SvcState::Starting,
            Some("removing") => SvcState::Stopping,
            Some(_) => SvcState::Other,
        })
    }

    /// `compose up -d --no-deps --force-recreate <svc>`; `--dogrulama` ⇒ `TEKSERP_DOGRULAMA_KIPI=1` (backend yalnız
    /// konteynerin döngü adresinde dinler), yoksa değişken BOŞ (konağın ortamından sızmasın).
    fn start(&self, name: &str, args: &[&str]) -> EnvResult<()> {
        let svc = compose_hizmeti(name).map_err(EnvError)?;
        let verify = match args {
            [] => false,
            [a] if *a == contract::VERIFY_ARG => true,
            other => return Err(EnvError(format!("{name}: tanınmayan başlatma argümanı {other:?}"))),
        };
        if svc == BACKEND {
            etiket_dogrula(self.fs.as_ref(), self.procs.as_ref(), &self.komut).map_err(EnvError)?;
        }
        let c = self
            .komut
            .compose()
            .args(["up", "-d", "--no-deps", "--force-recreate", svc])
            .env("TEKSERP_DOGRULAMA_KIPI", if verify { "1" } else { "" })
            .timeout(Duration::from_secs(300));
        run(self.procs.as_ref(), &c, "compose up").map_err(EnvError)?;
        self.durduruldu.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(svc);
        Ok(())
    }

    fn stop(&self, name: &str) -> EnvResult<()> {
        let svc = compose_hizmeti(name).map_err(EnvError)?;
        let c = self
            .komut
            .compose()
            .args(["stop", "-t", &self.stop_timeout_s.to_string(), svc])
            .timeout(Duration::from_secs(self.stop_timeout_s + 60));
        run(self.procs.as_ref(), &c, "compose stop").map_err(EnvError)?;
        self.durduruldu.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(svc.to_string());
        Ok(())
    }

    /// Çökme: `restarting` · `exited`/`dead` + kapanış dışı kod · ya da `running` ama yeniden başlatma sayısı > 0
    /// (başlatma `--force-recreate` ile sayacı sıfırlar ⇒ sayaç bizim başlatmamızdan beri düşüşleri sayar).
    fn crash_exit_code(&self, name: &str) -> EnvResult<Option<u32>> {
        let svc = compose_hizmeti(name).map_err(EnvError)?;
        if self.durduruldu.lock().unwrap_or_else(std::sync::PoisonError::into_inner).contains(svc) {
            return Ok(None);
        }
        let Some(d) = self.incele(svc)? else { return Ok(None) };
        let code = || u32::try_from(d.exit).ok().filter(|c| *c != 0).unwrap_or(1);
        Ok(match d.status.as_str() {
            "restarting" => Some(code()),
            "exited" | "dead" if !kapanis_kodu(d.exit) => Some(code()),
            "running" if d.restarts > 0 => Some(code()),
            _ => None,
        })
    }

    fn start_mode(&self, name: &str) -> EnvResult<String> {
        let svc = compose_hizmeti(name).map_err(EnvError)?;
        let Some(id) = self.konteyner(svc)? else { return Ok(crate::env::start_mode::MISSING.into()) };
        let c = self.komut.docker().args(["inspect", "--format", RESTART_POLICY_FORMAT]).arg(&id).timeout(Duration::from_secs(60));
        let out = run(self.procs.as_ref(), &c, "docker inspect").map_err(EnvError)?;
        let policy = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if policy.is_empty() || !policy.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
            return Err(EnvError(format!("docker inspect yeniden başlatma politikası çözülemedi: {policy:?}")));
        }
        Ok(policy)
    }
    fn image_path(&self, name: &str) -> EnvResult<String> {
        Err(EnvError(super::unsupported(&format!("{name}: komut satırı (PG imajı L8'de `pg.env`)"))))
    }
    fn set_image_path(&self, name: &str, _command_line: &str) -> EnvResult<()> {
        Err(EnvError(super::unsupported(&format!("{name}: komut satırı (PG imajı L8'de `pg.env`)"))))
    }
}

/// Konteyner içinden sağlık: durum kodu ilk satırda, gövde sonrakilerde (3 = bağlanamadı).
pub fn sonda_betigi(port: u16, path: &str) -> String {
    let path: String = path.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_')).collect();
    format!(
        "fetch('http://127.0.0.1:{port}/{}').then(async r=>{{process.stdout.write(r.status+'\\n'+await r.text())}}).catch(()=>process.exit(3))",
        path.trim_start_matches('/')
    )
}

pub struct DockerSaglik {
    pub komut: Arc<DockerKomut>,
}

impl crate::platform::Saglik for DockerSaglik {
    fn probe(&self, env: &Env, port: u16, path: &str) -> EnvResult<HttpResponse> {
        let c =
            self.komut.compose().args(["exec", "-T", BACKEND, "node", "-e"]).arg(sonda_betigi(port, path)).timeout(Duration::from_secs(30));
        let out = env.procs.run(&c)?;
        if !out.ok() {
            return Err(EnvError(format!("sağlık sondası: çıkış {:?}{}", out.code, if out.timed_out { " (zaman aşımı)" } else { "" })));
        }
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let (first, body) = text.split_once('\n').unwrap_or((text.as_str(), ""));
        let status = first.trim().parse::<u16>().map_err(|_| EnvError(format!("sağlık sondası: durum satırı {:?}", first.trim())))?;
        Ok(HttpResponse { status, headers: vec![], body: Box::new(std::io::Cursor::new(body.as_bytes().to_vec())) })
    }
    fn address(&self, port: u16, path: &str) -> String {
        format!("backend konteyneri içinden 127.0.0.1:{port}{path}")
    }
    fn exit_meaning(&self, code: u32) -> &'static str {
        acilis_kodu(code)
    }
}

/// Açılış betiğinin ve `goc` aracının beyanlı kodları (`docker/korumali/acilis-kodlari.json`; eşitliği test ölçer).
pub fn acilis_kodu(code: u32) -> &'static str {
    match code {
        40 => "KIP_GECERSIZ",
        41 => "GOC_TANISIZ",
        42 => "GOC_SQL_YOK",
        43 => "GOC_BASARISIZ",
        44 => "GOC_ELLE_BASARISIZ",
        45 => "GOC_DENEME_TUKENDI",
        46 => "SEMA_OLCULEMEDI",
        47 => "GOC_BEKLIYOR",
        48 => "GOC_YARIM",
        49 => "SEMA_ILERIDE",
        1 => "sunucu hatası",
        _ => "konteyner çıkışı",
    }
}

/// Araç konteynerinin bağları: konak dizini → `/arac/b<i>` (dosya yolları çevrilir).
#[derive(Default)]
struct Baglar(Vec<(PathBuf, String, bool)>);

impl Baglar {
    fn yol(&mut self, host: &Path, rw: bool) -> String {
        let dir = host.parent().map(Path::to_path_buf).unwrap_or_default();
        let file = host.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let i = match self.0.iter().position(|(d, _, _)| *d == dir) {
            Some(i) => {
                self.0[i].2 |= rw;
                i
            }
            None => {
                self.0.push((dir, format!("/arac/b{}", self.0.len()), rw));
                self.0.len() - 1
            }
        };
        format!("{}/{file}", self.0[i].1)
    }
    fn dizin(&mut self, host: &Path, rw: bool) -> String {
        let p = self.yol(&host.join("_"), rw);
        p.trim_end_matches("/_").to_string()
    }
}

/// `platform::Araclar` Linux uygulaması: her araç `compose run --rm --no-deps -T --name tekserp-arac-<proje>-<araç>`
/// ile KISA ÖMÜRLÜ konteynerde koşar (PG ortamı ve parola compose'tan — argümana/günlüğe girmez). Konak dosyasına
/// dokunan araç `--user 0:0` alır: özel alan root 0700'dür (yetkisiz kök, `cap_drop: ALL` şablondan). Yetkisiz kök
/// backend'in birimlerine (10001, 0700) GİREMEZ ve girmesi gerekmez: birimden gereken (yedek alıcıları) güncelleyici
/// tarafından konaktan okunup özel alana kopyalanır (`kurulum_alicilari`) — araca yetki eklenmez.
pub struct DockerAraclar {
    pub komut: Arc<DockerKomut>,
}

impl DockerAraclar {
    fn arac(&self, env: &Env, arac: &str, svc: &str, baglar: &Baglar, komut: &[String], timeout: Duration) -> Result<CmdOut, String> {
        let name = self.komut.arac_adi(arac);
        let rm = self.komut.docker().args(["rm", "-f", &name]).timeout(Duration::from_secs(60));
        let _ = env.procs.run(&rm);
        let mut c = self.komut.compose().args(["run", "--rm", "--no-deps", "-T", "--name", &name]);
        if !baglar.0.is_empty() {
            c = c.args(["--user", "0:0"]);
        }
        for (host, cont, rw) in &baglar.0 {
            c = c.arg("-v").arg(format!("{}:{cont}:{}", host.display(), if *rw { "rw" } else { "ro" }));
        }
        let c = c.arg(svc).args(komut.iter().cloned()).timeout(timeout);
        let out = env.procs.run(&c).map_err(|e| format!("{arac}: {e}"));
        if out.as_ref().map_or(true, |o| o.timed_out || o.code.is_none()) {
            let _ = env.procs.run(&rm);
        }
        out
    }

    fn arac_ok(&self, env: &Env, arac: &str, baglar: &Baglar, komut: &[String], timeout: Duration) -> Result<CmdOut, String> {
        let out = self.arac(env, arac, ARAC_HIZMETI, baglar, komut, timeout)?;
        if !out.ok() {
            return Err(describe_failure(arac, &out));
        }
        Ok(out)
    }

    fn psql(&self, env: &Env, sql: &str, what: &str) -> Result<String, String> {
        let k = ["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-tAc", sql].map(str::to_string);
        let out = self.arac_ok(env, "psql", &Baglar::default(), &k, Duration::from_secs(120)).map_err(|e| format!("{what}: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    /// Projenin adlı biriminin konak yolu (`docker volume inspect` `Mountpoint`); çözülemezse hata (başka yere düşülmez).
    fn birim_yolu(&self, env: &Env, birim: &str) -> Result<PathBuf, String> {
        let ad = duzen::birim_adi(&self.komut.proje, birim);
        let c =
            self.komut.docker().args(["volume", "inspect", "--format", BIRIM_YOLU_FORMAT, ad.as_str()]).timeout(Duration::from_secs(60));
        let yol = match env.procs.run(&c) {
            Ok(out) if out.ok() => String::from_utf8_lossy(&out.stdout).trim().to_string(),
            Ok(out) => return Err(describe_failure(&format!("{birim} birimi {ad} (docker volume inspect)"), &out)),
            Err(e) => return Err(format!("{birim} birimi {ad} okunamadı: {e}")),
        };
        if Path::new(&yol).is_absolute() {
            Ok(PathBuf::from(yol))
        } else {
            Err(format!("{birim} birimi {ad}: konak yolu yok ({yol:?})"))
        }
    }
}

impl crate::platform::Araclar for DockerAraclar {
    fn migration_count(&self, env: &Env, _be: &BackendEnv) -> Result<MigrationCount, String> {
        let text = self.psql(env, crate::platform::windows::araclar::MIGRATION_COUNT_SQL, "göç sayısı (psql)")?;
        let mut it = text.split_whitespace().map(str::parse::<u64>);
        match (it.next(), it.next()) {
            (Some(Ok(finished)), Some(Ok(total))) => Ok(MigrationCount { finished, total }),
            _ => Err(format!("göç sayısı çözülemedi: {:?}", text.trim())),
        }
    }
    fn finished_migrations(&self, env: &Env, _be: &BackendEnv) -> Result<Vec<String>, String> {
        let text = self.psql(env, crate::sema::FINISHED_MIGRATIONS_SQL, "bitmiş göç adları (psql)")?;
        Ok(text.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
    }
    fn pg_dump(&self, env: &Env, _be: &BackendEnv, out_file: &Path, timeout: Duration) -> Result<(), String> {
        let mut b = Baglar::default();
        let out = b.yol(out_file, true);
        self.arac_ok(env, "pg_dump", &b, &["pg_dump".into(), "-w".into(), "-Fc".into(), "-f".into(), out], timeout).map(|_| ())
    }
    fn pg_restore_list(&self, env: &Env, _be: &BackendEnv, dump: &Path) -> Result<(), String> {
        let mut b = Baglar::default();
        let d = b.yol(dump, false);
        self.arac_ok(env, "pg_restore", &b, &["pg_restore".into(), "--list".into(), d], Duration::from_secs(600)).map(|_| ())
    }
    fn restore_db(&self, env: &Env, be: &BackendEnv, dump: &Path, timeout: Duration) -> Result<(), String> {
        self.psql(env, crate::platform::windows::araclar::RESET_SQL, "şema sıfırlama (psql)")?;
        let mut b = Baglar::default();
        let d = b.yol(dump, false);
        let k = ["pg_restore".into(), "-w".into(), "-d".into(), be.db.database.clone(), d];
        let out = self.arac(env, "pg_restore", ARAC_HIZMETI, &b, &k, timeout)?;
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
    fn server_version(&self, env: &Env, _be: &BackendEnv, _bin: &Path) -> Result<String, String> {
        let v = self.psql(env, "SHOW server_version", "SHOW server_version")?;
        Ok(v.split_whitespace().next().unwrap_or_default().to_string())
    }
    /// Araçlar imajın içindedir (compose dosyası hangi sürümü gösteriyorsa onunki).
    fn usable_for_backup(&self, _env: &Env, _tools_dir: &Path) -> bool {
        true
    }
    fn backup_keygen(&self, env: &Env, _tools_dir: &Path, dir: &Path, private_out: &Path) -> Result<(), String> {
        let mut b = Baglar::default();
        let d = b.dizin(dir, true);
        let p = b.yol(private_out, true);
        let k = ["node", YEDEK_ARACI, "anahtar-uret", "--ad", "guncelleme", "--dizin", &d, "--ozel-cikti", &p].map(str::to_string);
        self.arac_ok(env, "yedek-anahtar", &b, &k, Duration::from_secs(120)).map(|_| ())
    }
    fn backup_encrypt(
        &self,
        env: &Env,
        _tools_dir: &Path,
        input: &Path,
        output: &Path,
        recipients: &[PathBuf],
        timeout: Duration,
    ) -> Result<(), String> {
        let mut b = Baglar::default();
        let mut k: Vec<String> = ["node", YEDEK_ARACI, "sifrele", "--girdi"].map(str::to_string).to_vec();
        k.push(b.yol(input, false));
        k.push("--cikti".into());
        k.push(b.yol(output, true));
        for r in recipients {
            k.push("--alici".into());
            k.push(b.yol(r, false));
        }
        self.arac_ok(env, "yedek-sifrele", &b, &k, timeout).map(|_| ())
    }
    fn backup_decrypt(
        &self,
        env: &Env,
        _tools_dir: &Path,
        input: &Path,
        output: &Path,
        key: &Path,
        timeout: Duration,
    ) -> Result<(), String> {
        let mut b = Baglar::default();
        let mut k: Vec<String> = ["node", YEDEK_ARACI, "coz", "--girdi"].map(str::to_string).to_vec();
        k.push(b.yol(input, false));
        k.push("--cikti".into());
        k.push(b.yol(output, true));
        k.push("--anahtar".into());
        k.push(b.yol(key, false));
        self.arac_ok(env, "yedek-coz", &b, &k, timeout).map(|_| ())
    }
    /// İmajdaki `goc` aracı (`CONCURRENTLY` kuralı onda, L5); compose dosyası `current`ten ⇒ yeni sürümün imajı.
    fn migrate_deploy(&self, env: &Env, _version_dir: &Path, _be: &BackendEnv, timeout: Duration) -> Result<CmdOut, String> {
        self.arac(env, "goc", BACKEND, &Baglar::default(), &["goc".to_string()], timeout)
    }
    fn imaj_deposu(&self, env: &Env) -> Option<PathBuf> {
        let c = self.komut.docker().args(["info", "--format", "{{.DockerRootDir}}"]).timeout(Duration::from_secs(60));
        let out = env.procs.run(&c).ok().filter(CmdOut::ok)?;
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        s.starts_with('/').then(|| PathBuf::from(s))
    }
    /// Backend'in yazdığı `<proje>_lisans` biriminin konak yolu (`Mountpoint`): kira/HAK/iptal tek kaynaktan, kopyasız.
    /// İçerik backend'in (10001) yazabildiği yerdir — okuma `read_untrusted`, yazım `write_atomic` (bağ izlemez).
    fn lisans_dizini(&self, env: &Env) -> Option<Result<PathBuf, String>> {
        Some(self.birim_yolu(env, duzen::LISANS_BIRIMI))
    }
    /// Alıcılar backend'in `yedek_anahtar` biriminde (10001, 0700): bağ taşıyan araç yetkisiz köktür ve oraya giremez.
    /// Güncelleyici (konakta root) birimi konak yolundan okur (bağ izlemeden) ve `ara`ya (özel alan, root) kopyalar.
    /// Birim çözülemezse hata: alıcısız yedek sessizce alınmaz. Boş birim = alıcı yok.
    fn kurulum_alicilari(&self, env: &Env, _be: &BackendEnv, ara: &Path) -> Result<Vec<PathBuf>, String> {
        let fs = env.fs.as_ref();
        let kaynak = self.birim_yolu(env, duzen::YEDEK_ANAHTAR_BIRIMI)?;
        let mut adlar: Vec<String> = fs
            .list(&kaynak)
            .map_err(|e| format!("yedek alıcı birimi okunamadı ({}): {e}", kaynak.display()))?
            .into_iter()
            .filter(|n| n.ends_with(".tkpub") && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')))
            .collect();
        adlar.sort();
        fs.remove_dir_all(ara).map_err(|e| format!("alıcı kopya dizini: {e}"))?;
        fs.create_dir_all(ara).map_err(|e| format!("alıcı kopya dizini: {e}"))?;
        let mut out = Vec::with_capacity(adlar.len());
        for n in adlar {
            let b = fs.read_untrusted(&kaynak.join(&n), ALICI_EN_BUYUK).map_err(|e| format!("yedek alıcısı {n} okunamadı: {e}"))?;
            let hedef = ara.join(&n);
            fs.write_atomic(&hedef, &b).map_err(|e| format!("yedek alıcısı {n} kopyalanamadı: {e}"))?;
            out.push(hedef);
        }
        Ok(out)
    }
    fn db_boyutu(&self, env: &Env, _be: &BackendEnv) -> Option<u64> {
        self.psql(env, crate::package::DB_BOYU_SQL, "veritabanı boyu (psql)").ok()?.trim().parse().ok()
    }
    fn imaj_hazir(&self, env: &Env, surum: &str, kimlik: &str) -> bool {
        let Some(k) = imaj::kayit_oku(env.fs.as_ref(), &self.komut.layout, surum) else { return false };
        let now = etiket_olc(env.procs.as_ref(), &self.komut, &crate::oci::image_tag(surum)).ok().flatten();
        k.kimlik == kimlik && now.is_some_and(|(id, layers)| k.tutar(&id, &layers))
    }
    fn surum_hazirla(&self, env: &Env, dir: &Path, surum: &str, kimlik: &str) -> Result<(), (&'static str, String)> {
        self.compose_denetle(env, dir, surum).map_err(|e| (codes::COMPOSE_HATASI, e))?;
        if self.imaj_hazir(env, surum, kimlik) {
            return Ok(());
        }
        self.imaj_yukle(env, &dir.join(crate::oci::image_archive(surum)), surum, kimlik)
    }
    /// Yalnız `tekserp-korumali:<sürüm>` etiketleri, tutulanlar dışındakiler; `image prune` ÇAĞRILMAZ.
    fn imaj_buda(&self, env: &Env, keep: &[String]) {
        let c = self.komut.docker().args(["image", "ls", "--format", "{{.Tag}}", IMAJ_DEPOSU]).timeout(Duration::from_secs(60));
        let Some(out) = env.procs.run(&c).ok().filter(CmdOut::ok) else { return };
        for tag in String::from_utf8_lossy(&out.stdout).lines().map(str::trim) {
            if crate::version::parse(tag).is_some() && !keep.iter().any(|k| k == tag) {
                let rm = self.komut.docker().args(["image", "rm", &format!("{IMAJ_DEPOSU}:{tag}")]).timeout(Duration::from_secs(120));
                let _ = env.procs.run(&rm);
            }
        }
        let dir = imaj::kayit_dizini(&self.komut.layout);
        for name in env.fs.list(&dir).unwrap_or_default() {
            if name.strip_suffix(".json").is_some_and(|v| !keep.iter().any(|k| k == v)) {
                let _ = env.fs.remove_file(&dir.join(&name));
            }
        }
    }
}

// ── İmaj yükleme · etiket kaydı · compose denetimi (L4c-2) ──────────────────────────────────────

/// `docker image inspect`: `None` = böyle imaj yok; Docker'a ulaşılamaması hata.
fn imaj_incele(procs: &dyn Procs, komut: &DockerKomut, r: &str, format: &str) -> Result<Option<String>, String> {
    let c = komut.docker().args(["image", "inspect", "--format", format, r]).timeout(Duration::from_secs(60));
    let out = procs.run(&c).map_err(|e| format!("docker image inspect: {e}"))?;
    if out.ok() {
        return Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()));
    }
    if String::from_utf8_lossy(&out.stderr).contains("No such image") {
        return Ok(None);
    }
    Err(describe_failure("docker image inspect", &out))
}

/// Etiketin bugünkü (yerel tutamaç, katmanlar) ölçümü.
fn etiket_olc(procs: &dyn Procs, komut: &DockerKomut, tag: &str) -> Result<Option<(String, Vec<String>)>, String> {
    match imaj_incele(procs, komut, tag, imaj::INSPECT_FORMAT)? {
        None => Ok(None),
        Some(line) => imaj::inspect_coz(&line).map(Some).ok_or_else(|| format!("docker image inspect çözülemedi: {line:?}")),
    }
}

/// Başlatılacak sürümün etiketi güncelleyicinin kaydıyla aynı nesne mi (`current`in hedefi). Kayıt yok, etiket yok ya
/// da başka nesne ⇒ `IMAJ_KIMLIGI:` önekli hata; Docker'a ulaşılamazsa öneksiz (başlatma hatası).
pub fn etiket_dogrula(fs: &dyn Fs, procs: &dyn Procs, komut: &DockerKomut) -> Result<(), String> {
    let target = fs.link_target(&komut.layout.current()).ok().flatten().ok_or("current bağlantısı okunamadı")?;
    let surum = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tag = crate::oci::image_tag(&surum);
    let Some(k) = imaj::kayit_oku(fs, &komut.layout, &surum) else {
        return Err(format!("{} {tag}: güncelleyicinin yükleme kaydı yok — başlatılmaz", imaj::KIMLIK_ONEKI));
    };
    match etiket_olc(procs, komut, &tag)? {
        Some((id, layers)) if k.tutar(&id, &layers) => Ok(()),
        Some(_) => Err(format!("{} {tag} güncelleyicinin yüklediği imaj değil (yeniden etiketlenmiş) — başlatılmaz", imaj::KIMLIK_ONEKI)),
        None => Err(format!("{} {tag} Docker'da yok — başlatılmaz", imaj::KIMLIK_ONEKI)),
    }
}

impl DockerAraclar {
    fn imaj_kumesi(&self, env: &Env) -> Result<HashSet<String>, String> {
        let c = self.komut.docker().args(["image", "ls", "-a", "-q", "--no-trunc"]).timeout(Duration::from_secs(60));
        let out = run(env.procs.as_ref(), &c, "docker image ls").map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().map(str::to_string).collect())
    }

    /// Yarım/uyuşmaz yüklemenin artığı: yüklemeden sonra doğan ve YALNIZ bizim etiketimizi taşıyan imajlar silinir
    /// (başka projenin imajına ve etiketsiz yeniye dokunulmaz). En iyi çaba.
    fn artik_temizle(&self, env: &Env, before: &HashSet<String>, tag: &str) {
        let Ok(after) = self.imaj_kumesi(env) else { return };
        for id in after.difference(before) {
            let tags = imaj_incele(env.procs.as_ref(), &self.komut, id, "{{json .RepoTags}}").ok().flatten();
            let tags: Vec<String> = tags.and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
            if !tags.is_empty() && tags.iter().all(|t| t == tag) {
                let rm = self.komut.docker().args(["image", "rm", id.as_str()]).timeout(Duration::from_secs(120));
                let _ = env.procs.run(&rm);
            }
        }
    }

    /// Paketin compose dosyası: `config --format json` + kurallar. Hata iletisi YALNIZ stderr'den (stdout ortamı
    /// açılmış hâliyle sır taşır).
    pub fn compose_denetle(&self, env: &Env, dir: &Path, surum: &str) -> Result<(), String> {
        let c = self
            .komut
            .compose_dosyali(&dir.join(duzen::COMPOSE_DOSYASI))
            .args(["config", "--format", "json"])
            .timeout(Duration::from_secs(60));
        let out = env.procs.run(&c).map_err(|e| format!("compose config: {e}"))?;
        if !out.ok() {
            let err = String::from_utf8_lossy(&out.stderr);
            let last: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
            return Err(format!("compose config: çıkış {:?} — {}", out.code, redact(&last[last.len().saturating_sub(4)..].join(" | "))));
        }
        let cfg: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|_| "compose config çıktısı JSON değil".to_string())?;
        let bad = super::compose::ihlaller(&cfg, surum);
        if bad.is_empty() {
            Ok(())
        } else {
            Err(format!("compose kuralı: {}", bad.join(" · ")))
        }
    }

    /// Arşivi ölçer (kimlik = bildirim), yükler, etiketin katmanlarını arşivle karşılaştırır, kaydı yazar.
    pub fn imaj_yukle(&self, env: &Env, archive: &Path, surum: &str, kimlik: &str) -> Result<(), (&'static str, String)> {
        let fs = env.fs.as_ref();
        let tag = crate::oci::image_tag(surum);
        let k = |m: String| (codes::IMAJ_KIMLIGI, m);
        let olcum = imaj::olc(fs, archive).map_err(k)?;
        if olcum.kimlik != kimlik {
            return Err(k(format!("imaj arşivinin kimliği {} — bildirim {kimlik}", olcum.kimlik)));
        }
        if olcum.etiketler != [tag.clone()] {
            return Err(k(format!("imaj arşivinin etiketleri {:?} — yalnız {tag} bekleniyor", olcum.etiketler)));
        }
        let before = self.imaj_kumesi(env).map_err(|e| (codes::IMAJ_YUKLENEMEDI, e))?;
        let c = self.komut.docker().arg("load").arg("-i").arg(archive).timeout(Duration::from_secs(1800));
        if let Err(e) = run(env.procs.as_ref(), &c, "docker load") {
            self.artik_temizle(env, &before, &tag);
            // Daemon ENOSPC'yi yalnız metinle bildirir; insan yer açmalı, kod bunu söylemeli.
            let code = if crate::platform::is_disk_full_text(&e) { codes::DISK_DOLU } else { codes::IMAJ_YUKLENEMEDI };
            return Err((code, e));
        }
        let olcum_d = etiket_olc(env.procs.as_ref(), &self.komut, &tag).map_err(|e| (codes::IMAJ_YUKLENEMEDI, e))?;
        let Some((docker_id, layers)) = olcum_d else {
            self.artik_temizle(env, &before, &tag);
            return Err((codes::IMAJ_YUKLENEMEDI, format!("docker load sonrası {tag} yok")));
        };
        if layers != olcum.katmanlar {
            self.artik_temizle(env, &before, &tag);
            let rm = self.komut.docker().args(["image", "rm", &tag]).timeout(Duration::from_secs(120));
            let _ = env.procs.run(&rm);
            return Err(k(format!("yüklenen {tag} katmanları arşivle tutmuyor — imaj silindi")));
        }
        let kayit = imaj::Kayit {
            v: 1,
            surum: surum.to_string(),
            etiket: tag,
            kimlik: olcum.kimlik,
            katmanlar: layers,
            docker_id,
            zaman: tekserp_hizmet::timefmt::iso_millis(env.clock.now_ms()),
        };
        imaj::kayit_yaz(fs, &self.komut.layout, &kayit).map_err(|e| (codes::IMAJ_YUKLENEMEDI, format!("imaj kaydı yazılamadı: {e}")))
    }
}

impl DockerAraclar {
    /// Kurulum ve geçişin imaj adımı (R17): etiket Docker'da YOKSA `imaj_yukle`; VARSA yeniden yüklenmez — arşiv ölçülür
    /// (kimlik = künye, tek etiket), etiketin katmanları arşivin `diff_ids`iyle aynıysa güncelleyicinin kaydı yazılır.
    /// Tutmazsa `IMAJ_KIMLIGI` ve etikete DOKUNULMAZ (çalışan bir konteynerin imajı olabilir). Dönüş: yüklendi mi.
    pub fn imaj_kaydet_ya_da_yukle(&self, env: &Env, archive: &Path, surum: &str, kimlik: &str) -> Result<bool, (&'static str, String)> {
        let tag = crate::oci::image_tag(surum);
        let Some((docker_id, layers)) = etiket_olc(env.procs.as_ref(), &self.komut, &tag).map_err(|e| (codes::IMAJ_YUKLENEMEDI, e))? else {
            return self.imaj_yukle(env, archive, surum, kimlik).map(|()| true);
        };
        let fs = env.fs.as_ref();
        let k = |m: String| (codes::IMAJ_KIMLIGI, m);
        let olcum = imaj::olc(fs, archive).map_err(k)?;
        if olcum.kimlik != kimlik {
            return Err(k(format!("imaj arşivinin kimliği {} — künye {kimlik}", olcum.kimlik)));
        }
        if olcum.etiketler != [tag.clone()] {
            return Err(k(format!("imaj arşivinin etiketleri {:?} — yalnız {tag} bekleniyor", olcum.etiketler)));
        }
        if layers != olcum.katmanlar {
            return Err(k(format!("Docker'daki {tag} paketteki imaj değil (katmanlar tutmuyor) — etikete dokunulmadı")));
        }
        let kayit = imaj::Kayit {
            v: 1,
            surum: surum.to_string(),
            etiket: tag,
            kimlik: olcum.kimlik,
            katmanlar: layers,
            docker_id,
            zaman: tekserp_hizmet::timefmt::iso_millis(env.clock.now_ms()),
        };
        imaj::kayit_yaz(fs, &self.komut.layout, &kayit).map_err(|e| (codes::IMAJ_YUKLENEMEDI, format!("imaj kaydı yazılamadı: {e}")))?;
        Ok(false)
    }
}

/// Kuruluma bağlı Linux arka ucu (`platform::baglam`).
pub fn arka_ucu(komut: Arc<DockerKomut>) -> crate::platform::Arka {
    crate::platform::Arka {
        platform: super::SURUM_PLATFORMU,
        ortam: crate::settings::OrtamKipi::Compose,
        guncelleyici_paket_yolu: super::birim::IKILI,
        saglik: Arc::new(DockerSaglik { komut: Arc::clone(&komut) }),
        araclar: Arc::new(DockerAraclar { komut }),
        pg: Arc::new(super::IskeletPg),
        kendi: Arc::new(super::kendi::AtomikAdlandirma),
        cit: crate::platform::CitKipi::YenidenBaslatmaPolitikasi,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{Araclar, Saglik};

    type Yanit = Box<dyn Fn(&[String]) -> CmdOut + Send + Sync>;
    type Cagri = (Vec<String>, Vec<(String, String)>);

    /// Kaydeden sahte `docker`: her çağrının argümanları + ortamı; yanıt betikten.
    struct Betik {
        calls: Mutex<Vec<Cagri>>,
        yanit: Yanit,
    }
    impl Procs for Betik {
        fn run(&self, c: &Cmd) -> EnvResult<CmdOut> {
            let args: Vec<String> = c.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
            self.calls.lock().unwrap().push((args.clone(), c.env.clone()));
            Ok((self.yanit)(&args))
        }
    }
    fn out(code: i32, stdout: &str) -> CmdOut {
        CmdOut { code: Some(code), stdout: stdout.as_bytes().to_vec(), stderr: vec![], timed_out: false }
    }
    fn kur(yanit: impl Fn(&[String]) -> CmdOut + Send + Sync + 'static) -> (Arc<Betik>, Arc<DockerKomut>, Env) {
        kur_l(Layout::new(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp")), yanit)
    }
    fn kur_l(layout: Layout, yanit: impl Fn(&[String]) -> CmdOut + Send + Sync + 'static) -> (Arc<Betik>, Arc<DockerKomut>, Env) {
        let komut = Arc::new(DockerKomut::new(&layout, "tekserp_l4b").unwrap());
        let procs = Arc::new(Betik { calls: Mutex::new(vec![]), yanit: Box::new(yanit) });
        let env = Env {
            fs: Arc::new(crate::env::RealFs),
            svc: Arc::new(super::super::NoServices),
            procs: Arc::clone(&procs) as Arc<dyn Procs>,
            net: Arc::new(crate::env::RealNet::new(None).unwrap()),
            clock: Arc::new(crate::env::SystemClock),
            events: Arc::new(super::super::olay::StderrEvents { journald: false }),
            protect: Arc::new(super::super::koruma::DirectoryProtect),
            arka: arka_ucu(Arc::clone(&komut)),
        };
        (procs, komut, env)
    }
    fn alt_komut(args: &[String]) -> Vec<String> {
        // compose -p P --project-directory K -f F [-f Y] --env-file A --env-file B <alt komut …>
        match duzen::compose_basi_coz(args) {
            Some((_, i)) => args[i..].to_vec(),
            None => args.to_vec(),
        }
    }

    #[test]
    fn durum_ve_cokme_eslemesi() {
        for (line, state, crash) in [
            ("running|0|0|healthy", SvcState::Running, None),
            ("running|0|2|", SvcState::Running, Some(1)),
            ("restarting|47|1|", SvcState::Starting, Some(47)),
            ("exited|10|0|", SvcState::Stopped, Some(10)),
            ("exited|143|0|", SvcState::Stopped, None),
            ("exited|0|0|", SvcState::Stopped, None),
            ("created|0|0|", SvcState::Stopped, None),
        ] {
            let l = line.to_string();
            let (_, komut, env) = kur(move |a| match alt_komut(a).first().map(String::as_str) {
                Some("ps") => out(0, "abc123\n"),
                Some("inspect") => out(0, &format!("{l}\n")),
                _ => out(1, ""),
            });
            let s = DockerServices::new(komut, Arc::clone(&env.procs), Arc::clone(&env.fs), 60);
            assert_eq!(s.state(contract::BACKEND_SERVICE).unwrap(), state, "{line}");
            assert_eq!(s.crash_exit_code("backend").unwrap(), crash, "{line}");
        }
        // Konteyner yok ⇒ durmuş (Missing değil: compose `up` yaratır).
        let (_, komut, env) = kur(|_| out(0, ""));
        let s = DockerServices::new(komut, Arc::clone(&env.procs), Arc::clone(&env.fs), 60);
        assert_eq!(s.state("backend").unwrap(), SvcState::Stopped);
        assert!(s.state("TeksERP-Backend-ikinci").is_err(), "büyük harfli ad compose servisi değil");
    }

    #[test]
    fn baslat_kip_degiskeni_ve_durdurulani_cokme_saymaz() {
        // Backend başlatması etiketi kayda karşı ölçer: `current` → 1.0.0 ve güncelleyicinin kaydı.
        let root = std::env::temp_dir().join(format!("tekserp-dk-baslat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let layout = Layout::new(&root, &root.join("veri"));
        std::fs::create_dir_all(layout.version_dir("1.0.0")).unwrap();
        Fs::set_link(&crate::env::RealFs, &layout.current(), &layout.version_dir("1.0.0")).unwrap();
        let kayit = imaj::Kayit {
            v: 1,
            surum: "1.0.0".into(),
            etiket: "tekserp-korumali:1.0.0".into(),
            kimlik: "sha256:c".into(),
            katmanlar: vec!["sha256:l".into()],
            docker_id: "sha256:h".into(),
            zaman: String::new(),
        };
        imaj::kayit_yaz(&crate::env::RealFs, &layout, &kayit).unwrap();
        let (p, komut, env) = kur_l(layout, |a| match alt_komut(a).first().map(String::as_str) {
            Some("ps") => out(0, "abc\n"),
            Some("inspect") => out(0, "exited|10|0|\n"),
            Some("image") => out(0, "sha256:h|[\"sha256:l\"]\n"),
            _ => out(0, ""),
        });
        let s = DockerServices::new(komut, Arc::clone(&env.procs), Arc::clone(&env.fs), 45);
        s.start("TeksERP-Backend", &[contract::VERIFY_ARG]).unwrap();
        s.start("backend", &[]).unwrap();
        assert!(s.start("backend", &["--baska"]).is_err());
        assert_eq!(s.crash_exit_code("backend").unwrap(), Some(10), "durdurulmamış + kod 10 = çökme");
        s.stop("backend").unwrap();
        assert_eq!(s.crash_exit_code("backend").unwrap(), None, "elle durdurulan yeniden başlamaz — yatıştırma yok");
        let calls = p.calls.lock().unwrap();
        let ups: Vec<_> = calls.iter().filter(|(a, _)| alt_komut(a).first().map(String::as_str) == Some("up")).collect();
        assert_eq!(alt_komut(&ups[0].0), ["up", "-d", "--no-deps", "--force-recreate", "backend"]);
        assert_eq!(ups[0].1, [("TEKSERP_DOGRULAMA_KIPI".to_string(), "1".to_string())]);
        assert_eq!(ups[1].1, [("TEKSERP_DOGRULAMA_KIPI".to_string(), String::new())], "normal başlatmada kip BOŞ");
        let stop = calls.iter().find(|(a, _)| alt_komut(a).first().map(String::as_str) == Some("stop")).unwrap();
        assert_eq!(alt_komut(&stop.0), ["stop", "-t", "45", "backend"]);
        // Birim her hedefte koşar; Windows'ta `Path::join` `\` ekler — ölçülen compose başının biçimi, ayraç değil.
        let root_s = root.to_string_lossy().replace('\\', "/");
        let head: Vec<String> = ups[0].0[..11].iter().map(|a| a.replace('\\', "/").replace(&root_s, "/opt/tekserp")).collect();
        assert_eq!(
            head,
            [
                "compose",
                "-p",
                "tekserp_l4b",
                "--project-directory",
                "/opt/tekserp",
                "-f",
                "/opt/tekserp/current/docker-compose.yml",
                "--env-file",
                "/opt/tekserp/yapilandirma/.env",
                "--env-file",
                "/opt/tekserp/yapilandirma/pg.env"
            ]
        );
    }

    #[test]
    fn saglik_konteyner_icinden() {
        let (p, komut, env) = kur(|_| out(0, "200\n{\"status\":\"UP\"}"));
        let r = DockerSaglik { komut }.probe(&env, 4000, "/health/yerel").unwrap();
        assert_eq!(r.status, 200);
        let mut body = String::new();
        std::io::Read::read_to_string(&mut { r.body }, &mut body).unwrap();
        assert_eq!(body, "{\"status\":\"UP\"}");
        let a = alt_komut(&p.calls.lock().unwrap()[0].0);
        assert_eq!(&a[..5], ["exec", "-T", "backend", "node", "-e"]);
        assert!(a[5].contains("http://127.0.0.1:4000/health/yerel"), "{}", a[5]);
        let (_, komut, env) = kur(|_| out(3, ""));
        assert!(DockerSaglik { komut }.probe(&env, 4000, "/health").is_err(), "bağlanamadı = hata");
    }

    #[test]
    fn araclar_adli_konteynerde_bagli_dizinle() {
        let (p, komut, env) = kur(|_| out(0, "3 4\n"));
        let a = DockerAraclar { komut };
        let be = crate::settings::backend_env_from_bytes_in(
            b"POSTGRES_PASSWORD=x\nPOSTGRES_DB=fabrika\n",
            &Layout::new(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp")),
            crate::settings::OrtamKipi::Compose,
        )
        .unwrap();
        assert_eq!(a.migration_count(&env, &be).unwrap(), MigrationCount { finished: 3, total: 4 });
        a.pg_dump(&env, &be, Path::new("/var/lib/tekserp/guncelleme/is/yedek/op1/db.dump"), Duration::from_secs(5)).unwrap();
        a.restore_db(&env, &be, Path::new("/x/db.dump.geri"), Duration::from_secs(5)).unwrap();
        a.migrate_deploy(&env, Path::new("/yok"), &be, Duration::from_secs(5)).unwrap();
        let calls: Vec<Vec<String>> = p.calls.lock().unwrap().iter().map(|(a, _)| alt_komut(a)).collect();
        // Her araçtan önce aynı adlı yetim silinir.
        assert_eq!(calls[0], ["rm", "-f", "tekserp-arac-tekserp_l4b-psql"]);
        let dump = calls.iter().find(|c| c.contains(&"pg_dump".to_string())).unwrap();
        assert_eq!(
            dump,
            &[
                "run",
                "--rm",
                "--no-deps",
                "-T",
                "--name",
                "tekserp-arac-tekserp_l4b-pg_dump",
                "--user",
                "0:0",
                "-v",
                "/var/lib/tekserp/guncelleme/is/yedek/op1:/arac/b0:rw",
                "yedek",
                "pg_dump",
                "-w",
                "-Fc",
                "-f",
                "/arac/b0/db.dump"
            ]
        );
        let restore = calls.iter().find(|c| c.last().is_some_and(|l| l == "/arac/b0/db.dump.geri")).unwrap();
        assert!(restore.windows(2).any(|w| w == ["-d", "fabrika"]), "{restore:?}");
        let goc = calls.last().unwrap();
        assert_eq!(&goc[goc.len() - 2..], ["backend", "goc"]);
        assert!(!calls.iter().flatten().any(|x| x.contains("x\n") || x == "x"), "parola argümana girmez");
    }

    /// Saha hatası (2.15.2, deneme sunucusu): bağ taşıyan araç yetkisiz köktür; alıcı birimdeki yoldan verilirse
    /// `EACCES` ve YEDEK geri döner. Alıcılar konaktan özel alana kopyalanır, araç yalnız o kopyayı görür.
    #[test]
    fn yedek_alicilari_birimden_kopyalanir_araca_yetki_eklenmez() {
        let root = std::env::temp_dir().join(format!("tekserp-dk-alici-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let birim = root.join("volumes/tekserp_l4b_yedek_anahtar/_data");
        std::fs::create_dir_all(&birim).unwrap();
        std::fs::write(birim.join("ders.tkpub"), "tkpub1:DERS\n").unwrap();
        std::fs::write(birim.join("benioku.txt"), "alıcı değil").unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&birim, std::os::unix::fs::PermissionsExt::from_mode(0o700)).unwrap();
        let mp = birim.to_string_lossy().into_owned();
        let (p, komut, env) = kur(move |a| {
            if a.get(..2) == Some(&["volume".to_string(), "inspect".to_string()][..]) {
                out(0, &format!("{mp}\n"))
            } else {
                out(0, "")
            }
        });
        let a = DockerAraclar { komut };
        let be = crate::settings::backend_env_from_bytes_in(
            b"POSTGRES_PASSWORD=x\n",
            &Layout::new(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp")),
            crate::settings::OrtamKipi::Compose,
        )
        .unwrap();
        let op = root.join("is/yedek/op1");
        let ara = op.join(crate::operation::RECIPIENT_STAGE);
        let alicilar = a.kurulum_alicilari(&env, &be, &ara).unwrap();
        assert_eq!(alicilar, vec![ara.join("ders.tkpub")], "yalnız *.tkpub, özel alandaki kopya");
        assert_eq!(std::fs::read_to_string(&alicilar[0]).unwrap(), "tkpub1:DERS\n");
        let mut hepsi = alicilar.clone();
        hepsi.push(root.join("is/anahtar/op1/guncelleme.tkpub"));
        a.backup_encrypt(&env, Path::new("/yok"), &op.join("db.dump"), &op.join("db.dump.tkenc"), &hepsi, Duration::from_secs(5)).unwrap();
        let calls: Vec<Vec<String>> = p.calls.lock().unwrap().iter().map(|(a, _)| alt_komut(a)).collect();
        let sifrele = calls.iter().find(|c| c.contains(&"sifrele".to_string())).unwrap();
        let alici: Vec<&String> = sifrele.windows(2).filter(|w| w[0] == "--alici").map(|w| &w[1]).collect();
        assert_eq!(alici.len(), 2, "{sifrele:?}");
        assert!(alici.iter().all(|x| x.starts_with("/arac/b")), "alıcı yalnız bağlanan kopyadan: {alici:?}");
        assert!(!sifrele.iter().any(|x| x.contains("yedek-anahtar") || x.contains("_yedek_anahtar")), "birim araca verilmez: {sifrele:?}");
        let ara_bagi = format!("{}:", ara.display());
        assert!(sifrele.iter().any(|x| x.starts_with(&ara_bagi) && x.ends_with(":ro")), "kopya dizini salt okunur bağlanır: {sifrele:?}");
        assert!(
            sifrele.windows(2).any(|w| w == ["--user", "0:0"]) && !sifrele.iter().any(|x| x.contains("cap-add")),
            "kimlik/yetki değişmez"
        );
        assert!(!calls.iter().any(|c| c.contains(&"ls".to_string())), "alıcı listesi konteynerden okunmaz");
        // Birim çözülemezse alıcısız yedek SESSİZCE alınmaz.
        let (_, komut, env) = kur(|_| out(1, ""));
        let e = DockerAraclar { komut }.kurulum_alicilari(&env, &be, &ara).unwrap_err();
        assert!(e.contains("yedek_anahtar birimi tekserp_l4b_yedek_anahtar"), "{e}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn imaj_budama_yalniz_surum_etiketleri() {
        let (p, komut, env) = kur(|a| {
            if a.get(1).map(String::as_str) == Some("ls") {
                out(0, "1.2.0\n1.3.0\n1.4.0\nlatest\n2.14.0-ders.5fb46d862\n")
            } else {
                out(0, "")
            }
        });
        DockerAraclar { komut }.imaj_buda(&env, &["1.4.0".into(), "1.3.0".into()]);
        let rms: Vec<String> =
            p.calls.lock().unwrap().iter().filter(|(a, _)| a.get(1).map(String::as_str) == Some("rm")).map(|(a, _)| a[2].clone()).collect();
        assert_eq!(rms, ["tekserp-korumali:1.2.0", "tekserp-korumali:2.14.0-ders.5fb46d862"].map(str::to_string).to_vec());
    }

    /// Kodun aynası: açılış kodları tablosu ve şablonun backend adresi (compose kipinin türettiği `postgres:5432`/4000).
    #[test]
    fn sablon_ve_kod_tablosu_aynasi() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docker/korumali");
        let t: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("acilis-kodlari.json")).unwrap()).unwrap();
        let kodlar = t["kodlar"].as_array().unwrap();
        assert!(kodlar.len() >= 10);
        for k in kodlar {
            assert_eq!(acilis_kodu(u32::try_from(k["kod"].as_u64().unwrap()).unwrap()), k["ad"].as_str().unwrap());
        }
        let yml = std::fs::read_to_string(dir.join("docker-compose.guncelleyici.yml")).unwrap();
        for satir in [
            "DATABASE_URL: postgresql://${POSTGRES_USER:-tekserp}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-tekserp}?schema=public",
            "PORT: \"4000\"",
            "name: ${TEKSERP_PROJE:-tekserp}",
            "TEKSERP_DOGRULAMA_KIPI: ${TEKSERP_DOGRULAMA_KIPI:-}",
            "  yedek:",
            "  backend:",
            "- yedek_anahtar:/var/lib/tekserp/yedek-anahtar:ro",
        ] {
            assert!(yml.contains(satir), "şablonda yok: {satir}");
        }
        let be = crate::settings::backend_env_from_bytes_in(
            b"POSTGRES_PASSWORD=p\n",
            &Layout::new(Path::new("/k"), Path::new("/v")),
            crate::settings::OrtamKipi::Compose,
        )
        .unwrap();
        assert_eq!(
            (be.port, be.db.host.as_str(), be.db.port, be.db.user.as_str(), be.db.database.as_str()),
            (4000, "postgres", 5432, "tekserp", "tekserp")
        );
        let eksik = crate::settings::backend_env_from_bytes_in(
            b"DATABASE_URL=postgresql://u:p@h:1/d\n",
            &Layout::new(Path::new("/k"), Path::new("/v")),
            crate::settings::OrtamKipi::Compose,
        );
        assert_eq!(eksik.err().map(|e| e.0), Some(crate::codes::AYAR_EKSIK));
    }
}
