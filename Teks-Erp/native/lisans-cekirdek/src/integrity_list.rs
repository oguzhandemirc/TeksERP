//! Bütünlük LİSTE DOSYASI (`butunluk-liste.txt`) + kapsam yürüyüşü — TS aynası
//! `lib/license/integrity-list.ts`. İmzalı yük yalnız listenin boyunu + sha256'sını taşır; liste
//! kanonik ve satır tabanlıdır (`<sha256>\t<boyut>\t<yol>\n`, yollar bayt sırasıyla kesin artan).
use regex::Regex;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// TS `INTEGRITY_LIST_FILE` aynası (kâhin ölçer).
pub const LIST_FILE: &str = "butunluk-liste.txt";
pub const MAX_FILES: usize = 200_000;
pub const MAX_LIST_BYTES: u64 = 64 * 1024 * 1024;
pub const PATH_MAX: usize = 512;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub struct Entry {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

struct Patterns {
    line: Regex,
    path: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        line: Regex::new(r"^([A-Za-z0-9_-]{43})\t(0|[1-9][0-9]{0,15})\t([\x20-\x7E]+)$").expect("liste satırı"),
        path: Regex::new(
            r"^[\x20\x21\x23-\x29\x2B-\x2E\x30-\x39\x3B\x3D\x40-\x5B\x5D-\x7B\x7D\x7E]+(?:/[\x20\x21\x23-\x29\x2B-\x2E\x30-\x39\x3B\x3D\x40-\x5B\x5D-\x7B\x7D\x7E]+)*$",
        )
        .expect("liste yolu"),
    })
}

/// Liste yolu: göreli POSIX, yazdırılabilir ASCII (`/ \ : * ? " < > |` hariç), `.`/`..` yok, ≤ 512.
pub fn is_list_path(p: &str) -> bool {
    p.len() <= PATH_MAX && patterns().path.is_match(p) && p.split('/').all(|s| s != "." && s != "..")
}

/// Kanonik listeyi ayrıştırır; satır sayısı imzalı `dosyaSayisi`na eşit olmalı. Biçimsizse `None`.
pub fn parse(bytes: &[u8], expected: usize) -> Option<Vec<Entry>> {
    if bytes.last() != Some(&b'\n') {
        return None;
    }
    if bytes.iter().any(|&c| c != 0x09 && c != 0x0a && !(0x20..=0x7e).contains(&c)) {
        return None;
    }
    let text = std::str::from_utf8(&bytes[..bytes.len() - 1]).ok()?;
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.len() != expected || lines.len() > MAX_FILES {
        return None;
    }
    let mut out: Vec<Entry> = Vec::with_capacity(lines.len());
    for line in lines {
        let c = patterns().line.captures(line)?;
        let size: u64 = c.get(2)?.as_str().parse().ok()?;
        let path = c.get(3)?.as_str();
        if size > MAX_SAFE_INTEGER || !is_list_path(path) {
            return None;
        }
        if out.last().is_some_and(|prev| prev.path.as_bytes() >= path.as_bytes()) {
            return None;
        }
        out.push(Entry { path: path.to_string(), sha256: c.get(1)?.as_str().to_string(), size });
    }
    Some(out)
}

pub fn join(root: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(root.to_path_buf(), |acc, seg| acc.join(seg))
}

#[derive(Default)]
pub struct Walk {
    /// Kapsamda diskte duran her girdi (sembolik bağ İZLENMEZ, kendisi girdi sayılır).
    pub entries: Vec<String>,
    /// İçi görülemeyen dizinler (fazla dosya gizlenebilir).
    pub unreadable: Vec<String>,
}

fn walk_dir(root: &Path, rel: &str, out: &mut Walk) {
    let Ok(dir) = std::fs::read_dir(join(root, rel)) else {
        out.unreadable.push(rel.to_string());
        return;
    };
    for item in dir {
        let Ok(e) = item else {
            out.unreadable.push(rel.to_string());
            continue;
        };
        let child = format!("{rel}/{}", e.file_name().to_string_lossy());
        match e.file_type() {
            Ok(t) if t.is_dir() => walk_dir(root, &child, out),
            Ok(_) => out.entries.push(child),
            Err(_) => out.unreadable.push(child),
        }
    }
}

/// Kapsam dizinlerinin altındaki + kapsam dosyalarından diskte olan her girdi (bayt sırasıyla, tekrarsız).
pub fn walk_scope(root: &Path, dirs: &[String], files: &[String]) -> Walk {
    let mut out = Walk::default();
    for rel in dirs.iter().chain(files.iter()) {
        match std::fs::symlink_metadata(join(root, rel)) {
            Err(e) if matches!(e.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory) => {}
            Err(_) => out.unreadable.push(rel.clone()),
            Ok(m) if m.is_dir() => {
                if dirs.contains(rel) {
                    walk_dir(root, rel, &mut out);
                }
            }
            Ok(_) => out.entries.push(rel.clone()),
        }
    }
    for list in [&mut out.entries, &mut out.unreadable] {
        list.sort();
        list.dedup();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walk_does_not_follow_symlinks_and_skips_missing_scope() {
        let dir = std::env::temp_dir().join(format!("lisans-yuruyus-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("dist/alt")).expect("dizin");
        std::fs::create_dir_all(dir.join("dis/gizli")).expect("dizin");
        std::fs::write(dir.join("dist/a.js"), b"a").expect("dosya");
        std::fs::write(dir.join("dis/gizli/b.js"), b"b").expect("dosya");
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("dis"), dir.join("dist/bag")).expect("bag");
        let w = walk_scope(&dir, &["dist".into(), "yok".into()], &["package.json".into()]);
        #[cfg(unix)]
        assert_eq!(w.entries, vec!["dist/a.js".to_string(), "dist/bag".to_string()]);
        #[cfg(not(unix))]
        assert_eq!(w.entries, vec!["dist/a.js".to_string()]);
        assert!(w.unreadable.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_rejects_non_canonical_lists() {
        let s = "A".repeat(43);
        assert!(parse(format!("{s}\t1\ta b/c.js\n").as_bytes(), 1).is_some());
        assert!(parse(format!("{s}\t1\tb.js\n{s}\t1\ta.js\n").as_bytes(), 2).is_none());
        assert!(parse(format!("{s}\t1\ta.js\n").as_bytes(), 2).is_none());
        assert!(parse(b"", 0).is_none());
    }
}
