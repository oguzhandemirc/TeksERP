//! Bekçi `test_guncelleyici_yikici_docker_yok` (plan §8.2, L7): güncelleyici kaynağı (`src/`) veriyi taşıyan birimleri
//! ya da imajları toptan silen Docker komutlarını HİÇ kurmaz — `down -v` · `volume rm`/`prune` · `system prune` ·
//! `image prune`. Arama yorum satırlarını atlar ve argüman listesi biçimini (`["volume", "rm"]`, `.arg("down").arg("-v")`)
//! düzleştirerek yapar. İki sonda: ihlal metni kırmızı, temiz metin yeşil.
use std::path::Path;

/// Düzleştirilmiş metinde aranan yasak diziler.
const YASAK: [&str; 6] = ["down-v", "down--volumes", "volumerm", "volumeprune", "systemprune", "imageprune"];

/// Kaynağı düzleştirir: yorum satırları atlanır; `.args`/`.arg`, tırnak, virgül, parantez, köşeli parantez ve boşluk düşer.
fn duzlestir(metin: &str) -> String {
    metin
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join(" ")
        .replace(".args", "")
        .replace(".arg", "")
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '"' | ',' | '(' | ')' | '[' | ']' | '&'))
        .collect()
}

fn ihlaller(metin: &str) -> Vec<&'static str> {
    let d = duzlestir(metin);
    YASAK.iter().copied().filter(|y| d.contains(y)).collect()
}

fn rs_dosyalari(d: &Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(d).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            rs_dosyalari(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn test_guncelleyici_yikici_docker_yok() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut dosyalar = Vec::new();
    rs_dosyalari(&src, &mut dosyalar);
    assert!(dosyalar.len() > 30, "kaynak taranmadı: {} dosya", dosyalar.len());
    assert!(dosyalar.iter().any(|p| p.ends_with("platform/linux/kurulum.rs")), "geçiş aracı taramada yok");
    let bulgular: Vec<String> = dosyalar
        .iter()
        .flat_map(|p| ihlaller(&std::fs::read_to_string(p).unwrap()).into_iter().map(move |y| format!("{}: {y}", p.display())))
        .collect();
    assert!(bulgular.is_empty(), "güncelleyici kaynağında yıkıcı Docker komutu: {bulgular:?}");
}

/// Negatif sonda: her biçimdeki ihlal kırmızı; yorum satırı, `down --remove-orphans` ve başka `rm`ler yeşil.
#[test]
fn yikici_docker_sondalari() {
    for kotu in [
        r#"let c = komut.compose().args(["down", "-v"]);"#,
        r#"Cmd::new(p).arg("volume").arg("rm").arg(&ad)"#,
        "let c = docker().args([\n    \"volume\",\n    \"rm\",\n    ad,\n]);",
        r#"run("docker system prune -af")"#,
        r#"self.komut.docker().args(["image", "prune", "-f"])"#,
        r#"args(["volume", "prune"])"#,
        r#"compose().args(["down", "--volumes"])"#,
    ] {
        assert!(!ihlaller(kotu).is_empty(), "sonda kırmızı vermedi: {kotu}");
    }
    for temiz in [
        "// `image prune` ÇAĞRILMAZ; `down -v` yasak",
        r#"compose().args(["down", "--remove-orphans"])"#,
        r#"docker().args(["image", "rm", id.as_str()])"#,
        r#"docker().args(["rm", "-f", &name])"#,
        r#"docker().args(["volume", "inspect", "--format", "{{.Name}}", ad.as_str()])"#,
    ] {
        assert!(ihlaller(temiz).is_empty(), "temiz metin kırmızı: {temiz} → {:?}", ihlaller(temiz));
    }
}
