//! `<KOK>\ayar\backend.env` — backend ortamı (dotenv alt kümesi): `ANAHTAR=DEĞER` satırları, `#`
//! yorumları, boş satır, isteğe bağlı `export ` öneki, `"…"` (kaçışlı: `\n` `\r` `\t` `\"` `\\`) ya
//! da `'…'` (düz) değer. Tekrarlanan anahtarda SONUNCUSU geçerlidir (dotenv `parse` gibi) ve tekrar
//! uyarı olarak bildirilir. Hata iletileri yalnız satır numarası taşır — DEĞER asla (sır).
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EnvFile {
    /// Dosyadaki sırayla (tekrar edilen anahtar son konumunu alır).
    pub pairs: Vec<(String, String)>,
    /// Tekrarlanan anahtar adları (değer yok).
    pub duplicates: Vec<String>,
}

impl EnvFile {
    /// Boş değer "yok" sayılır.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).filter(|v| !v.is_empty())
    }
}

fn valid_key(k: &str) -> bool {
    let mut c = k.chars();
    matches!(c.next(), Some(ch) if ch == '_' || ch.is_ascii_alphabetic()) && c.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn double_quoted(inner: &str, line: usize) -> Result<String, String> {
    let mut out = String::with_capacity(inner.len());
    let mut it = inner.chars();
    while let Some(ch) = it.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            _ => return Err(format!("satır {line}: tanınmayan kaçış dizisi")),
        }
    }
    Ok(out)
}

fn parse_value(raw: &str, line: usize) -> Result<String, String> {
    let d = raw.trim();
    for q in ['"', '\''] {
        if let Some(inner) = d.strip_prefix(q) {
            let Some(inner) = inner.strip_suffix(q) else {
                return Err(format!("satır {line}: kapanmayan tırnak"));
            };
            return if q == '"' { double_quoted(inner, line) } else { Ok(inner.to_string()) };
        }
    }
    // Tırnaksız değerde satır sonu yorumu (` #`) atılır (dotenv davranışı).
    let d = d.split_once(" #").map_or(d, |(v, _)| v).trim_end();
    Ok(d.to_string())
}

pub fn parse(text: &str) -> Result<EnvFile, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = EnvFile::default();
    for (i, raw) in text.split('\n').enumerate() {
        let no = i + 1;
        let s = raw.strip_suffix('\r').unwrap_or(raw).trim();
        if s.is_empty() || s.starts_with('#') {
            continue;
        }
        let s = s.strip_prefix("export ").map_or(s, str::trim_start);
        let Some((k, v)) = s.split_once('=') else {
            return Err(format!("satır {no}: `ANAHTAR=DEĞER` biçiminde değil"));
        };
        let k = k.trim();
        if !valid_key(k) {
            return Err(format!("satır {no}: geçersiz anahtar adı"));
        }
        let value = parse_value(v, no)?;
        if let Some(pos) = out.pairs.iter().position(|(a, _)| a == k) {
            out.pairs.remove(pos);
            if !out.duplicates.iter().any(|t| t == k) {
                out.duplicates.push(k.to_string());
            }
        }
        out.pairs.push((k.to_string(), value));
    }
    Ok(out)
}

pub fn read(path: &Path) -> Result<EnvFile, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{} okunamadı: {e}", path.display()))?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{} UTF-8 değil", path.display()))?;
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotenv_subset() {
        let d = parse("\u{feff}# yorum\r\nPORT=4000\r\nexport HOST = 0.0.0.0 \nDATABASE_URL=\"postgresql://u:p%40@127.0.0.1:5432/db?schema=public\"\nA='düz \\n'\nB=\"x\\ny\" \nC=deger # yorum\nPORT=4001\n\n")
            .expect("çözülür");
        assert_eq!(d.get("PORT"), Some("4001"), "son tekrar geçerli");
        assert_eq!(d.duplicates, vec!["PORT".to_string()]);
        assert_eq!(d.get("HOST"), Some("0.0.0.0"));
        assert_eq!(d.get("DATABASE_URL"), Some("postgresql://u:p%40@127.0.0.1:5432/db?schema=public"));
        assert_eq!(d.get("A"), Some("düz \\n"), "tek tırnak kaçış çözmez");
        assert_eq!(d.get("B"), Some("x\ny"));
        assert_eq!(d.get("C"), Some("deger"));
        assert_eq!(d.pairs.last().map(|(k, _)| k.as_str()), Some("PORT"), "tekrar son konumu alır");
        assert_eq!(d.pairs.len(), 6);
    }

    #[test]
    fn errors_never_leak_values() {
        let e = parse("GIZLI=\"sir-degeri").unwrap_err();
        assert!(e.contains("satır 1") && !e.contains("sir-degeri"), "{e}");
        assert!(parse("1ABC=x").is_err());
        assert!(parse("satirsiz").is_err());
        assert!(parse("K=\"\\q\"").is_err());
        assert_eq!(parse("").expect("boş").pairs.len(), 0);
    }
}
