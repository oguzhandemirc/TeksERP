//! İmaj arşivi ve etiket kaydı (L4c-2, `GUNCELLEYICI-SAGLAMLIK.md` §1.2 · §5 halka 6) — Docker'sız, saf çekirdek.
//! İmaj kimliği = arşivdeki config blob'unun sha256'sı (`Teks-Erp/scripts/lib/oci-arsiv.ts` `imajArsiviOlc` aynası);
//! `docker image inspect .Id` kimlik DEĞİLDİR (containerd deposunda index özetidir). Arşiv tek geçişte akışla okunur:
//! yalnız küçük girdiler belleğe alınır, katmanlar okunup atılır (950 MB imaj diske açılmaz).
//! Kayıt (`is/imaj/<sürüm>.json`): güncelleyicinin KENDİ yüklediği imajın etiketi, katmanları ve Docker'ın yerel
//! tutamacı — her başlatmadan önce etiket buna karşı ölçülür (yeniden etiketlenmiş imaj başlatılmaz).
use crate::env::Fs;
use crate::layout::Layout;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

/// `docker image inspect`in tek satırı: yerel tutamaç | katman listesi (`RootFS.Layers` = config `diff_ids`).
pub const INSPECT_FORMAT: &str = "{{.Id}}|{{json .RootFS.Layers}}";
/// Başlatma ve araç yollarının hata iletisi öneki: adım kodu `IMAJ_KIMLIGI`ye çevrilir (`operation::step_err`).
pub const KIMLIK_ONEKI: &str = "IMAJ_KIMLIGI:";
/// Belleğe alınan tek girdinin tavanı (manifest ve config birkaç KB; imza katmanı küçük).
const KUCUK_GIRDI: u64 = 4 * 1024 * 1024;
/// Belleğe alınanların toplam tavanı — aşılırsa arşiv biçimde değil (fail-closed).
const KUCUK_TOPLAM: u64 = 64 * 1024 * 1024;
const GIRDI_TAVANI: usize = 100_000;

/// Arşivin ölçümü.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImajOlcumu {
    /// `sha256:<64 hex>` — config blob'unun özeti.
    pub kimlik: String,
    pub etiketler: Vec<String>,
    /// Config `rootfs.diff_ids` (sırası korunur).
    pub katmanlar: Vec<String>,
}

fn bozuk(m: impl AsRef<str>) -> String {
    format!("imaj arşivi biçimde değil: {}", m.as_ref())
}

fn hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn digest_ok(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// Sekizli ya da GNU base-256 sayı alanı.
fn number(f: &[u8]) -> Result<u64, String> {
    if f.first().is_some_and(|b| b & 0x80 != 0) {
        return f[1..]
            .iter()
            .try_fold(u64::from(f[0] & 0x7f), |a, b| a.checked_mul(256).map(|x| x + u64::from(*b)))
            .ok_or_else(|| bozuk("boy taşıyor"));
    }
    let s: String = f.iter().take_while(|b| **b != 0).map(|b| *b as char).collect();
    let s = s.trim();
    if s.is_empty() {
        return Ok(0);
    }
    u64::from_str_radix(s, 8).map_err(|_| bozuk(format!("sekizli değil: {s:?}")))
}

fn cstr(f: &[u8]) -> String {
    let end = f.iter().position(|b| *b == 0).unwrap_or(f.len());
    String::from_utf8_lossy(&f[..end]).into_owned()
}

/// PAX kaydındaki `path=` (Docker uzun adlarda yazabilir).
fn pax_path(data: &[u8]) -> Option<String> {
    let mut rest = data;
    let mut out = None;
    while !rest.is_empty() {
        let sp = rest.iter().position(|b| *b == b' ')?;
        let len: usize = std::str::from_utf8(&rest[..sp]).ok()?.parse().ok()?;
        if len <= sp + 1 || len > rest.len() {
            return None;
        }
        let rec = &rest[sp + 1..len - 1];
        if let Some(v) = rec.strip_prefix(b"path=") {
            out = Some(String::from_utf8_lossy(v).into_owned());
        }
        rest = &rest[len..];
    }
    out
}

fn read_exact_or<R: Read>(r: &mut R, buf: &mut [u8]) -> Result<bool, String> {
    let mut got = 0;
    while got < buf.len() {
        match r.read(&mut buf[got..]) {
            Ok(0) if got == 0 => return Ok(false),
            Ok(0) => return Err(bozuk("kesik")),
            Ok(n) => got += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(bozuk(format!("okunamadı: {e}"))),
        }
    }
    Ok(true)
}

/// `n` bayt okur; `keep` ise döndürür, değilse atar.
fn take<R: Read>(r: &mut R, n: u64, keep: bool) -> Result<Option<Vec<u8>>, String> {
    let mut lim = r.take(n);
    let got = if keep {
        let mut v = Vec::with_capacity(usize::try_from(n).unwrap_or(0));
        lim.read_to_end(&mut v).map_err(|e| bozuk(format!("okunamadı: {e}")))?;
        let len = v.len() as u64;
        (len == n).then_some(Some(v)).ok_or(len)
    } else {
        let len = io::copy(&mut lim, &mut io::sink()).map_err(|e| bozuk(format!("okunamadı: {e}")))?;
        (len == n).then_some(None).ok_or(len)
    };
    got.map_err(|_| bozuk("kesik girdi"))
}

/// Düz (gzip'siz) `docker save` tar'ını akışla ölçer.
pub fn olc_tar<R: Read>(mut r: R) -> Result<ImajOlcumu, String> {
    let mut small: HashMap<String, Vec<u8>> = HashMap::new();
    let mut kept = 0u64;
    let mut next_name: Option<String> = None;
    let mut h = [0u8; 512];
    for _ in 0..GIRDI_TAVANI {
        if !read_exact_or(&mut r, &mut h)? || h.iter().all(|b| *b == 0) {
            return finish(&small);
        }
        let stored = number(&h[148..156])?;
        let sum: u64 = h.iter().enumerate().map(|(i, b)| if (148..156).contains(&i) { 32 } else { u64::from(*b) }).sum();
        if stored != sum {
            return Err(bozuk("başlık sağlama toplamı tutmuyor"));
        }
        let size = number(&h[124..136])?;
        let pad = (512 - size % 512) % 512;
        let t = h[156];
        let mut name = cstr(&h[0..100]);
        if &h[257..262] == b"ustar" {
            let prefix = cstr(&h[345..500]);
            if !prefix.is_empty() {
                name = format!("{prefix}/{name}");
            }
        }
        let meta = matches!(t, b'x' | b'L');
        if !meta && t != b'g' {
            if let Some(n) = next_name.take() {
                name = n;
            }
        }
        let name = name.trim_start_matches("./").to_string();
        let regular = matches!(t, b'0' | 0 | b'7');
        let keep = meta || (regular && size <= KUCUK_GIRDI);
        if keep {
            kept = kept.saturating_add(size);
            if kept > KUCUK_TOPLAM {
                return Err(bozuk("küçük girdilerin toplamı tavanı aştı"));
            }
        }
        let data = take(&mut r, size, keep)?;
        take(&mut r, pad, false)?;
        match (t, data) {
            (b'x', Some(d)) => next_name = pax_path(&d).or(next_name),
            (b'L', Some(d)) => next_name = Some(cstr(&d)),
            (_, Some(d)) if regular => {
                if small.insert(name.clone(), d).is_some() {
                    return Err(bozuk(format!("çift girdi: {name}")));
                }
            }
            _ => {}
        }
    }
    Err(bozuk("girdi sayısı tavanı aştı"))
}

fn finish(small: &HashMap<String, Vec<u8>>) -> Result<ImajOlcumu, String> {
    let mj = small.get("manifest.json").ok_or_else(|| bozuk("manifest.json yok (docker save çıktısı değil)"))?;
    let m: Value = serde_json::from_slice(mj).map_err(|_| bozuk("manifest.json JSON değil"))?;
    let list = m.as_array().ok_or_else(|| bozuk("manifest.json dizi değil"))?;
    let [one] = list.as_slice() else { return Err(bozuk(format!("TEK imaj taşımalı ({})", list.len()))) };
    let config_name = one.get("Config").and_then(Value::as_str).ok_or_else(|| bozuk("Config yok"))?;
    let layers = one.get("Layers").and_then(Value::as_array).filter(|l| !l.is_empty()).ok_or_else(|| bozuk("katman listesi yok"))?;
    let etiketler: Vec<String> = match one.get("RepoTags") {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) => {
            a.iter().map(|t| t.as_str().map(str::to_string)).collect::<Option<_>>().ok_or_else(|| bozuk("RepoTags metin değil"))?
        }
        Some(_) => return Err(bozuk("RepoTags dizi değil")),
    };
    let config = small.get(config_name).ok_or_else(|| bozuk(format!("config arşivde yok ya da büyük: {config_name}")))?;
    let kimlik = format!("sha256:{}", hex(config));
    if let Some(named) = config_name.strip_prefix("blobs/sha256/") {
        if format!("sha256:{named}") != kimlik {
            return Err(bozuk("config blob'unun adı içeriğinin özeti değil"));
        }
    }
    let c: Value = serde_json::from_slice(config).map_err(|_| bozuk("config JSON değil"))?;
    let katmanlar: Vec<String> = c
        .pointer("/rootfs/diff_ids")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().map(|d| d.as_str().filter(|s| digest_ok(s)).map(str::to_string)).collect())
        .ok_or_else(|| bozuk("config rootfs.diff_ids yok ya da biçimsiz"))?;
    if katmanlar.len() != layers.len() {
        return Err(bozuk(format!("config diff_ids ({}) ≠ katman sayısı ({})", katmanlar.len(), layers.len())));
    }
    Ok(ImajOlcumu { kimlik, etiketler, katmanlar })
}

/// Arşivi (gzip'li ya da düz) ölçer.
pub fn olc_okuyucu<R: Read>(r: R) -> Result<ImajOlcumu, String> {
    let mut r = io::BufReader::new(r);
    let head = io::BufRead::fill_buf(&mut r).map_err(|e| bozuk(format!("okunamadı: {e}")))?;
    if head.starts_with(&[0x1f, 0x8b]) {
        olc_tar(flate2::read::MultiGzDecoder::new(r))
    } else {
        olc_tar(r)
    }
}

pub fn olc(fs: &dyn Fs, archive: &Path) -> Result<ImajOlcumu, String> {
    let f = fs.open_read(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    olc_okuyucu(f)
}

/// `docker image inspect --format INSPECT_FORMAT` satırı → (yerel tutamaç, katmanlar).
pub fn inspect_coz(line: &str) -> Option<(String, Vec<String>)> {
    let (id, layers) = line.trim().split_once('|')?;
    let layers: Vec<String> = serde_json::from_str(layers).ok()?;
    (!id.is_empty()).then(|| (id.to_string(), layers))
}

/// Güncelleyicinin yüklediği imajın kaydı.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kayit {
    pub v: u32,
    pub surum: String,
    pub etiket: String,
    /// Arşivdeki config özeti (künye/bildirim `imaj.kimlik`).
    pub kimlik: String,
    pub katmanlar: Vec<String>,
    /// Docker'ın bu yüklemede verdiği yerel tutamaç (`.Id`): kimlik değil, "aynı nesne mi" ölçüsü.
    #[serde(rename = "dockerKimligi")]
    pub docker_id: String,
    pub zaman: String,
}

impl Kayit {
    /// Etiketin bugünkü ölçümü bu kayıtla aynı nesne mi.
    pub fn tutar(&self, id: &str, layers: &[String]) -> bool {
        self.docker_id == id && self.katmanlar == layers
    }
}

pub fn kayit_dizini(l: &Layout) -> PathBuf {
    l.work().join("imaj")
}

pub fn kayit_yolu(l: &Layout, surum: &str) -> PathBuf {
    kayit_dizini(l).join(format!("{surum}.json"))
}

pub fn kayit_oku(fs: &dyn Fs, l: &Layout, surum: &str) -> Option<Kayit> {
    fs.read(&kayit_yolu(l, surum)).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(|k: &Kayit| k.surum == surum)
}

pub fn kayit_yaz(fs: &dyn Fs, l: &Layout, k: &Kayit) -> io::Result<()> {
    fs.create_dir_all(&kayit_dizini(l))?;
    fs.write_atomic(&kayit_yolu(l, &k.surum), serde_json::to_vec(k).map_err(io::Error::other)?.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(name: &str, t: u8, size: u64) -> [u8; 512] {
        let mut h = [0u8; 512];
        h[..name.len()].copy_from_slice(name.as_bytes());
        h[100..108].copy_from_slice(b"0000644\0");
        h[124..136].copy_from_slice(format!("{size:011o}\0").as_bytes());
        h[156] = t;
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h[148..156].copy_from_slice(b"        ");
        let s: u32 = h.iter().map(|b| u32::from(*b)).sum();
        h[148..156].copy_from_slice(format!("{s:06o}\0 ").as_bytes());
        h
    }
    fn tar(entries: &[(&str, u8, Vec<u8>)]) -> Vec<u8> {
        let mut v = Vec::new();
        for (n, t, d) in entries {
            v.extend_from_slice(&header(n, *t, d.len() as u64));
            v.extend_from_slice(d);
            v.resize(v.len().div_ceil(512) * 512, 0);
        }
        v.extend_from_slice(&[0u8; 1024]);
        v
    }
    fn pax(path: &str) -> Vec<u8> {
        let body = format!("path={path}\n");
        let mut len = body.len() + 2;
        while format!("{len} {body}").len() != len {
            len += 1;
        }
        format!("{len} {body}").into_bytes()
    }
    fn image(tags: &str, diff: &[&str], layers: usize) -> (Vec<(String, u8, Vec<u8>)>, String) {
        let config = format!(r#"{{"rootfs":{{"type":"layers","diff_ids":{}}}}}"#, serde_json::to_string(diff).unwrap()).into_bytes();
        let c = hex(&config);
        let layer_names: Vec<String> = (0..layers).map(|i| format!("blobs/sha256/{:064x}", i + 1)).collect();
        let manifest =
            format!(r#"[{{"Config":"blobs/sha256/{c}","RepoTags":{tags},"Layers":{}}}]"#, serde_json::to_string(&layer_names).unwrap());
        let mut e = vec![("blobs/".to_string(), b'5', vec![]), (format!("blobs/sha256/{c}"), b'0', config)];
        e.extend(layer_names.iter().map(|n| (n.clone(), b'0', vec![7u8; 600])));
        e.push(("manifest.json".into(), b'0', manifest.into_bytes()));
        (e, format!("sha256:{c}"))
    }
    fn olc_v(e: &[(String, u8, Vec<u8>)]) -> Result<ImajOlcumu, String> {
        let refs: Vec<(&str, u8, Vec<u8>)> = e.iter().map(|(n, t, d)| (n.as_str(), *t, d.clone())).collect();
        olc_okuyucu(io::Cursor::new(tar(&refs)))
    }
    const D1: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    #[test]
    fn config_ozeti_kimliktir_gzip_ve_duz() {
        let (e, kimlik) = image(r#"["tekserp-korumali:1.2.3"]"#, &[D1], 1);
        let m = olc_v(&e).unwrap();
        assert_eq!(m, ImajOlcumu { kimlik: kimlik.clone(), etiketler: vec!["tekserp-korumali:1.2.3".into()], katmanlar: vec![D1.into()] });
        let refs: Vec<(&str, u8, Vec<u8>)> = e.iter().map(|(n, t, d)| (n.as_str(), *t, d.clone())).collect();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gz, &tar(&refs)).unwrap();
        assert_eq!(olc_okuyucu(io::Cursor::new(gz.finish().unwrap())).unwrap().kimlik, kimlik);
    }

    #[test]
    fn pax_ve_gnu_uzun_ad_izlenir() {
        let (mut e, kimlik) = image("null", &[D1], 1);
        let m = e.pop().unwrap();
        e.push(("PaxHeaders/x".into(), b'x', pax("manifest.json")));
        e.push(("kisa".into(), b'0', m.2.clone()));
        assert_eq!(olc_v(&e).unwrap().kimlik, kimlik);
        e.truncate(e.len() - 2);
        e.push(("././@LongLink".into(), b'L', b"manifest.json\0".to_vec()));
        e.push(("baska".into(), b'0', m.2));
        let o = olc_v(&e).unwrap();
        assert_eq!((o.kimlik, o.etiketler), (kimlik, vec![]));
    }

    #[test]
    fn bicim_disi_reddedilir() {
        let (e, _) = image("[]", &[D1], 2);
        assert!(olc_v(&e).unwrap_err().contains("diff_ids (1) ≠ katman sayısı (2)"));
        let (mut e, _) = image("[]", &[D1], 1);
        e.retain(|x| x.0 != "manifest.json");
        assert!(olc_v(&e).unwrap_err().contains("manifest.json yok"));
        // Config içeriği adındaki özetle tutmaz (adı değiştirilmiş blob).
        let (mut e, _) = image("[]", &[D1], 1);
        e[1].2.push(b' ');
        assert!(olc_v(&e).unwrap_err().contains("config"), "{:?}", olc_v(&e));
        let (e, _) = image("[]", &["sha256:kisa"], 1);
        assert!(olc_v(&e).unwrap_err().contains("diff_ids"));
        let (mut e, _) = image("[]", &[D1], 1);
        let m = e.last().unwrap().2.clone();
        let two = String::from_utf8(m).unwrap().replacen('[', "[{\"Config\":\"x\",\"Layers\":[\"y\"]},", 1);
        e.last_mut().unwrap().2 = two.into_bytes();
        assert!(olc_v(&e).unwrap_err().contains("TEK imaj"));
        // Kesik arşiv.
        let (e, _) = image("[]", &[D1], 1);
        let refs: Vec<(&str, u8, Vec<u8>)> = e.iter().map(|(n, t, d)| (n.as_str(), *t, d.clone())).collect();
        let t = tar(&refs);
        assert!(olc_okuyucu(io::Cursor::new(t[..t.len() - 1024 - 300].to_vec())).is_err());
    }

    #[test]
    fn inspect_satiri() {
        assert_eq!(inspect_coz(&format!("sha256:ab|[\"{D1}\"]\n")), Some(("sha256:ab".into(), vec![D1.to_string()])));
        assert_eq!(inspect_coz("|[]"), None);
        assert_eq!(inspect_coz("sha256:ab|<no value>"), None);
    }
}
