//! Bütünlük denetimi: PAKET anahtarıyla imzalı dosya listesi (`tekserp-butunluk`) — Faz 2e'nin
//! biçimi için v1 arayüzü. TS başvuru uygulaması `lib/license/integrity.ts`; ikisi aynı
//! vektörlerde aynı raporu verir (kâhin bekçisi + `tests/vektorler.rs`).
//!
//! Karar sırası: çapa boş → ÖLÇÜLEMEDİ · imza/şema → GEÇERSİZ · eksik ya da değişmiş dosya →
//! GEÇERSİZ (kurcalama) · yalnız okunamayan dosya → ÖLÇÜLEMEDİ · aksi GEÇERLİ. Listede
//! olmayan fazla dosya bu sürümde sorulmaz (paket `node_modules` taşır; kapsam 2e'nin kararı).
use crate::b64;
use crate::iso;
use crate::jsonx::{js_number, utf16_len};
use crate::jws;
use crate::outcome::code;
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

pub const TYP_BUTUNLUK: &str = "tekserp-butunluk";
pub const MAX_FILES: usize = 20_000;
pub const MAX_PATH_UTF16: usize = 512;
/// Rapordaki dosya listelerinin tavanı (sayılar ayrıca tam verilir).
pub const LIST_CAP: usize = 50;

struct Patterns {
    package_kid: Regex,
    path: Regex,
    uuid: Regex,
    product: Regex,
    version: Regex,
    customer: Regex,
    digest: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        package_kid: Regex::new(r"^paket-[a-z0-9-]{1,40}$").expect("paket kid"),
        path: Regex::new(r"^(?:[A-Za-z0-9_.@+-]+/)*[A-Za-z0-9_.@+-]+$").expect("yol"),
        uuid: Regex::new(
            r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
        )
        .expect("uuid"),
        product: Regex::new(r"^[a-z][a-z0-9-]{0,39}$").expect("urun"),
        version: Regex::new(r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$").expect("surum"),
        customer: Regex::new(r"^[a-z0-9][a-z0-9-]{0,39}$").expect("musteri"),
        digest: Regex::new(r"^[A-Za-z0-9_-]{43}$").expect("sha256"),
    })
}

fn str_matches(v: Option<&Value>, re: &Regex) -> bool {
    matches!(v, Some(Value::String(s)) if re.is_match(s))
}

/// Göreli POSIX yol: `.`/`..` segmenti, ters eğik çizgi, sürücü harfi, baştaki `/` RED.
fn is_safe_path(v: Option<&Value>) -> bool {
    let Some(Value::String(s)) = v else { return false };
    utf16_len(s) <= MAX_PATH_UTF16 && patterns().path.is_match(s) && s.split('/').all(|seg| seg != "." && seg != "..")
}

pub struct ManifestFile {
    pub path: String,
    pub sha256: String,
    pub size: f64,
}

/// Şema (TS `IntegrityManifestSchema` aynası); başarıda atılmış paket künyesi + dosyalar.
fn decode_manifest(payload: &Map<String, Value>) -> Result<(Value, Vec<ManifestFile>), &'static str> {
    if let Some(v) = payload.get("v") {
        if js_number(v) != Some(1.0) {
            return Err(code::BELGE_SURUM);
        }
    }
    let p = patterns();
    let customer_ok = matches!(payload.get("musteri"), Some(Value::Null)) || str_matches(payload.get("musteri"), &p.customer);
    let ok = payload.get("v").and_then(js_number) == Some(1.0)
        && str_matches(payload.get("paketId"), &p.uuid)
        && str_matches(payload.get("urun"), &p.product)
        && str_matches(payload.get("surum"), &p.version)
        && matches!(payload.get("derlemeTarihi"), Some(Value::String(s)) if iso::is_zod_datetime(s))
        && customer_ok;
    if !ok {
        return Err(code::BELGE_SEMA);
    }
    let Some(Value::Array(list)) = payload.get("dosyalar") else { return Err(code::BELGE_SEMA) };
    if list.is_empty() || list.len() > MAX_FILES {
        return Err(code::BELGE_SEMA);
    }
    let mut seen = HashSet::new();
    let mut files = Vec::with_capacity(list.len());
    for item in list {
        let Value::Object(f) = item else { return Err(code::BELGE_SEMA) };
        if f.keys().any(|k| !matches!(k.as_str(), "yol" | "sha256" | "boyut")) {
            return Err(code::BELGE_SEMA);
        }
        let size = f.get("boyut").and_then(js_number);
        let size_ok = size.is_some_and(|n| n.is_finite() && n.fract() == 0.0 && (0.0..=9_007_199_254_740_991.0).contains(&n));
        if !is_safe_path(f.get("yol")) || !str_matches(f.get("sha256"), &p.digest) || !size_ok {
            return Err(code::BELGE_SEMA);
        }
        let path = f["yol"].as_str().unwrap_or_default().to_string();
        if !seen.insert(path.clone()) {
            return Err(code::BELGE_SEMA);
        }
        files.push(ManifestFile { path, sha256: f["sha256"].as_str().unwrap_or_default().to_string(), size: size.unwrap_or(-1.0) });
    }
    let package = json!({
        "paketId": payload["paketId"],
        "urun": payload["urun"],
        "surum": payload["surum"],
        "derlemeTarihi": payload["derlemeTarihi"],
        "musteri": payload["musteri"],
    });
    Ok((package, files))
}

#[derive(Default)]
struct Buckets {
    missing: Vec<String>,
    changed: Vec<String>,
    unreadable: Vec<String>,
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(b64::encode(&hasher.finalize()))
}

fn check_file(root: &Path, f: &ManifestFile, out: &mut Buckets) {
    let full = f.path.split('/').fold(root.to_path_buf(), |acc, seg| acc.join(seg));
    match std::fs::metadata(&full) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => out.missing.push(f.path.clone()),
        Err(_) => out.unreadable.push(f.path.clone()),
        Ok(m) if !m.is_file() => out.missing.push(f.path.clone()),
        Ok(m) if m.len() as f64 != f.size => out.changed.push(f.path.clone()),
        Ok(_) => match sha256_file(&full) {
            Ok(h) if h == f.sha256 => {}
            Ok(_) => out.changed.push(f.path.clone()),
            Err(_) => out.unreadable.push(f.path.clone()),
        },
    }
}

fn report(durum: &str, kod: Option<&str>, total: usize, b: &Buckets, package: Value) -> Value {
    let cap = |v: &Vec<String>| v.iter().take(LIST_CAP).cloned().collect::<Vec<_>>();
    json!({
        "durum": durum,
        "kod": kod,
        "dosyaSayisi": total,
        "eksik": cap(&b.missing),
        "eksikSayisi": b.missing.len(),
        "degisik": cap(&b.changed),
        "degisikSayisi": b.changed.len(),
        "okunamayan": cap(&b.unreadable),
        "okunamayanSayisi": b.unreadable.len(),
        "paket": package,
    })
}

/// `keys`: (kid, ham açık anahtar base64url). Rapor TS `IntegrityReport` biçimindedir.
pub fn verify(manifest: &Value, root: &str, keys: &[(String, String)]) -> Value {
    let empty = Buckets::default();
    let usable: Vec<(String, [u8; 32])> = keys
        .iter()
        .filter(|(kid, _)| patterns().package_kid.is_match(kid))
        .filter_map(|(kid, x)| b64::decode_exact::<32>(x).map(|k| (kid.clone(), k)))
        .collect();
    // TS `Map` gibi: tekrarlı kid tek anahtar sayılır → biçimsiz çapa.
    let distinct = usable.iter().map(|(k, _)| k).collect::<HashSet<_>>().len();
    if usable.is_empty() || usable.len() != keys.len() || distinct != keys.len() {
        return report("OLCULEMEDI", Some(code::BUTUNLUK_CAPA_BOS), 0, &empty, Value::Null);
    }
    let verified = jws::verify(manifest, TYP_BUTUNLUK, |kid| usable.iter().find(|(k, _)| k == kid).map(|(_, key)| *key));
    let parsed = match verified {
        Ok(p) => p,
        Err(e) => return report("GECERSIZ", Some(e.code), 0, &empty, Value::Null),
    };
    let (package, files) = match decode_manifest(&parsed.payload) {
        Ok(ok) => ok,
        Err(c) => return report("GECERSIZ", Some(c), 0, &empty, Value::Null),
    };
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return report("OLCULEMEDI", Some(code::BUTUNLUK_OKUNAMADI), files.len(), &empty, package);
    }
    let mut buckets = Buckets::default();
    for f in &files {
        check_file(root_path, f, &mut buckets);
    }
    if !buckets.missing.is_empty() || !buckets.changed.is_empty() {
        return report("GECERSIZ", Some(code::BUTUNLUK_UYUSMAZ), files.len(), &buckets, package);
    }
    if !buckets.unreadable.is_empty() {
        return report("OLCULEMEDI", Some(code::BUTUNLUK_OKUNAMADI), files.len(), &buckets, package);
    }
    report("GECERLI", None, files.len(), &buckets, package)
}
