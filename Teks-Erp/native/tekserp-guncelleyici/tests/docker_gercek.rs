//! GERÇEK Docker'a karşı Linux arka ucu (L4b, K1'in gerçek ayağı): `DockerServices` durum/başlat/durdur/çökme
//! eşlemesi, doğrulama kipi değişkeninin konteynere ulaşması, `unless-stopped` + `compose stop` yatışması ve araç
//! konteynerinin yetim bırakmaması. Yalnız `TEKSERP_DOCKER_TEST=1` + `TEKSERP_DOCKER_TEST_IMAJ=<YEREL imaj, sh'li>`
//! verilince koşar (aksi hâlde ⏭ beyanla geçer); hiçbir imaj çekilmez (`pull_policy: never`), kendi projesini
//! (`tekserp_l4b_<pid>`) sonunda `down` eder. CI: `native-linux.yml` (busybox).
#![cfg(unix)]
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tekserp_guncelleyici::env::{Env, Fs, Procs, RealProcs, Services, SvcState};
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::platform::linux::docker::{self, DockerKomut, DockerServices};
use tekserp_guncelleyici::platform::Araclar;

const COMPOSE: &str = r#"services:
  backend:
    image: ${IMAJ}
    pull_policy: never
    restart: unless-stopped
    stop_grace_period: 2s
    environment:
      TEKSERP_DOGRULAMA_KIPI: ${TEKSERP_DOGRULAMA_KIPI:-}
    command: ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 1; done"]
  duser:
    image: ${IMAJ}
    pull_policy: never
    restart: unless-stopped
    command: ["sh", "-c", "sleep 1; exit 10"]
"#;

/// Test imajının sürüm etiketi (backend başlatması yalnız güncelleyicinin yüklediği etiketi başlatır).
const ETIKET: &str = "tekserp-korumali:1.0.0";

struct Proje {
    root: PathBuf,
    komut: Arc<DockerKomut>,
}

impl Drop for Proje {
    fn drop(&mut self) {
        let mut c = Command::new("docker");
        c.args(self.komut.compose().args.iter()).args(["down", "--remove-orphans", "-t", "1"]);
        let _ = c.output();
        let _ = Command::new("docker").args(["rm", "-f", &self.komut.arac_adi("goc")]).output();
        let _ = Command::new("docker").args(["image", "rm", ETIKET]).output();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn sh(args: &[&str]) -> String {
    let o = Command::new("docker").args(args).output().expect("docker");
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

fn kipi(p: &Proje) -> String {
    let mut c = Command::new("docker");
    c.args(p.komut.compose().args.iter()).args(["exec", "-T", "backend", "sh", "-c", "printf %s \"$TEKSERP_DOGRULAMA_KIPI\""]);
    String::from_utf8_lossy(&c.output().expect("exec").stdout).to_string()
}

fn bekle(what: &str, limit: Duration, f: impl Fn() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(t.elapsed() < limit, "{what}: {} sn içinde olmadı", limit.as_secs());
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[test]
fn docker_gercek_hizmet_ve_arac() {
    let (Ok("1"), Ok(imaj)) = (std::env::var("TEKSERP_DOCKER_TEST").as_deref(), std::env::var("TEKSERP_DOCKER_TEST_IMAJ")) else {
        eprintln!("⏭ docker_gercek: TEKSERP_DOCKER_TEST=1 + TEKSERP_DOCKER_TEST_IMAJ verilmedi (CI native-linux koşar)");
        return;
    };
    assert!(!sh(&["image", "inspect", "--format", "{{.Id}}", &imaj]).is_empty(), "{imaj} YEREL olmalı (çekilmez)");
    let proje = format!("tekserp_l4b_{}", std::process::id());
    let root = std::env::temp_dir().join(&proje);
    let surum = root.join("surumler").join("1.0.0");
    std::fs::create_dir_all(&surum).unwrap();
    std::fs::create_dir_all(root.join("yapilandirma")).unwrap();
    std::fs::write(surum.join("docker-compose.yml"), COMPOSE).unwrap();
    std::fs::write(root.join("yapilandirma/.env"), format!("IMAJ={ETIKET}\n")).unwrap();
    std::fs::write(root.join("yapilandirma/pg.env"), "").unwrap();
    std::os::unix::fs::symlink(&surum, root.join("current")).unwrap();
    let layout = Layout::new(&root, &root.join("veri"));
    let p = Proje { root: root.clone(), komut: Arc::new(DockerKomut::new(&layout, &proje).unwrap()) };
    let procs: Arc<dyn Procs> = Arc::new(RealProcs);
    let fs: Arc<dyn Fs> = Arc::new(tekserp_guncelleyici::env::RealFs);
    let env = Env {
        fs: Arc::clone(&fs),
        svc: Arc::new(DockerServices::new(Arc::clone(&p.komut), Arc::clone(&procs), Arc::clone(&fs), 5)),
        procs: Arc::clone(&procs),
        net: Arc::new(tekserp_guncelleyici::env::RealNet::new(None).unwrap()),
        clock: Arc::new(tekserp_guncelleyici::env::SystemClock),
        events: Arc::new(tekserp_guncelleyici::platform::linux::olay::StderrEvents { journald: false }),
        protect: Arc::new(tekserp_guncelleyici::platform::linux::koruma::DirectoryProtect),
        arka: docker::arka_ucu(Arc::clone(&p.komut)),
    };
    let a = docker::DockerAraclar { komut: Arc::clone(&p.komut) };
    // Backend başlatması etiketi güncelleyicinin kaydına karşı ölçer: test imajı sürüm etiketiyle kaydedilip yüklenir.
    sh(&["tag", &imaj, ETIKET]);
    let arsiv = root.join("imaj.tar");
    sh(&["save", "-o", &arsiv.to_string_lossy(), ETIKET]);
    let kimlik = tekserp_guncelleyici::imaj::olc(fs.as_ref(), &arsiv).unwrap().kimlik;
    a.imaj_yukle(&env, &arsiv, "1.0.0", &kimlik).unwrap();
    let s = DockerServices::new(Arc::clone(&p.komut), Arc::clone(&procs), Arc::clone(&fs), 5);

    // Yok ⇒ durmuş; doğrulama kipi konteynere "1", normal başlatmada BOŞ.
    assert_eq!(s.state("TeksERP-Backend").unwrap(), SvcState::Stopped);
    s.start("backend", &["--dogrulama"]).unwrap();
    bekle("backend çalışır", Duration::from_secs(60), || s.state("backend").is_ok_and(|x| x == SvcState::Running));
    assert_eq!(kipi(&p), "1");
    s.start("backend", &[]).unwrap();
    bekle("backend yeniden", Duration::from_secs(60), || s.state("backend").is_ok_and(|x| x == SvcState::Running));
    assert_eq!(kipi(&p), "", "normal başlatmada kip boş");
    assert_eq!(s.crash_exit_code("backend").unwrap(), None);
    s.stop("backend").unwrap();
    assert_eq!(s.state("backend").unwrap(), SvcState::Stopped);
    assert_eq!(s.crash_exit_code("backend").unwrap(), None, "temiz durdurma çökme değil");

    // Düşen konteyner: `unless-stopped` yeniden başlatır ⇒ çökme kodu görülür; `compose stop` döngüyü bitirir.
    s.start("duser", &[]).unwrap();
    bekle("çökme görülür", Duration::from_secs(60), || s.crash_exit_code("duser").is_ok_and(|c| c == Some(10) || c == Some(1)));
    s.stop("duser").unwrap();
    let once = s.incele("duser").unwrap().unwrap();
    std::thread::sleep(Duration::from_secs(3));
    let sonra = s.incele("duser").unwrap().unwrap();
    assert_eq!(s.state("duser").unwrap(), SvcState::Stopped);
    assert_eq!((once.restarts, sonra.status.as_str()), (sonra.restarts, "exited"), "durdurulan yeniden başlamaz");
    // Yeni bir DockerServices (güncelleyici yeniden başladı): elle durdurulmuş, kod 10'la çıkmış konteyner — çökme
    // sayılır mı? Docker yeniden başlatmaz; yatıştırma penceresi bunu bekleyip bırakır (fail-safe yön).
    let s2 = DockerServices::new(Arc::clone(&p.komut), Arc::clone(&procs), Arc::clone(&fs), 5);
    assert_eq!(s2.state("duser").unwrap(), SvcState::Stopped);

    // Araç konteyneri: aynı adlı yetim önce silinir, `--rm` sonra hiçbir şey bırakmaz.
    let ad = p.komut.arac_adi("goc");
    sh(&["create", "--name", &ad, &imaj, "true"]);
    assert_eq!(sh(&["ps", "-a", "-q", "--filter", &format!("name=^{ad}$")]).lines().count(), 1, "yetim kuruldu");
    let be = tekserp_guncelleyici::settings::backend_env_from_bytes_in(
        b"POSTGRES_PASSWORD=x\n",
        &layout,
        tekserp_guncelleyici::settings::OrtamKipi::Compose,
    )
    .unwrap();
    let out = a.migrate_deploy(&env, Path::new("/yok"), &be, Duration::from_secs(120)).unwrap();
    assert!(!out.ok(), "test imajında `goc` yok — konteyner koştu ve düştü");
    assert!(sh(&["ps", "-a", "-q", "--filter", &format!("name=^{ad}$")]).is_empty(), "araç konteyneri yetim kaldı");
    assert_eq!(a.imaj_deposu(&env).map(|d| d.is_absolute()), Some(true), "Docker kökü ölçüldü");
}
