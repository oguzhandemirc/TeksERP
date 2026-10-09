//! Linux/Docker arka ucu II (`GUNCELLEYICI-SAGLAMLIK.md` §1.2, §2.2 — L4b): hizmet denetimi (`DockerServices`),
//! sağlık sondası (`DockerSaglik`, konteyner İÇİNDEN) ve araçlar (`DockerAraclar`, kısa ömürlü araç konteynerleri).
//! Docker'a YALNIZ `docker` CLI ile, `Procs` üzerinden konuşulur; her compose çağrısı `duzen::compose_args`
//! başıyla koşar. CLI çıktısından yalnız Go şablonuyla istenen tek değerler okunur, başarı ölçüsü çıkış kodudur.
use super::duzen;
use crate::env::{Cmd, CmdOut, Env, EnvError, EnvResult, HttpResponse, Procs, Services, SvcState};
use crate::layout::Layout;
use crate::settings::BackendEnv;
use crate::tools::{describe_failure, restore_errors, MigrationCount};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekserp_hizmet::contract;

/// Disk ön kontrolünün DB payı (§5 madde 4).
pub const DB_BOYU_SQL: &str = "SELECT pg_database_size(current_database())";
/// Compose servis adları (şablon `docker-compose.guncelleyici.yml`).
pub const BACKEND: &str = "backend";
/// Araç konteynerlerinin servisi: aynı imaj, PG istemcisi + yedek aracı, PG ortamı compose'tan.
pub const ARAC_HIZMETI: &str = "yedek";
/// İmaj içindeki yedek aracı ve kurulumun alıcı birimi (şablondaki bağ).
pub const YEDEK_ARACI: &str = "/app/dist/tools/yedek-sifrele.cjs";
pub const ALICI_BIRIMI: &str = "/var/lib/tekserp/yedek-anahtar";
/// Backend imajının deposu (budama yalnız bunun etiketlerine dokunur).
pub const IMAJ_DEPOSU: &str = "tekserp-korumali";
/// `docker inspect` tek satır biçimi: durum | çıkış kodu | yeniden başlatma sayısı | sağlık.
pub const INSPECT_FORMAT: &str =
    "{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}";

/// Konteynerin yeniden başlatma politikası (bakım çiti W2: `stop` edilen konteyneri açılışta başlatmayan politika şart).
pub const RESTART_POLICY_FORMAT: &str = "{{.HostConfig.RestartPolicy.Name}}";

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
    pub stop_timeout_s: u64,
    /// Bu süreçte `stop` ile durdurulanlar: Docker elle durdurulan konteyneri yeniden başlatmaz — çıkış kodu
    /// çökme sayılmaz (yatıştırma kendiliğinden).
    durduruldu: Mutex<HashSet<String>>,
}

impl DockerServices {
    pub fn new(komut: Arc<DockerKomut>, procs: Arc<dyn Procs>, stop_timeout_s: u64) -> DockerServices {
        DockerServices { komut, procs, stop_timeout_s, durduruldu: Mutex::new(HashSet::new()) }
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
/// dokunan araç `--user 0:0` alır: özel alan root 0700'dür (yetkisiz kök, `cap_drop: ALL` şablondan).
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

    /// Kurulumun yedek alıcıları (birimdeki `*.tkpub`) — `--anahtar-dizini` ile `--alici` birlikte verilemez.
    fn birim_alicilari(&self, env: &Env) -> Result<Vec<String>, String> {
        let k = ["ls", "-1", ALICI_BIRIMI].map(str::to_string);
        let out = self.arac(env, "alicilar", ARAC_HIZMETI, &Baglar::default(), &k, Duration::from_secs(60))?;
        if !out.ok() {
            return Ok(Vec::new());
        }
        Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|n| n.ends_with(".tkpub") && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')))
            .map(|n| format!("{ALICI_BIRIMI}/{n}"))
            .collect())
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
        for r in self.birim_alicilari(env)? {
            k.push("--alici".into());
            k.push(r);
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
    fn db_boyutu(&self, env: &Env, _be: &BackendEnv) -> Option<u64> {
        self.psql(env, DB_BOYU_SQL, "veritabanı boyu (psql)").ok()?.trim().parse().ok()
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
        let layout = Layout::new(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp"));
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
        // compose -p P -f F --env-file A --env-file B <alt komut …>
        if args.first().map(String::as_str) == Some("compose") {
            args[9..].to_vec()
        } else {
            args.to_vec()
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
            let s = DockerServices::new(komut, Arc::clone(&env.procs), 60);
            assert_eq!(s.state(contract::BACKEND_SERVICE).unwrap(), state, "{line}");
            assert_eq!(s.crash_exit_code("backend").unwrap(), crash, "{line}");
        }
        // Konteyner yok ⇒ durmuş (Missing değil: compose `up` yaratır).
        let (_, komut, env) = kur(|_| out(0, ""));
        let s = DockerServices::new(komut, Arc::clone(&env.procs), 60);
        assert_eq!(s.state("backend").unwrap(), SvcState::Stopped);
        assert!(s.state("TeksERP-Backend-ikinci").is_err(), "büyük harfli ad compose servisi değil");
    }

    #[test]
    fn baslat_kip_degiskeni_ve_durdurulani_cokme_saymaz() {
        let (p, komut, env) = kur(|a| match alt_komut(a).first().map(String::as_str) {
            Some("ps") => out(0, "abc\n"),
            Some("inspect") => out(0, "exited|10|0|\n"),
            _ => out(0, ""),
        });
        let s = DockerServices::new(komut, Arc::clone(&env.procs), 45);
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
        let head: Vec<String> = ups[0].0[..9].iter().map(|a| a.replace('\\', "/")).collect();
        assert_eq!(
            head,
            [
                "compose",
                "-p",
                "tekserp_l4b",
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
