//! Tanı paketi (`tani --kok <KOK> [--veri <D>] [--ad <ad>] --cikti <dosya.zip>`, `GUNCELLEYICI-SAGLAMLIK.md` §7 W4):
//! destek için durum, geçmiş, son işlemler, günlük kuyruğu, kurulu sürümler, disk ve hizmet/konteyner ölçümleri
//! TEK zip'e. Paket dışarı GÖNDERİLMEZ (güncelleyici kurulum anahtarını kullanmaz); yönetici/SSH ile alınır.
//!
//! Sır GİRMEZ: `.env`ten yalnız anahtar adları; kira/HAK/iptal belgelerinden yalnız sha256 + `kid` + bitiş; niyetteki
//! belirteçten yalnız var/yok + bitiş; yedekler ve geçici anahtarlar hiç okunmaz. Pakete giren her metin üç
//! süzgeçten geçer: `şema://kullanıcı:parola@` maskesi · sır adlı anahtarın değeri · bilinen sır DEĞERLERİ
//! (`.env`in sır adlı anahtarları, bağlantı dizesi parolası, vekil parolası, belirteç, belgelerin kendisi).
//! Bekçi `tests/tani_paketi.rs` (`tani_paketi_sir_tasimaz`).
use crate::cli::{data_arg, flag_value, root_arg};
use crate::env::Fs;
use crate::layout::Layout;
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Güncelleyici günlüğünden pakete giren kuyruk.
pub const LOG_TAIL: u64 = 5 * 1024 * 1024;
/// `gecmis.jsonl` kuyruğu.
pub const HISTORY_TAIL: u64 = 2 * 1024 * 1024;
/// `islem.jsonl`den son kaç işlem.
pub const LAST_OPS: usize = 5;
/// `kurulum-gecmisi.jsonl`den son kaç satır.
pub const INSTALL_HISTORY_LINES: usize = 20;
/// Tek bir küçük dosyanın (durum, ayar, belge…) okuma sınırı.
const SMALL_MAX: u64 = 1024 * 1024;
const JOURNAL_MAX: u64 = 16 * 1024 * 1024;
const MASK: &str = "***";
/// Bilinen sır değeri bu boydan kısaysa metinde aranmaz (`a`, `1` gibi değerler her yeri bozardı).
const SECRET_MIN_LEN: usize = 4;

/// Pakete giren bir dosya (platform ölçümleri de bu biçimde gelir).
#[derive(Debug, Clone)]
pub struct Olcum {
    /// Zip içindeki ad (`/` ayraçlı).
    pub ad: String,
    /// `ICINDEKILER.txt` satırı.
    pub aciklama: String,
    pub icerik: Vec<u8>,
}

impl Olcum {
    pub fn new(ad: &str, aciklama: &str, icerik: impl Into<Vec<u8>>) -> Olcum {
        Olcum { ad: ad.to_string(), aciklama: aciklama.to_string(), icerik: icerik.into() }
    }
}

/// Platform ölçümlerinin hedefi (hizmet adları + kökler).
#[derive(Debug, Clone)]
pub struct TaniHedefi {
    pub root: PathBuf,
    pub data: PathBuf,
    pub updater_service: String,
    pub backend_service: String,
}

// ── Süzgeç ──────────────────────────────────────────────────────────────────────────────────

fn secret_key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i-u:parola|sifre|pass|pwd|secret|token|belirte|apikey|api_key|private|credential|pepper|hmac)").expect("re")
    })
}

/// `.env` anahtarı sır mı (değeri pakette aranıp maskelenir): yukarıdakiler + `KEY`/`SALT`/`PIN`.
fn secret_env_key(k: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?i-u:key|salt|(^|_)pin($|_)|url|dsn)").expect("re"));
    secret_key_re().is_match(k) || re.is_match(k)
}

fn kv_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"((?i-u:[A-Za-z0-9_-]*(?:parola|sifre|password|passwd|pwd|secret|token|belirtec|apikey|api_key)[A-Za-z0-9_-]*))("?[ \t]*[=:][ \t]*)("?)([^ \t\r\n"',;&]+)"#,
        )
        .expect("re")
    })
}

fn bearer_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"((?i-u:bearer|basic))[ \t]+[A-Za-z0-9._~+/=-]{8,}").expect("re"))
}

/// Pakete giren metnin süzgeci. `secrets` = bilinen sır değerleri (metinde nerede görünürse görünsün maskelenir).
#[derive(Debug, Default, Clone)]
pub struct Suzgec {
    secrets: Vec<String>,
}

impl Suzgec {
    pub fn add_secret(&mut self, s: &str) {
        let s = s.trim();
        if s.chars().count() >= SECRET_MIN_LEN && s != MASK && !self.secrets.iter().any(|x| x == s) {
            self.secrets.push(s.to_string());
            // Uzun önce: kısa sırrın uzun olanın içinde kalıp parçalı maskelenmesini önler.
            self.secrets.sort_by_key(|x| std::cmp::Reverse(x.len()));
        }
    }

    /// Bağlantı dizesinin (`şema://kullanıcı:parola@…`) parolası — ham ve çözülmüş biçimiyle.
    pub fn add_url_password(&mut self, text: &str) {
        let mut rest = text;
        while let Some(i) = rest.find("://") {
            let tail = &rest[i + 3..];
            let end = tail.find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '/').unwrap_or(tail.len());
            let auth = &tail[..end];
            if let Some(at) = auth.rfind('@') {
                if let Some((_, pw)) = auth[..at].split_once(':') {
                    self.add_secret(pw);
                    if let Some(d) = pct_decode(pw) {
                        self.add_secret(&d);
                    }
                }
            }
            rest = tail;
        }
    }

    pub fn secrets(&self) -> &[String] {
        &self.secrets
    }

    /// Serbest metin: kimlikli adres · `parola=…` biçimi · `Bearer …` · bilinen sır değerleri.
    pub fn text(&self, s: &str) -> String {
        let mut out = crate::settings::redact(s);
        out = kv_re().replace_all(&out, format!("${{1}}${{2}}${{3}}{MASK}")).into_owned();
        out = bearer_re().replace_all(&out, format!("${{1}} {MASK}")).into_owned();
        for sec in &self.secrets {
            if out.contains(sec.as_str()) {
                out = out.replace(sec.as_str(), MASK);
            }
        }
        out
    }

    /// JSON: sır adlı anahtarın değeri maskelenir, her metin değeri `text`ten geçer.
    pub fn json(&self, v: &mut Value) {
        match v {
            Value::Object(m) => {
                for (k, x) in m.iter_mut() {
                    if secret_key_re().is_match(k) && !matches!(x, Value::Null | Value::Bool(_)) {
                        *x = Value::String(MASK.into());
                    } else {
                        self.json(x);
                    }
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| self.json(x)),
            Value::String(s) => *s = self.text(s),
            _ => {}
        }
    }

    /// JSON baytları (ayrışmazsa düz metin süzgeci).
    pub fn json_bytes(&self, b: &[u8]) -> Vec<u8> {
        match serde_json::from_slice::<Value>(b) {
            Ok(mut v) => {
                self.json(&mut v);
                serde_json::to_vec_pretty(&v).unwrap_or_default()
            }
            Err(_) => self.text(&String::from_utf8_lossy(b)).into_bytes(),
        }
    }

    /// JSONL: satır satır (ayrışmayan satır düz metin süzgecinden).
    pub fn jsonl(&self, lines: &[&str]) -> Vec<u8> {
        let mut out = String::new();
        for l in lines.iter().filter(|l| !l.trim().is_empty()) {
            match serde_json::from_str::<Value>(l) {
                Ok(mut v) => {
                    self.json(&mut v);
                    out.push_str(&v.to_string());
                }
                Err(_) => out.push_str(&self.text(l)),
            }
            out.push('\n');
        }
        out.into_bytes()
    }
}

fn pct_decode(s: &str) -> Option<String> {
    if !s.contains('%') {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

// ── Okuma ───────────────────────────────────────────────────────────────────────────────────

fn hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

/// Dosyanın son `max` baytı (kesik ilk satır atılır); yoksa `None`.
fn tail(fs: &dyn Fs, p: &Path, max: u64) -> Option<Vec<u8>> {
    let len = fs.file_len(p).ok()?;
    let mut f = fs.open_read(p).ok()?;
    let start = len.saturating_sub(max);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.take(max).read_to_end(&mut buf).ok()?;
    if start > 0 {
        let cut = buf.iter().position(|c| *c == b'\n').map_or(buf.len(), |i| i + 1);
        buf.drain(..cut);
    }
    Some(buf)
}

fn read_small(fs: &dyn Fs, p: &Path) -> Result<Vec<u8>, String> {
    fs.read_untrusted(p, SMALL_MAX).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "yok".into()
        } else {
            format!("okunamadı ({:?})", e.kind())
        }
    })
}

/// Pakete girmeyen ya da bulunamayan kalem (`ICINDEKILER.txt`).
struct Atlanan {
    ad: String,
    neden: String,
}

struct Paket {
    girdiler: Vec<Olcum>,
    atlananlar: Vec<Atlanan>,
}

impl Paket {
    fn add(&mut self, o: Olcum) {
        self.girdiler.push(o);
    }
    fn skip(&mut self, ad: &str, neden: impl Into<String>) {
        self.atlananlar.push(Atlanan { ad: ad.to_string(), neden: neden.into() });
    }
}

/// `.env`: sır değerleri süzgece, pakete yalnız anahtar adları.
fn env_keys(fs: &dyn Fs, layout: &Layout, s: &mut Suzgec) -> Result<Vec<u8>, String> {
    let bytes = fs.read_untrusted(&layout.backend_env(), 256 * 1024).map_err(|e| format!("okunamadı ({:?})", e.kind()))?;
    let file = tekserp_hizmet::envfile::parse_bytes(&bytes);
    let mut out = String::from("# yapilandirma/.env — YALNIZ anahtar adları (değerler pakete girmez)\n");
    for (k, v) in &file.pairs {
        s.add_url_password(v);
        let path_like = v.starts_with('/') || v.get(1..3).is_some_and(|x| x == ":\\");
        if secret_env_key(k) && !path_like && !v.contains("://") {
            s.add_secret(v);
        }
        out.push_str(&format!("{k}{}\n", if v.is_empty() { " (boş)" } else { "" }));
    }
    for d in &file.duplicates {
        out.push_str(&format!("# tekrarlanan anahtar: {d}\n"));
    }
    // Sır adlı anahtar ADI da metinde kalır (sır değil); değer yukarıda süzgece girdi.
    Ok(out.into_bytes())
}

/// Lisans belgeleri: yalnız var/yok · boy · sha256 · `kid` · bitiş alanları (imza DOĞRULANMADAN okunur).
fn license_summary(fs: &dyn Fs, dir: &Path, s: &mut Suzgec) -> Value {
    let mut m = Map::new();
    for name in ["kira.jws", "hak.jws", "iptal.jws", tekserp_dogrulama::paket_zinciri::PACKAGE_REVOCATION_FILE] {
        let v = match fs.read_untrusted(&dir.join(name), 128 * 1024) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({ "var": false }),
            Err(e) => json!({ "var": true, "hata": format!("okunamadı ({:?})", e.kind()) }),
            Ok(b) => {
                let text = String::from_utf8_lossy(&b).trim().to_string();
                s.add_secret(&text);
                if let Some(sig) = text.rsplit('.').next() {
                    s.add_secret(sig);
                }
                let mut o = json!({ "var": true, "boy": b.len(), "sha256": hex(&b) });
                match tekserp_dogrulama::jws::parse(&Value::String(text)) {
                    Ok(p) => {
                        o["kid"] = json!(p.header.kid);
                        o["typ"] = json!(p.header.typ);
                        for f in ["verilis", "bitis", "bakimBitis", "gecerlilikBitis", "sira"] {
                            if let Some(x) = p.payload.get(f).filter(|x| x.is_string() || x.is_number()) {
                                o[f] = x.clone();
                            }
                        }
                    }
                    Err(f) => o["bicim"] = json!(format!("ayrıştırılamadı ({})", f.code)),
                }
                o
            }
        };
        m.insert(name.to_string(), v);
    }
    json!({ "dizin": dir.to_string_lossy(), "not": "imza burada DOĞRULANMAZ; belgelerin kendisi pakete girmez", "belgeler": m })
}

/// Niyet: onay olduğu gibi (kişi/zaman/sürüm), indirme belirtecinden yalnız var/yok + bitiş.
fn intent_summary(fs: &dyn Fs, layout: &Layout, s: &mut Suzgec) -> Value {
    let b = match fs.read_untrusted(&layout.intent_file(), 64 * 1024) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return json!({ "var": false }),
        Err(e) => return json!({ "var": true, "hata": format!("okunamadı ({:?})", e.kind()) }),
        Ok(b) => b,
    };
    let Ok(Value::Object(mut v)) = serde_json::from_slice::<Value>(&b) else {
        return json!({ "var": true, "bicim": "JSON nesnesi değil", "sha256": hex(&b) });
    };
    if let Some(d) = v.remove("indirme") {
        if let Some(t) = d.get("belirtec").and_then(Value::as_str) {
            s.add_secret(t);
        }
        v.insert(
            "indirme".into(),
            json!({ "belirtecVar": d.get("belirtec").and_then(Value::as_str).is_some_and(|t| !t.is_empty()), "bitis": d.get("bitis") }),
        );
    }
    v.insert("var".into(), json!(true));
    Value::Object(v)
}

/// `islem.jsonl`in son `LAST_OPS` işleminin satırları (sırayla).
fn last_ops(text: &str) -> Vec<&str> {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut ops: Vec<String> = Vec::new();
    for l in &lines {
        if let Some(op) = serde_json::from_str::<Value>(l).ok().and_then(|v| v.get("islemId").and_then(Value::as_str).map(str::to_string)) {
            if let Some(i) = ops.iter().position(|o| *o == op) {
                ops.remove(i);
            }
            ops.push(op);
        }
    }
    let keep: Vec<&String> = ops.iter().rev().take(LAST_OPS).collect();
    lines
        .into_iter()
        .filter(|l| {
            serde_json::from_str::<Value>(l)
                .ok()
                .and_then(|v| v.get("islemId").and_then(Value::as_str).map(str::to_string))
                .is_some_and(|op| keep.contains(&&op))
        })
        .collect()
}

fn list_dir(fs: &dyn Fs, p: &Path) -> Value {
    match fs.list(p) {
        Ok(mut names) => {
            names.sort();
            Value::Array(names.into_iter().map(|n| json!({ "ad": n, "dizin": fs.is_dir(&p.join(&n)) })).collect())
        }
        Err(e) => json!(format!("okunamadı ({:?})", e.kind())),
    }
}

fn disk(fs: &dyn Fs, paths: &[(&str, &Path)]) -> Value {
    let mut m = Map::new();
    for (name, p) in paths {
        let v = match fs.free_space(p) {
            Ok(u64::MAX) => json!({ "yol": p.to_string_lossy(), "bos": null, "not": "bu platformda ölçülmedi" }),
            Ok(n) => json!({ "yol": p.to_string_lossy(), "bosBayt": n, "bosMB": n / (1024 * 1024) }),
            Err(e) => json!({ "yol": p.to_string_lossy(), "hata": format!("{:?}", e.kind()) }),
        };
        m.insert((*name).to_string(), v);
    }
    Value::Object(m)
}

/// Paketin girdileri (zip'e yazılmadan önce; testler doğrudan ölçer). `platform` = platform ölçümleri
/// (süzgeçten geçer); `kunye` = ikilinin künyesi; `now` = UTC ISO.
pub fn collect(fs: &dyn Fs, layout: &Layout, kunye: &str, platform: Vec<Olcum>, now: &str) -> Vec<Olcum> {
    let mut s = Suzgec::default();
    let mut p = Paket { girdiler: Vec::new(), atlananlar: Vec::new() };

    // Önce bilinen sırlar (sonraki her metin onlara karşı süzülür).
    let env_names = env_keys(fs, layout, &mut s);
    let settings = read_small(fs, &layout.settings_file());
    if let Ok(b) = &settings {
        if let Ok(v) = serde_json::from_slice::<Value>(b) {
            for x in [v.get("vekil"), v.get("guncellemeSunucusu")].into_iter().flatten().filter_map(Value::as_str) {
                s.add_url_password(x);
            }
        }
    }
    let license_dir = crate::settings::read_backend_env(fs, layout).map_or_else(|_| layout.default_license_dir(), |be| be.license_dir);
    let lisans = license_summary(fs, &license_dir, &mut s);
    let niyet = intent_summary(fs, layout, &mut s);

    p.add(Olcum::new("kunye.json", "güncelleyici ikilisinin künyesi (ad · sürüm · hedef · çapa kipi)", s.json_bytes(kunye.as_bytes())));
    for (name, file, what) in [
        ("durum.json", layout.status_file(), "güncelleyicinin son durumu (panelin okuduğu)"),
        ("kendi.json", layout.self_update_file(), "kendini güncelleme sayacı"),
        ("ertele.json", layout.work().join("ertele.json"), "kesin paket hatalarında yeniden indirme aralığı"),
    ] {
        match read_small(fs, &file) {
            Ok(b) => p.add(Olcum::new(name, what, s.json_bytes(&b))),
            Err(e) => p.skip(name, e),
        }
    }
    match settings {
        Ok(b) => p.add(Olcum::new("ayar.json", "güncelleyici ayarı (vekil parolası maskeli)", s.json_bytes(&b))),
        Err(e) => p.skip("ayar.json", e),
    }
    match tail(fs, &layout.history_file(), HISTORY_TAIL) {
        Some(b) => p.add(Olcum::new(
            "gecmis.jsonl",
            "güncelleme geçmişi (son 2 MB)",
            s.jsonl(&String::from_utf8_lossy(&b).lines().collect::<Vec<_>>()),
        )),
        None => p.skip("gecmis.jsonl", "yok"),
    }
    match fs.read_untrusted(&layout.journal_file(), JOURNAL_MAX) {
        Ok(b) => {
            let text = String::from_utf8_lossy(&b);
            p.add(Olcum::new("islem.jsonl", &format!("işlem günlüğü (son {LAST_OPS} işlem)"), s.jsonl(&last_ops(&text))));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => p.skip("islem.jsonl", "yok"),
        Err(e) => p.skip("islem.jsonl", format!("okunamadı ({:?})", e.kind())),
    }

    // Günlük: son 5 MB — gerekirse bir önceki döndürülmüş dosyanın kuyruğuyla.
    let log = layout.log_dir().join("guncelleyici.log");
    let cur = tail(fs, &log, LOG_TAIL).unwrap_or_default();
    let mut log_bytes =
        tail(fs, &layout.log_dir().join("guncelleyici.1.log"), LOG_TAIL.saturating_sub(cur.len() as u64)).unwrap_or_default();
    log_bytes.extend_from_slice(&cur);
    if log_bytes.is_empty() {
        p.skip("gunluk/guncelleyici.log", "yok");
    } else {
        p.add(Olcum::new(
            "gunluk/guncelleyici.log",
            "güncelleyici günlüğü (son 5 MB, UTC)",
            s.text(&String::from_utf8_lossy(&log_bytes)).into_bytes(),
        ));
    }

    let current = match fs.link_target(&layout.current()) {
        Ok(Some(t)) => json!(t.to_string_lossy()),
        Ok(None) => json!(null),
        Err(e) => json!(format!("okunamadı ({:?})", e.kind())),
    };
    let versions = json!({ "current": current, "surumler": list_dir(fs, &layout.versions()), "pgsql": list_dir(fs, &layout.pgsql()) });
    p.add(Olcum::new(
        "surumler.json",
        "kurulu sürümler · current hedefi · PG sürüm dizinleri",
        s.json_bytes(versions.to_string().as_bytes()),
    ));

    match fs.read_untrusted(&layout.install_history(), JOURNAL_MAX) {
        Ok(b) => {
            let text = String::from_utf8_lossy(&b);
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            let from = lines.len().saturating_sub(INSTALL_HISTORY_LINES);
            p.add(Olcum::new(
                "kurulum-gecmisi.jsonl",
                &format!("kurulum geçmişi (son {INSTALL_HISTORY_LINES} satır)"),
                s.jsonl(&lines[from..]),
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => p.skip("kurulum-gecmisi.jsonl", "yok"),
        Err(e) => p.skip("kurulum-gecmisi.jsonl", format!("okunamadı ({:?})", e.kind())),
    }

    let d = disk(fs, &[("kok", &layout.root), ("veri", &layout.data), ("is", &layout.work())]);
    p.add(Olcum::new("disk.json", "boş alan (kök · veri · güncelleyici iş alanı)", s.json_bytes(d.to_string().as_bytes())));
    match env_names {
        Ok(b) => p.add(Olcum::new(
            "env-anahtarlari.txt",
            "yapilandirma/.env — yalnız anahtar adları",
            s.text(&String::from_utf8_lossy(&b)).into_bytes(),
        )),
        Err(e) => p.skip("env-anahtarlari.txt", e),
    }
    p.add(Olcum::new(
        "lisans-ozeti.json",
        "kira · HAK · iptal belgeleri: yalnız sha256 + kid + bitiş",
        s.json_bytes(lisans.to_string().as_bytes()),
    ));
    p.add(Olcum::new(
        "niyet-ozeti.json",
        "panel onayı + indirme belirteci (yalnız var/yok + bitiş)",
        s.json_bytes(niyet.to_string().as_bytes()),
    ));

    for o in platform {
        let icerik =
            if o.ad.ends_with(".json") { s.json_bytes(&o.icerik) } else { s.text(&String::from_utf8_lossy(&o.icerik)).into_bytes() };
        p.add(Olcum { icerik, ..o });
    }

    // Girmeyenler (beyan): ne olduklarını bilmek tanıya yeter.
    for (ad, neden) in [
        ("yapilandirma/.env (değerler)", "sır — yalnız anahtar adları env-anahtarlari.txt'de"),
        ("lisans/*.jws (belgelerin kendisi)", "yalnız sha256 + kid + bitiş lisans-ozeti.json'da"),
        ("niyet.json indirme belirteci", "yalnız var/yok + bitiş niyet-ozeti.json'da"),
        ("güncelleme öncesi yedekler", "veri — pakete girmez"),
        ("geçici yedek anahtarları (is/anahtar)", "sır — pakete girmez"),
    ] {
        p.skip(ad, neden);
    }

    let mut toc = format!(
        "TeksERP güncelleyici tanı paketi\noluşturuldu (UTC): {now}\nkök: {}\nveri: {}\n\nSırlar maskelidir (***): parola · belirteç · anahtar · bağlantı dizesi parolası.\nPaket hiçbir yere gönderilmedi.\n\n# Dosyalar\n",
        layout.root.display(),
        layout.data.display()
    );
    for o in &p.girdiler {
        toc.push_str(&format!("{}  ({} bayt, sha256 {})\n    {}\n", o.ad, o.icerik.len(), &hex(&o.icerik)[..16], o.aciklama));
    }
    toc.push_str("\n# Girmeyenler / bulunamayanlar\n");
    for a in &p.atlananlar {
        toc.push_str(&format!("{} — {}\n", a.ad, a.neden));
    }
    let mut out = vec![Olcum::new("ICINDEKILER.txt", "içindekiler", s.text(&toc).into_bytes())];
    out.extend(p.girdiler);
    out
}

/// Girdileri zip'e yazar (Deflate).
pub fn zip_bytes(entries: &[Olcum]) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for e in entries {
            z.start_file(e.ad.as_str(), opts).map_err(|x| format!("zip: {x}"))?;
            z.write_all(&e.icerik).map_err(|x| format!("zip: {x}"))?;
        }
        z.finish().map_err(|x| format!("zip: {x}"))?;
    }
    Ok(buf.into_inner())
}

/// `tani` alt komutu.
pub fn komut(args: &[String], kunye: &str) -> Result<u32, String> {
    let root = root_arg(args)?;
    let data = data_arg(args, &root);
    let out = PathBuf::from(flag_value(args, "--cikti").ok_or("--cikti <dosya.zip> gerekli")?);
    let layout = Layout::new(&root, &data);
    let fs = crate::env::RealFs;
    let settings = crate::settings::read_settings(&fs, &layout).unwrap_or_default();
    let hedef = TaniHedefi {
        root: root.clone(),
        data: data.clone(),
        updater_service: tekserp_hizmet::contract::service_name_arg(args, tekserp_hizmet::contract::UPDATER_SERVICE)?,
        backend_service: settings.backend_service().to_string(),
    };
    let platform = crate::platform::tani_olcumleri(&hedef);
    let now = tekserp_hizmet::timefmt::iso_millis(tekserp_hizmet::timefmt::now_ms());
    let entries = collect(&fs, &layout, kunye, platform, &now);
    let bytes = zip_bytes(&entries)?;
    if let Some(d) = out.parent().filter(|d| !d.as_os_str().is_empty()) {
        fs.create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    fs.write_atomic(&out, &bytes).map_err(|e| format!("{}: {e}", out.display()))?;
    println!("tanı paketi yazıldı: {} ({} dosya, {} bayt) — gönderilmedi", out.display(), entries.len(), bytes.len());
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suzgec_maskeler() {
        let mut s = Suzgec::default();
        s.add_secret("cokgizli1");
        s.add_url_password("postgresql://u:p%40rola@h:5432/d");
        assert_eq!(s.text("x cokgizli1 y"), "x *** y");
        assert_eq!(s.text("p@rola"), "***");
        assert_eq!(s.text("PGPASSWORD=abc123 devam"), "PGPASSWORD=*** devam");
        assert_eq!(s.text("Authorization: Bearer abcdefgh1234"), "Authorization: Bearer ***");
        let mut v = json!({ "belirtec": "t", "vekil": "http://a:b@c:1", "n": 3, "parola": null });
        s.json(&mut v);
        assert_eq!(v, json!({ "belirtec": "***", "vekil": "http://***@c:1", "n": 3, "parola": null }));
    }

    #[test]
    fn son_islemler() {
        let mut t = String::new();
        for i in 0..8 {
            t.push_str(&format!("{{\"islemId\":\"op{i}\",\"olay\":\"ISLEM\"}}\n{{\"islemId\":\"op{i}\",\"olay\":\"SONUC\"}}\n"));
        }
        let l = last_ops(&t);
        assert_eq!(l.len(), 2 * LAST_OPS);
        assert!(l[0].contains("op3") && l.last().unwrap().contains("op7"));
    }

    #[test]
    fn yuzde_cozme() {
        assert_eq!(pct_decode("a%40b%3A").as_deref(), Some("a@b:"));
        assert_eq!(pct_decode("ab"), None);
        assert_eq!(pct_decode("a%4"), None);
    }
}
