//! Bekçi `tani_paketi_sir_tasimaz` (`GUNCELLEYICI-SAGLAMLIK.md` §7 W4): sahte dünyanın her köşesine bilinen sırlar
//! konur (`.env` değerleri · bağlantı dizesi parolası · vekil parolası · ayar parolası · niyet belirteci · lisans
//! belgeleri · yedek · geçici anahtar · günlük/durum/geçmiş/işlem satırları · platform ölçümü), paket üretilir ve
//! sırlar hem zip baytlarında hem AÇILMIŞ her girdide aranır. İkinci sonda: tarayıcı sıkıştırılmış girdideki
//! sırrı görür (kör tarayıcı yeşil vermez).
use std::io::Read;
use std::path::{Path, PathBuf};
use tekserp_guncelleyici::env::RealFs;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::tani::{self, Olcum};

const KUNYE: &str = r#"{"ad":"tekserp-guncelleyici","surum":"0.0.0-test","hedef":"test"}"#;

fn b64(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

fn jws(typ: &str, payload: &str, sig_seed: u8) -> String {
    let h = format!(r#"{{"alg":"EdDSA","typ":"{typ}","kid":"kok-test1"}}"#);
    format!("{}.{}.{}", b64(h.as_bytes()), b64(payload.as_bytes()), b64(&[sig_seed; 64]))
}

fn write(p: &Path, data: impl AsRef<[u8]>) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, data).unwrap();
}

struct World {
    dir: PathBuf,
    layout: Layout,
    secrets: Vec<String>,
    kira: String,
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn world(tag: &str) -> World {
    let dir = std::env::temp_dir().join(format!("tekserp-tani-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let layout = Layout::new(&dir.join("kok"), &dir.join("veri"));
    let kira = jws("tekserp-kira", r#"{"bitis":"2026-11-01T00:00:00.000Z","verilis":"2026-10-01T00:00:00.000Z"}"#, 7);
    let hak = jws("tekserp-hak", r#"{"bakimBitis":"2027-01-01T00:00:00.000Z"}"#, 9);
    let mut secrets: Vec<String> = [
        "DBSIRRI!x",
        "DBSIRRI%21x",
        "JWTSIRRI123",
        "YEDEKPGSIRRI",
        "AYARANAHTARSIRRI",
        "VEKILSIRRI",
        "AYARPAROLASIRRI",
        "BELIRTECSIRRI.abc-def",
        "DURUMSIRRI",
        "GECMISSIRRI",
        "ISLEMSIRRI",
        "KURULUMSIRRI",
        "GUNLUKSIRRI",
        "GECICIANAHTARSIRRI",
        "YEDEKICERIKSIRRI",
        "PLATFORMSIRRI",
        "PLATFORMPAROLA",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    secrets.push(kira.clone());
    secrets.push(hak.clone());
    secrets.push(kira.rsplit('.').next().unwrap().to_string());

    write(
        &layout.backend_env(),
        "PORT=4000\nDATABASE_URL=postgresql://tekserp:DBSIRRI%21x@127.0.0.1:5432/tekserp\nJWT_SECRET=JWTSIRRI123\n\
         BACKUP_PG_USER=yedekci\nBACKUP_PG_PASSWORD=YEDEKPGSIRRI\nSETTINGS_ENCRYPTION_KEY=AYARANAHTARSIRRI\n",
    );
    write(
        &layout.settings_file(),
        r#"{"guncellemeSunucusu":"https://guncelleme.example","vekil":"http://vekilci:VEKILSIRRI@10.0.0.1:3128","parola":"AYARPAROLASIRRI"}"#,
    );
    write(&layout.default_license_dir().join("kira.jws"), &kira);
    write(&layout.default_license_dir().join("hak.jws"), &hak);
    write(
        &layout.intent_file(),
        r#"{"yazildi":"2026-10-09T00:00:00.000Z","indirme":{"belirtec":"BELIRTECSIRRI.abc-def","bitis":"2026-10-09T01:00:00.000Z"},"onay":{"onayId":"o1","surum":"1.2.3"}}"#,
    );
    write(&layout.status_file(), r#"{"durum":"HATA","mesaj":"göç düştü: postgresql://tekserp:DURUMSIRRI@h:5432/db"}"#);
    write(&layout.history_file(), "{\"sonuc\":\"HATA\",\"mesaj\":\"PGPASSWORD=GECMISSIRRI pg_dump\"}\nbozuk satır parola: GECMISSIRRI\n");
    let mut journal = String::new();
    for i in 0..7 {
        journal.push_str(&format!(
            "{{\"sira\":{i},\"islemId\":\"op{i}\",\"olay\":\"ISLEM\",\"zaman\":\"z\",\"veri\":{{\"url\":\"postgresql://u:ISLEMSIRRI@h/d\"}}}}\n"
        ));
        journal.push_str(&format!("{{\"sira\":{i},\"islemId\":\"op{i}\",\"olay\":\"SONUC\",\"zaman\":\"z\",\"veri\":{{}}}}\n"));
    }
    write(&layout.journal_file(), journal);
    write(&layout.self_update_file(), r#"{"deneme":1}"#);
    write(&layout.work().join("ertele.json"), r#"{"1.2.3":{"sayi":2,"sonraki":1}}"#);
    write(&layout.op_keys("op1").join("yedek.key"), "GECICIANAHTARSIRRI");
    write(&layout.update_backup_dir("op1").join("db.dump"), "YEDEKICERIKSIRRI");
    let mut install = String::new();
    for i in 0..25 {
        install.push_str(&format!("{{\"satir\":{i},\"not\":\"postgresql://k:KURULUMSIRRI@h/d\"}}\n"));
    }
    write(&layout.install_history(), install);
    write(
        &layout.log_dir().join("guncelleyici.log"),
        "2026-10-09 INFO tur başladı\n2026-10-09 HATA araç: postgresql://u:GUNLUKSIRRI@h/d\n2026-10-09 HATA beklenmedik çıktı JWTSIRRI123\n",
    );
    write(&layout.version_dir("1.2.3").join("kunye.json"), "{}");
    World { dir, layout, secrets, kira }
}

fn platform() -> Vec<Olcum> {
    vec![Olcum::new("platform/docker.json", "test ölçümü", r#"{"hata":"postgresql://x:PLATFORMSIRRI@h/d","parola":"PLATFORMPAROLA"}"#)]
}

/// Zip'in her girdisi açılmış hâliyle (ad, içerik).
fn unzip(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("zip");
    (0..z.len())
        .map(|i| {
            let mut f = z.by_index(i).unwrap();
            let mut b = Vec::new();
            f.read_to_end(&mut b).unwrap();
            (f.name().to_string(), b)
        })
        .collect()
}

/// Bulunan sırlar (`yer: sır`): ham zip baytları + açılmış her girdinin adı ve içeriği.
fn leaks(zip_bytes: &[u8], secrets: &[String]) -> Vec<String> {
    let has = |hay: &[u8], s: &str| hay.windows(s.len()).any(|w| w == s.as_bytes());
    let mut out = Vec::new();
    for s in secrets {
        if has(zip_bytes, s) {
            out.push(format!("zip baytları: {s}"));
        }
        for (name, body) in unzip(zip_bytes) {
            if name.contains(s.as_str()) || has(&body, s) {
                out.push(format!("{name}: {s}"));
            }
        }
    }
    out
}

fn entry(entries: &[(String, Vec<u8>)], name: &str) -> String {
    let (_, b) = entries.iter().find(|(n, _)| n == name).unwrap_or_else(|| panic!("{name} pakette yok"));
    String::from_utf8_lossy(b).into_owned()
}

#[test]
fn tani_paketi_sir_tasimaz() {
    let w = world("sir");
    let entries = tani::collect(&RealFs, &w.layout, KUNYE, platform(), "2026-10-09T00:00:00.000Z");
    let bytes = tani::zip_bytes(&entries).expect("zip");
    let found = leaks(&bytes, &w.secrets);
    assert!(found.is_empty(), "tanı paketinde sır var:\n{}", found.join("\n"));

    // Boş paket de sırsızdır — içerik gerçekten girdi mi (sonda kör değil).
    let e = unzip(&bytes);
    for name in [
        "ICINDEKILER.txt",
        "kunye.json",
        "durum.json",
        "gecmis.jsonl",
        "islem.jsonl",
        "kendi.json",
        "ayar.json",
        "ertele.json",
        "gunluk/guncelleyici.log",
        "surumler.json",
        "kurulum-gecmisi.jsonl",
        "disk.json",
        "env-anahtarlari.txt",
        "lisans-ozeti.json",
        "niyet-ozeti.json",
        "platform/docker.json",
    ] {
        entry(&e, name);
    }
    let log = entry(&e, "gunluk/guncelleyici.log");
    assert!(log.contains("tur başladı") && log.contains("postgresql://***@h/d") && log.contains("beklenmedik çıktı ***"), "{log}");
    let env = entry(&e, "env-anahtarlari.txt");
    assert!(env.contains("JWT_SECRET") && env.contains("DATABASE_URL"), "anahtar adları girer: {env}");
    let lic = entry(&e, "lisans-ozeti.json");
    let kira_sha: String = {
        use sha2::Digest;
        sha2::Sha256::digest(w.kira.as_bytes()).iter().map(|x| format!("{x:02x}")).collect()
    };
    assert!(
        lic.contains(&kira_sha) && lic.contains("kok-test1") && lic.contains("2026-11-01T00:00:00.000Z") && lic.contains("2027-01-01"),
        "{lic}"
    );
    let niyet = entry(&e, "niyet-ozeti.json");
    assert!(niyet.contains("\"belirtecVar\": true") && niyet.contains("2026-10-09T01:00:00.000Z") && niyet.contains("1.2.3"), "{niyet}");
    let ops = entry(&e, "islem.jsonl");
    assert!(ops.contains("op6") && ops.contains("op2") && !ops.contains("\"op1\"") && !ops.contains("\"op0\""), "son 5 işlem: {ops}");
    assert_eq!(entry(&e, "kurulum-gecmisi.jsonl").lines().count(), 20);
    assert!(entry(&e, "surumler.json").contains("1.2.3"));
    let toc = entry(&e, "ICINDEKILER.txt");
    assert!(toc.contains("gunluk/guncelleyici.log") && toc.contains("yedekler") && toc.contains("geçici yedek anahtarları"), "{toc}");
}

/// İkinci sonda: tarayıcı süzülmemiş bir girdideki sırrı (Deflate ile sıkıştırılmış) bulur.
#[test]
fn tani_paketi_tarayici_kor_degil() {
    let secrets = vec!["SONDASIRRI-123456".to_string()];
    let ham = vec![Olcum::new("ayar.json", "süzülmemiş", r#"{"parola":"SONDASIRRI-123456"}"#.repeat(50))];
    let bytes = tani::zip_bytes(&ham).unwrap();
    assert!(!leaks(&bytes, &secrets).is_empty(), "tarayıcı sıkıştırılmış girdideki sırrı görmedi");
}

/// `tani` alt komutu gerçek dosyaya yazar (platform ölçümleri fail-soft: bu makinede Docker/systemd olmasa da).
#[test]
fn tani_komutu_zip_yazar() {
    let w = world("komut");
    let out = w.dir.join("cikti").join("tani.zip");
    let args: Vec<String> =
        ["tani", "--kok", w.layout.root.to_str().unwrap(), "--veri", w.layout.data.to_str().unwrap(), "--cikti", out.to_str().unwrap()]
            .iter()
            .map(|s| s.to_string())
            .collect();
    assert_eq!(tani::komut(&args, KUNYE), Ok(0));
    let bytes = std::fs::read(&out).unwrap();
    let found = leaks(&bytes, &w.secrets);
    assert!(found.is_empty(), "{}", found.join("\n"));
    assert!(unzip(&bytes).iter().any(|(n, _)| n.starts_with("platform/")), "platform ölçümü girer");
}
