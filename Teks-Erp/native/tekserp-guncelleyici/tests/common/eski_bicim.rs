//! Eski biçim vektörlerinin okuyucusu (`docs/design/GUNCELLEYICI.md` §15): günlük vektörünün dünyasını sahte
//! dünyaya kurar. Vektör biçimi (`v: 1`) DONMUŞTUR — üretici `tests/gunluk_vektoru_uret.rs`, okuyucu burası;
//! bu dosya yeni alan tanıyabilir ama bir alanı yorumlamaktan VAZGEÇEMEZ (eski vektörler sonsuza dek okunur).
use super::*;

pub const PLACEHOLDER: &str = "{{DUNYA}}";

pub fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("test-vektorleri")
}

/// `dir` altındaki bütün dosyalar (özyinelemeli, sıralı).
pub fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            out.extend(files_under(&p));
        } else {
            out.push(p);
        }
    }
    out
}

/// Sahte sürümün sıkışmayan dolgusu (`version_files` `dist/buyuk.bin`).
pub fn filler(n: usize) -> Vec<u8> {
    (0..n as u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect()
}

/// `{{DUNYA}}/a/b` → bu makinedeki dünya yolu (platformun ayracıyla); `json` ise JSON dizgisine kaçışlı.
pub fn materialize(text: &str, dir: &Path, json: bool) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find(PLACEHOLDER) {
        out.push_str(&rest[..at]);
        let tail = &rest[at + PLACEHOLDER.len()..];
        let end = tail.find(|c: char| c == '"' || c.is_whitespace()).unwrap_or(tail.len());
        let mut p = dir.to_path_buf();
        for part in tail[..end].split('/').filter(|x| !x.is_empty()) {
            p.push(part);
        }
        let s = p.to_string_lossy().into_owned();
        if json {
            let q = serde_json::to_string(&s).unwrap();
            out.push_str(&q[1..q.len() - 1]);
        } else {
            out.push_str(&s);
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

fn join_rel(dir: &Path, rel: &str) -> PathBuf {
    let mut p = dir.to_path_buf();
    for part in rel.split('/') {
        p.push(part);
    }
    p
}

fn svc_state(s: &str) -> SvcState {
    match s {
        "Missing" => SvcState::Missing,
        "Stopped" => SvcState::Stopped,
        "Starting" => SvcState::Starting,
        "Running" => SvcState::Running,
        "Stopping" => SvcState::Stopping,
        "Other" => SvcState::Other,
        x => panic!("vektörde tanınmayan hizmet durumu {x}"),
    }
}

impl World {
    /// Günlük vektörünün (`dunya`) dünyası: varsayılan dünya kurulur, diski ve bellek durumu vektörünkiyle DEĞİŞTİRİLİR.
    pub fn from_vector(tag: &str, doc: &Value) -> World {
        assert_eq!(doc["v"], 1, "tanınmayan vektör biçimi");
        let w = World::new(tag, Setup::default());
        let d = &doc["dunya"];
        for top in ["kok", "programdata"] {
            let _ = std::fs::remove_dir_all(w.dir.join(top));
        }
        for rel in d["dizinler"].as_array().unwrap() {
            std::fs::create_dir_all(join_rel(&w.dir, rel.as_str().unwrap())).unwrap();
        }
        for (rel, f) in d["dosyalar"].as_object().unwrap() {
            let path = join_rel(&w.dir, rel);
            let bytes = if let Some(t) = f["metin"].as_str() {
                materialize(t, &w.dir, rel.ends_with(".json") || rel.ends_with(".jsonl")).into_bytes()
            } else if f["dolgu"] == "carpim" {
                let b = filler(usize::try_from(f["boy"].as_u64().unwrap()).unwrap());
                assert_eq!(f["sha256"].as_str(), Some(sha_hex(&b).as_str()), "{rel}: dolgu özeti tutmuyor");
                b
            } else if let Some(b) = f["b64"].as_str() {
                tekserp_dogrulama::b64::decode_strict(b).unwrap_or_else(|| panic!("{rel}: b64 biçimsiz"))
            } else {
                panic!("{rel}: tanınmayan dosya kaydı {f}");
            };
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        for (rel, target) in d["baglantilar"].as_object().unwrap() {
            RealFs.set_link(&join_rel(&w.dir, rel), &join_rel(&w.dir, target.as_str().unwrap())).unwrap();
        }
        let mut svcs = HashMap::new();
        for (name, s) in d["hizmetler"].as_object().unwrap() {
            svcs.insert(
                name.clone(),
                Svc {
                    state: svc_state(s["durum"].as_str().unwrap()),
                    args: serde_json::from_value(s["argumanlar"].clone()).unwrap(),
                    version: s["surum"].as_str().map(str::to_string),
                    image: materialize(s["imaj"].as_str().unwrap(), &w.dir, false),
                    starts: s["baslatma"].as_u64().unwrap(),
                    crash: s["cokme"].as_u64().map(|c| u32::try_from(c).unwrap()),
                    restart_at: s["yenidenBaslatma"].as_i64(),
                },
            );
        }
        *w.svcs.lock().unwrap() = svcs;
        *w.db.lock().unwrap() = serde_json::from_value(d["db"].clone()).unwrap();
        w.clock.store(d["saat"].as_i64().unwrap(), Ordering::SeqCst);
        *w.backend_name.lock().unwrap() = d["backendHizmeti"].as_str().unwrap().to_string();
        for (k, v) in doc["arizalar"].as_object().unwrap() {
            match k.as_str() {
                "sagliksizSurum" => *w.faults.unhealthy_version.lock().unwrap() = Some(v.as_str().unwrap().into()),
                "gocDuser" => w.faults.migrate_fails.store(v.as_bool().unwrap(), Ordering::SeqCst),
                x => panic!("vektörde tanınmayan arıza {x} — sahte dünyaya eklenmeden vektör okunamaz"),
            }
        }
        w
    }
}
