//! Parmak izi normalleştirme + tuzlu özet + eşleşme kararı — TS `protocol/parmak-izi.ts` aynası. Ham değer bu
//! çekirdekten dışarı ÇIKMAZ: toplayıcı (`collect.rs`) yalnız özeti döndürür.
use crate::b64;
use crate::outcome::{fail, Outcome};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;

pub const FACTORS: [&str; 5] = ["f1", "f2", "f3", "f4", "f5"];
const SALT_MIN_BYTES: usize = 16;
/// Güçlü etkenler (K8): VM ya da disk kopyası f1 (makine kimliği) ve f5'i (PG kimliği) taşır, bunları taşımaz.
pub const STRONG_FACTORS: [&str; 3] = ["f2", "f3", "f4"];
/// v1 eşiği (TS `FINGERPRINT_THRESHOLD`): en az 2 ölçülebilir ve eşleşen ≥ min(3, ölçülebilen).
pub const V1_MIN_MATCHES: usize = 3;
pub const V1_MIN_MEASURABLE: usize = 2;
/// v2 eşiği (TS `FINGERPRINT_V2_THRESHOLD`): eşleşen ≥ 3 ve güçlülerden eşleşen ≥ 2.
pub const V2_MIN_MATCHES: usize = 3;
pub const V2_MIN_STRONG_MATCHES: usize = 2;

/// Tuzlu özet (base64url) ya da `None` = ölçülemedi; sıra `FACTORS`.
pub type Fingerprint = [Option<String>; 5];

/// Üreticilerin doldurmadığı yer tutucular — TS `PLACEHOLDER_VALUES` ile birebir (bekçi ölçer).
pub const PLACEHOLDER_VALUES: [&str; 12] = [
    "none",
    "null",
    "unknown",
    "defaultstring",
    "tobefilledbyoem",
    "notapplicable",
    "notspecified",
    "systemserialnumber",
    "0123456789",
    "systemproductname",
    "chassisserialnumber",
    "baseboardserialnumber",
];

fn is_uniform(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => chars.all(|c| c == first),
        None => false,
    }
}

/// RAID/sanal birimlerin genel serisi (`volume`, `volume0`…).
fn is_generic_disk_serial(text: &str) -> bool {
    text.strip_prefix("volume").is_some_and(|rest| rest.bytes().all(|b| b.is_ascii_digit()))
}

fn is_hex_len(text: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Etken değerini kararlı biçime getirir; anlamsız/boş değer `None` (ölçülemedi).
pub fn normalize_factor(factor: &str, raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let alnum: String = raw.nfkc().filter(char::is_ascii_alphanumeric).map(|c| c.to_ascii_lowercase()).collect();
    if alnum.is_empty() || PLACEHOLDER_VALUES.contains(&alnum.as_str()) || is_uniform(&alnum) {
        return None;
    }
    let ok = match factor {
        "f1" | "f2" => is_hex_len(&alnum, 16, 64),
        "f3" => alnum.len() >= 4 && !is_generic_disk_serial(&alnum),
        "f4" => alnum.len() >= 4,
        "f5" => (1..=20).contains(&alnum.len()) && alnum.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    };
    ok.then_some(alnum)
}

/// Her etken kendi alan önekiyle özetlenir: aynı değer iki etkende çakışmasın.
pub fn digest_fingerprint(raw: &[Option<String>; 5], salt: &[u8]) -> Outcome<[Option<String>; 5]> {
    if salt.len() < SALT_MIN_BYTES {
        return fail("TUZ_KISA", "digestFingerprint: tuz en az 16 bayt olmalı");
    }
    let mut out: [Option<String>; 5] = Default::default();
    for (i, factor) in FACTORS.iter().enumerate() {
        out[i] = normalize_factor(factor, raw[i].as_deref()).map(|value| {
            let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(salt).expect("HMAC her anahtar boyunu kabul eder");
            mac.update(format!("{factor}\u{1f}{value}").as_bytes());
            b64::encode(&mac.finalize().into_bytes())
        });
    }
    Ok(out)
}

/// Uygulanan kural: kira `parmakIziKurali` taşımıyorsa `V1` (ölçülemeyen etken paydadan çıkar).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    V1,
    Standart,
    Zayif,
}

impl Rule {
    /// Kiradaki kural adı (`None` = alan yok → v1); tanınmayan ad `Err`.
    pub fn from_lease(name: Option<&str>) -> Result<Rule, String> {
        match name {
            None => Ok(Rule::V1),
            Some("standart") => Ok(Rule::Standart),
            Some("zayif") => Ok(Rule::Zayif),
            Some(other) => Err(format!("tanınmayan parmak izi kuralı: {other}")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Rule::V1 => "v1",
            Rule::Standart => "standart",
            Rule::Zayif => "zayif",
        }
    }
}

/// TS `FingerprintDecision` aynası.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub result: &'static str,
    pub rule: Rule,
    /// v1: iki tarafta da ölçülebilen etken sayısı · v2: kabul kümesinde değeri olan etken sayısı (n).
    pub measurable: usize,
    pub matched: usize,
    /// v2'de kayıp etkenleri de içerir (kayıp = uyuşmazlık).
    pub mismatched: Vec<&'static str>,
    pub unmeasured: Vec<&'static str>,
    pub lost: Vec<&'static str>,
    pub strong_matched: usize,
}

impl Decision {
    pub fn view(&self) -> Value {
        json!({
            "result": self.result,
            "rule": self.rule.as_str(),
            "measurable": self.measurable,
            "matched": self.matched,
            "mismatched": self.mismatched,
            "unmeasured": self.unmeasured,
            "lost": self.lost,
            "strongMatched": self.strong_matched,
        })
    }
}

fn considered(exclude_f5: bool) -> impl Iterator<Item = (usize, &'static str)> {
    FACTORS.iter().copied().enumerate().filter(move |(_, f)| !(exclude_f5 && *f == "f5"))
}

fn is_strong(factor: &str) -> bool {
    STRONG_FACTORS.contains(&factor)
}

/// Kabul edilen küme ile ölçüleni karşılaştırır (TS `compareFingerprints`). v1: bir tarafta ölçülemeyen etken
/// sayılmaz. v2: kabul kümesinde değeri olup ölçülemeyen etken KAYIPTIR ve uyuşmazlık sayılır; `standart`
/// eşleşen ≥ 3 ∧ güçlülerden ≥ 2, `zayif` eşleşen ≥ min(3, n) ve boş kabul kümesi ÖLÇÜLEMEDİ. DR'de f5 dışarıda.
pub fn compare(accepted: &Fingerprint, measured: &Fingerprint, exclude_f5: bool, rule: Rule) -> Decision {
    let mut d =
        Decision { result: "", rule, measurable: 0, matched: 0, mismatched: vec![], unmeasured: vec![], lost: vec![], strong_matched: 0 };
    for (i, factor) in considered(exclude_f5) {
        match (&accepted[i], &measured[i]) {
            (None, _) => d.unmeasured.push(factor),
            (Some(_), None) if rule == Rule::V1 => d.unmeasured.push(factor),
            (Some(_), None) => {
                d.lost.push(factor);
                d.mismatched.push(factor);
            }
            (Some(a), Some(b)) if a == b => {
                d.matched += 1;
                if is_strong(factor) {
                    d.strong_matched += 1;
                }
            }
            (Some(_), Some(_)) => d.mismatched.push(factor),
        }
    }
    d.measurable = d.matched + d.mismatched.len();
    d.result = match rule {
        Rule::V1 if d.measurable < V1_MIN_MEASURABLE => "OLCULEMEDI",
        Rule::Zayif if d.measurable == 0 => "OLCULEMEDI",
        Rule::V1 => verdict(d.matched >= V1_MIN_MATCHES.min(d.measurable)),
        Rule::Zayif => verdict(d.matched >= V2_MIN_MATCHES.min(d.measurable)),
        Rule::Standart => verdict(d.matched >= V2_MIN_MATCHES && d.strong_matched >= V2_MIN_STRONG_MATCHES),
    };
    d
}

fn verdict(ok: bool) -> &'static str {
    if ok {
        "ESLESTI"
    } else {
        "ESLESMEDI"
    }
}

/// Zayıf tanıma (K8, TS `assessIdentification`): okunabilen < 3 ya da okunabilen güçlü < 2 ise standart kural
/// bu kümeyle hiç sağlanamaz — etkinleştirme satıcı onayı ister, kira `zayif` kuralı taşır.
pub fn assess_identification(fingerprint: &Fingerprint, exclude_f5: bool) -> Value {
    let readable: Vec<&str> = considered(exclude_f5).filter(|(i, _)| fingerprint[*i].is_some()).map(|(_, f)| f).collect();
    let strong_readable = readable.iter().filter(|f| is_strong(f)).count();
    json!({
        "readable": readable.len(),
        "strongReadable": strong_readable,
        "weak": readable.len() < V2_MIN_MATCHES || strong_readable < V2_MIN_STRONG_MATCHES,
    })
}

/// Meşru donanım değişikliği (K8, TS `canAutoLearnFingerprint`): güçlülerden eşleşen ≥ 2 ise yeni küme onaysız öğrenilir.
pub fn can_auto_learn(accepted: &Fingerprint, measured: &Fingerprint, exclude_f5: bool) -> bool {
    compare(accepted, measured, exclude_f5, Rule::Standart).strong_matched >= V2_MIN_STRONG_MATCHES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_rules() {
        assert_eq!(
            normalize_factor("f1", Some("{6F1C2B9A-0D3E-4B57-9A11-3C5E7D9F0B24}")).as_deref(),
            Some("6f1c2b9a0d3e4b579a113c5e7d9f0b24")
        );
        assert_eq!(normalize_factor("f3", Some("Volume1")), None);
        assert_eq!(normalize_factor("f4", Some("To Be Filled By O.E.M.")), None);
        assert_eq!(normalize_factor("f4", Some("００１２ＡＢ")).as_deref(), Some("0012ab"), "NFKC tam genişlik");
        assert_eq!(normalize_factor("f5", Some("0000")), None, "tek düze");
        assert_eq!(normalize_factor("f2", None), None);
    }

    fn fp(values: [Option<&str>; 5]) -> Fingerprint {
        values.map(|v| v.map(str::to_string))
    }

    #[test]
    fn decision_rules() {
        let a = fp([Some("a"), Some("b"), Some("c"), Some("d"), Some("e")]);
        // Güçlü şartı: f1 + f2 + f5 tutar, f3 + f4 tutmaz → v1 geçer, standart RED.
        let copy = fp([Some("a"), Some("b"), Some("x"), Some("y"), Some("e")]);
        assert_eq!(compare(&a, &copy, false, Rule::V1).result, "ESLESTI");
        assert_eq!(compare(&a, &copy, false, Rule::Standart).result, "ESLESMEDI");
        // Kayıp v1'de sayılmaz, v2'de uyuşmazlıktır.
        let lost = fp([Some("a"), Some("b"), None, None, Some("e")]);
        assert_eq!(compare(&a, &lost, false, Rule::V1).measurable, 3);
        let v2 = compare(&a, &lost, false, Rule::Standart);
        assert_eq!((v2.result, v2.lost.clone(), v2.measurable), ("ESLESMEDI", vec!["f3", "f4"], 5));
        // Zayıf kuralda boş kabul kümesi ÖLÇÜLEMEDİ.
        let empty = fp([None; 5]);
        assert_eq!(compare(&empty, &a, false, Rule::Zayif).result, "OLCULEMEDI");
        assert!(can_auto_learn(&a, &fp([Some("z"), Some("b"), Some("c"), Some("d"), Some("w")]), false));
        assert_eq!(assess_identification(&lost, false)["weak"], Value::Bool(true));
    }
}
