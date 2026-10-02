//! Kurulum kaydı (`<KOK>\kurulum-gecmisi.jsonl`, §8.8) — `kur.ps1` ile BİREBİR biçim
//! (`InstallRecordSchema`, KATI): backend son 10 geçerli satırı yoklamada satıcıya taşır. `kayitId`
//! işlemden türetilir: yeniden koşulan ONAY adımı aynı kaydı yeniden yazar, okuyucu tekilleştirir.
use crate::env::Fs;
use crate::ids;
use crate::layout::Layout;
use serde_json::json;
use tekserp_hizmet::timefmt;

pub struct InstallRecord<'a> {
    pub op_id: &'a str,
    /// `KURULUM` · `GERI_ALMA`
    pub kind: &'a str,
    pub now_ms: i64,
    pub started_ms: i64,
    pub commit: Option<&'a str>,
    /// zip'in hex sha256'sı
    pub package_hex: Option<&'a str>,
    pub previous: Option<&'a str>,
    pub new: &'a str,
    pub migrations_before: Option<u64>,
    pub migrations_after: Option<u64>,
    pub data_encrypted: bool,
}

pub fn line(r: &InstallRecord) -> String {
    let commit = r.commit.filter(|c| (7..=40).contains(&c.len()) && c.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    let package = r.package_hex.filter(|p| p.len() == 64 && p.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    json!({
        "kayitId": ids::derived_uuid(&format!("{}/{}", r.op_id, r.kind)),
        "tur": r.kind,
        "tarih": timefmt::iso_seconds(r.now_ms),
        "commit": commit,
        "paketOzeti": package,
        "oncekiSurum": r.previous,
        "yeniSurum": r.new,
        "migrationSayisi": r.migrations_before,
        "yeniMigrationSayisi": r.migrations_after,
        "geriDonus": { "damga": timefmt::stamp(r.started_ms), "kod": true, "veri": true, "veriSifreli": r.data_encrypted },
    })
    .to_string()
}

pub fn append(fs: &dyn Fs, layout: &Layout, r: &InstallRecord) -> std::io::Result<()> {
    crate::ipc::append_jsonl(fs, &layout.install_history(), line(r).as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_kur_ps1_shape() {
        let r = InstallRecord {
            op_id: "op-1",
            kind: "KURULUM",
            now_ms: 1_790_799_742_999,
            started_ms: 1_790_799_000_000,
            commit: Some("9702f6af"),
            package_hex: Some(&"a".repeat(64)),
            previous: Some("2.12.4"),
            new: "2.13.0",
            migrations_before: Some(210),
            migrations_after: Some(213),
            data_encrypted: true,
        };
        let v: serde_json::Value = serde_json::from_str(&line(&r)).unwrap();
        assert_eq!(v["tarih"], "2026-09-30T20:22:22Z");
        assert_eq!(v["geriDonus"]["damga"], "20260930_201000");
        assert_eq!(v["kayitId"].as_str().unwrap().len(), 36);
        assert_eq!(v["kayitId"], serde_json::from_str::<serde_json::Value>(&line(&r)).unwrap()["kayitId"], "aynı işlem aynı kimlik");
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 10, "KATI şema: tam on alan");
        let r2 = InstallRecord { commit: Some("XYZ"), package_hex: Some("kisa"), ..r };
        let v2: serde_json::Value = serde_json::from_str(&line(&r2)).unwrap();
        assert!(v2["commit"].is_null() && v2["paketOzeti"].is_null(), "biçimsiz değer null (şema reddetmesin)");
    }
}
