//! Bütünlük denetimi: PAKET anahtarıyla imzalı yük (`tekserp-butunluk`) + onun sha256'sına bağlı
//! liste dosyası (`integrity_list.rs`). TS başvuru uygulaması `lib/license/integrity.ts`; ikisi
//! aynı vektörlerde aynı raporu verir (kâhin bekçisi + `tests/vektorler.rs`).
//!
//! Karar sırası: çapa boş → ÖLÇÜLEMEDİ · imza/şema → GEÇERSİZ · kök dizin değil → ÖLÇÜLEMEDİ ·
//! liste yok/özet/dilbilgisi → GEÇERSİZ(LISTE_BOZUK), okunamaz → ÖLÇÜLEMEDİ · eksik ya da
//! değişmiş dosya → GEÇERSİZ(UYUSMAZ) · imzalı kapsamda listede olmayan girdi → GEÇERSİZ(FAZLA) ·
//! yalnız okunamayan → ÖLÇÜLEMEDİ · aksi GEÇERLİ.
use crate::b64;
use crate::integrity_list::{self as list, Entry};
use crate::iso;
use crate::jsonx::{js_number, utf16_len};
use crate::jws;
use crate::outcome::code;
use crate::paket_zinciri::{self, PackageTrust};
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{ErrorKind, Read};
use std::path::Path;
use std::sync::OnceLock;

/// TS `TYP.BUTUNLUK` aynası (kâhin §0j ölçer).
pub const TYP_BUTUNLUK: &str = "tekserp-butunluk";
pub const MAX_PATH_UTF16: usize = 512;
const MAX_SCOPE_DIRS: usize = 32;
const MAX_SCOPE_FILES: usize = 64;
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

/// Yükteki liste künyesi: dosyanın boyu + özeti + satır sayısı.
pub struct ListRef {
    pub sha256: String,
    pub size: u64,
    pub count: usize,
}

pub struct Manifest {
    pub package: Value,
    pub list: ListRef,
    pub dirs: Vec<String>,
    pub files: Vec<String>,
}

fn int_in(v: Option<&Value>, min: f64, max: f64) -> Option<f64> {
    let n = v.and_then(js_number)?;
    (n.is_finite() && n.fract() == 0.0 && n >= min && n <= max).then_some(n)
}

fn only_keys(o: &Map<String, Value>, allowed: &[&str]) -> bool {
    o.keys().all(|k| allowed.contains(&k.as_str()))
}

/// Kapsam listesi: güvenli yol, tekrarsız, en çok `max`.
fn scope_list(v: Option<&Value>, max: usize) -> Option<Vec<String>> {
    let Some(Value::Array(items)) = v else { return None };
    if items.len() > max {
        return None;
    }
    let mut seen = HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        if !is_safe_path(Some(item)) {
            return None;
        }
        let s = item.as_str()?.to_string();
        if !seen.insert(s.clone()) {
            return None;
        }
        out.push(s);
    }
    Some(out)
}

/// Şema (TS `IntegrityManifestSchema` aynası): künye + `liste` + `kapsam` (ikisi de KATI nesne).
fn decode_manifest(payload: &Map<String, Value>) -> Result<Manifest, &'static str> {
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
    let Some(Value::Object(l)) = payload.get("liste") else { return Err(code::BELGE_SEMA) };
    if !only_keys(l, &["sha256", "boyut", "dosyaSayisi"]) || !str_matches(l.get("sha256"), &p.digest) {
        return Err(code::BELGE_SEMA);
    }
    let size = int_in(l.get("boyut"), 1.0, list::MAX_LIST_BYTES as f64).ok_or(code::BELGE_SEMA)?;
    let count = int_in(l.get("dosyaSayisi"), 1.0, list::MAX_FILES as f64).ok_or(code::BELGE_SEMA)?;
    let Some(Value::Object(k)) = payload.get("kapsam") else { return Err(code::BELGE_SEMA) };
    if !only_keys(k, &["dizinler", "dosyalar"]) {
        return Err(code::BELGE_SEMA);
    }
    let dirs = scope_list(k.get("dizinler"), MAX_SCOPE_DIRS).ok_or(code::BELGE_SEMA)?;
    let files = scope_list(k.get("dosyalar"), MAX_SCOPE_FILES).ok_or(code::BELGE_SEMA)?;
    let package = json!({
        "paketId": payload["paketId"],
        "urun": payload["urun"],
        "surum": payload["surum"],
        "derlemeTarihi": payload["derlemeTarihi"],
        "musteri": payload["musteri"],
    });
    let list = ListRef { sha256: l["sha256"].as_str().unwrap_or_default().to_string(), size: size as u64, count: count as usize };
    Ok(Manifest { package, list, dirs, files })
}

#[derive(Default)]
struct Buckets {
    missing: Vec<String>,
    changed: Vec<String>,
    unreadable: Vec<String>,
    extra: Vec<String>,
}

fn not_found(e: &std::io::Error) -> bool {
    matches!(e.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory)
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

fn check_file(root: &Path, f: &Entry, out: &mut Buckets) {
    let full = list::join(root, &f.path);
    match std::fs::metadata(&full) {
        Err(e) if not_found(&e) => out.missing.push(f.path.clone()),
        Err(_) => out.unreadable.push(f.path.clone()),
        Ok(m) if !m.is_file() => out.missing.push(f.path.clone()),
        Ok(m) if m.len() != f.size => out.changed.push(f.path.clone()),
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
        "fazla": cap(&b.extra),
        "fazlaSayisi": b.extra.len(),
        "paket": package,
    })
}

enum ListError {
    Missing,
    Changed,
    Unreadable,
}

/// Liste dosyası: yok → eksik · boy/özet/dilbilgisi tutmaz → değişik · okunamaz → okunamayan.
fn read_list(root: &Path, l: &ListRef) -> Result<Vec<Entry>, ListError> {
    let path = root.join(list::LIST_FILE);
    let io = |e: std::io::Error| if not_found(&e) { ListError::Missing } else { ListError::Unreadable };
    let meta = std::fs::metadata(&path).map_err(io)?;
    if !meta.is_file() {
        return Err(ListError::Missing);
    }
    if meta.len() != l.size {
        return Err(ListError::Changed);
    }
    let bytes = std::fs::read(&path).map_err(io)?;
    if bytes.len() as u64 != l.size || b64::encode(&Sha256::digest(&bytes)) != l.sha256 {
        return Err(ListError::Changed);
    }
    list::parse(&bytes, l.count).ok_or(ListError::Changed)
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
    if paket_zinciri::carries_package_chain_fields(&parsed.payload) {
        return report("GECERSIZ", Some(code::BELGE_SEMA), 0, &empty, Value::Null);
    }
    match decode_manifest(&parsed.payload) {
        Ok(m) => measure(m, root),
        Err(c) => report("GECERSIZ", Some(c), 0, &empty, Value::Null),
    }
}

/// TS `verifyIntegrity(manifest, root, keys, zincir)`: `pkt-*` imzalı liste kök imzalı PAKET sertifikasına dayanır
/// (gömülü liste boş olsa da doğrulanır); aksi bugünkü `verify` AYNEN.
pub fn verify_trusted(manifest: &Value, root: &str, trust: &PackageTrust) -> Value {
    let chained = jws::parse(manifest).is_ok_and(|p| paket_zinciri::is_chain_package_kid(&p.header.kid));
    if !chained {
        return verify(manifest, root, &trust.keys);
    }
    let empty = Buckets::default();
    let signed = match paket_zinciri::verify_package_signed(manifest, TYP_BUTUNLUK, trust) {
        Ok(s) => s,
        Err(e) => return report("GECERSIZ", Some(e.code), 0, &empty, Value::Null),
    };
    match decode_manifest(&signed.payload) {
        Ok(m) => measure(m, root),
        Err(c) => report("GECERSIZ", Some(c), 0, &empty, Value::Null),
    }
}

/// İmzası ve şeması geçmiş listeye karşı `root` altındaki dosyalar.
fn measure(m: Manifest, root: &str) -> Value {
    let empty = Buckets::default();
    let total = m.list.count;
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return report("OLCULEMEDI", Some(code::BUTUNLUK_OKUNAMADI), total, &empty, m.package);
    }
    let mut b = Buckets::default();
    let entries = match read_list(root_path, &m.list) {
        Ok(e) => e,
        Err(ListError::Unreadable) => {
            b.unreadable.push(list::LIST_FILE.to_string());
            return report("OLCULEMEDI", Some(code::BUTUNLUK_OKUNAMADI), total, &b, m.package);
        }
        Err(kind) => {
            let bucket = if matches!(kind, ListError::Missing) { &mut b.missing } else { &mut b.changed };
            bucket.push(list::LIST_FILE.to_string());
            return report("GECERSIZ", Some(code::BUTUNLUK_LISTE_BOZUK), total, &b, m.package);
        }
    };
    for f in &entries {
        check_file(root_path, f, &mut b);
    }
    let listed: HashSet<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    let walk = list::walk_scope(root_path, &m.dirs, &m.files);
    b.extra = walk.entries.into_iter().filter(|e| !listed.contains(e.as_str())).collect();
    b.unreadable.extend(walk.unreadable);
    b.unreadable.sort();
    if !b.missing.is_empty() || !b.changed.is_empty() {
        return report("GECERSIZ", Some(code::BUTUNLUK_UYUSMAZ), total, &b, m.package);
    }
    if !b.extra.is_empty() {
        return report("GECERSIZ", Some(code::BUTUNLUK_FAZLA), total, &b, m.package);
    }
    if !b.unreadable.is_empty() {
        return report("OLCULEMEDI", Some(code::BUTUNLUK_OKUNAMADI), total, &b, m.package);
    }
    report("GECERLI", None, total, &b, m.package)
}
