//! Linux teslim paketi (L4c-1, `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §5 madde 5): dış tar yerleşik dar ustar
//! okuyucusuyla açılır. Her red "hiçbir şey yazılmadı" ile ölçülür: ölçüm açmadan önce biter, üye kümesi TAM eşit
//! olmalıdır. Biçim bizim üretimimiz (`teslim-paketle.sh`, `oci-paket.ts`) — ikisi de burada aynayla bağlanır.
mod common;

use common::*;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use tekserp_guncelleyici::env::{Fs, RealFs};
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::oci;
use tekserp_guncelleyici::package::{ExtractLimits, ExtractStats};

static SEQ: AtomicUsize = AtomicUsize::new(0);

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("tekserp-lp-{tag}-{}-{}", std::process::id(), SEQ.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// Geçerli paketin başlık + veri dizisi (`oci::members` sırası; içerik önemsiz — açıcı imza ölçmez).
fn valid_entries() -> Vec<([u8; 512], Vec<u8>)> {
    oci::members(NEW)
        .into_iter()
        .map(|n| {
            let data = format!("içerik {n}").into_bytes();
            let mode = if n == oci::GUNCELLEYICI { 0o755 } else { 0o644 };
            (ustar_seal(ustar_header(&n, b'0', data.len() as u64, mode)), data)
        })
        .collect()
}

fn extract(tag: &str, archive: &[u8]) -> (Result<ExtractStats, String>, PathBuf) {
    let d = scratch(tag);
    let tar = d.join("paket.tar");
    std::fs::write(&tar, archive).unwrap();
    let dest = d.join("hazirlik");
    (RealFs.extract_tar(&tar, &dest, &oci::members(NEW), &ExtractLimits::default()), dest)
}

/// Red: `PAKET_YOL:` önekli, beklenen gerekçeyi taşır ve hedefe TEK bayt yazılmamıştır (kötü üye en sonda olsa da).
fn rejected(tag: &str, archive: &[u8], why: &str) {
    let (r, dest) = extract(tag, archive);
    let e = r.expect_err(tag);
    assert!(e.starts_with("PAKET_YOL:"), "{tag}: yol/tip sınıfı değil: {e}");
    assert!(e.contains(why), "{tag}: gerekçe {why:?} değil: {e}");
    assert!(!dest.exists(), "{tag}: açma ölçümden önce başladı");
}

/// Geçerli üyelerden `name`i `evil` ile değiştirir (yoksa sona ekler): üye kümesi aynı kalır, yalnız sondalanan
/// denetim yakalar.
fn swapped(name: &str, evil: [u8; 512], data: &[u8]) -> Vec<u8> {
    let mut e: Vec<([u8; 512], Vec<u8>)> =
        valid_entries().into_iter().filter(|(h, _)| !h.starts_with(format!("{name}\0").as_bytes())).collect();
    e.push((evil, data.to_vec()));
    ustar_raw(&e)
}

fn typed(name: &str, t: u8, link: &str) -> [u8; 512] {
    let mut h = ustar_header(name, t, 0, 0o644);
    h[157..157 + link.len()].copy_from_slice(link.as_bytes());
    ustar_seal(h)
}

fn named(raw: &[u8]) -> [u8; 512] {
    let mut h = ustar_header("x", b'0', 1, 0o644);
    h[..100].fill(0);
    h[..raw.len()].copy_from_slice(raw);
    ustar_seal(h)
}

#[test]
fn linux_paket_yol_kacisi() {
    // Yol: mutlak, `..` (baştan ve içten), ad alanında NUL'dan sonra gizli parça, ters bölü.
    rejected("mutlak", &swapped("", named(b"/etc/cron.d/tekserp"), b"x"), "güvensiz yol");
    rejected("ust", &swapped("", named(b"../tekserp-guncelleyici"), b"x"), "güvensiz yol");
    rejected("ic-ust", &swapped("", named(b"a/../../tekserp-guncelleyici"), b"x"), "güvensiz yol");
    rejected("nul", &swapped(oci::GUNCELLEYICI, named(b"tekserp-guncelleyici\0../../x"), b"x"), "NUL");
    rejected("ters-bolu", &swapped("", named(b"..\\..\\x"), b"x"), "güvensiz yol");
    // Tip: beklenen bir üyenin adını taşısa da düz dosya olmayan üye RED (üye kümesi denetimine kalmaz).
    rejected("sembolik", &swapped(oci::GUNCELLEYICI, typed(oci::GUNCELLEYICI, b'2', "/usr/bin/sh"), b""), "sembolik bağ");
    rejected("sert", &swapped("docker-compose.yml", typed("docker-compose.yml", b'1', "/etc/shadow"), b""), "sert bağ");
    rejected("aygit", &swapped(".env.ornek", typed(".env.ornek", b'3', ""), b""), "aygıt");
    rejected("fifo", &swapped(oci::OZETLER, typed(oci::OZETLER, b'6', ""), b""), "FIFO");
    rejected("pax", &swapped(oci::KUNYE, typed(oci::KUNYE, b'x', ""), b""), "PAX");
    rejected("gnu-uzun", &swapped(oci::KUNYE_JWS, typed(oci::KUNYE_JWS, b'L', ""), b""), "GNU uzun ad");
    // Düz dosya tipinde bağ hedefi taşıyan üye de RED.
    rejected("bag-hedefi", &swapped(oci::OZETLER, typed(oci::OZETLER, b'0', "/etc/passwd"), b""), "bağ hedefi");
}

#[test]
fn linux_paket_uye_kumesi() {
    let base = valid_entries();
    // Geçerli küme: 9 düz dosya açılır, güncelleyici çalıştırılabilir, diğerleri değil.
    let (r, dest) = extract("tam", &ustar_raw(&base));
    assert_eq!(r.unwrap().files, 9);
    assert_eq!(listing(&dest), sorted(oci::members(NEW)));
    #[cfg(unix)]
    {
        assert_eq!(mode(&dest.join(oci::GUNCELLEYICI)), 0o755);
        assert_eq!(mode(&dest.join(oci::KUNYE)), 0o644);
    }
    let mut extra = base.clone();
    extra.push((ustar_seal(ustar_header("dist/arka-kapi.js", b'0', 1, 0o644)), b"x".to_vec()));
    rejected("fazla", &ustar_raw(&extra), "fazla: dist/arka-kapi.js");
    let missing: Vec<_> = base.iter().filter(|(h, _)| !h.starts_with(b"SHA256SUMS\0")).cloned().collect();
    rejected("eksik", &ustar_raw(&missing), "eksik: SHA256SUMS");
    let mut dup = base.clone();
    dup.push(base[0].clone());
    rejected("cift", &ustar_raw(&dup), "çift üye");
    let mut dir = vec![(ustar_seal(ustar_header("runtime/", b'5', 0, 0o755)), Vec::new())];
    dir.extend(base.iter().cloned());
    rejected("dizin", &ustar_raw(&dir), "fazla: runtime");
}

fn listing(d: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

#[cfg(unix)]
fn mode(p: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).unwrap().permissions().mode() & 0o7777
}

fn code(w: &World) -> Option<String> {
    w.status().and_then(|s| s.error_code)
}

/// Red sonrası Linux dünyası: hizmet durdurulmadı, `current` aynı, sürüm ve hazırlık dizini yok, indirme silinmiş.
fn untouched(w: &World, ctx: &str) {
    assert_eq!(w.backend().starts, 0, "{ctx}: backend yeniden başlatıldı");
    assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}: current değişti");
    assert!(!w.layout.version_dir(NEW).exists(), "{ctx}: sürüm dizini açılmış");
    assert!(!w.layout.staging_dir(NEW).exists(), "{ctx}: hazırlık dizini kalmış");
}

fn linux(tag: &str) -> World {
    World::new_in(Profil::Linux, tag, Setup::default())
}

fn files_with(w: &World, edit: &dyn Fn(&mut serde_json::Value)) -> Vec<(String, Vec<u8>)> {
    oci_files(NEW, &oci_default_updater(), &w.keys.package, "paket-2026", None, edit)
}

#[test]
fn linux_paket_hazirligi_uctan_uca() {
    let w = linux("lp-tam");
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
    let dir = w.layout.version_dir(NEW);
    assert_eq!(listing(&dir), sorted(oci::members(NEW)), "sürüm dizini TAM teslim paketi üyeleri");
    assert!(!w.layout.staging_dir(NEW).exists(), "hazırlık dizini sürüm dizinine taşındı");
    assert!(!w.layout.downloads().join(format!("{NEW}.tar")).exists(), "dış tar hazırlıktan sonra silindi");
    #[cfg(unix)]
    assert_eq!(mode(&dir.join(oci::GUNCELLEYICI)), 0o755);

    // Sunucu bozuk bayt verir: sha256 bildirimle tutmaz → tar ayrıştırıcısına hiç girmez.
    let w = linux("lp-ozet");
    w.faults.serve_tampered.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("PAKET_OZETI"));
    untouched(&w, "özet");

    // Düz künye imzalı yükten sapar (imza aynı): `BUTUNLUK_GECERSIZ`.
    let w = linux("lp-kunye");
    let mut files = files_with(&w, &|_| {});
    let k = files.iter_mut().find(|(n, _)| n == oci::KUNYE).unwrap();
    k.1 = String::from_utf8(k.1.clone()).unwrap().replace("24.18.0", "24.18.1").into_bytes();
    w.serve_oci(NEW, ustar_of(&files), None);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("BUTUNLUK_GECERSIZ"));
    untouched(&w, "künye");

    // Künyenin (imzalı) imaj kimliği bildirimdekinden başka: `PAKET_BAGI`.
    let w = linux("lp-imaj");
    let files = files_with(&w, &|k| k["imaj"]["kimlik"] = json!(format!("sha256:{}", "e".repeat(64))));
    w.serve_oci(NEW, ustar_of(&files), None);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("PAKET_BAGI"));
    untouched(&w, "imaj");

    // Paket kökünden kaçan üye sunulur: `PAKET_YOL`.
    let w = linux("lp-yol");
    let mut files = files_with(&w, &|_| {});
    files.push(("../kacak".into(), b"x".to_vec()));
    w.serve_oci(NEW, ustar_of(&files), None);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("PAKET_YOL"));
    untouched(&w, "yol");

    // `backend-oci` yolunda Windows bildirimi: Linux güncelleyicisi başka platformun paketini almaz.
    let w = linux("lp-platform");
    let tar = ustar_of(&files_with(&w, &|_| {}));
    let payload = manifest_payload("paket-2026", NEW, &tar, None);
    let token = sign_manifest(&w.keys.package, "paket-2026", &payload);
    {
        let mut f = w.files.lock().unwrap();
        f.clear();
        f.insert(format!("/{CHANNEL}/backend-oci/{NEW}/{}", package_name(NEW)), tar);
        f.insert(format!("/{CHANNEL}/backend-oci/{NEW}/surum.json"), pointer(&token));
        f.insert(format!("/{CHANNEL}/backend-oci/son.json"), pointer(&token));
    }
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("SURUM_PLATFORM"));
    untouched(&w, "platform");
}

/// Linux disk formülü veri kökünde DB boyunu sayar (Windows'unki `disk_dolu.rs`): aynı boş alan, DB boyu karar verir.
#[test]
fn linux_disk_dolu_db_boyunu_sayar() {
    const GB: u64 = 1024 * 1024 * 1024;
    let small = linux("lp-disk-kucuk");
    small.fs.free.store(3 * GB, Ordering::SeqCst);
    small.faults.db_bytes.store(100 * 1024 * 1024, Ordering::SeqCst);
    small.run(1).unwrap();
    assert_ne!(code(&small).as_deref(), Some("DISK_DOLU"), "küçük DB: 2 GB + DB×1,2 sığar");
    let big = linux("lp-disk-buyuk");
    big.fs.free.store(3 * GB, Ordering::SeqCst);
    big.faults.db_bytes.store(2 * GB, Ordering::SeqCst);
    big.run(1).unwrap();
    assert_eq!(code(&big).as_deref(), Some("DISK_DOLU"));
    untouched(&big, "disk");
    assert!(!big.layout.downloads().join(format!("{NEW}.tar.part")).exists(), "yer yokken indirme başlamaz");
}

/// Yayındaki dış tarın boyu (bildirimin `paket.boyut`u).
fn package_bytes(w: &World) -> u64 {
    let files = w.files.lock().unwrap();
    files.iter().find(|(k, _)| k.ends_with(&oci_package_name(NEW))).map(|(_, v)| v.len() as u64).expect("yayında paket yok")
}

/// Kök (`surumler/.hazirlik-<v>`) ile veri kökü ayrı dosya sistemlerinde: açılmış kopyanın payı KÖKTE ölçülür (T1
/// açığı: eskiden yalnız veri kökü ölçülüyor, açılış yarıda diski dolduruyordu). İleti eksik olan kökü söyler.
#[test]
fn linux_disk_iki_kok_ayri_aygit() {
    const GB: u64 = 1024 * 1024 * 1024;
    let w = linux("lp-disk-iki-kok");
    std::fs::create_dir_all(w.layout.versions()).unwrap();
    w.fs.mounts.lock().unwrap().push((w.layout.versions(), "surumler".into(), GB));
    w.run(1).unwrap();
    let st = w.status().unwrap();
    assert_eq!(st.error_code.as_deref(), Some("DISK_DOLU"), "{:?}", st.message);
    let msg = st.message.unwrap_or_default();
    assert!(msg.contains(&format!("{} dosya sistemi (hazırlık)", w.layout.versions().display())) && msg.contains("eksik"), "{msg}");
    assert!(!msg.contains("indirme"), "veri kökünde yer var — iletide yalnız eksik kök: {msg}");
    untouched(&w, "iki kök");
    assert!(!w.layout.downloads().join(format!("{NEW}.tar.part")).exists(), "yer yokken indirme başlamaz");
    w.fs.mounts.lock().unwrap()[0].2 = 3 * GB;
    w.run(1).unwrap();
    assert_ne!(code(&w).as_deref(), Some("DISK_DOLU"), "kökte yer açılınca ön kontrol geçer");
}

/// Kök, veri kökü ve Docker kökü aynı dosya sisteminde: gereksinimler TOPLANIR (indirme + hazırlık + yedek + imaj +
/// tek pay) — bir bayt eksik `DISK_DOLU`, tam sığan geçer.
#[test]
fn linux_disk_ayni_aygit_toplanir() {
    const GB: u64 = 1024 * 1024 * 1024;
    for (tag, short) in [("lp-disk-toplam-eksik", 1), ("lp-disk-toplam-tam", 0)] {
        let w = linux(tag);
        w.faults.db_bytes.store(GB, Ordering::SeqCst);
        let p = package_bytes(&w);
        let need = p + p + GB * 6 / 5 + 3 * p + 2 * GB;
        {
            let mut m = w.fs.mounts.lock().unwrap();
            m.push((w.layout.root.clone(), "ortak".into(), need - short));
            m.push((w.layout.data.clone(), "ortak".into(), need - short));
        }
        w.run(1).unwrap();
        let st = w.status().unwrap();
        if short == 1 {
            assert_eq!(st.error_code.as_deref(), Some("DISK_DOLU"), "{tag}: {:?}", st.message);
            let msg = st.message.unwrap_or_default();
            assert!(msg.contains("(indirme + hazırlık + yedek + imaj deposu)"), "{tag}: toplamın her kalemi iletide: {msg}");
            untouched(&w, tag);
        } else {
            assert_ne!(st.error_code.as_deref(), Some("DISK_DOLU"), "{tag}: tam sığan geçer: {:?}", st.message);
        }
    }
}

// ── Aynalar: yayıncı (`oci-paket.ts`) ve paketleyici (`teslim-paketle.sh`) ile aynı biçim ──────────────────

fn repo_file(rel: &str) -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// `export const AD = "değer";` — yoksa panik (tanınmayan simge aynayı geçirmez).
fn ts_const(sources: &[&str], name: &str) -> String {
    let pat = format!("export const {name} = \"");
    for s in sources {
        if let Some(i) = s.find(&pat) {
            let rest = &s[i + pat.len()..];
            return rest[..rest.find('"').unwrap()].to_string();
        }
    }
    panic!("oci-paket.ts aynası: {name} tanımı bulunamadı");
}

/// `export const ad = (surum: string): string[] => [ ... ];` gövdesindeki dizi öğeleri.
fn ts_array(src: &str, name: &str) -> Vec<String> {
    let head = format!("export const {name} = (surum: string): string[] => [");
    let i = src.find(&head).unwrap_or_else(|| panic!("oci-paket.ts aynası: {name} biçimi değişti"));
    let body = &src[i + head.len()..];
    body[..body.find("];").unwrap()].split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()
}

fn ts_eval(sources: &[&str], token: &str, surum: &str) -> Vec<String> {
    if let Some(inner) = token.strip_prefix("...").and_then(|t| t.strip_suffix("(surum)")) {
        return ts_array(sources[0], inner).iter().flat_map(|t| ts_eval(sources, t, surum)).collect();
    }
    if let Some(lit) = token.strip_prefix('"').and_then(|t| t.strip_suffix('"')) {
        return vec![lit.to_string()];
    }
    if token == "ociImajArsivi(surum)" {
        let src = sources[0];
        let head = "export const ociImajArsivi = (surum: string): string => `";
        let i = src.find(head).expect("ociImajArsivi biçimi değişti");
        let tpl = &src[i + head.len()..];
        let tpl = &tpl[..tpl.find('`').unwrap()];
        return vec![tpl.replace("${OCI_IMAJ_ADI}", &ts_const(sources, "OCI_IMAJ_ADI")).replace("${surum}", surum)];
    }
    assert!(token.chars().all(|c| c.is_ascii_uppercase() || c == '_'), "oci-paket.ts aynası: tanınmayan simge {token}");
    vec![ts_const(sources, token)]
}

#[test]
fn oci_paket_ts_aynasi() {
    let ts = repo_file("scripts/lib/oci-paket.ts");
    let list = repo_file("src/lib/license/integrity-list.ts");
    let sources = [ts.as_str(), list.as_str()];
    let v = "3.4.5";
    assert_eq!(ts_array(&ts, "ociKapsam").iter().flat_map(|t| ts_eval(&sources, t, v)).collect::<Vec<_>>(), oci::scope(v));
    assert_eq!(ts_array(&ts, "ociUyeler").iter().flat_map(|t| ts_eval(&sources, t, v)).collect::<Vec<_>>(), oci::members(v));
    for (ts_name, rs) in [
        ("OCI_KUNYE", oci::KUNYE),
        ("OCI_KUNYE_JWS", oci::KUNYE_JWS),
        ("OCI_KUNYE_URUN", oci::KUNYE_URUN),
        ("OCI_IMAJ_ADI", oci::IMAJ_ADI),
        ("OCI_GUNCELLEYICI", oci::GUNCELLEYICI),
        ("OCI_GUNCELLEYICI_KUNYE", oci::GUNCELLEYICI_KUNYE),
    ] {
        assert_eq!(ts_const(&sources, ts_name), rs, "{ts_name}");
    }
    assert_eq!(ts_const(&sources, "INTEGRITY_LIST_FILE"), tekserp_dogrulama::integrity_list::LIST_FILE);
}

/// `teslim-paketle.sh`in kendi tar satırları (GNU ya da bsdtar dalı, makinedeki `tar`a göre) üretir; okuyucu açar.
/// Paketleyicinin üye listesi (`UYELER`) de `oci::members` ile aynı sırada olmalı.
#[cfg(unix)]
#[test]
fn sistem_tar_teslim_bicimi_okunur() {
    if std::process::Command::new("tar").arg("--version").output().is_err() {
        eprintln!("⏭ tar yok");
        return;
    }
    let script = repo_file("docker/korumali/teslim-paketle.sh");
    let uyeler = script.lines().find(|l| l.starts_with("UYELER=")).expect("UYELER satırı");
    let start = script.find("if tar --version").expect("tar dalı");
    let block = &script[start..start + script[start..].find("\nfi\n").expect("tar dalı sonu") + 4];
    let d = scratch("sistem-tar");
    let stage = d.join("sahne");
    std::fs::create_dir_all(&stage).unwrap();
    for n in oci::members(NEW) {
        std::fs::write(stage.join(&n), format!("içerik {n}")).unwrap();
    }
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(stage.join(oci::GUNCELLEYICI), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let out = std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("set -e\n{uyeler}\n[ \"$UYELER\" = \"$BEKLENEN\" ] || {{ echo \"UYELER: $UYELER\" >&2; exit 3; }}\n{block}"))
        .env("SAHNE", &stage)
        .env("CIKTI", &d)
        .env("PAKET", "paket.tar")
        .env("AD", oci::image_archive(NEW))
        .env("BEKLENEN", oci::members(NEW).join(" "))
        .output()
        .unwrap();
    assert!(out.status.success(), "paketleyici tar dalı: {}", String::from_utf8_lossy(&out.stderr));
    let dest = d.join("hazirlik");
    let stats = RealFs.extract_tar(&d.join("paket.tar.part"), &dest, &oci::members(NEW), &ExtractLimits::default());
    assert_eq!(stats.expect("sistem tar'ının ustar çıktısı okunur").files, 9);
    assert_eq!(listing(&dest), sorted(oci::members(NEW)));
    assert_eq!(std::fs::read_to_string(dest.join(oci::KUNYE)).unwrap(), format!("içerik {}", oci::KUNYE));
    assert_eq!(mode(&dest.join(oci::GUNCELLEYICI)), 0o755);
    assert_eq!(mode(&dest.join(oci::OZETLER)), 0o644);
}
