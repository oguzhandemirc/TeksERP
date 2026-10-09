//! Yedek alan dosyası (§2.3 "Disk dolu", W3a): güncelleyicinin iş alanında sabit boyutlu bir dosya. Disk dolup işlem
//! günlüğü yazılamazsa silinir; açılan yer günlüğe ve telafiye yeter — işlem geri alınır (adım ilerletilmez). Boşta
//! turda yeniden kurulur; kurulamazsa yeni işlem BAŞLAMAZ (`DISK_DOLU`).
use crate::env::Fs;
use crate::layout::Layout;

pub const FILE_NAME: &str = "yedek-alan";
/// Plan §2.3: 64 MB — işlem günlüğünün geri kalanı + telafi yazımları (durum, geçmiş, bağlantı) bunun binde birine sığar.
pub const RESERVE_BYTES: u64 = 64 * 1024 * 1024;

/// Yoksa ya da boyu yanlışsa kurar (atomik yazım: yarım dosya kalmaz). `Ok(true)` = bu çağrı kurdu.
pub fn ensure(fs: &dyn Fs, layout: &Layout, bytes: u64) -> std::io::Result<bool> {
    let p = layout.reserve_file();
    if fs.file_len(&p).ok() == Some(bytes) {
        return Ok(false);
    }
    fs.write_atomic(&p, &filler(bytes))?;
    Ok(true)
}

/// Disk dolu: dosyayı siler. Dosya vardı ve silindiyse `true` (açılan yer var).
pub fn release(fs: &dyn Fs, layout: &Layout) -> bool {
    let p = layout.reserve_file();
    fs.exists(&p) && fs.remove_file(&p).is_ok()
}

/// Sıkıştırılamaz dolgu: sıfırlar sıkıştıran/seyrek dosya sisteminde (btrfs, ZFS, NTFS sıkıştırması) yer TUTMAZ.
fn filler(bytes: u64) -> Vec<u8> {
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut out = Vec::with_capacity(usize::try_from(bytes).unwrap_or(0));
    while (out.len() as u64) < bytes {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let take = usize::try_from((bytes - out.len() as u64).min(8)).unwrap_or(8);
        out.extend_from_slice(&x.to_le_bytes()[..take]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::RealFs;

    #[test]
    fn reserve_is_created_once_released_and_recreated() {
        let d = std::env::temp_dir().join(format!("tekserp-yedekalan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let l = Layout::new(&d, &d);
        assert!(ensure(&RealFs, &l, 4096).unwrap());
        assert!(!ensure(&RealFs, &l, 4096).unwrap(), "doğru boyda dosya yeniden yazılmaz");
        let b = std::fs::read(l.reserve_file()).unwrap();
        assert_eq!(b.len(), 4096);
        assert!(b.iter().filter(|x| **x == 0).count() < 64, "dolgu sıkıştırılamaz olmalı");
        assert!(release(&RealFs, &l));
        assert!(!release(&RealFs, &l), "ikinci bırakma yer açmaz");
        assert!(ensure(&RealFs, &l, 4096).unwrap());
        let _ = std::fs::remove_dir_all(&d);
    }
}
