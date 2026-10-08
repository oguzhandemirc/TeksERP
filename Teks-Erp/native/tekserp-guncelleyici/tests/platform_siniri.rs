//! Platform sınırı (`docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.1, dilim L1): çekirdek iki arka ucu tanımaz —
//! derleme hedefi koşulu (`#[cfg]`/`cfg!`) ve işletim sistemi bağları yalnız `src/platform/` altında durur; başka
//! arka ucun işlem günlüğü ne sürdürülür ne geri alınır.
mod common;

use common::eski_bicim::{files_under, vectors_dir};
use common::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Hedef koşulu sayılan `cfg` yüklemleri (`test` · `feature` serbest).
const TARGET_PREDICATES: &[&str] = &["windows", "unix", "target_os", "target_family", "target_env", "target_vendor"];
/// Çekirdeğe girmeyen işletim sistemi bağları ve arka uç modülleri (çekirdek `platform::` cephesinden geçer).
const FORBIDDEN_TOKENS: &[&str] = &[
    "windows_sys",
    "windows_service",
    "std::os::windows",
    "std::os::unix",
    "junction::",
    "tekserp_hizmet::windows",
    "platform::windows",
    "platform::linux",
];

/// `cfg(`/`cfg!(` yüklemlerinin gövdeleri (parantez dengeli).
fn cfg_predicates(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = code;
    while let Some(i) = rest.find("cfg") {
        let after = &rest[i + 3..];
        let after = after.strip_prefix('!').or_else(|| after.strip_prefix("_attr")).unwrap_or(after).trim_start();
        let prev_ident = rest[..i].chars().last().is_some_and(|c| c.is_alphanumeric() || c == '_');
        if after.starts_with('(') && !prev_ident {
            let mut depth = 0usize;
            let mut end = after.len();
            for (j, ch) in after.char_indices() {
                match ch {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            end = j + 1;
                            break;
                        }
                    }
                    _ => {}
                }
            }
            out.push(after[..end].to_string());
        }
        rest = &rest[i + 3..];
    }
    out
}

/// Bir kaynağın sınır ihlalleri (yorum satırları sayılmaz).
fn violations(source: &str) -> Vec<String> {
    let code: String = source.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    let mut out: Vec<String> = cfg_predicates(&code)
        .into_iter()
        .filter(|p| {
            TARGET_PREDICATES.iter().any(|t| {
                p.match_indices(t).any(|(i, _)| {
                    let before = p[..i].chars().last();
                    let after = p[i + t.len()..].chars().next();
                    !before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '"')
                        && !after.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '"')
                })
            })
        })
        .map(|p| format!("hedef koşulu cfg{p}"))
        .collect();
    out.extend(FORBIDDEN_TOKENS.iter().filter(|t| code.contains(*t)).map(|t| format!("`{t}`")));
    out
}

fn src() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "rs") {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

/// Bekçi: çekirdek modüllerde (`src/` − `src/platform/`, `main.rs` dahil) hedef koşulu ve işletim sistemi bağı yok.
#[test]
fn test_guncelleyici_platform_siniri() {
    let platform = src().join("platform");
    let (core, own): (Vec<PathBuf>, Vec<PathBuf>) = rust_files(&src()).into_iter().partition(|p| !p.starts_with(&platform));
    assert!(core.len() >= 25, "çekirdek taranmadı: {} dosya", core.len());
    let mut bad = Vec::new();
    for p in &core {
        for v in violations(&std::fs::read_to_string(p).unwrap()) {
            bad.push(format!("{}: {v}", p.strip_prefix(src()).unwrap().display()));
        }
    }
    assert!(bad.is_empty(), "platform sınırı delindi — bunlar `src/platform/` altına:\n{}", bad.join("\n"));
    // Tarayıcı gerçek ihlali görür: platform ağacı hedef koşulu taşır (görmüyorsa bekçi kördür).
    let seen: usize = own.iter().map(|p| violations(&std::fs::read_to_string(p).unwrap()).len()).sum();
    assert!(seen >= 10, "tarayıcı platform ağacındaki cfg'leri görmüyor ({seen})");
}

/// Negatif sondalar: her ihlal biçimi kırmızı, serbest yüklemler yeşil.
#[test]
fn platform_siniri_sondalari() {
    for bad in [
        "#[cfg(windows)]\nfn a() {}",
        "fn a() { if cfg!(windows) {} }",
        "#[cfg(not(unix))]\nfn a() {}",
        "#[cfg(any(target_os = \"linux\", test))]\nfn a() {}",
        "#[cfg(all(test, target_family = \"windows\"))]\nfn a() {}",
        "use windows_sys::Win32::Foundation::HANDLE;",
        "fn a() { crate::platform::windows::arka_ucu(); }",
        "use std::os::unix::fs::PermissionsExt;",
        "#[cfg_attr(windows, allow(dead_code))]\nfn a() {}",
    ] {
        assert!(!violations(bad).is_empty(), "sonda yeşil kaldı:\n{bad}");
    }
    for ok in [
        "#[cfg(test)]\nmod tests {}",
        "#[cfg(feature = \"test-anchor\")]\nfn a() {}",
        "pub const TEST_ANCHOR: bool = cfg!(feature = \"test-anchor\");",
        "// #[cfg(windows)] yorumda anılabilir\nfn a() {}",
        "fn a() { crate::platform::executable(\"psql\"); }",
        "#[cfg(feature = \"windows_x\")]\nfn a() {}",
    ] {
        assert!(violations(ok).is_empty(), "temiz kaynak kırmızı: {ok} → {:?}", violations(ok));
    }
}

/// Başka arka ucun (burada Linux) yarım işlem günlüğü: sürdürülmez, geri alınmaz, günlüğe tek bayt yazılmaz,
/// hizmete dokunulmaz; durum HATA (insan) + `IC_HATA`. Her turda aynı.
#[test]
fn yabanci_platform_gunlugu_dokunulmaz() {
    let p = files_under(&vectors_dir().join("guncelleyici-gunluk"))
        .into_iter()
        .find(|p| {
            let s = p.to_string_lossy().replace('\\', "/");
            s.contains("/0.1.3-backend-v2.14.0/basarili/") && s.ends_with("-bitti-goc.json")
        })
        .expect("BITTI GOC vektörü");
    let doc: Value = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
    let w = World::from_vector("yabanci-platform", &doc);
    let file = w.layout.journal_file();
    let text = std::fs::read_to_string(&file).unwrap();
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let mut begin: Value = serde_json::from_str(&lines[0]).unwrap();
    assert_eq!(begin["olay"], "ISLEM");
    begin["platform"] = Value::String("linux-x64-oci".into());
    lines[0] = begin.to_string();
    let foreign = lines.join("\n") + "\n";
    std::fs::write(&file, &foreign).unwrap();
    let (svc_before, current_before) = (format!("{:?}", w.backend()), w.current());
    for tur in 0..2 {
        w.run(3).unwrap_or_else(|_| panic!("ölüm enjeksiyonu yok"));
        let st = w.status().expect("durum.json");
        assert_eq!(format!("{:?}", st.state), "Failed", "tur {tur}: {:?}", st.message);
        assert_eq!(st.error_code.as_deref(), Some("IC_HATA"), "tur {tur}");
        assert!(st.message.as_deref().is_some_and(|m| m.contains("linux-x64-oci")), "tur {tur}: {:?}", st.message);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), foreign, "tur {tur}: günlüğe yazıldı");
        assert_eq!(
            (format!("{:?}", w.backend()), w.current()),
            (svc_before.clone(), current_before.clone()),
            "tur {tur}: dünyaya dokunuldu"
        );
    }
}
