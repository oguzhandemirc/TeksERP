//! Sürüm metni (`VersionTextSchema`: `X.Y.Z[-ön|+derleme]`) ve karşılaştırması. Ön sürüm aynı
//! çekirdekteki kararlı sürümden KÜÇÜKTÜR (semver); derleme eki sıralamaya girmez.
use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub core: [u64; 3],
    pub pre: Option<String>,
    pub text: String,
}

pub fn parse(text: &str) -> Option<Version> {
    let (main, suffix) = match text.find(['-', '+']) {
        Some(i) => (&text[..i], Some(&text[i..])),
        None => (text, None),
    };
    let parts: Vec<&str> = main.split('.').collect();
    let limits = [4usize, 4, 6];
    if parts.len() != 3 || parts.iter().zip(limits).any(|(p, n)| p.is_empty() || p.len() > n || !p.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let core = [parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?];
    let pre = match suffix {
        None => None,
        Some(s) => {
            let body = &s[1..];
            if body.is_empty() || body.len() > 40 || !body.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') {
                return None;
            }
            // `+derleme` sıralamaya girmez; `-ön` girer.
            s.starts_with('-').then(|| body.split('+').next().unwrap_or(body).to_string())
        }
    };
    Some(Version { core, pre, text: text.to_string() })
}

fn cmp_pre(a: &str, b: &str) -> Ordering {
    let (pa, pb): (Vec<&str>, Vec<&str>) = (a.split('.').collect(), b.split('.').collect());
    for (x, y) in pa.iter().zip(pb.iter()) {
        let o = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(m), Ok(n)) => m.cmp(&n),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            _ => x.cmp(y),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    pa.len().cmp(&pb.len())
}

impl Version {
    pub fn cmp_to(&self, other: &Version) -> Ordering {
        self.core.cmp(&other.core).then_with(|| match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (None, Some(_)) => Ordering::Greater,
            (Some(_), None) => Ordering::Less,
            (Some(a), Some(b)) => cmp_pre(a, b),
        })
    }
}

/// Karşılaştırma; biçimsiz sürüm `None` (çağıran reddeder).
pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    Some(parse(a)?.cmp_to(&parse(b)?))
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
        assert_eq!(compare("10.0.0", "9.99.999"), Some(Ordering::Greater));
        assert_eq!(compare("2.13", "2.13.0"), None);
        assert_eq!(compare("2.13.0-", "2.13.0"), None);
        assert!(parse("12345.0.0").is_none());
    }
}
