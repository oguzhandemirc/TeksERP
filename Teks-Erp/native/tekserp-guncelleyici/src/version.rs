//! Sürüm önceliği — TS `protocol/guncelleme.ts` `parseVersion`/`compareVersions` AYNASI (vektör
//! `guncelleme-karar.json` `surum-karsilastir`): semver önceliği, `+yapı` eki önceliğe girmez, ön sürüm
//! aynı çekirdekteki kararlı sürümden KÜÇÜKTÜR; sayısal tanımlayıcı JS `Number` ile kıyaslanır.
use regex::Regex;
use std::cmp::Ordering;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedVersion {
    pub core: [u64; 3],
    pub pre: Vec<String>,
}

fn parts() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$")
            .expect("surum deseni")
    })
}

/// Semver biçiminde mi (önceliği hesaplanabilir mi)?
pub fn parse(text: &str) -> Option<ParsedVersion> {
    let m = parts().captures(text)?;
    let n = |i: usize| m.get(i).and_then(|x| x.as_str().parse::<u64>().ok());
    let pre = m.get(4).map(|p| p.as_str().split('.').map(str::to_string).collect()).unwrap_or_default();
    Some(ParsedVersion { core: [n(1)?, n(2)?, n(3)?], pre })
}

fn numeric(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn compare_identifiers(a: &str, b: &str) -> Ordering {
    match (numeric(a), numeric(b)) {
        // JS `Number(a) - Number(b)`: çok uzun sayısal tanımlayıcıda da aynı (kayan noktalı) sonuç.
        (true, true) => a.parse::<f64>().unwrap_or(0.0).partial_cmp(&b.parse::<f64>().unwrap_or(0.0)).unwrap_or(Ordering::Equal),
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => a.cmp(b),
    }
}

/// −1 · 0 · 1 karşılığı; biri biçimsizse `None` (çağıran fail-closed davranır).
pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    let (x, y) = (parse(a)?, parse(b)?);
    if x.core != y.core {
        return Some(x.core.cmp(&y.core));
    }
    match (x.pre.is_empty(), y.pre.is_empty()) {
        (true, true) => return Some(Ordering::Equal),
        (true, false) => return Some(Ordering::Greater),
        (false, true) => return Some(Ordering::Less),
        (false, false) => {}
    }
    for (p, q) in x.pre.iter().zip(y.pre.iter()) {
        let c = compare_identifiers(p, q);
        if c != Ordering::Equal {
            return Some(c);
        }
    }
    Some(x.pre.len().cmp(&y.pre.len()))
}

/// Yayınlanan backend sürümü mü (`ReleaseVersionSchema`: `+yapı` eki yok, URL segmenti).
pub fn is_release(text: &str) -> bool {
    tekserp_dogrulama::schema::is_release_version(&serde_json::Value::String(text.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordering() {
        assert_eq!(compare("2.13.0", "2.12.9"), Some(Ordering::Greater));
        assert_eq!(compare("2.13.0-prova.abc", "2.13.0"), Some(Ordering::Less));
        assert_eq!(compare("2.13.0+x", "2.13.0"), Some(Ordering::Equal));
        assert_eq!(compare("2.13.0-rc.2", "2.13.0-rc.10"), Some(Ordering::Less));
        assert_eq!(compare("2.13.0-rc.1", "2.13.0-rc.1.1"), Some(Ordering::Less));
        assert_eq!(compare("2.13.0-1", "2.13.0-a"), Some(Ordering::Less), "sayısal tanımlayıcı alfasayısaldan küçük");
        assert_eq!(compare("10.0.0", "9.99.999"), Some(Ordering::Greater));
        assert_eq!(compare("2.13", "2.13.0"), None);
        assert_eq!(compare("2.13.0-", "2.13.0"), None);
        assert_eq!(compare("2.13.0-rc..1", "2.13.0"), None, "boş tanımlayıcı");
        assert!(parse("12345.0.0").is_none());
        assert!(is_release("2.13.0-rc.1") && !is_release("2.13.0+yapi") && !is_release("2.13.0-a.b.c.d.e"));
    }
}
