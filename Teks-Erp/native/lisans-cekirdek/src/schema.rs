//! Belge şemaları — TS `protocol/belgeler.ts` (Zod v4) aynası. Çıktı Zod'unkiyle aynıdır:
//! `z.object` tanımadığı anahtarı ATAR (`strictObject` reddeder), isteğe bağlı alan yoksa yok.
//! Eşlik iki yönlü ölçülür: TS kâhini aynı vektörleri Zod'dan geçirir (kâhin bekçisi +
//! `tests/vektorler.rs`). Yalnız geçer/kalır ve atılmış çıktı eşleşir; ilk hatanın metni değil.
use crate::iso;
use crate::jsonx::{js_number, utf16_len};
use crate::outcome::{code, fail, Outcome};
use regex::Regex;
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::OnceLock;

pub const PROTOCOL_VERSION: f64 = 1.0;
pub const LICENSE_CLASSES: [&str; 6] = ["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"];
pub const STAGING_ROOT_CLASSES: [&str; 2] = ["TEST", "DEMO"];
pub const SANCTION_LEVELS: [&str; 6] = ["K0", "K1", "K2", "K3", "K4", "K5"];
/// `HAK`: HAK ara imzacısı (G4) — kök → ara sertifika (`ara-`) → HAK.
pub const CERT_USAGES: [&str; 4] = ["ALT", "INDIRME", "BAYI", "HAK"];
pub const DAY_MS: f64 = 86_400_000.0;
pub const LEASE_MAX_DAYS: f64 = 45.0;
pub const GRACE_MAX_DAYS: f64 = 60.0;
/// HAK çevrimdışı ufkunun şema sınırı (gün); sınıf/imzacı tavanı zincirde (`chain::offline_horizon_ceiling_days`).
pub const OFFLINE_HORIZON_MAX_DAYS: u32 = 3650;
/// Satıcının varsayılan ufku ve bayi tavanı (gün).
pub const OFFLINE_HORIZON_DEALER_DAYS: u32 = 400;
/// DEMO ve TEST sınıflarının ufuk tavanı (gün).
pub const OFFLINE_HORIZON_SHORT_CLASS_DAYS: u32 = 45;
/// Kapanış kirasının nedeni (K6) — bilgi alanı; kısıtlamayı kiranın K3'ü getirir.
pub const CLOSING_LEASE_REASONS: [&str; 3] = ["KOPYA", "TASIMA", "IPTAL"];
/// Kiradaki parmak izi kuralı (K8) — TS `FINGERPRINT_RULES`.
pub const FINGERPRINT_RULES: [&str; 2] = ["standart", "zayif"];
/// İptal belgesinin satır tavanı (bağlayıcı sınır yine 32 KB JWS).
pub const REVOCATION_MAX_ENTRIES: usize = 256;
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

struct Patterns {
    uuid: Regex,
    digest: Regex,
    installation_kid: Regex,
    module_key: Regex,
    channel: Regex,
    version: Regex,
    license_no: Regex,
    cert_kid: Regex,
    module_key_id: Regex,
    wrapped_key: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        // Zod v4 `z.uuid()` (RFC 9562: sürüm 1-8, varyant 8-b; nil ve max ayrıca).
        uuid: Regex::new(
            r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
        )
        .expect("uuid"),
        digest: Regex::new(r"^[A-Za-z0-9_-]{43}$").expect("digest"),
        installation_kid: Regex::new(r"^kur-[A-Za-z0-9_-]{43}$").expect("kur"),
        module_key: Regex::new(r"^[a-z][A-Za-z0-9]*([.-][A-Za-z0-9]+)*$").expect("modul"),
        channel: Regex::new(r"^[a-z0-9][a-z0-9-]{0,39}$").expect("kanal"),
        version: Regex::new(r"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}([-+][0-9A-Za-z.-]{1,40})?$").expect("surum"),
        license_no: Regex::new(r"^TKS-[0-9]{4}-[0-9]{4,6}$").expect("lisansNo"),
        cert_kid: Regex::new(r"^[a-z]+-[a-z0-9-]{1,60}$").expect("sertifika kid"),
        module_key_id: Regex::new(r"^mk-[A-Za-z0-9_-]{22}$").expect("modul kid"),
        wrapped_key: Regex::new(r"^[A-Za-z0-9_-]{64}$").expect("sarili"),
    })
}

/// Tek bir alan denetimi; ilk başarısızlıkta alan yolu mesaja girer.
type Check<'a> = &'a dyn Fn(&Value) -> bool;

fn is_str_matching(v: &Value, re: &Regex) -> bool {
    matches!(v, Value::String(s) if re.is_match(s))
}

fn is_uuid(v: &Value) -> bool {
    is_str_matching(v, &patterns().uuid)
}

fn is_iso(v: &Value) -> bool {
    matches!(v, Value::String(s) if iso::is_zod_datetime(s))
}

fn is_digest(v: &Value) -> bool {
    is_str_matching(v, &patterns().digest)
}

fn is_bool(v: &Value) -> bool {
    v.is_boolean()
}

/// `z.number().int()` (+ `.min/.max`): sonlu, güvenli tamsayı.
fn is_int(v: &Value, min: Option<f64>, max: Option<f64>) -> bool {
    let Some(n) = js_number(v) else { return false };
    n.is_finite() && n.fract() == 0.0 && n.abs() <= MAX_SAFE && min.is_none_or(|m| n >= m) && max.is_none_or(|m| n <= m)
}

fn is_string_len(v: &Value, min: usize, max: usize) -> bool {
    matches!(v, Value::String(s) if (min..=max).contains(&utf16_len(s)))
}

fn is_module_key(v: &Value) -> bool {
    matches!(v, Value::String(s) if utf16_len(s) <= 64 && patterns().module_key.is_match(s))
}

fn unique_strings(items: &[Value]) -> bool {
    let mut seen = HashSet::new();
    items.iter().all(|i| seen.insert(i.as_str().unwrap_or_default().to_string()))
}

fn is_module_list(v: &Value) -> bool {
    matches!(v, Value::Array(a) if a.len() <= 64 && a.iter().all(is_module_key) && unique_strings(a))
}

fn is_class(v: &Value) -> bool {
    matches!(v, Value::String(s) if LICENSE_CLASSES.contains(&s.as_str()))
}

fn is_class_list(v: &Value) -> bool {
    matches!(v, Value::Array(a) if !a.is_empty() && a.iter().all(is_class) && unique_strings(a))
}

fn is_nullable(v: &Value, inner: Check) -> bool {
    v.is_null() || inner(v)
}

fn is_jws_text(v: &Value) -> bool {
    is_string_len(v, 1, 32 * 1024)
}

fn is_name(v: &Value) -> bool {
    is_string_len(v, 1, 200)
}

/// `z.object` alan listesi: (ad, zorunlu mu, denetim). Tanınmayan anahtar atılır.
struct Field<'a> {
    name: &'static str,
    required: bool,
    check: Check<'a>,
}

fn req<'a>(name: &'static str, check: Check<'a>) -> Field<'a> {
    Field { name, required: true, check }
}

fn opt<'a>(name: &'static str, check: Check<'a>) -> Field<'a> {
    Field { name, required: false, check }
}

/// Alanları denetler ve atılmış kopyayı döndürür; `strict` tanınmayan anahtarı reddeder.
fn object(v: &Value, fields: &[Field], strict: bool) -> Result<Map<String, Value>, String> {
    let Value::Object(input) = v else {
        return Err("nesne bekleniyordu".into());
    };
    let mut out = Map::new();
    for f in fields {
        match input.get(f.name) {
            None if f.required => return Err(format!("{}: zorunlu", f.name)),
            None => {}
            Some(value) => {
                if !(f.check)(value) {
                    return Err(format!("{}: geçersiz", f.name));
                }
                out.insert(f.name.to_string(), value.clone());
            }
        }
    }
    if strict {
        if let Some(extra) = input.keys().find(|k| !fields.iter().any(|f| f.name == k.as_str())) {
            return Err(format!("{extra}: tanınmayan alan"));
        }
    }
    Ok(out)
}

/// İç içe `z.object` denetimi (atılmış çıktı yerine geçer).
fn nested(value: &Value, fields: &[Field], strict: bool) -> Option<Value> {
    object(value, fields, strict).ok().map(Value::Object)
}

/// `a > b` — NaN (ayrıştırılamayan damga) karşılaştırılamaz ve JS'teki gibi YANLIŞ döner.
fn strictly_after(a: f64, b: f64) -> bool {
    a.partial_cmp(&b) == Some(Ordering::Greater)
}

/// `a <= b` — NaN'da YANLIŞ (JS `<=` gibi).
fn at_most(a: f64, b: f64) -> bool {
    matches!(a.partial_cmp(&b), Some(Ordering::Less | Ordering::Equal))
}

fn ms(m: &Map<String, Value>, key: &str) -> f64 {
    m.get(key).and_then(Value::as_str).map_or(f64::NAN, iso::date_parse_ms)
}

fn named_entity(v: &Value) -> Option<Value> {
    nested(v, &[req("id", &is_uuid), req("ad", &is_name)], false)
}

/// İç içe nesneyi denetleyip atılmış hâlini döndüren şekillendirici.
type Shaper<'a> = &'a dyn Fn(&Value) -> Option<Value>;

/// İç içe nesneleri atılmış hâlleriyle değiştirerek denetler.
fn object_with_nested(v: &Value, fields: &[Field], nested_fields: &[(&'static str, Shaper)]) -> Result<Map<String, Value>, String> {
    let mut out = object(v, fields, false)?;
    for (name, shaper) in nested_fields {
        if let Some(value) = out.get(*name) {
            let shaped = if value.is_null() { Some(Value::Null) } else { shaper(value) };
            match shaped {
                Some(s) => {
                    out.insert((*name).to_string(), s);
                }
                None => return Err(format!("{name}: geçersiz")),
            }
        }
    }
    Ok(out)
}

fn is_one_of(v: &Value, allowed: &[&str]) -> bool {
    matches!(v, Value::String(s) if allowed.contains(&s.as_str()))
}

pub fn entitlement(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(PROTOCOL_VERSION);
    let is_surum = |x: &Value| is_int(x, Some(1.0), None);
    let is_license_no = |x: &Value| is_str_matching(x, &patterns().license_no);
    let any_object = |x: &Value| x.is_object();
    let is_horizon = |x: &Value| is_nullable(x, &|y| is_int(y, Some(1.0), Some(f64::from(OFFLINE_HORIZON_MAX_DAYS))));
    let is_mode_floor = |x: &Value| is_one_of(x, &["zorla"]);
    let out = object_with_nested(
        v,
        &[
            req("v", &is_v),
            req("hakId", &is_uuid),
            req("surum", &is_surum),
            req("lisansNo", &is_license_no),
            req("musteri", &any_object),
            req("tesis", &any_object),
            req("kurulumId", &is_uuid),
            req("sinif", &is_class),
            req("moduller", &is_module_list),
            req("kalici", &is_bool),
            req("bakimBitis", &is_iso),
            req("verilis", &is_iso),
            opt("bayiId", &is_uuid),
            opt("bayiSertifikasi", &is_jws_text),
            opt("imzaciSertifikasi", &is_jws_text),
            opt("cevrimdisiUfukGun", &is_horizon),
            opt("kipAltSiniri", &is_mode_floor),
        ],
        &[("musteri", &named_entity), ("tesis", &named_entity)],
    )?;
    if out.contains_key("bayiSertifikasi") && !out.contains_key("bayiId") {
        return Err("Bayi sertifikalı HAK bayiId taşımalı".into());
    }
    if out.contains_key("bayiSertifikasi") && out.contains_key("imzaciSertifikasi") {
        return Err("HAK hem bayi hem ara imzacı sertifikası taşıyamaz".into());
    }
    Ok(out)
}

fn sanction(v: &Value) -> Option<Value> {
    let is_level = |x: &Value| matches!(x, Value::String(s) if SANCTION_LEVELS.contains(&s.as_str()));
    let is_level_or_null = |x: &Value| is_nullable(x, &is_level);
    let is_message = |x: &Value| is_nullable(x, &|y| is_string_len(y, 0, 500));
    let is_iso_or_null = |x: &Value| is_nullable(x, &is_iso);
    let out = object(
        v,
        &[
            req("kademe", &is_level_or_null),
            req("mesaj", &is_message),
            req("kisitlamaTarihi", &is_iso_or_null),
            req("donmusModuller", &is_module_list),
            req("guncellemeDonuk", &is_bool),
        ],
        false,
    )
    .ok()?;
    let k3 = out.get("kademe").and_then(Value::as_str) == Some("K3");
    if k3 && out.get("kisitlamaTarihi").is_some_and(Value::is_null) {
        return None;
    }
    Some(Value::Object(out))
}

fn channel(v: &Value) -> Option<Value> {
    let is_code = |x: &Value| is_str_matching(x, &patterns().channel);
    let is_version = |x: &Value| is_str_matching(x, &patterns().version);
    let versions = |x: &Value| nested(x, &[opt("backend", &is_version), opt("panel", &is_version), opt("tablet", &is_version)], false);
    let any_object = |x: &Value| x.is_object();
    let mut out = object(v, &[req("kod", &is_code), req("guncelSurumler", &any_object)], false).ok()?;
    let shaped = versions(out.get("guncelSurumler")?)?;
    out.insert("guncelSurumler".into(), shaped);
    Some(Value::Object(out))
}

fn fingerprint(v: &Value) -> Option<Value> {
    let d = |x: &Value| is_nullable(x, &is_digest);
    nested(v, &[req("f1", &d), req("f2", &d), req("f3", &d), req("f4", &d), req("f5", &d)], true)
}

/// `ModuleKeyWrapSchema` (z.object: tanınmayan anahtar atılır).
fn module_key_wrap(v: &Value) -> Option<Value> {
    let is_v = |x: &Value| js_number(x) == Some(1.0);
    let is_wrapped = |x: &Value| is_str_matching(x, &patterns().wrapped_key);
    nested(v, &[req("v", &is_v), req("modul", &is_module_key), req("epk", &is_digest), req("sarili", &is_wrapped)], false)
}

/// `ModuleKeyGrantSchema`: sarmanın modülü hakkın modülüyle aynı olmalı.
fn module_key_grant(v: &Value) -> Option<Value> {
    let is_surum = |x: &Value| is_int(x, Some(1.0), None);
    let is_kid = |x: &Value| is_str_matching(x, &patterns().module_key_id);
    let any_object = |x: &Value| x.is_object();
    let out = object_with_nested(
        v,
        &[req("modul", &is_module_key), req("surum", &is_surum), req("kid", &is_kid), req("sarma", &any_object)],
        &[("sarma", &module_key_wrap)],
    )
    .ok()?;
    let wrap_module = out.get("sarma").and_then(|w| w.get("modul"));
    (wrap_module == out.get("modul")).then_some(Value::Object(out))
}

/// `modulAnahtarlari`: en çok 32 hak, `kid` tekrarsız; her öğe atılmış hâliyle.
fn module_key_grants(v: &Value) -> Option<Value> {
    let Value::Array(items) = v else { return None };
    if items.len() > 32 {
        return None;
    }
    let shaped: Vec<Value> = items.iter().map(module_key_grant).collect::<Option<_>>()?;
    let kids: Vec<Value> = shaped.iter().map(|g| g.get("kid").cloned().unwrap_or(Value::Null)).collect();
    unique_strings(&kids).then_some(Value::Array(shaped))
}

pub fn lease(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(PROTOCOL_VERSION);
    let is_surum = |x: &Value| is_int(x, Some(1.0), None);
    let is_kid = |x: &Value| is_str_matching(x, &patterns().installation_kid);
    let is_grace = |x: &Value| is_int(x, Some(0.0), Some(GRACE_MAX_DAYS));
    let is_iso_or_null = |x: &Value| is_nullable(x, &is_iso);
    let is_poll = |x: &Value| is_int(x, Some(5.0), Some(1440.0));
    let is_sync = |x: &Value| is_nullable(x, &|y| is_int(y, Some(1.0), Some(1440.0)));
    let any_object = |x: &Value| x.is_object();
    let is_array = |x: &Value| x.is_array();
    let is_rule = |x: &Value| is_one_of(x, &FINGERPRINT_RULES);
    let is_closing = |x: &Value| is_one_of(x, &CLOSING_LEASE_REASONS);
    let is_revocation_seq = |x: &Value| is_int(x, Some(1.0), Some(MAX_SAFE));
    let out = object_with_nested(
        v,
        &[
            req("v", &is_v),
            req("kiraId", &is_uuid),
            req("hakId", &is_uuid),
            req("hakSurum", &is_surum),
            req("kurulumId", &is_uuid),
            req("kurulumAnahtarKimligi", &is_kid),
            req("parmakIzi", &any_object),
            req("verilis", &is_iso),
            req("bitis", &is_iso),
            req("sunucuSaati", &is_iso),
            req("ekSureGun", &is_grace),
            req("zorlama", &is_bool),
            req("gecerlilikBitis", &is_iso_or_null),
            req("yaptirim", &any_object),
            req("yoklamaAraligiDk", &is_poll),
            req("esitlemeAraligiDk", &is_sync),
            req("patronBulutBitis", &is_iso_or_null),
            req("devredildi", &is_bool),
            req("kanal", &any_object),
            req("altSertifika", &is_jws_text),
            opt("modulAnahtarlari", &is_array),
            opt("odenmisTarih", &is_iso_or_null),
            opt("parmakIziKurali", &is_rule),
            opt("kapanis", &is_closing),
            opt("hakOzeti", &is_digest),
            opt("iptalSira", &is_revocation_seq),
        ],
        &[("parmakIzi", &fingerprint), ("yaptirim", &sanction), ("kanal", &channel), ("modulAnahtarlari", &module_key_grants)],
    )?;
    let (issued, ends) = (ms(&out, "verilis"), ms(&out, "bitis"));
    if !strictly_after(ends, issued) {
        return Err("Kira bitişi verilişten sonra olmalı".into());
    }
    if !at_most(ends - issued, LEASE_MAX_DAYS * DAY_MS) {
        return Err("Kira ömrü 45 günü aşamaz".into());
    }
    let k3 = out.get("yaptirim").and_then(|y| y.get("kademe")).and_then(Value::as_str) == Some("K3");
    if out.contains_key("kapanis") && !k3 {
        return Err("Kapanış kirası K3 yaptırımı taşımalı".into());
    }
    Ok(out)
}

/// Kullanımın `kid` öneki; tanınmayan kullanımın öneki yok (hiçbir kid uymaz).
pub fn sub_kid_prefix(usage: &str) -> Option<&'static str> {
    match usage {
        "ALT" => Some("alt-"),
        "INDIRME" => Some("ind-"),
        "BAYI" => Some("bayi-"),
        "HAK" => Some("ara-"),
        _ => None,
    }
}

fn kid_matches_usage(out: &Map<String, Value>) -> bool {
    let usage = out.get("kullanim").and_then(Value::as_str).unwrap_or_default();
    let kid = out.get("kid").and_then(Value::as_str).unwrap_or_default();
    sub_kid_prefix(usage).is_some_and(|p| kid.starts_with(p))
}

pub fn certificate(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(PROTOCOL_VERSION);
    let is_usage = |x: &Value| matches!(x, Value::String(s) if CERT_USAGES.contains(&s.as_str()));
    let is_kid = |x: &Value| is_str_matching(x, &patterns().cert_kid);
    let is_x = |x: &Value| is_str_matching(x, &patterns().digest);
    let dealer = |x: &Value| nested(x, &[req("bayiId", &is_uuid), req("moduller", &is_module_list)], false);
    let object_or_null = |x: &Value| x.is_null() || x.is_object();
    let out = object_with_nested(
        v,
        &[
            req("v", &is_v),
            req("sertifikaId", &is_uuid),
            req("kullanim", &is_usage),
            req("kid", &is_kid),
            req("x", &is_x),
            req("siniflar", &is_class_list),
            req("baslangic", &is_iso),
            req("bitis", &is_iso),
            req("bayi", &object_or_null),
        ],
        &[("bayi", &dealer)],
    )?;
    if !strictly_after(ms(&out, "bitis"), ms(&out, "baslangic")) {
        return Err("Sertifika bitişi başlangıçtan sonra olmalı".into());
    }
    if !kid_matches_usage(&out) {
        return Err("kid öneki kullanımla uyuşmuyor".into());
    }
    let usage = out.get("kullanim").and_then(Value::as_str).unwrap_or_default();
    if (usage == "BAYI") != !out.get("bayi").is_some_and(Value::is_null) {
        return Err("Bayi tavanı yalnız BAYI sertifikasında".into());
    }
    Ok(out)
}

/// İptal satırı (`RevocationEntrySchema`, z.object): kid öneki kullanımla uyuşmalı.
fn revocation_entry(v: &Value) -> Option<Value> {
    let is_kid = |x: &Value| is_str_matching(x, &patterns().cert_kid);
    let is_usage = |x: &Value| is_one_of(x, &CERT_USAGES);
    let is_reason = |x: &Value| is_string_len(x, 0, 200);
    let out = object(
        v,
        &[req("kid", &is_kid), req("sertifikaId", &is_uuid), req("kullanim", &is_usage), req("tarih", &is_iso), req("neden", &is_reason)],
        false,
    )
    .ok()?;
    kid_matches_usage(&out).then_some(Value::Object(out))
}

/// `iptaller`: en çok 256 satır, sertifika kimliği tekrarsız; her satır atılmış hâliyle.
fn revocation_entries(v: &Value) -> Option<Value> {
    let Value::Array(items) = v else { return None };
    if items.len() > REVOCATION_MAX_ENTRIES {
        return None;
    }
    let shaped: Vec<Value> = items.iter().map(revocation_entry).collect::<Option<_>>()?;
    let ids: Vec<Value> = shaped.iter().map(|e| e.get("sertifikaId").cloned().unwrap_or(Value::Null)).collect();
    unique_strings(&ids).then_some(Value::Array(shaped))
}

/// İPTAL (G4 §2.3) — TS `RevocationSchema` (z.object: tanınmayan anahtar atılır).
pub fn revocation(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(PROTOCOL_VERSION);
    let is_seq = |x: &Value| is_int(x, Some(1.0), Some(MAX_SAFE));
    let is_array = |x: &Value| x.is_array();
    object_with_nested(
        v,
        &[req("v", &is_v), req("iptalId", &is_uuid), req("sira", &is_seq), req("verilis", &is_iso), req("iptaller", &is_array)],
        &[("iptaller", &revocation_entries)],
    )
}

/// TS `decodeDocument`: bilinmeyen `v` şema hatasından AYRI kodlanır (yükseltme sinyali).
pub fn decode(schema: fn(&Value) -> Result<Map<String, Value>, String>, payload: &Map<String, Value>) -> Outcome<Map<String, Value>> {
    if let Some(v) = payload.get("v") {
        if js_number(v) != Some(PROTOCOL_VERSION) {
            return fail(code::BELGE_SURUM, format!("Desteklenmeyen protokol sürümü: {}", crate::jsonx::js_string(Some(v))));
        }
    }
    let as_value = Value::Object(payload.clone());
    schema(&as_value).or_else(|m| fail(code::BELGE_SEMA, format!("Belge şemaya uymuyor: {m}")))
}
