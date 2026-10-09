//! Dar ustar okuyucu — yalnız bizim ürettiğimiz dış teslim tar'ı (`teslim-paketle.sh --format=ustar`) için
//! (`docs/design/GUNCELLEYICI-SAGLAMLIK.md` §5 madde 5, L4c-1). Kabul: POSIX ustar başlığı (`ustar\0` + `00`),
//! düz dosya (`'0'`/NUL) ve dizin (`'5'`). Başka her tip (PAX `x`/`g`, GNU `L`/`K`, bağ, aygıt, FIFO) RED: biçim
//! bizim üretimimiz, genişletmeye gerek yok ve yeni bağımlılık kullanıcı onayı ister (`tar` crate'i yok).
//! Açma iki geçişlidir: önce BÜTÜN başlıklar ölçülür ve üye kümesi beklenene eşit olmalıdır, ancak sonra yazılır.
use crate::package::{ExtractLimits, ExtractStats};
use std::collections::HashSet;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const BLOCK: u64 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    File,
    Dir,
}

/// Ölçülmüş üye: ad (dizinde sondaki `/` atılmış), tip, boy, çalıştırılabilirlik (kip bitlerinden yalnız bu) ve
/// verinin arşivdeki yeri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub executable: bool,
    pub offset: u64,
}

/// Yol/tip ihlali `PAKET_YOL:` önekiyle (zip açıcısıyla aynı ayrım); bozuk arşiv öneksiz.
fn path_err(msg: impl AsRef<str>) -> String {
    format!("PAKET_YOL: {}", msg.as_ref())
}

fn corrupt(msg: impl AsRef<str>) -> String {
    format!("tar bozuk: {}", msg.as_ref())
}

/// Sekizli sayı alanı: baştaki boşluklar, en az bir rakam, ardı yalnız NUL/boşluk. İkili (base-256) kodlama RED.
fn octal(field: &[u8], what: &str) -> Result<u64, String> {
    if field.first().is_some_and(|b| b & 0x80 != 0) {
        return Err(corrupt(format!("{what} ikili (base-256) kodlu")));
    }
    let start = field.iter().position(|b| *b != b' ').unwrap_or(field.len());
    let digits = field[start..].iter().take_while(|b| (b'0'..=b'7').contains(b)).count();
    if digits == 0 || field[start + digits..].iter().any(|b| *b != 0 && *b != b' ') {
        return Err(corrupt(format!("{what} sekizli değil")));
    }
    field[start..start + digits].iter().try_fold(0u64, |acc, d| {
        acc.checked_mul(8).and_then(|x| x.checked_add(u64::from(d - b'0'))).ok_or_else(|| corrupt(format!("{what} taşıyor")))
    })
}

/// NUL ile biten metin alanı; ilk NUL'dan sonra NUL olmayan bayt (gizli ad parçası) RED.
fn text(field: &[u8], what: &str) -> Result<String, String> {
    let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
    if field[end..].iter().any(|b| *b != 0) {
        return Err(path_err(format!("{what} alanında NUL'dan sonra veri")));
    }
    String::from_utf8(field[..end].to_vec()).map_err(|_| path_err(format!("{what} UTF-8 değil")))
}

fn type_label(t: u8) -> &'static str {
    match t {
        b'x' | b'g' => "PAX başlığı",
        b'L' | b'K' => "GNU uzun ad",
        b'1' => "sert bağ",
        b'2' => "sembolik bağ",
        b'3' | b'4' => "aygıt",
        b'6' => "FIFO",
        _ => "bilinmeyen tip",
    }
}

/// Göreli, `..`/`.`/boş bileşensiz, ayraç ve denetim karakteri taşımayan ad (dizinde tek sondaki `/` serbest).
fn checked_name(raw: &str, kind: Kind) -> Result<String, String> {
    let name = match kind {
        Kind::Dir => raw.strip_suffix('/').unwrap_or(raw),
        Kind::File => raw,
    };
    let bad = name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(char::is_control)
        || name.split('/').any(|c| c.is_empty() || c == "." || c == "..");
    if bad {
        return Err(path_err(format!("güvensiz yol: {raw:?}")));
    }
    Ok(name.to_string())
}

/// Tek başlık bloğu → üye (`None`: sıfır blok). Sıra: sağlama → biçim → tip → ad → boy.
fn parse_header(h: &[u8; 512], offset: u64) -> Result<Option<Member>, String> {
    if h.iter().all(|b| *b == 0) {
        return Ok(None);
    }
    let stored = octal(&h[148..156], "sağlama toplamı")?;
    let sum: u64 = h.iter().enumerate().map(|(i, b)| if (148..156).contains(&i) { u64::from(b' ') } else { u64::from(*b) }).sum();
    if stored != sum {
        return Err(corrupt(format!("{offset}. baytta başlık sağlama toplamı tutmuyor")));
    }
    if &h[257..263] != b"ustar\0" || &h[263..265] != b"00" {
        return Err(corrupt(format!("{offset}. baytta POSIX ustar başlığı değil")));
    }
    let raw = {
        let name = text(&h[0..100], "ad")?;
        let prefix = text(&h[345..500], "ön ek")?;
        if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        }
    };
    let kind = match h[156] {
        b'0' | 0 => Kind::File,
        b'5' => Kind::Dir,
        t => return Err(path_err(format!("desteklenmeyen üye tipi {:?} ({}): {raw:?}", t as char, type_label(t)))),
    };
    if !text(&h[157..257], "bağ hedefi")?.is_empty() {
        return Err(path_err(format!("bağ hedefi taşıyan üye: {raw:?}")));
    }
    let name = checked_name(&raw, kind)?;
    let size = octal(&h[124..136], "boy")?;
    if kind == Kind::Dir && size != 0 {
        return Err(corrupt(format!("dizin üyesi veri taşıyor: {name}")));
    }
    let executable = octal(&h[100..108], "kip")? & 0o111 != 0;
    Ok(Some(Member { name, kind, size, executable, offset: offset + BLOCK }))
}

fn read_block<R: Read + Seek>(r: &mut R, at: u64) -> io::Result<[u8; 512]> {
    let mut b = [0u8; 512];
    r.seek(SeekFrom::Start(at))?;
    r.read_exact(&mut b)?;
    Ok(b)
}

/// Bütün arşivi açmadan ölçer: her başlık, boy, kesiklik, çift üye, tavanlar ve bitişten sonrası (yalnız sıfır).
pub fn scan<R: Read + Seek>(r: &mut R, len: u64, limits: &ExtractLimits) -> Result<Vec<Member>, String> {
    let io_err = |e: io::Error| corrupt(format!("okunamadı: {e}"));
    let mut out: Vec<Member> = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0u64;
    let mut pos = 0u64;
    loop {
        if pos.checked_add(BLOCK).is_none_or(|end| end > len) {
            return Err(corrupt("kesik arşiv (bitiş blokları yok)"));
        }
        let Some(m) = parse_header(&read_block(r, pos).map_err(io_err)?, pos)? else {
            if pos + 2 * BLOCK > len || read_block(r, pos + BLOCK).map_err(io_err)?.iter().any(|b| *b != 0) {
                return Err(corrupt("kesik arşiv (ikinci bitiş bloğu yok)"));
            }
            let mut rest = Vec::new();
            r.seek(SeekFrom::Start(pos + 2 * BLOCK)).map_err(io_err)?;
            r.read_to_end(&mut rest).map_err(io_err)?;
            if rest.iter().any(|b| *b != 0) {
                return Err(corrupt("bitiş bloklarından sonra veri"));
            }
            return Ok(out);
        };
        let padded = m.size.div_ceil(BLOCK).checked_mul(BLOCK).ok_or_else(|| corrupt("boy taşıyor"))?;
        let next = m.offset.checked_add(padded).ok_or_else(|| corrupt("boy taşıyor"))?;
        if next > len {
            return Err(corrupt(format!("kesik arşiv: {} {} bayt bildiriyor", m.name, m.size)));
        }
        if !seen.insert(m.name.clone()) {
            return Err(path_err(format!("çift üye: {}", m.name)));
        }
        total = total.saturating_add(m.size);
        if out.len() >= limits.max_entries || total > limits.max_total_bytes {
            return Err("tar tavanı aştı (girdi sayısı ya da toplam boy)".into());
        }
        out.push(m);
        pos = next;
    }
}

/// Üye kümesi `expected` (düz dosya adları) ile TAM aynı olmalı: fazla (dizin dahil) ya da eksik üye RED.
pub fn check_members(members: &[Member], expected: &[String]) -> Result<(), String> {
    let extra: Vec<&str> =
        members.iter().filter(|m| m.kind != Kind::File || !expected.contains(&m.name)).map(|m| m.name.as_str()).collect();
    let missing: Vec<&str> =
        expected.iter().filter(|e| !members.iter().any(|m| m.kind == Kind::File && &m.name == *e)).map(String::as_str).collect();
    if extra.is_empty() && missing.is_empty() {
        return Ok(());
    }
    let show = |v: &[&str]| if v.is_empty() { "yok".to_string() } else { v.join(", ") };
    Err(path_err(format!("üye kümesi biçimde değil — fazla: {} · eksik: {}", show(&extra), show(&missing))))
}

/// Gerçek açma (`Fs::extract_tar`): ölç → üye kümesi → yaz. Dosyalar `create_new` ile (var olanı ezmez, bağ izlemez);
/// ikinci geçişte her başlık yeniden okunur ve ilk ölçümle aynı olmalıdır. `finish` yazılan dosyanın kipini koyar
/// (platform işi: çalıştırılabilir bit).
pub fn extract_real(
    archive: &Path,
    dest: &Path,
    expected: &[String],
    limits: &ExtractLimits,
    finish: &dyn Fn(&Path, &Member) -> io::Result<()>,
) -> Result<ExtractStats, String> {
    let mut file = std::fs::File::open(archive).map_err(|e| format!("paket açılamadı: {e}"))?;
    let len = file.metadata().map_err(|e| format!("paket ölçülemedi: {e}"))?.len();
    let members = scan(&mut file, len, limits)?;
    check_members(&members, expected)?;
    std::fs::create_dir_all(dest).map_err(|e| format!("hedef dizin açılamadı: {e}"))?;
    let mut stats = ExtractStats::default();
    for m in &members {
        let again = parse_header(&read_block(&mut file, m.offset - BLOCK).map_err(|e| corrupt(e.to_string()))?, m.offset - BLOCK)?;
        if again.as_ref() != Some(m) {
            return Err(corrupt("arşiv açılırken değişti"));
        }
        let out: PathBuf = m.name.split('/').fold(dest.to_path_buf(), |p, c| p.join(c));
        if m.kind == Kind::Dir {
            std::fs::create_dir_all(&out).map_err(|e| format!("{}: {e}", m.name))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", m.name))?;
        }
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&out).map_err(|e| format!("{}: {e}", m.name))?;
        let n = io::copy(&mut (&mut file).take(m.size), &mut f).map_err(|e| format!("{}: {e}", m.name))?;
        if n != m.size {
            return Err(corrupt(format!("{} kesik", m.name)));
        }
        f.sync_all().map_err(|e| format!("{}: {e}", m.name))?;
        drop(f);
        finish(&out, m).map_err(|e| format!("{}: {e}", m.name))?;
        stats.files += 1;
        stats.bytes += n;
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Test başlığı: alanlar yazıldıktan sonra `seal` sağlamayı koyar (bozuk sağlama için çağrılmaz).
    fn header(name: &str, t: u8, size: u64) -> [u8; 512] {
        let mut h = [0u8; 512];
        h[..name.len()].copy_from_slice(name.as_bytes());
        h[100..108].copy_from_slice(b"0000644\0");
        h[108..116].copy_from_slice(b"0000000\0");
        h[116..124].copy_from_slice(b"0000000\0");
        h[124..136].copy_from_slice(format!("{size:011o}\0").as_bytes());
        h[136..148].copy_from_slice(b"00000000000\0");
        h[156] = t;
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h
    }

    fn seal(mut h: [u8; 512]) -> [u8; 512] {
        h[148..156].copy_from_slice(b"        ");
        let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
        h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        h
    }

    fn archive(entries: &[([u8; 512], &[u8])]) -> Vec<u8> {
        let mut v = Vec::new();
        for (h, data) in entries {
            v.extend_from_slice(h);
            v.extend_from_slice(data);
            v.resize(v.len().div_ceil(512) * 512, 0);
        }
        v.extend_from_slice(&[0u8; 1024]);
        v
    }

    fn scan_of(v: &[u8]) -> Result<Vec<Member>, String> {
        scan(&mut Cursor::new(v), v.len() as u64, &ExtractLimits::default())
    }

    #[test]
    fn reads_plain_files_and_dirs() {
        let v = archive(&[(seal(header("a/", b'5', 0)), b""), (seal(header("a/b.txt", b'0', 3)), b"abc"), (seal(header("c", 0, 0)), b"")]);
        let m = scan_of(&v).unwrap();
        assert_eq!(
            m.iter().map(|x| (x.name.as_str(), x.kind, x.size)).collect::<Vec<_>>(),
            [("a", Kind::Dir, 0), ("a/b.txt", Kind::File, 3), ("c", Kind::File, 0)]
        );
    }

    #[test]
    fn checksum_magic_and_numbers_are_strict() {
        let bad_sum = archive(&[(header("a", b'0', 0), b"")]);
        assert!(scan_of(&bad_sum).unwrap_err().contains("sağlama"));
        let mut gnu = header("a", b'0', 0);
        gnu[257..265].copy_from_slice(b"ustar  \0");
        assert!(scan_of(&archive(&[(seal(gnu), b"")])).unwrap_err().contains("ustar"), "eski GNU biçimi RED");
        let mut b256 = header("a", b'0', 0);
        b256[124] = 0x80;
        assert!(scan_of(&archive(&[(seal(b256), b"")])).unwrap_err().contains("base-256"));
        let mut huge = header("a", b'0', 0);
        huge[124..136].copy_from_slice(b"777777777777");
        assert!(scan_of(&archive(&[(seal(huge), b"")])).unwrap_err().contains("kesik"), "dev boy: arşivin sonunu aşar");
    }

    #[test]
    fn truncated_and_trailing_data_rejected() {
        let v = archive(&[(seal(header("a", b'0', 600)), &[7u8; 600])]);
        assert!(scan_of(&v[..v.len() - 1024]).unwrap_err().contains("kesik"), "bitiş blokları yok");
        assert!(scan_of(&v[..700]).unwrap_err().contains("kesik"), "veri yarıda");
        assert!(scan_of(&v[..v.len() - 512]).unwrap_err().contains("ikinci bitiş"), "tek sıfır blok");
        let mut tail = v.clone();
        tail.extend_from_slice(b"gizli");
        assert!(scan_of(&tail).unwrap_err().contains("sonra veri"));
        let mut zeros = v;
        zeros.extend_from_slice(&[0u8; 9216]);
        assert!(scan_of(&zeros).is_ok(), "kayıt dolgusu (sıfır) serbest");
    }

    #[test]
    fn limits_apply_before_extraction() {
        let v = archive(&[(seal(header("a", b'0', 4)), b"abcd"), (seal(header("b", b'0', 4)), b"abcd")]);
        let tight = ExtractLimits { max_entries: 1, max_total_bytes: 100 };
        assert!(scan(&mut Cursor::new(&v), v.len() as u64, &tight).unwrap_err().contains("tavan"));
        let small = ExtractLimits { max_entries: 10, max_total_bytes: 7 };
        assert!(scan(&mut Cursor::new(&v), v.len() as u64, &small).unwrap_err().contains("tavan"));
    }
}
