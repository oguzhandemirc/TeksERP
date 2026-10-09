//! Unix çekirdek bağları (`GUNCELLEYICI-SAGLAMLIK.md` §1.2 "Diğer Linux uygulamaları"): güvenilmez okuma
//! (`O_NOFOLLOW` + `fstat`), boş alan (`statvfs`), yabancı yazar (sahip + izin bitleri), özel alan (root 0700),
//! tek süreç kilidi (`flock`) ve çocuk süreç ağacı (kendi süreç grubu + `PR_SET_PDEATHSIG`). Linux için yazılır;
//! geliştirme konağı macOS'ta da derlenip koşar (`PDEATHSIG` yalnız Linux'ta).
use std::ffi::CString;
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

fn deny(p: &Path, why: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, format!("{}: {why}", p.display()))
}

fn c_name(p: &Path, s: &std::ffi::OsStr) -> io::Result<CString> {
    CString::new(s.as_bytes()).map_err(|_| deny(p, "yolda NUL baytı"))
}

/// Güncelleyicinin etkin kullanıcısı (üretimde root).
pub fn euid() -> u32 {
    // SAFETY: yan etkisiz sistem çağrısı.
    unsafe { libc::geteuid() }
}

/// GÜVENİLMEZ dizinden okuma (`env::Fs::read_untrusted`): üst dizin `O_DIRECTORY|O_NOFOLLOW` ile açılıp
/// sabitlenir, dosya o tutamaca göre `openat(O_NOFOLLOW|O_NONBLOCK)` ile açılır ve AÇILAN tutamaç `fstat` ile
/// yeniden ölçülür — ölçüm ile açış arasında değiştirilen yol (bağlantı, FIFO, dizin) okunmaz. `O_NONBLOCK`:
/// yerine konan FIFO açılışta güncelleyiciyi asmaz. Birden çok sabit bağlantılı dosya RED (başka bir yerin
/// dosyası niyet dizinine bağlanamasın).
pub fn read_untrusted(p: &Path, max: u64) -> io::Result<Vec<u8>> {
    let name = p.file_name().ok_or_else(|| deny(p, "dosya adı yok"))?;
    let parent = match p.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    let dir = std::fs::OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(parent).map_err(|e| {
        // Linux ELOOP, macOS ENOTDIR döner — bağlantı olduğu ayrıca ölçülür.
        let link = std::fs::symlink_metadata(parent).is_ok_and(|m| m.file_type().is_symlink());
        if link || e.raw_os_error() == Some(libc::ELOOP) {
            deny(p, "üst dizin bir bağlantı — izlenmez")
        } else {
            e
        }
    })?;
    let cname = c_name(p, name)?;
    let flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_NOCTTY | libc::O_CLOEXEC;
    // SAFETY: geçerli dizin tutamacı ve NUL sonlu ad; dönen tutamaç hemen `File`a devredilir.
    let fd = unsafe { libc::openat(dir.as_raw_fd(), cname.as_ptr(), flags) };
    if fd < 0 {
        let e = io::Error::last_os_error();
        return Err(if e.raw_os_error() == Some(libc::ELOOP) { deny(p, "düz dosya değil (bağlantı izlenmez)") } else { e });
    }
    // SAFETY: `fd` az önce açıldı ve başka sahibi yok.
    let f = unsafe { std::fs::File::from_raw_fd(fd) };
    let m = f.metadata()?;
    if !m.is_file() {
        return Err(deny(p, "düz dosya değil (bağlantı izlenmez)"));
    }
    if m.nlink() > 1 {
        return Err(deny(p, "birden çok sabit bağlantılı dosya okunmaz"));
    }
    if m.len() > max {
        return Err(deny(p, &format!("{max} bayttan büyük")));
    }
    let mut out = Vec::with_capacity(m.len().min(max) as usize);
    f.take(max + 1).read_to_end(&mut out)?;
    if out.len() as u64 > max {
        return Err(deny(p, &format!("{max} bayttan büyük")));
    }
    Ok(out)
}

/// Yolun bulunduğu dosya sisteminde root OLMAYAN süreçlerin kullanabileceği boş alan (`f_bavail × f_frsize`).
// Alan türleri hedefe göre değişir (macOS `f_bavail` u32) — dönüşüm Linux'ta özdeşliktir.
#[allow(clippy::useless_conversion)]
pub fn free_space(p: &Path) -> io::Result<u64> {
    let c = c_name(p, p.as_os_str())?;
    // SAFETY: sıfırlanmış çıktı yapısı ve NUL sonlu yol.
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(u64::from(st.f_bavail).saturating_mul(u64::from(st.f_frsize)))
}

/// Yabancı yazar (Windows DACL ölçümünün karşılığı): sahibi root ya da güncelleyicinin kendisi değilse sahip
/// (izinleri değiştirebilir), grup ya da herkes yazabiliyorsa onlar. POSIX ACL'de grup bitleri maskedir —
/// adlı kullanıcıya yazma veren ACL maskeyi açar, burada "grup yazabilir" olarak görünür (fail-closed).
pub fn foreign_writers(p: &Path) -> io::Result<Vec<String>> {
    let m = std::fs::metadata(p)?;
    let mut out = Vec::new();
    if m.uid() != 0 && m.uid() != euid() {
        out.push(format!("sahibi uid {}", m.uid()));
    }
    if m.mode() & 0o020 != 0 {
        out.push("grup yazabilir".to_string());
    }
    if m.mode() & 0o002 != 0 {
        out.push("herkes yazabilir".to_string());
    }
    Ok(out)
}

/// Güncelleyicinin özel alanı (`is/`): bağlantı olamaz; sahibi güncelleyicinin kendisi (root ise başka sahipli
/// dizin root'a alınır), izni 0700. Windows'taki korumalı DACL'in karşılığı — `Protect` (Linux) gizliliği buna
/// dayanır. Uygulandıktan sonra yeniden ölçülür; ölçüm tutmazsa hata (fail-closed).
pub fn harden_private_dir(p: &Path) -> io::Result<()> {
    let m = std::fs::symlink_metadata(p)?;
    if m.file_type().is_symlink() || !m.is_dir() {
        return Err(deny(p, "bir bağlantı ya da dizin değil — özel alan olarak kullanılmaz"));
    }
    let me = euid();
    if m.uid() != me {
        if me != 0 {
            return Err(deny(p, &format!("sahibi uid {} — güncelleyicinin (uid {me}) değil", m.uid())));
        }
        std::os::unix::fs::lchown(p, Some(0), Some(0))?;
    }
    if m.mode() & 0o7777 != 0o700 {
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700))?;
    }
    let after = std::fs::symlink_metadata(p)?;
    if after.file_type().is_symlink() || after.uid() != me || after.mode() & 0o077 != 0 {
        return Err(deny(p, "özel alan izni uygulanamadı (sahip/izin ölçümü tutmuyor)"));
    }
    Ok(())
}

/// Tek güncelleyici süreci: `flock(LOCK_EX|LOCK_NB)` — ikinci süreç (elle koşulan CLI dahil) hemen düşer;
/// süreç ölünce çekirdek kilidi bırakır (bayat kilit yok).
pub fn open_lock_file(p: &Path) -> Result<std::fs::File, String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let f = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(p)
        .map_err(|e| e.to_string())?;
    // SAFETY: geçerli tutamaç.
    if unsafe { libc::flock(f.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        let e = io::Error::last_os_error();
        return Err(if e.raw_os_error() == Some(libc::EWOULDBLOCK) {
            "başka bir güncelleyici süreci çalışıyor (kilit dolu)".to_string()
        } else {
            format!("kilit alınamadı: {e}")
        });
    }
    Ok(f)
}

/// Çocuk süreci kendi süreç grubunda başlatır (grup kimliği = çocuğun kimliği) ve Linux'ta güncelleyici
/// (başlatan iş parçacığı) ölünce çekirdeğe SIGKILL gönderttirir. Zaman aşımında ve çocuk çıktıktan sonra
/// bütün grup öldürülür (`ChildGroup`). ⚠️ `PDEATHSIG` başlatan İŞ PARÇACIĞINA bağlıdır: `RealProcs::run`
/// çocuğu kendi iş parçacığında bekler, o yüzden erken tetiklenmez.
pub fn own_process_tree(cmd: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
    #[cfg(target_os = "linux")]
    {
        // SAFETY: getpid fork'tan ÖNCE alınır; kapanış yalnız async-signal-safe çağrılar yapar (prctl, getppid).
        let parent = unsafe { libc::getpid() };
        unsafe {
            cmd.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong, 0, 0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                // Ebeveyn prctl'den önce öldüyse sinyal hiç gelmez — o durumda hiç başlama.
                if libc::getppid() != parent {
                    return Err(io::Error::from_raw_os_error(libc::ESRCH));
                }
                Ok(())
            });
        }
    }
}

/// Çocuğun süreç grubu (Windows `ChildTree` iş nesnesinin karşılığı).
pub struct ChildGroup(i32);

impl ChildGroup {
    pub fn attach(child: &std::process::Child) -> ChildGroup {
        ChildGroup(i32::try_from(child.id()).unwrap_or(0))
    }

    /// Bütün grubu SIGKILL ile sonlandırır (çıkmış grup: ESRCH, yok sayılır). Çocuk çıktıktan sonra da
    /// çağrılır: çıktı borusunu açık tutan torun, çıktı toplayan iş parçacığını sonsuza dek bekletmesin.
    pub fn kill(&self) {
        if self.0 > 0 {
            // SAFETY: negatif kimlik = süreç grubu; yalnız bu çocuğun kurduğu grup.
            unsafe {
                libc::kill(-self.0, libc::SIGKILL);
            }
        }
    }
}

/// Dizin girdisini (yeniden adlandırma) diske boşaltır. Unix'te dizinin fsync'i salt-okunur tutamaçla yapılır
/// (Windows'taki "salt-okunur tutamaçta FlushFileBuffers" sınıfı burada yok — bu modül yalnız Unix'te derlenir).
pub fn sync_dir(d: &Path) -> io::Result<()> {
    let dir = std::fs::File::open(d)?;
    dir.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::{Cmd, Procs, RealProcs};
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gl4a-{tag}-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn denied(r: io::Result<Vec<u8>>, needle: &str) -> bool {
        matches!(r, Err(ref e) if e.kind() == io::ErrorKind::PermissionDenied && e.to_string().contains(needle))
    }

    fn mkfifo(p: &Path) {
        let c = CString::new(p.as_os_str().as_bytes()).unwrap();
        // SAFETY: NUL sonlu yol.
        assert_eq!(unsafe { libc::mkfifo(c.as_ptr(), 0o600) }, 0, "mkfifo");
    }

    /// BEKÇİ `linux_fs_guvenilmez_okuma` (§1.2 güvenilmez okuma): düz dosya okunur; dosya ya da üst dizin
    /// sembolik bağsa, FIFO/dizin/çok bağlantılıysa ya da tavanı aşıyorsa RED; yokluk `NotFound` kalır
    /// (niyet/kira "yok" ayrımı); yerine konan FIFO okumayı ASMAZ (süreli iş parçacığıyla ölçülür).
    #[test]
    fn linux_fs_guvenilmez_okuma() {
        let d = tmp("okuma");
        let secret = d.join("gizli.txt");
        std::fs::write(&secret, b"root-sirri").unwrap();
        let ipc = d.join("niyet");
        std::fs::create_dir_all(&ipc).unwrap();
        let ok = ipc.join("niyet.json");
        std::fs::write(&ok, b"{}").unwrap();
        assert_eq!(read_untrusted(&ok, 16).unwrap(), b"{}");
        assert!(denied(read_untrusted(&ok, 1), "bayttan büyük"), "tavan");
        assert_eq!(read_untrusted(&ipc.join("yok.json"), 16).unwrap_err().kind(), io::ErrorKind::NotFound, "yokluk NotFound kalır");

        let link = ipc.join("bag.json");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert!(denied(read_untrusted(&link, 64), "bağlantı izlenmez"), "dosya bağı");

        let parent_link = d.join("niyet-bag");
        std::os::unix::fs::symlink(&ipc, &parent_link).unwrap();
        let r = read_untrusted(&parent_link.join("niyet.json"), 64);
        let msg = format!("{r:?}");
        assert!(denied(r, "üst dizin bir bağlantı"), "üst dizin bağı: {msg}");

        let hard = ipc.join("sabit.json");
        std::fs::hard_link(&secret, &hard).unwrap();
        assert!(denied(read_untrusted(&hard, 64), "sabit bağlantılı"), "sabit bağ");

        let sub = ipc.join("dizin.json");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(denied(read_untrusted(&sub, 64), "düz dosya değil"), "dizin");

        let fifo = ipc.join("fifo.json");
        mkfifo(&fifo);
        let (tx, rx) = std::sync::mpsc::channel();
        let f2 = fifo.clone();
        std::thread::spawn(move || {
            let _ = tx.send(read_untrusted(&f2, 64));
        });
        let r = rx.recv_timeout(Duration::from_secs(5)).expect("FIFO okuması ASILDI (O_NONBLOCK yok)");
        assert!(denied(r, "düz dosya değil"), "FIFO");

        // RealFs aynı yoldan geçer (gercek.rs unix dalı).
        assert!(crate::env::Fs::read_untrusted(&crate::env::RealFs, &link, 64).is_err(), "RealFs bağı izledi");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Yaşıyor mu: hortlak (ölmüş, toplanmamış — öksüz torunun yeni ebeveyni toplamamış olabilir) ölü sayılır.
    fn alive(pid: i32) -> bool {
        // SAFETY: sinyal 0 yalnız varlık ölçer.
        if unsafe { libc::kill(pid, 0) } != 0 {
            return false;
        }
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        !stat.rsplit_once(')').is_some_and(|(_, rest)| rest.trim_start().starts_with('Z'))
    }

    fn wait_dead(pid: i32, within: Duration) -> bool {
        let t = Instant::now();
        while t.elapsed() < within {
            if !alive(pid) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn read_pid(p: &Path) -> i32 {
        let t = Instant::now();
        loop {
            if let Ok(s) = std::fs::read_to_string(p) {
                if let Ok(n) = s.trim().parse() {
                    return n;
                }
            }
            assert!(t.elapsed() < Duration::from_secs(5), "torun kimliği yazılmadı");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// BEKÇİ `linux_procs_agac_olur` (§1.2 `Procs`): (a) zaman aşımında çocuğun TORUNU da ölür; (b) çocuk
    /// çıktığında çıktı borusunu tutan torun öldürülür ve `run` hemen döner (asılı kalmaz); (c) Linux'ta
    /// başlatan iş parçacığı ölünce çocuk SIGKILL alır (`PR_SET_PDEATHSIG`).
    #[test]
    fn linux_procs_agac_olur() {
        let d = tmp("agac");
        let sh = Path::new("/bin/sh");

        // Her koşum süreli iş parçacığında: ağaç öldürülmezse `run` torunun borusunda ASILIR — bekçi asılmaz, kızarır.
        let bounded = |c: Cmd| {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(RealProcs.run(&c));
            });
            rx.recv_timeout(Duration::from_secs(20)).expect("run ASILDI (torun çıktı borusunu tutuyor)").unwrap()
        };
        let reap = |pid: i32, what: &str| {
            let dead = wait_dead(pid, Duration::from_secs(5));
            if !dead {
                // SAFETY: sonda temizliği — yalnız bu testin torunu.
                unsafe { libc::kill(pid, libc::SIGKILL) };
            }
            assert!(dead, "{what}: torun yaşıyor");
        };

        let pid_a = d.join("a.pid");
        let out = bounded(
            Cmd::new(sh).arg("-c").arg(format!("sleep 300 & echo $! > '{}'; wait", pid_a.display())).timeout(Duration::from_secs(1)),
        );
        assert!(out.timed_out, "zaman aşımı bildirilmedi");
        reap(read_pid(&pid_a), "zaman aşımında");

        let pid_b = d.join("b.pid");
        let out = bounded(Cmd::new(sh).arg("-c").arg(format!("sleep 300 & echo $! > '{}'; echo bitti", pid_b.display())));
        assert!(out.ok() && String::from_utf8_lossy(&out.stdout).contains("bitti"), "çıktı: {out:?}");
        reap(read_pid(&pid_b), "çocuk çıktıktan sonra");

        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::ExitStatusExt;
            let mut child = std::thread::spawn(|| {
                let mut c = std::process::Command::new("sleep");
                c.arg("300");
                own_process_tree(&mut c);
                c.spawn().unwrap()
            })
            .join()
            .unwrap();
            let t = Instant::now();
            let status = loop {
                if let Some(s) = child.try_wait().unwrap() {
                    break Some(s);
                }
                if t.elapsed() > Duration::from_secs(5) {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(20));
            };
            assert_eq!(status.and_then(|s| s.signal()), Some(libc::SIGKILL), "başlatan ölünce çocuk SIGKILL almadı (PDEATHSIG)");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn statvfs_bos_alan_olculur() {
        let free = free_space(&std::env::temp_dir()).unwrap();
        assert!(free > 0 && free < u64::MAX, "{free}");
        assert!(free_space(Path::new("/yok/boyle/bir/yol")).is_err());
    }

    #[test]
    fn yabanci_yazar_ve_ozel_alan() {
        let d = tmp("izin");
        let set = |m: u32| std::fs::set_permissions(&d, std::fs::Permissions::from_mode(m)).unwrap();
        set(0o755);
        assert!(foreign_writers(&d).unwrap().is_empty());
        set(0o777);
        assert_eq!(foreign_writers(&d).unwrap(), vec!["grup yazabilir".to_string(), "herkes yazabilir".to_string()]);
        if euid() == 0 {
            std::os::unix::fs::lchown(&d, Some(4242), None).unwrap();
            set(0o755);
            assert_eq!(foreign_writers(&d).unwrap(), vec!["sahibi uid 4242".to_string()], "root olmayan sahip yabancıdır");
        }
        set(0o777);
        harden_private_dir(&d).unwrap();
        let m = std::fs::metadata(&d).unwrap();
        assert_eq!((m.mode() & 0o7777, m.uid()), (0o700, euid()));
        let link = d.with_extension("bag");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&d, &link).unwrap();
        assert!(harden_private_dir(&link).is_err(), "bağlantı özel alan olamaz");
        std::fs::remove_file(&link).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn kilit_ikinci_sureci_reddeder() {
        let d = tmp("kilit");
        let p = d.join("kilit");
        let first = open_lock_file(&p).unwrap();
        assert!(open_lock_file(&p).unwrap_err().contains("kilit dolu"), "ikinci açılış kilidi aldı");
        drop(first);
        // Paralel testin fork'u açıklamayı exec'e dek paylaşabilir — kısa süre yeniden denenir.
        let t = Instant::now();
        let again = loop {
            match open_lock_file(&p) {
                Err(e) if t.elapsed() < Duration::from_secs(3) => {
                    let _ = e;
                    std::thread::sleep(Duration::from_millis(50));
                }
                r => break r,
            }
        };
        assert!(again.is_ok(), "bırakılan kilit yeniden alınamadı: {again:?}");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
