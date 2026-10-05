//! Kurulum (setup.exe) doğrulayıcısı (`kurulum-paket` · `kurulum-pg`): ilk kurulumda backend ve PG paketi
//! güncelleyiciyle AYNI kodla doğrulanır; doğrulama düşerse hedef dizin SİLİNİR, var olan hedefe açılmaz.
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tekserp_dogrulama::paket_zinciri::PackageTrust;
use tekserp_guncelleyici::kurulum::{self, kod};

static SIRA: AtomicU64 = AtomicU64::new(0);

/// Her test kendi geçici dizinini alır (paralel koşum çakışmasın).
fn gecici(etiket: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("tekserp-kurulum-{etiket}-{}-{}", std::process::id(), SIRA.fetch_add(1, Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn anahtar(tohum: u8) -> SigningKey {
    SigningKey::from_bytes(&[tohum; 32])
}

/// Gömülü çapanın yerine test kümesi: üretim + hazırlık PAKET anahtarı.
fn kume(paket: &SigningKey, hazirlik: &SigningKey) -> PackageTrust {
    PackageTrust::embedded(vec![("paket-2026".into(), x_of(paket)), ("paket-hazirlik".into(), x_of(hazirlik))])
}

fn backend_zip(dir: &Path, imzalayan: &SigningKey, kid: &str, kurcala: bool, ek: &[(String, Vec<u8>)]) -> PathBuf {
    let mut files = version_files(NEW);
    files.extend(integrity_files(&files, NEW, imzalayan, kid, Some(CHANNEL)));
    if kurcala {
        for (p, c) in files.iter_mut() {
            if p == "dist/server.js" {
                c.extend_from_slice(b"\n// kurcalandi");
            }
        }
    }
    files.extend(ek.iter().cloned());
    let z = dir.join("paket.zip");
    std::fs::write(&z, zip_of(&files)).unwrap();
    z
}

/// `integrity_files` ile aynı biçim, ürün parametreli (başka ürünün imzalı paketi: imza + liste GEÇERLİ olur,
/// yalnız ürün kapısı ayırt eder).
fn urunlu_zip(dir: &Path, imzalayan: &SigningKey, urun: &str) -> PathBuf {
    let files = version_files(NEW);
    let mut kapsamda: Vec<&(String, Vec<u8>)> = files
        .iter()
        .filter(|(p, _)| {
            ["dist/", "runtime/", "node_modules/", "prisma/migrations/"].iter().any(|d| p.starts_with(d)) || p == "package.json"
        })
        .collect();
    kapsamda.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let liste: String = kapsamda.iter().map(|(p, c)| format!("{}\t{}\t{p}\n", sha_b64u(c), c.len())).collect();
    let yuk = json!({
        "v": 1, "paketId": PACKAGE_ID, "urun": urun, "surum": NEW, "derlemeTarihi": BUILT_AT, "musteri": CHANNEL,
        "liste": { "sha256": sha_b64u(liste.as_bytes()), "boyut": liste.len(), "dosyaSayisi": kapsamda.len() },
        "kapsam": { "dizinler": ["dist", "node_modules", "prisma/migrations", "runtime"], "dosyalar": ["package.json"] },
    });
    let mut tum = files.clone();
    tum.push(("butunluk-liste.txt".into(), liste.into_bytes()));
    tum.push(("butunluk.jws".into(), sign(imzalayan, "tekserp-butunluk", "paket-2026", &yuk).into_bytes()));
    let z = dir.join("baska-urun.zip");
    std::fs::write(&z, zip_of(&tum)).unwrap();
    z
}

fn pg_dosyalari(icu: &[&str]) -> Vec<(String, Vec<u8>)> {
    let mut v: Vec<(String, Vec<u8>)> =
        vec![("bin/postgres.exe".into(), b"postgres".to_vec()), ("share/timezone/UTC".into(), b"tz".to_vec())];
    for n in icu {
        v.push((format!("bin/icuuc{n}.dll"), b"icu".to_vec()));
    }
    v
}

/// PG zip (içerik manifestosu dahil) + künye işaretçisi. `manifest_disi`: manifestoya YAZILMAYAN ek dosya.
fn pg_paketi(
    dir: &Path,
    imzalayan: &SigningKey,
    kid: &str,
    icu_dosya: &[&str],
    icu_kunye: &str,
    manifest_disi: bool,
) -> (PathBuf, PathBuf) {
    let files = pg_dosyalari(icu_dosya);
    let mut sirali: Vec<&(String, Vec<u8>)> = files.iter().collect();
    sirali.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let manifest: String = sirali.iter().map(|(p, c)| format!("{}  {p}\n", sha_hex(c))).collect();
    let mut tum = files.clone();
    tum.push(("TEKSERP-ICERIK.sha256".into(), manifest.clone().into_bytes()));
    if manifest_disi {
        tum.push(("bin/kacak.dll".into(), b"kacak".to_vec()));
    }
    let zip = zip_of(&tum);
    let zp = dir.join("postgresql-16.15-4-win-x64.zip");
    std::fs::write(&zp, &zip).unwrap();
    let yuk = json!({
        "v": 1, "urun": "postgresql", "platform": "win32-x64", "cizgi": 16, "surum": "16.15", "derleme": 4,
        "paket": { "ad": "postgresql-16.15-4-win-x64.zip", "boyut": zip.len(), "sha256": sha_hex(&zip) },
        "icerikSha256": sha_hex(manifest.as_bytes()), "icuSurum": icu_kunye, "yayinZamani": "2026-10-01T00:00:00Z",
    });
    let kp = dir.join("pg.json");
    std::fs::write(&kp, json!({ "v": 1, "bildirim": sign(imzalayan, "tekserp-pg", kid, &yuk) }).to_string()).unwrap();
    (kp, zp)
}

#[test]
fn backend_paketi_dogrulanir_ve_acilir() {
    let d = gecici("backend-ok");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[]);
    let hedef = d.join("surumler").join(".kurulum-1");
    std::fs::create_dir_all(hedef.parent().unwrap()).unwrap();
    let v = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).expect("geçerli paket");
    assert_eq!(v["surum"], NEW);
    assert_eq!(v["paketId"], PACKAGE_ID);
    assert_eq!(v["kid"], "paket-2026");
    assert_eq!(v["hazirlikAnahtari"], false);
    assert_eq!(v["musteri"], CHANNEL);
    assert!(hedef.join("dist").join("server.js").is_file() && hedef.join("butunluk.jws").is_file());
}

#[test]
fn hazirlik_anahtari_soylenir() {
    let d = gecici("backend-hazirlik");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &h, "paket-hazirlik", false, &[]);
    let hedef = d.join("hedef");
    let v = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).expect("hazırlık imzalı paket açılır");
    assert_eq!(v["hazirlikAnahtari"], true, "hazırlık anahtarı çıktıda söylenmeli (üretim sınıfı onu reddeder)");
}

#[test]
fn var_olan_hedefe_acilmaz_ve_ona_dokunulmaz() {
    let d = gecici("backend-hedef-var");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[]);
    let hedef = d.join("hedef");
    std::fs::create_dir_all(&hedef).unwrap();
    std::fs::write(hedef.join("veri.txt"), "dokunma").unwrap();
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, kod::HEDEF_VAR);
    assert_eq!(std::fs::read_to_string(hedef.join("veri.txt")).unwrap(), "dokunma");
}

#[test]
fn goreli_hedef_reddedilir() {
    let d = gecici("backend-goreli");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[]);
    let e = kurulum::backend_paketi(&z, Path::new("goreli-hedef"), &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, kod::GIRDI);
    assert!(!Path::new("goreli-hedef").exists());
}

#[test]
fn kurcali_paket_reddedilir_ve_hedef_silinir() {
    let d = gecici("backend-kurcali");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", true, &[]);
    let hedef = d.join("hedef");
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "BUTUNLUK_GECERSIZ", "{e:?}");
    assert!(!hedef.exists(), "doğrulanamayan içerik silinmeli");
}

#[test]
fn bilinmeyen_anahtarla_imzali_paket_reddedilir() {
    let d = gecici("backend-yabanci");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &anahtar(9), "paket-2026", false, &[]);
    let hedef = d.join("hedef");
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "BUTUNLUK_GECERSIZ", "{e:?}");
    assert!(!hedef.exists());
}

#[test]
fn kapsamda_fazla_dosya_reddedilir() {
    let d = gecici("backend-fazla");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[("runtime/kacak.exe".into(), b"MZ".to_vec())]);
    let hedef = d.join("hedef");
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "BUTUNLUK_GECERSIZ", "{e:?}");
    assert!(!hedef.exists());
}

#[test]
fn yol_kacisi_girdisi_reddedilir() {
    let d = gecici("backend-yol");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[("../kacak.txt".into(), b"x".to_vec())]);
    let hedef = d.join("ic").join("hedef");
    std::fs::create_dir_all(hedef.parent().unwrap()).unwrap();
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "PAKET_YOL", "{e:?}");
    assert!(!hedef.exists() && !d.join("ic").join("kacak.txt").exists());
}

#[test]
fn pg_paketi_dogrulanir() {
    let d = gecici("pg-ok");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &p, "paket-2026", &["67"], "67", false);
    let hedef = d.join("pgsql").join(".kurulum-1");
    std::fs::create_dir_all(hedef.parent().unwrap()).unwrap();
    let v: Value = kurulum::pg_paketi(&k, &z, &hedef, &kume(&p, &h)).expect("geçerli PG paketi");
    assert_eq!(
        (v["surum"].as_str(), v["derleme"].as_u64(), v["icuSurum"].as_str(), v["cizgi"].as_u64()),
        (Some("16.15"), Some(4), Some("67"), Some(16))
    );
    assert_eq!(v["dosya"], 3);
    assert!(hedef.join("bin").join("postgres.exe").is_file());
}

#[test]
fn pg_zip_ozeti_tutmazsa_acilmaz() {
    let d = gecici("pg-ozet");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &p, "paket-2026", &["67"], "67", false);
    let mut b = std::fs::read(&z).unwrap();
    let son = b.len() - 30;
    b[son] ^= 0xFF;
    std::fs::write(&z, b).unwrap();
    let hedef = d.join("hedef");
    let e = kurulum::pg_paketi(&k, &z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "PAKET_OZETI");
    assert!(!hedef.exists(), "özet tutmayan zip AÇILMAZ");
}

#[test]
fn pg_manifest_disi_dosya_reddedilir() {
    let d = gecici("pg-fazla");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &p, "paket-2026", &["67"], "67", true);
    let hedef = d.join("hedef");
    let e = kurulum::pg_paketi(&k, &z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "PG_PAKET", "{e:?}");
    assert!(e.mesaj.contains("kacak.dll"), "{}", e.mesaj);
    assert!(!hedef.exists());
}

#[test]
fn pg_icu_kunyeyle_ayni_ve_tek_olmali() {
    let d = gecici("pg-icu");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &p, "paket-2026", &["70"], "67", false);
    let e = kurulum::pg_paketi(&k, &z, &d.join("h1"), &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "PG_BAGI", "{e:?}");
    assert!(!d.join("h1").exists());
    let d2 = gecici("pg-icu-iki");
    let (k2, z2) = pg_paketi(&d2, &p, "paket-2026", &["67", "70"], "67", false);
    let e2 = kurulum::pg_paketi(&k2, &z2, &d2.join("h2"), &kume(&p, &h)).unwrap_err();
    assert_eq!(e2.kod, "PG_BAGI", "iki ICU: {e2:?}");
}

#[test]
fn pg_kunyesi_bilinmeyen_anahtarla_reddedilir() {
    let d = gecici("pg-yabanci");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &anahtar(9), "paket-2026", &["67"], "67", false);
    let hedef = d.join("hedef");
    let e = kurulum::pg_paketi(&k, &z, &hedef, &kume(&p, &h)).unwrap_err();
    assert!(e.kod.starts_with("JWS_"), "{e:?}");
    assert!(!hedef.exists());
}

#[test]
fn pg_kunyesi_bicimsizse_reddedilir() {
    let d = gecici("pg-bicimsiz");
    let (p, h) = (anahtar(3), anahtar(4));
    let (k, z) = pg_paketi(&d, &p, "paket-2026", &["67"], "67", false);
    std::fs::write(&k, "{\"v\":1}").unwrap();
    let e = kurulum::pg_paketi(&k, &z, &d.join("hedef"), &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "SURUM_ISARETCI", "{e:?}");
}

#[test]
fn acilmis_dizin_yeniden_olculur_ve_hatada_silinmez() {
    let d = gecici("dizin");
    let (p, h) = (anahtar(3), anahtar(4));
    let z = backend_zip(&d, &p, "paket-2026", false, &[]);
    let hedef = d.join("surum");
    kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).expect("açılır");
    let v = kurulum::surum_dizini(&hedef, &kume(&p, &h)).expect("açılmış dizin geçerli");
    assert_eq!((v["surum"].as_str(), v["paketId"].as_str()), (Some(NEW), Some(PACKAGE_ID)));
    std::fs::write(hedef.join("dist").join("server.js"), "// kurcalandi").unwrap();
    let e = kurulum::surum_dizini(&hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, "BUTUNLUK_GECERSIZ", "{e:?}");
    assert!(hedef.join("dist").join("server.js").is_file(), "kurulu dizin SİLİNMEZ (karar çağıranın)");
    assert_eq!(kurulum::surum_dizini(&d.join("yok"), &kume(&p, &h)).unwrap_err().kod, kod::GIRDI);
}

#[test]
fn baska_urunun_imzali_paketi_reddedilir() {
    let d = gecici("urun");
    let (p, h) = (anahtar(3), anahtar(4));
    // Kontrol: aynı yardımcıyla "backend" ürünü GEÇER (sonda yardımcının kendisini değil ürün kapısını ölçer).
    let iyi = urunlu_zip(&d, &p, "backend");
    kurulum::backend_paketi(&iyi, &d.join("h-iyi"), &kume(&p, &h)).expect("aynı yardımcıyla backend paketi geçer");
    let z = urunlu_zip(&d, &p, "electron");
    let hedef = d.join("hedef");
    let e = kurulum::backend_paketi(&z, &hedef, &kume(&p, &h)).unwrap_err();
    assert_eq!(e.kod, kod::URUN, "{e:?}");
    assert!(!hedef.exists(), "başka ürünün açılmış içeriği silinmeli");
    // Onarım yolu (açılmış dizin) da ürünü ölçer: aynı içerik elle açılır; dizin SİLİNMEZ.
    let ac = d.join("acilmis");
    zip::ZipArchive::new(std::fs::File::open(&z).unwrap()).unwrap().extract(&ac).unwrap();
    let e2 = kurulum::surum_dizini(&ac, &kume(&p, &h)).unwrap_err();
    assert_eq!(e2.kod, kod::URUN, "{e2:?}");
    assert!(ac.join("dist").join("server.js").is_file(), "onarımda kurulu dizin silinmez");
}
