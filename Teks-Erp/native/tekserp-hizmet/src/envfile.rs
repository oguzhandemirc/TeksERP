//! `<KOK>\yapilandirma\.env` — backend'in ortam dosyası; bu modül BACKEND'İN OKUYUCUSUNUN aynasıdır.
//! Backend dosyayı dotenv 17.4.2 ile okur (`config` → `readFileSync(utf8)` → `parse`: tek çok satırlı
//! düzenli ifade + `trim` + tırnak soyma + yalnız çift tırnakta `\n`/`\r` açılımı). Aynı dosyayı okuyan
//! iki süreç aynı anahtar/değeri görmeli; burası kendi kuralını koymaz, o ifadenin geri izleme
//! sırasını (JS `\s` · satır sonu · `^`/`$` kümeleri dahil) birebir izler:
//! · içerik ASLA hata üretmez — biçimsiz satır sessizce atlanır; zorunlu anahtarın yokluğunu ÇAĞIRAN
//!   ölçer (güncelleyici `AYAR_EKSIK`);
//! · geçersiz UTF-8 U+FFFD olur (Node'un çözücüsü), BOM boşluktur;
//! · tekrarlanan anahtarın değeri SONUNCUSU, sırası ilk görülüşü (JS nesnesi); `__proto__` atanmaz.
//! Eşlik ortak vektörlerle ölçülür: `native/test-vektorleri/env-dosyasi.json` (üreten GERÇEK dotenv —
//! `Teks-Erp/scripts/test_env_okuyucu.ts --vektor-yaz`) ↔ `tests/env_dosyasi_vektorleri.rs`.
//! Değer hiçbir iletiye girmez (sır).
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EnvFile {
    /// İlk görülüş sırasıyla; tekrarlanan anahtarın değeri sonuncusudur.
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

/// JS `\s` ve `String.prototype.trim` kümesi (ECMAScript WhiteSpace + LineTerminator; `\u{85}` YOK, BOM VAR).
fn is_space(c: char) -> bool {
    matches!(c, '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}')
        || matches!(c, '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// JS satır sonu: çok satır kipinde `^`/`$` bunlarda tutar, `.` bunları geçmez.
fn is_line_end(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `[\w.-]` (bayraksız JS `\w` yalnız ASCII).
fn is_key_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')
}

struct Match {
    key: (usize, usize),
    value: Option<(usize, usize)>,
    end: usize,
}

/// dotenv'in satır ifadesi:
/// `^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$`
/// (çok satır + genel kip). Her yöntem ifadenin bir parçasını, geri izlemenin deneyeceği sırayla çözer.
struct Scan<'a> {
    s: &'a [char],
}

impl Scan<'_> {
    fn at(&self, i: usize) -> Option<char> {
        self.s.get(i).copied()
    }

    fn skip_space(&self, mut i: usize) -> usize {
        while self.at(i).is_some_and(is_space) {
            i += 1;
        }
        i
    }

    fn line_start(&self, i: usize) -> bool {
        i == 0 || self.s.get(i - 1).copied().is_some_and(is_line_end)
    }

    /// `\s*(?:#.*)?$` — tutarsa eşleşmenin sonu. Açgözlü `\s*` önce en uzun boşluğu dener: ardından
    /// metin sonu ya da `#` gelirse orada, gelmezse boşluk içindeki SON satır sonunda biter.
    fn tail(&self, from: usize) -> Option<usize> {
        let r = self.skip_space(from);
        match self.at(r) {
            None => Some(r),
            Some('#') => {
                let mut c = r;
                while self.at(c).is_some_and(|ch| !is_line_end(ch)) {
                    c += 1;
                }
                Some(c)
            }
            Some(_) => (from..r).rev().find(|&i| is_line_end(self.s[i])),
        }
    }

    /// `q(?:\\q|[^q])*q` + kuyruk. Kapanış adayları geri izleme sırasıyla: en uzun gövdenin durduğu
    /// eşsiz `q`, sonra gövdede `\q` çifti olarak yutulan tırnaklar sondan başa.
    fn quoted(&self, open: usize, q: char) -> Option<(usize, usize)> {
        let mut paired = Vec::new();
        let mut i = open + 1;
        let first = loop {
            match self.at(i) {
                None => break None,
                Some('\\') if self.at(i + 1) == Some(q) => {
                    paired.push(i + 1);
                    i += 2;
                }
                Some(c) if c == q => break Some(i),
                Some(_) => i += 1,
            }
        };
        first.into_iter().chain(paired.into_iter().rev()).find_map(|e| self.tail(e + 1).map(|end| (e, end)))
    }

    /// Değer grubu + kuyruk; ilk tutan seçenek: tırnaklı (`'` `"` `` ` ``) → tırnaksız → değersiz.
    /// Tırnaksız ve değersiz seçenekte kuyruk her zaman tutar (sonraki karakter `#`, satır sonu ya da
    /// metin sonu) — bu yüzden ayırıcıdan sonraki tembel boşluk hiç uzamaz.
    fn value(&self, vs: usize) -> (Option<(usize, usize)>, usize) {
        let a = self.skip_space(vs);
        if let Some(q @ ('\'' | '"' | '`')) = self.at(a) {
            if let Some((e, end)) = self.quoted(a, q) {
                return (Some((vs, e + 1)), end);
            }
        }
        let mut u = vs;
        while self.at(u).is_some_and(|c| !matches!(c, '#' | '\r' | '\n')) {
            u += 1;
        }
        if u > vs {
            return (Some((vs, u)), self.tail(u).unwrap_or(u));
        }
        (None, self.tail(vs).unwrap_or(vs))
    }

    /// `([\w.-]+)(?:\s*=\s*?|:\s+?)` + değer: anahtar hep en uzunudur (kısalırsa ardından anahtar
    /// karakteri gelir, ayırıcı tutmaz); `:` biçiminde tam bir boşluk yutulur.
    fn after_prefix(&self, k0: usize) -> Option<Match> {
        let mut k1 = k0;
        while self.at(k1).is_some_and(is_key_char) {
            k1 += 1;
        }
        if k1 == k0 {
            return None;
        }
        let w = self.skip_space(k1);
        let vs = if self.at(w) == Some('=') {
            w + 1
        } else if self.at(k1) == Some(':') && self.at(k1 + 1).is_some_and(is_space) {
            k1 + 2
        } else {
            return None;
        };
        let (value, end) = self.value(vs);
        Some(Match { key: (k0, k1), value, end })
    }

    /// `(?:export\s+)?` önce alınarak denenir, tutmazsa `export` anahtarın kendisi olabilir.
    fn attempt(&self, p1: usize) -> Option<Match> {
        let export = ['e', 'x', 'p', 'o', 'r', 't'];
        if self.s.get(p1..p1 + 6) == Some(&export[..]) && self.at(p1 + 6).is_some_and(is_space) {
            if let Some(m) = self.after_prefix(self.skip_space(p1 + 6)) {
                return Some(m);
            }
        }
        self.after_prefix(p1)
    }
}

/// `/\r\n?/g` → `\n`.
fn normalize(text: &str) -> Vec<char> {
    let mut out = Vec::with_capacity(text.len());
    let mut it = text.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\r' {
            it.next_if_eq(&'\n');
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

fn js_trim(v: &[char]) -> &[char] {
    let start = v.iter().position(|c| !is_space(*c)).unwrap_or(v.len());
    let end = v.iter().rposition(|c| !is_space(*c)).map_or(start, |i| i + 1);
    &v[start..end]
}

/// `replace(/^(['"`])([\s\S]*)\1$/mg, '$2')`: satır başındaki tırnak, aynı türün kendisinden sonra
/// satır sonu ya da metin sonu gelen SON örneğiyle kapanır (açgözlü gövde), eşleşmeler sırayla.
fn strip_quotes(v: &[char]) -> Vec<char> {
    let n = v.len();
    let last_close = |q: char| (0..n).rev().find(|&e| v[e] == q && v.get(e + 1).copied().is_none_or(is_line_end));
    let closes = [('\'', last_close('\'')), ('"', last_close('"')), ('`', last_close('`'))];
    let mut out = Vec::with_capacity(n);
    let (mut pos, mut s) = (0, 0);
    while s < n {
        let at_line_start = s == 0 || is_line_end(v[s - 1]);
        let close = closes.iter().find(|(q, _)| *q == v[s]).and_then(|(_, e)| *e).filter(|&e| e > s);
        if let (true, Some(e)) = (at_line_start, close) {
            out.extend_from_slice(&v[pos..s]);
            out.extend_from_slice(&v[s + 1..e]);
            pos = e + 1;
            s = e + 1;
        } else {
            s += 1;
        }
    }
    out.extend_from_slice(&v[pos..]);
    out
}

/// Yalnız çift tırnakla BAŞLAYAN değerde `\n` → LF, `\r` → CR; başka kaçış yoktur (`\\`, `\"`, `\t`
/// olduğu gibi kalır — Windows yolu `"C:\yol"` hatasız okunur, `"C:\new"` ise satır sonu içerir).
fn expand(v: &[char]) -> String {
    let mut out = String::with_capacity(v.len());
    let mut i = 0;
    while i < v.len() {
        match (v[i], v.get(i + 1)) {
            ('\\', Some('n')) => {
                out.push('\n');
                i += 2;
            }
            ('\\', Some('r')) => {
                out.push('\r');
                i += 2;
            }
            (c, _) => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}

fn finish(raw: &[char]) -> String {
    let v = js_trim(raw);
    let stripped = strip_quotes(v);
    if v.first() == Some(&'"') {
        expand(&stripped)
    } else {
        stripped.into_iter().collect()
    }
}

/// dotenv `parse` aynası — içerikten hata doğmaz.
pub fn parse(text: &str) -> EnvFile {
    let s = normalize(text);
    let scan = Scan { s: &s };
    let mut out = EnvFile::default();
    // anahtar → (pairs konumu, tekrar bildirildi mi)
    let mut index: HashMap<String, (usize, bool)> = HashMap::new();
    let mut p = 0;
    while p < s.len() {
        if !scan.line_start(p) {
            p += 1;
            continue;
        }
        let p1 = scan.skip_space(p);
        let Some(m) = scan.attempt(p1) else {
            // p..=p1 arasındaki her satır başı aynı `p1`e varır ve aynı yerde düşer.
            p = p1 + 1;
            continue;
        };
        let key: String = s[m.key.0..m.key.1].iter().collect();
        let value = m.value.map_or_else(String::new, |(a, b)| finish(&s[a..b]));
        p = m.end;
        // JS: `obj["__proto__"] = "dize"` hiçbir şey atamaz.
        if key == "__proto__" {
            continue;
        }
        match index.get_mut(&key) {
            Some((i, reported)) => {
                out.pairs[*i].1 = value;
                if !*reported {
                    *reported = true;
                    out.duplicates.push(key);
                }
            }
            None => {
                index.insert(key.clone(), (out.pairs.len(), false));
                out.pairs.push((key, value));
            }
        }
    }
    out
}

/// Dosya baytları: Node'un `readFileSync(yol, "utf8")`u gibi geçersiz dizi U+FFFD olur, BOM kalır.
pub fn parse_bytes(bytes: &[u8]) -> EnvFile {
    parse(&String::from_utf8_lossy(bytes))
}

pub fn read(path: &Path) -> Result<EnvFile, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{} okunamadı: {e}", path.display()))?;
    Ok(parse_bytes(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(text: &str) -> Vec<(String, String)> {
        let mut v = parse(text).pairs;
        v.sort();
        v
    }

    fn kv(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut v: Vec<(String, String)> = pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        v.sort();
        v
    }

    #[test]
    fn duplicate_keeps_first_position_last_value() {
        let d = parse("A=1\nB=2\nA=3\n");
        assert_eq!(d.pairs, vec![("A".to_string(), "3".to_string()), ("B".to_string(), "2".to_string())]);
        assert_eq!(d.duplicates, vec!["A".to_string()]);
        assert_eq!(d.get("A"), Some("3"));
    }

    #[test]
    fn never_fails_on_content() {
        // Eski katı okuyucunun reddettiği her biçim dotenv'de bir sonuç verir (vektörlerde ayrıntı).
        assert_eq!(map("Q=\"C:\\yol\""), kv(&[("Q", "C:\\yol")]));
        assert_eq!(map("K: v"), kv(&[("K", "v")]));
        assert_eq!(map("1ABC=x\nsatirsiz\nGIZLI=\"sir"), kv(&[("1ABC", "x"), ("GIZLI", "\"sir")]));
        assert_eq!(map("P=abc#def"), kv(&[("P", "abc")]));
        assert!(parse("").pairs.is_empty());
        assert!(parse_bytes(&[0xff, b'=', 0xfe]).pairs.is_empty());
    }

    #[test]
    fn empty_value_is_absent_for_get() {
        let d = parse("A=\nB=''\n");
        assert_eq!(d.pairs.len(), 2);
        assert_eq!((d.get("A"), d.get("B")), (None, None));
    }

    #[test]
    fn pathological_input_is_linear_enough() {
        // 256 KiB tavanında geri izleme patlamaz (güncelleyici dosyayı her turda okur).
        for unit in ["\n", "K=\"\\\"", "A=\n'", " ", "K:\n", "export \n", "\"\\\""] {
            let text = unit.repeat(256 * 1024 / unit.len());
            let t = std::time::Instant::now();
            let _ = parse(&text);
            assert!(t.elapsed() < std::time::Duration::from_secs(5), "{unit:?}: {:?}", t.elapsed());
        }
    }
}
