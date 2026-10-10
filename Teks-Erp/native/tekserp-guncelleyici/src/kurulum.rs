//! Kurulum (setup.exe) doğrulayıcısı — ilk kurulumda backend paketi ve PostgreSQL paketi GÜNCELLEYİCİYLE
//! AYNI kodla doğrulanır (sözleşme `docs/design/GUNCELLEYICI.md` §1.5 madde 2 · §1.6; D4 `KENDI-POSTGRESQL.md`
//! §4.3). setup.exe bu ikilinin KENDİ kopyasını taşır (CI'da aynı commit'ten, üretim çapasıyla derlenir):
//! paketin İÇİNDEKİ ikili doğrulayıcı olamaz — doğruladığı paketin parçasıdır.
//!
//!   kurulum-paket --zip <backend zip> --hedef <YOK olan dizin>
//!   kurulum-paket --tar <OCI teslim tar'ı> --hedef <YOK olan dizin>   (Linux, §8.1 madde 1 — `kur`/`gecis` de bunu çağırır)
//!   kurulum-pg    --kunye <pg.json> --zip <PG zip> --hedef <YOK olan dizin>
//!   kurulum-dizin --dizin <açılmış sürüm dizini>     (onarım: var olan dizini yeniden ölçer, SİLMEZ; OCI dizini de)
//!
//! Anahtar kümesi gömülü çapanın BÜTÜN PAKET anahtarlarıdır (tek kip; kurulumda HAK — sınıf — henüz yoktur).
//! Çıktı stdout'a TEK satır JSON. Doğrulama hatasında `{"tamam":false,"kod","mesaj"}` + çıkış 3 ve
//! hedef dizin SİLİNİR (yarım/kurcalı içerik kullanılmasın); kullanım hatası çıkış 2.
use crate::env::{self, Fs, RealFs};
use crate::package::{self, ExtractLimits};
use crate::pgminor;
use crate::release;
use crate::trust::TrustAnchor;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tekserp_dogrulama::jws;
use tekserp_dogrulama::paket_zinciri::{PackageMode, PackageTrust};

/// Kurulumun kendi kodları (tel sözleşmesi değil — setup betiği gösterir). Paket/imza/bağ hatalarında
/// güncelleyicinin kodu (`codes::*`, sözleşmenin `JWS_*` · `BELGE_*` · `PG_BAGI`) olduğu gibi döner.
pub mod kod {
    pub const GIRDI: &str = "KURULUM_GIRDI";
    pub const HEDEF_VAR: &str = "KURULUM_HEDEF_VAR";
    pub const PAKET_ACILAMADI: &str = "PAKET_ACILAMADI";
    pub const URUN: &str = "PAKET_URUNU";
}

/// PG künyesi işaretçisinin tavanı (sözleşme §1.2: işaretçi ≤ 64 KB).
const KUNYE_TAVANI: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KurulumHatasi {
    pub kod: &'static str,
    pub mesaj: String,
}

fn hata(kod: &'static str, mesaj: impl Into<String>) -> KurulumHatasi {
    KurulumHatasi { kod, mesaj: mesaj.into() }
}

/// Doğrulama düştüyse açılan içerik kullanılmasın: hedef silinir (yalnız bu çağrının yarattığı dizin).
fn temizle(hedef: &Path, kod: &'static str, mesaj: impl Into<String>) -> KurulumHatasi {
    let _ = std::fs::remove_dir_all(hedef);
    hata(kod, mesaj)
}

/// Hedef YOK olmalı (üzerine açılmaz) ve mutlak olmalı; üst dizini var olmalı.
fn hedef_hazir(hedef: &Path) -> Result<(), KurulumHatasi> {
    if !hedef.is_absolute() {
        return Err(hata(kod::GIRDI, format!("--hedef mutlak yol olmalı: {}", hedef.display())));
    }
    if std::fs::symlink_metadata(hedef).is_ok() {
        return Err(hata(kod::HEDEF_VAR, format!("hedef zaten var (üzerine açılmaz): {}", hedef.display())));
    }
    match hedef.parent() {
        Some(p) if p.is_dir() => Ok(()),
        _ => Err(hata(kod::GIRDI, format!("hedefin üst dizini yok: {}", hedef.display()))),
    }
}

fn sha256_hex(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn acma_hatasi(hedef: &Path, mesaj: String) -> KurulumHatasi {
    let kod = if mesaj.starts_with("PAKET_YOL:") { crate::codes::PAKET_YOL } else { kod::PAKET_ACILAMADI };
    temizle(hedef, kod, mesaj)
}

/// Backend paketi: güvenli açma (göreli yol · bağlantı girdisi RED · boy tavanı) → `butunluk.jws` PAKET
/// anahtarıyla + imzalı listedeki HER dosya GEÇERLİ (§1.5 madde 2) → künye ürünü backend.
pub fn backend_paketi(zip: &Path, hedef: &Path, trust: &PackageTrust) -> Result<Value, KurulumHatasi> {
    hedef_hazir(hedef)?;
    let boy = std::fs::metadata(zip).map_err(|e| hata(kod::GIRDI, format!("paket okunamadı ({}): {e}", zip.display())))?.len();
    if boy == 0 || boy > release::PACKAGE_MAX_BYTES {
        return Err(hata(kod::PAKET_ACILAMADI, format!("paket boyu sınır dışı: {boy} B")));
    }
    let stats = package::extract_real(zip, hedef, &ExtractLimits::default()).map_err(|m| acma_hatasi(hedef, m))?;
    // Setup (V5) KABUL kipindedir ve kira yoktur: iptal yalnız paketin getirdiğinden (paket kökü, kapsam dışı).
    let mut trust = trust.clone();
    if let Some(r) = paket_iptali(hedef, &trust.roots) {
        trust.revocation = tekserp_dogrulama::paket_zinciri::pick_newer_package_revocation(trust.revocation.take(), Some(r));
    }
    let id = package::verify_dir(hedef, &RealFs, &trust, None).map_err(|e| temizle(hedef, e.code, e.message))?;
    if id.urun != release::UPDATE_PRODUCT {
        return Err(temizle(hedef, kod::URUN, format!("paket ürünü \"{}\" (beklenen {})", id.urun, release::UPDATE_PRODUCT)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "backend",
        "surum": id.surum,
        "paketId": id.package_id,
        "kid": id.kid,
        "musteri": id.musteri,
        "derlemeTarihi": id.built_at,
        "dosya": stats.files,
        "bayt": stats.bytes,
    }))
}

/// OCI teslim tar'ının sürümü: üye kümesinde TEK `tekserp-korumali_<v>_linux-amd64.tar.gz` (açmadan ölçülür).
pub fn oci_surumu(tar: &Path) -> Result<String, KurulumHatasi> {
    let mut f = std::fs::File::open(tar).map_err(|e| hata(kod::GIRDI, format!("paket okunamadı ({}): {e}", tar.display())))?;
    let len = f.metadata().map_err(|e| hata(kod::GIRDI, format!("paket ölçülemedi: {e}")))?.len();
    let uyeler = crate::tar::scan(&mut f, len, &ExtractLimits::default()).map_err(|m| hata(kod::PAKET_ACILAMADI, m))?;
    let surumler: Vec<&str> = uyeler
        .iter()
        .filter_map(|m| m.name.strip_prefix(&format!("{}_", crate::oci::IMAJ_ADI))?.strip_suffix("_linux-amd64.tar.gz"))
        .collect();
    match surumler.as_slice() {
        [v] if crate::version::parse(v).is_some() => Ok((*v).to_string()),
        _ => Err(hata(kod::PAKET_ACILAMADI, format!("OCI paketinde tek imaj arşivi yok ya da sürümü geçersiz: {surumler:?}"))),
    }
}

/// OCI (Linux) teslim paketi: üye kümesi TAM (`oci::members`) → güvenli açma → imzalı künye + listedeki her üye
/// (`oci::verify_dir`) → paketteki güncelleyici ikilisinin sha256'sı künyedekiyle aynı. Hata ⇒ hedef SİLİNİR.
pub fn oci_paketi(tar: &Path, hedef: &Path, trust: &PackageTrust) -> Result<(Value, crate::oci::OciKunye), KurulumHatasi> {
    hedef_hazir(hedef)?;
    let boy = std::fs::metadata(tar).map_err(|e| hata(kod::GIRDI, format!("paket okunamadı ({}): {e}", tar.display())))?.len();
    if boy == 0 || boy > release::PACKAGE_MAX_BYTES {
        return Err(hata(kod::PAKET_ACILAMADI, format!("paket boyu sınır dışı: {boy} B")));
    }
    let surum = oci_surumu(tar)?;
    let stats =
        RealFs.extract_tar(tar, hedef, &crate::oci::members(&surum), &ExtractLimits::default()).map_err(|m| acma_hatasi(hedef, m))?;
    let k = crate::oci::verify_dir(hedef, &RealFs, trust).map_err(|e| temizle(hedef, e.code, e.message))?;
    if k.identity.surum != surum {
        return Err(temizle(hedef, crate::codes::BUTUNLUK_GECERSIZ, format!("künye sürümü {} — imaj arşivi {surum}", k.identity.surum)));
    }
    let ikili = sha256_hex(&hedef.join(crate::oci::GUNCELLEYICI))
        .map_err(|e| temizle(hedef, kod::GIRDI, format!("güncelleyici okunamadı: {e}")))?;
    if ikili != k.updater_sha256 {
        return Err(temizle(hedef, crate::codes::BUTUNLUK_GECERSIZ, "paketteki güncelleyici ikilisi künyedeki özetle aynı değil"));
    }
    let v = json!({
        "tamam": true,
        "tur": "oci",
        "surum": k.identity.surum,
        "paketId": k.identity.package_id,
        "kid": k.identity.kid,
        "musteri": k.identity.musteri,
        "imajKimligi": k.image_id,
        "guncelleyiciSha256": k.updater_sha256,
        "dosya": stats.files,
        "bayt": stats.bytes,
    });
    Ok((v, k))
}

/// Onarım: daha önce açılmış sürüm dizini yeniden ölçülür (`butunluk.jws` + imzalı listedeki her dosya).
/// Dizin kurulu sistemin parçasıdır — hata olsa da SİLİNMEZ; karar çağıranındır (yeniden açma).
pub fn surum_dizini(dizin: &Path, trust: &PackageTrust) -> Result<Value, KurulumHatasi> {
    if !dizin.is_dir() {
        return Err(hata(kod::GIRDI, format!("sürüm dizini yok: {}", dizin.display())));
    }
    if dizin.join(crate::oci::KUNYE_JWS).is_file() {
        let k = crate::oci::verify_dir(dizin, &RealFs, trust).map_err(|e| hata(e.code, e.message))?;
        return Ok(json!({
            "tamam": true,
            "tur": "dizin",
            "platform": k.platform,
            "surum": k.identity.surum,
            "paketId": k.identity.package_id,
            "kid": k.identity.kid,
            "musteri": k.identity.musteri,
            "imajKimligi": k.image_id,
        }));
    }
    let id = package::verify_dir(dizin, &RealFs, trust, None).map_err(|e| hata(e.code, e.message))?;
    if id.urun != release::UPDATE_PRODUCT {
        return Err(hata(kod::URUN, format!("paket ürünü \"{}\" (beklenen {})", id.urun, release::UPDATE_PRODUCT)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "dizin",
        "surum": id.surum,
        "paketId": id.package_id,
        "kid": id.kid,
        "musteri": id.musteri,
        "derlemeTarihi": id.built_at,
    }))
}

/// `bin\icuuc<N>.dll` adlarının N'leri (küçük harf; D4 U2: tek ICU, künyenin `icuSurum`u).
fn icu_surumleri(dizin: &Path) -> Vec<String> {
    let mut out: Vec<String> = RealFs
        .list(&dizin.join("bin"))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|n| {
            let l = n.to_ascii_lowercase();
            let rest = l.strip_prefix("icuuc")?.strip_suffix(".dll")?;
            (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())).then(|| rest.to_string())
        })
        .collect();
    out.sort();
    out
}

/// PG paketi: künye (`tekserp-pg`) imzası + şema → zip boyu ve sha256'sı künyeyle birebir → güvenli açma →
/// her dosya içerik manifestosuna, manifesto künyenin `icerikSha256`sına karşı (listede olmayan dosya RED)
/// → `bin\icuuc<N>.dll` tek ve künyenin ICU'su (§1.6, D4 §3.5 · §5 U0–U2).
pub fn pg_paketi(kunye: &Path, zip: &Path, hedef: &Path, trust: &PackageTrust) -> Result<Value, KurulumHatasi> {
    hedef_hazir(hedef)?;
    let km = std::fs::metadata(kunye).map_err(|e| hata(kod::GIRDI, format!("PG künyesi okunamadı ({}): {e}", kunye.display())))?;
    if km.len() > KUNYE_TAVANI {
        return Err(hata(crate::codes::PG_PAKET, "PG künyesi 64 KB tavanını aşıyor"));
    }
    let text = std::fs::read_to_string(kunye).map_err(|e| hata(kod::GIRDI, format!("PG künyesi okunamadı: {e}")))?;
    let token = Value::String(release::read_release_pointer(&text).map_err(|f| hata(f.code, f.message))?);
    let kid = jws::parse(&token).map(|p| p.header.kid).map_err(|f| hata(f.code, f.message))?;
    let k = release::verify_pg_package_manifest(&token, trust).map_err(|f| hata(f.code, f.message))?.doc;
    let boy = std::fs::metadata(zip).map_err(|e| hata(kod::GIRDI, format!("PG paketi okunamadı ({}): {e}", zip.display())))?.len();
    if boy != k.paket.boyut {
        return Err(hata(crate::codes::PAKET_OZETI, format!("PG paketi {boy} B, künye {} B", k.paket.boyut)));
    }
    let ozet = sha256_hex(zip).map_err(|e| hata(kod::GIRDI, format!("PG paketi okunamadı: {e}")))?;
    if ozet != k.paket.sha256 {
        return Err(hata(crate::codes::PAKET_OZETI, "PG paketinin sha256'sı künyeyle aynı değil"));
    }
    let stats = package::extract_real(zip, hedef, &ExtractLimits::default()).map_err(|m| acma_hatasi(hedef, m))?;
    let ortam = env::real(None, "TeksERP-Kurulum").map_err(|e| temizle(hedef, kod::GIRDI, e))?;
    let n = pgminor::verify_content(&ortam, hedef, &k.content_sha256).map_err(|m| temizle(hedef, crate::codes::PG_PAKET, m))?;
    let icu = icu_surumleri(hedef);
    if icu != [k.icu.clone()] {
        return Err(temizle(hedef, release::code::PG_BAGI, format!("ICU [{}] — künye {} (tek ICU beklenir)", icu.join(", "), k.icu)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "pg",
        "cizgi": k.cizgi,
        "surum": k.surum,
        "derleme": k.derleme,
        "icuSurum": k.icu,
        "kid": kid,
        "paketAdi": k.paket.ad,
        "dosya": n,
        "acilan": stats.files,
    }))
}

fn bayrak(args: &[String], ad: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == ad).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

/// CLI girişi: `kurulum-paket` · `kurulum-pg` · `kurulum-dizin`. Dönüş çıkış kodudur (0 tamam · 3 doğrulama · 2 kullanım).
/// Setup'ın güveni: gömülü çapa, SÜZGEÇSİZ (sınıf yok); yeni paket KABUL kipinde "şimdi" = sistem saati (kira yok),
/// kurulu dizinin onarımı YERLEŞİK.
pub fn kurulum_guveni(anchor: &TrustAnchor, mode: PackageMode, now_ms: f64) -> PackageTrust {
    PackageTrust {
        keys: anchor.package_keys.clone(),
        roots: anchor.roots.clone(),
        mode,
        now_ms: (mode == PackageMode::Kabul).then_some(now_ms),
        revocation: None,
        install_class: None,
    }
}

/// Açılan paketin kökündeki PAKET iptal belgesi (kökle doğrulanırsa).
fn paket_iptali(
    dizin: &Path,
    roots: &[tekserp_dogrulama::chain::RootKey],
) -> Option<tekserp_dogrulama::paket_zinciri::VerifiedPackageRevocation> {
    let p = dizin.join(tekserp_dogrulama::paket_zinciri::PACKAGE_REVOCATION_FILE);
    if std::fs::metadata(&p).ok()?.len() > KUNYE_TAVANI * 2 {
        return None;
    }
    let text = std::fs::read_to_string(&p).ok()?;
    tekserp_dogrulama::paket_zinciri::verify_package_revocation(&Value::String(text.trim().to_string()), roots).ok()
}

pub fn komut(command: &str, args: &[String]) -> Result<u32, String> {
    let anchor = TrustAnchor::for_process()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(f64::NAN, |d| d.as_millis() as f64);
    let kabul = kurulum_guveni(&anchor, PackageMode::Kabul, now);
    let gerek = |ad: &str| bayrak(args, ad).ok_or_else(|| format!("{command}: {ad} <yol> gerekli"));
    let sonuc = match command {
        "kurulum-paket" if bayrak(args, "--tar").is_some() => oci_paketi(&gerek("--tar")?, &gerek("--hedef")?, &kabul).map(|(v, _)| v),
        "kurulum-paket" => backend_paketi(&gerek("--zip")?, &gerek("--hedef")?, &kabul),
        "kurulum-pg" => pg_paketi(&gerek("--kunye")?, &gerek("--zip")?, &gerek("--hedef")?, &kabul),
        "kurulum-dizin" => surum_dizini(&gerek("--dizin")?, &kurulum_guveni(&anchor, PackageMode::Yerlesik, now)),
        _ => return Err(format!("bilinmeyen kurulum komutu: {command}")),
    };
    match sonuc {
        Ok(v) => {
            println!("{v}");
            Ok(0)
        }
        Err(e) => {
            println!("{}", json!({ "tamam": false, "kod": e.kod, "mesaj": e.mesaj }));
            Ok(3)
        }
    }
}
