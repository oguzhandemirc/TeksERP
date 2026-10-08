//! Eski biçim işlem günlüğü vektörlerinin ÜRETİCİSİ (`docs/design/GUNCELLEYICI.md` §14.3). Sahte dünyada bir
//! güncellemeyi her değiştiren noktada öldürür; yarım işlemi ve dünyanın o anki hâlini tek JSON'a döker, sonra
//! AYNI ikilinin kendi sürdürmesinin sonucunu (`eskiSonuc`) ekler. Varsayılan koşumda hiçbir şey yazmaz.
//!
//! Üretim (yalnız yeni bir güncelleyici sürümü yayınlandığında; hedef klasör VARSA durur — vektör ezilmez):
//!   TEKSERP_GUNLUK_VEKTOR_YAZ=<etiket> cargo test -p tekserp-guncelleyici --test gunluk_vektoru_uret -- --nocapture
//! Eski sürümün vektörü o sürümün git etiketinde üretilir: etiketin worktree'sine bu dosya kopyalanır ve koşulur
//! (dosya yalnız `tests/common`in o etikette de var olan yüzünü kullanır).
mod common;

use common::*;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

const ENV: &str = "TEKSERP_GUNLUK_VEKTOR_YAZ";
const YER_TUTUCU: &str = "{{DUNYA}}";

/// Günlüğün tam satırlarının (olay, adım) dizisi.
type Imza = Vec<(String, String)>;

struct Senaryo {
    ad: &'static str,
    ariza: fn(&World),
    arizalar: Value,
}

fn senaryolar() -> Vec<Senaryo> {
    vec![
        Senaryo { ad: "basarili", ariza: |_| {}, arizalar: json!({}) },
        Senaryo {
            ad: "saglik-geri-donus",
            ariza: |w| *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into()),
            arizalar: json!({ "sagliksizSurum": NEW }),
        },
        Senaryo {
            ad: "goc-hatasi",
            ariza: |w| w.faults.migrate_fails.store(true, Ordering::SeqCst),
            arizalar: json!({ "gocDuser": true }),
        },
    ]
}

fn rel(w: &World, p: &Path) -> String {
    p.strip_prefix(&w.dir).unwrap().components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

fn walk_all(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        let m = std::fs::symlink_metadata(&p).unwrap();
        if m.is_dir() && !m.file_type().is_symlink() {
            out.push(p.clone());
            walk_all(&p, out);
        } else {
            out.push(p);
        }
    }
}

fn filler(n: usize) -> Vec<u8> {
    (0..n as u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect()
}

/// Dünyanın diskteki ve bellekteki hâli: dosyalar (dünya kökü yer tutucuyla) · bağlantılar · dizinler · hizmet/DB/saat.
fn snapshot(w: &World) -> Value {
    let root = w.dir.to_string_lossy().into_owned();
    let mut files = Map::new();
    let mut links = Map::new();
    let mut dirs = vec![];
    let mut all = vec![];
    walk_all(&w.dir, &mut all);
    for p in all {
        let m = std::fs::symlink_metadata(&p).unwrap();
        let r = rel(w, &p);
        if m.file_type().is_symlink() {
            let t = std::fs::read_link(&p).unwrap();
            let t = if t.is_absolute() { rel(w, &t) } else { t.to_string_lossy().into_owned() };
            links.insert(r, Value::String(t));
        } else if m.is_dir() {
            dirs.push(Value::String(r));
        } else {
            let b = std::fs::read(&p).unwrap();
            let v = match String::from_utf8(b.clone()) {
                Ok(s) => json!({ "metin": s.replace(&root, YER_TUTUCU) }),
                // Sahte sürümün sıkışmayan dolgusu (`version_files` `dist/buyuk.bin`): içerik değil formül + özet saklanır.
                Err(_) if b == filler(b.len()) => json!({ "dolgu": "carpim", "boy": b.len(), "sha256": sha_hex(&b) }),
                Err(_) => json!({ "b64": tekserp_dogrulama::b64::encode(&b) }),
            };
            files.insert(r, v);
        }
    }
    let svcs: BTreeMap<String, Value> = w
        .svcs
        .lock()
        .unwrap()
        .iter()
        .map(|(k, s)| {
            (
                k.clone(),
                json!({
                    "durum": format!("{:?}", s.state), "argumanlar": s.args, "surum": s.version,
                    "imaj": s.image.replace(&root, YER_TUTUCU), "baslatma": s.starts, "cokme": s.crash, "yenidenBaslatma": s.restart_at,
                }),
            )
        })
        .collect();
    json!({
        "saat": w.clock.load(Ordering::SeqCst),
        "db": w.db(),
        "backendHizmeti": *w.backend_name.lock().unwrap(),
        "hizmetler": svcs,
        "dizinler": dirs,
        "baglantilar": links,
        "dosyalar": files,
    })
}

/// Günlüğün TAM satırlarının (olay, adım) imzası + yırtık son satır var mı; yarım işlem yoksa `None`.
fn signature(w: &World) -> Option<(Imza, bool, String, String)> {
    let bytes = std::fs::read(w.layout.journal_file()).ok()?;
    let mut sig = vec![];
    let mut torn = false;
    for line in bytes.split_inclusive(|b| *b == b'\n') {
        let parsed = line.ends_with(b"\n").then(|| serde_json::from_slice::<Value>(&line[..line.len() - 1]).ok()).flatten();
        match parsed {
            Some(v) => sig.push((v["olay"].as_str().unwrap_or_default().to_string(), v["adim"].as_str().unwrap_or_default().to_string())),
            None => torn = true,
        }
    }
    let begin = sig.iter().rposition(|(o, _)| o == "ISLEM")?;
    let op = sig[begin..].to_vec();
    if op.iter().any(|(o, _)| o == "SONUC") {
        return None;
    }
    let (olay, adim) = op.last().cloned().unwrap();
    Some((op, torn, olay, adim))
}

#[test]
fn uret() {
    let Ok(etiket) = std::env::var(ENV) else { return };
    assert!(!etiket.is_empty() && etiket.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')), "etiket biçimsiz");
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri").join("guncelleyici-gunluk").join(&etiket);
    assert!(!out.exists(), "{} zaten var — vektör ezilmez, yeni etiket seçin", out.display());
    let kaynak = json!({
        "guncelleyici": env!("CARGO_PKG_VERSION"),
        "etiket": etiket,
        "commit": std::env::var("TEKSERP_GUNLUK_VEKTOR_COMMIT").unwrap_or_default(),
    });
    let mut written = 0;
    let mut seen = std::collections::BTreeSet::new();
    for s in senaryolar() {
        let make = |tag: &str| {
            let w = World::new(tag, Setup::default());
            (s.ariza)(&w);
            w
        };
        let points = make("vsayac").count_points();
        // Aynı imza (günlüğün tam satırları + yırtık mı) için ilk ve son nokta: adımın başı ve sonu farklı dünya.
        let mut chosen: BTreeMap<(Imza, bool), Vec<u64>> = BTreeMap::new();
        let mut info: BTreeMap<(u64, bool), (String, String, String)> = BTreeMap::new();
        for torn in [false, true] {
            for k in 1..=points {
                let w = make("vtara");
                w.crash.arm(k, torn);
                if w.run(3).is_ok() {
                    continue;
                }
                let last = w.crash.log.lock().unwrap().last().cloned().unwrap_or_default();
                let Some((sig, is_torn, olay, adim)) = signature(&w) else { continue };
                if torn && !is_torn {
                    continue;
                }
                let e = chosen.entry((sig, is_torn)).or_default();
                if e.len() < 2 {
                    e.push(k);
                } else {
                    e[1] = k;
                }
                info.insert((k, torn), (olay, adim, last));
            }
        }
        // Önceki senaryoda aynı günlükle görülmüş imza tekrar yazılmaz; yırtık satır olay türü başına bir kez (tam
        // satırları aynı olan yırtıksız vektörün dünyasıyla özdeştir — yalnız atılacak yarım satırı ölçer).
        let mut picks: Vec<(u64, bool)> = vec![];
        let mut torn_kinds = std::collections::BTreeSet::new();
        let mut entries: Vec<_> = chosen.iter().collect();
        entries.sort_by_key(|(_, ks)| ks[0]);
        for ((sig, torn), ks) in entries {
            if !seen.insert((sig.clone(), *torn)) {
                continue;
            }
            if *torn {
                if torn_kinds.insert(sig.last().map(|(o, _)| o.clone()).unwrap_or_default()) {
                    picks.push((ks[0], true));
                }
            } else {
                picks.extend(ks.iter().map(|k| (*k, false)));
            }
        }
        picks.sort();
        picks.dedup();
        for (k, torn) in picks {
            let w = make("vyaz");
            w.crash.arm(k, torn);
            assert!(w.run(3).is_err(), "nokta {k}: ölüm yok");
            w.crash.disarm();
            let (olay, adim, last) = info[&(k, torn)].clone();
            let world = snapshot(&w);
            w.run_to_rest(4);
            assert_invariants(&w, &format!("{} nokta {k}", s.ad));
            let st = w.status().unwrap();
            let doc = json!({
                "v": 1,
                "kaynak": kaynak,
                "senaryo": s.ad,
                "arizalar": s.arizalar,
                "oldurme": { "nokta": k, "yirtik": torn, "olay": olay, "adim": adim, "sonCagri": last },
                "eskiSonuc": { "durum": format!("{:?}", st.state), "hataKodu": st.error_code },
                "dunya": world,
            });
            let name = format!(
                "{k:03}-{}{}{}.json",
                olay.to_lowercase(),
                if adim.is_empty() { String::new() } else { format!("-{}", adim.to_lowercase()) },
                if torn { "-yirtik" } else { "" }
            );
            let dir = out.join(s.ad);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(name), serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
            written += 1;
        }
    }
    eprintln!("{written} vektör yazıldı → {}", out.display());
}
