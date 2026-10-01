//! Şema hizası — TEK KURAL (`docs/design/GUNCELLEYICI.md` §8.0 · `docs/kurallar/deploy-kurulum.md`):
//! veritabanındaki BİTMİŞ göç adları (`finished_at IS NOT NULL AND rolled_back_at IS NULL`) paketin göç
//! adlarının (`prisma/migrations/<ad>/migration.sql`) ALT KÜMESİ değilse ŞEMA İLERİDE — paket şemayı geri
//! indirir, uygulanmaz. Sayı karşılaştırması bunu ölçmez (sayı eşit, ad farklı olabilir); ad bayt-eşit.
//! Aynası `deploy/hizmet/sema-hizasi.ps1` (setup + geçiş); eşlik ortak vektörlerle
//! (`test-vektorleri/sema-hizasi.json`, üreten `Teks-Erp/scripts/test_sema_hizasi.ts --vektor-yaz`).
use crate::env::Fs;
use std::collections::BTreeSet;
use std::path::Path;

/// Bitmiş göç adları — PS aynasındaki `$SEMA_BITMIS_GOC_SQL` ile BAYT-EŞİT (bekçi ölçer).
pub const FINISHED_MIGRATIONS_SQL: &str =
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1";

/// Paketin göç adları: `<sürüm>\prisma\migrations\<ad>\migration.sql` taşıyan her `<ad>` (bayt sıralı).
pub fn package_migrations(fs: &dyn Fs, version_dir: &Path) -> std::io::Result<Vec<String>> {
    let dir = version_dir.join("prisma").join("migrations");
    let mut out: Vec<String> = fs.list(&dir)?.into_iter().filter(|n| fs.exists(&dir.join(n).join("migration.sql"))).collect();
    out.sort();
    out.dedup();
    Ok(out)
}

/// `a`da olup `b`de olmayan adlar (bayt sıralı, tekil).
pub fn difference(a: &[String], b: &[String]) -> Vec<String> {
    let b: BTreeSet<&str> = b.iter().map(String::as_str).collect();
    a.iter().map(String::as_str).filter(|n| !b.contains(n)).collect::<BTreeSet<&str>>().into_iter().map(str::to_string).collect()
}

/// Veritabanında olup pakette olmayan bitmiş göçler; boş değilse şema İLERİDE (paket geri indirir).
pub fn ahead(db_finished: &[String], package: &[String]) -> Vec<String> {
    difference(db_finished, package)
}

/// Şema hizasının ÜÇ sonucu — ikisi ("uyumlu"/"ileride") yetmez: okunamayan yan boş küme sayılırsa ileri şema
/// sessizce "uyumlu" görünür.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Veritabanının bitmiş göçleri paketin alt kümesi: güncelleme sürer.
    Aligned,
    /// Veritabanında paketin taşımadığı bitmiş göçler (bayt sıralı): `SEMA_ILERIDE`, BEKLİYOR.
    Ahead(Vec<String>),
    /// Bir yan okunamadı (neden): `SEMA_OLCULEMEDI`, BİLGİ — güncelleme durmaz, sessiz de geçmez.
    Unmeasured(String),
}

/// Paketin ve veritabanının göç adları (ya da okunamama nedeni) → sonuç. Paket önce: ikisi de okunamazsa neden paketin.
pub fn verdict(db_finished: Result<Vec<String>, String>, package: Result<Vec<String>, String>) -> Verdict {
    let package = match package {
        Ok(p) => p,
        Err(e) => return Verdict::Unmeasured(format!("paketin göç dizini: {e}")),
    };
    let db = match db_finished {
        Ok(d) => d,
        Err(e) => return Verdict::Unmeasured(e),
    };
    let extra = ahead(&db, &package);
    if extra.is_empty() {
        Verdict::Aligned
    } else {
        Verdict::Ahead(extra)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(x: &[&str]) -> Vec<String> {
        x.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn same_count_different_name_is_ahead() {
        // Sayı eşit (2 = 2) ama veritabanındaki bir ad pakette yok: sayı karşılaştırması bunu kaçırırdı.
        assert_eq!(ahead(&v(&["0001_a", "0003_c"]), &v(&["0001_a", "0002_b"])), v(&["0003_c"]));
        assert!(ahead(&v(&["0001_a"]), &v(&["0001_a", "0002_b"])).is_empty(), "geride: paket ileri götürür");
        assert!(ahead(&v(&["0001_a", "0002_b"]), &v(&["0002_b", "0001_a"])).is_empty(), "eşit");
        assert_eq!(ahead(&v(&["0001_A"]), &v(&["0001_a"])), v(&["0001_A"]), "ad bayt-eşit");
    }

    #[test]
    fn unreadable_side_is_unmeasured_not_empty() {
        // Okunamayan yan BOŞ KÜME sayılsaydı veritabanı okunamayınca her paket "uyumlu" görünürdü.
        let ok = |x: &[&str]| -> Result<Vec<String>, String> { Ok(v(x)) };
        assert_eq!(verdict(ok(&["0001_a"]), ok(&["0001_a", "0002_b"])), Verdict::Aligned);
        assert_eq!(verdict(ok(&["0001_a", "0003_c"]), ok(&["0001_a"])), Verdict::Ahead(v(&["0003_c"])));
        assert!(matches!(verdict(Err("psql: bağlantı reddedildi".into()), ok(&["0001_a"])), Verdict::Unmeasured(w) if w.contains("psql")));
        assert!(matches!(verdict(ok(&["0001_a"]), Err("dizin yok".into())), Verdict::Unmeasured(w) if w.starts_with("paketin göç dizini")));
        assert!(
            matches!(verdict(Err("db".into()), Err("dizin yok".into())), Verdict::Unmeasured(w) if w.starts_with("paketin")),
            "ikisi de okunamazsa neden paketin"
        );
    }
}
