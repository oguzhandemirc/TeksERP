//! Aday (işaretçi) sorgusunun zamanlaması (§6.3, W5): CDN Worker'ının günlük istek sınırını bütün filo paylaşır.
//! Sorgu kira yenilenince (saatlik + zil), yeni panel onayında ve en geç `CEILING_MS`te bir yapılır; tavan anı
//! kurulum kimliğinden türeyen sabit kaydırmaya oturur ki aynı anda başlayan kurulumlar aynı dakikada sorgulamasın.

use sha2::{Digest, Sha256};

/// İki sorgu arası en uzun süre (kira yenilenmese bile).
pub const CEILING_MS: i64 = 6 * 60 * 60 * 1000;
/// Kaydırma penceresi: tavan anı son sorgudan sonraki `(CEILING − SPREAD, CEILING]` aralığına düşer.
pub const SPREAD_MS: i64 = 60 * 60 * 1000;
/// Başarısız sorgunun yeniden denenmesi: 1 dk × 2ⁿ⁻¹ (olağan sorgu anı daha erkense o).
const RETRY_BASE_MS: i64 = 60 * 1000;

/// Kurulumun sabit kaydırması `[0, SPREAD_MS)`: kimliğin SHA-256 özetinden (süreç ve yeniden başlatmadan bağımsız).
pub fn phase_ms(installation_id: &str) -> i64 {
    let d = Sha256::digest(installation_id.as_bytes());
    let n = u64::from_be_bytes([d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7]]);
    (n % SPREAD_MS as u64) as i64
}

/// `last_ms`ten sonraki tavan anı: `last + CEILING`e eşit ya da ondan önceki, kaydırmaya (mod `SPREAD_MS`) oturan en geç an.
pub fn ceiling_at(last_ms: i64, phase: i64) -> i64 {
    let limit = last_ms + CEILING_MS;
    limit - (limit - phase).rem_euclid(SPREAD_MS)
}

/// Başarısız ardışık `failures`. denemeden sonra bekleme.
pub fn retry_after_ms(failures: u32) -> i64 {
    RETRY_BASE_MS << failures.saturating_sub(1).min(10)
}

/// Son ağ sorgusunun izi (başarılı ya da değil).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mark {
    pub at_ms: i64,
    pub pointer: String,
    pub lease_issued_ms: Option<i64>,
    pub approval_id: Option<String>,
    /// Ardışık başarısız sorgu sayısı; başarı sıfırlar.
    pub failures: u32,
}

/// Bu turun sorgu girdileri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryNow {
    pub lease_issued_ms: Option<i64>,
    pub approval_id: Option<String>,
    pub phase_ms: i64,
}

/// Sorgu şimdi yapılmalı mı? İz yoksa, saat geri gittiyse, işaretçi/kira/onay değiştiyse, tavan ya da yeniden deneme
/// anı geldiyse evet.
pub fn due(mark: Option<&Mark>, pointer: &str, q: &QueryNow, now_ms: i64) -> bool {
    let Some(m) = mark else { return true };
    now_ms < m.at_ms
        || m.pointer != pointer
        || m.lease_issued_ms != q.lease_issued_ms
        || (q.approval_id.is_some() && m.approval_id != q.approval_id)
        || now_ms >= ceiling_at(m.at_ms, q.phase_ms)
        || (m.failures > 0 && now_ms >= m.at_ms + retry_after_ms(m.failures))
}
