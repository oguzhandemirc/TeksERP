//! PostgreSQL küçük sürüm güncellemesi — D4 `KENDI-POSTGRESQL.md` §5 U0–U11 (§9). Yalnız
//! `pgsql\ornek.json` `kip: "kendi"`de; harici kipte PG'ye DOKUNULMAZ (yalnız `pg.enAz` denetimi,
//! motor yapar). Veri dizinine dokunulmaz; geri dönüş = eski ImagePath + eski `pgsql\bin` bağlantısı.
use crate::codes;
use crate::download;
use crate::env::Env;
use crate::layout::Layout;
use crate::operation::{self, start_service, step_err, stop_service, switch_link, Ctx, OpOutcome, Operation, StepError};
use crate::tools;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tekserp_hizmet::timefmt;

/// Sahne içerik manifestosu (D4: `shasum -c` biçimi, `<hex>  <yol>`).
pub const CONTENT_MANIFEST: &str = "TEKSERP-ICERIK.sha256";

/// `pgsql\ornek.json` (D4 §6).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Instance {
    pub bicim: u32,
    pub kip: String,
    pub hizmet: String,
    pub surum: String,
    pub derleme: String,
    #[serde(rename = "ikiliDizin")]
    pub bin_dir: PathBuf,
    #[serde(rename = "oncekiIkiliDizin")]
    pub previous_bin_dir: Option<PathBuf>,
    #[serde(rename = "veriDizini")]
    pub data_dir: PathBuf,
    pub port: u16,
    pub kuruldu: String,
    pub guncellendi: Option<String>,
}

impl Instance {
    pub fn own(&self) -> bool {
        self.kip == "kendi"
    }
    pub fn tag(&self) -> String {
        format!("{}-{}", self.surum, self.derleme)
    }
}

pub fn read_instance(env: &Env, layout: &Layout) -> Option<Instance> {
    env.fs.read(&layout.pg_instance_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// `bin\icuuc<N>.dll` → N (ICU sürümü değişirse ICU'ya bağlı index'ler yeniden kurulur, D4 U9).
pub fn icu_version(env: &Env, dir: &Path) -> Option<String> {
    env.fs.list(&dir.join("bin")).ok()?.into_iter().find_map(|n| {
        let l = n.to_ascii_lowercase();
        let rest = l.strip_prefix("icuuc")?.strip_suffix(".dll")?;
        (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())).then(|| rest.to_string())
    })
}

/// İçerik manifestosuna karşı ölçüm: manifestonun özeti imzalı değere (`icerikSha256`, hex) eşit, her
/// satırdaki dosya var ve özeti tutuyor, listede olmayan dosya YOK.
pub fn verify_content(env: &Env, dir: &Path, content_sha256_hex: &str) -> Result<usize, String> {
    let text = env.fs.read(&dir.join(CONTENT_MANIFEST)).map_err(|e| format!("{CONTENT_MANIFEST} yok: {e}"))?;
    if download::hex(&Sha256::digest(&text)) != content_sha256_hex {
        return Err("içerik manifestosunun özeti imzalı değerle aynı değil".into());
    }
    let text = String::from_utf8(text).map_err(|_| "içerik manifestosu UTF-8 değil".to_string())?;
    let mut listed = std::collections::BTreeSet::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let (hex, rest) = line.split_at_checked(64).ok_or("içerik satırı kısa")?;
        let rel = rest.strip_prefix("  ").or_else(|| rest.strip_prefix(" *")).ok_or("içerik satırı biçimsiz")?;
        if rel.contains("..") || rel.starts_with('/') || rel.contains(':') || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("içerik satırı güvensiz: {rel}"));
        }
        let path = rel.split(['/', '\\']).fold(dir.to_path_buf(), |acc, seg| acc.join(seg));
        let got = download::sha256_file(env, &path).map_err(|e| format!("{rel}: {e}"))?;
        if got != hex.to_ascii_lowercase() {
            return Err(format!("{rel}: özet tutmuyor"));
        }
        listed.insert(rel.replace('\\', "/"));
    }
    let mut extra = Vec::new();
    walk(env, dir, dir, &mut |rel| {
        if rel != CONTENT_MANIFEST && !listed.contains(rel) {
            extra.push(rel.to_string());
        }
    });
    if let Some(x) = extra.first() {
        return Err(format!("içerik manifestosunda olmayan dosya: {x} (+{})", extra.len() - 1));
    }
    Ok(listed.len())
}

fn walk(env: &Env, root: &Path, dir: &Path, f: &mut dyn FnMut(&str)) {
    for name in env.fs.list(dir).unwrap_or_default() {
        let p = dir.join(&name);
        if env.fs.is_dir(&p) {
            walk(env, root, &p, f);
        } else if let Ok(rel) = p.strip_prefix(root) {
            f(&rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

pub const PG_STEPS: &[&str] =
    &["PG_YEDEK", "BACKEND_DURDUR", "PG_DURDUR", "PG_YOL", "PG_BAGLANTI", "PG_BASLAT", "PG_ICU", "BACKEND_BASLAT", "ONAY"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PgPlan {
    #[serde(rename = "tur")]
    pub kind: String,
    #[serde(rename = "islemId")]
    pub op_id: String,
    #[serde(rename = "onayId")]
    pub approval_id: Option<String>,
    /// Bu PG adımının ön koşul olduğu backend sürümü (denemenin hedefi — rapor `hedefSurum`).
    #[serde(rename = "hedefBackend")]
    pub backend_target: String,
    #[serde(rename = "kaynakSurum")]
    pub source_tag: String,
    #[serde(rename = "surum")]
    pub target_tag: String,
    #[serde(rename = "eskiSunucuSurumu")]
    pub source_server_version: String,
    #[serde(rename = "yeniSunucuSurumu")]
    pub target_server_version: String,
    #[serde(rename = "hizmet")]
    pub service: String,
    #[serde(rename = "oncekiDizin")]
    pub old_dir: PathBuf,
    #[serde(rename = "yeniDizin")]
    pub new_dir: PathBuf,
    #[serde(rename = "oncekiYol")]
    pub old_image_path: String,
    #[serde(rename = "yeniYol")]
    pub new_image_path: String,
    #[serde(rename = "veriDizini")]
    pub data_dir: PathBuf,
    #[serde(rename = "icuDegisti")]
    pub icu_changed: bool,
    #[serde(rename = "backendSurumu")]
    pub backend_version: String,
    #[serde(rename = "araclar")]
    pub tools_dir: PathBuf,
    #[serde(rename = "basladi")]
    pub started_ms: i64,
}

/// ImagePath'teki eski sürüm dizinini yenisiyle değiştirir (Windows'ta büyük/küçük harf duyarsız).
pub fn replace_dir(command_line: &str, old_dir: &Path, new_dir: &Path) -> Option<String> {
    let old = old_dir.to_string_lossy().to_string();
    let new = new_dir.to_string_lossy().to_string();
    let hay = if cfg!(windows) { command_line.to_ascii_lowercase() } else { command_line.to_string() };
    let needle = if cfg!(windows) { old.to_ascii_lowercase() } else { old.clone() };
    let i = hay.find(&needle)?;
    Some(format!("{}{}{}", &command_line[..i], new, &command_line[i + old.len()..]))
}

pub struct PgOp {
    pub plan: PgPlan,
}

impl PgOp {
    fn wait_version(&self, ctx: &Ctx, bin_dir: &Path, want: &str) -> Result<(), StepError> {
        let deadline = ctx.env.clock.now_ms() + 60_000;
        loop {
            let last = match tools::server_version(ctx.env, ctx.backend, &bin_dir.join("bin")) {
                Ok(v) if v == want => return Ok(()),
                Ok(v) => return Err(step_err(codes::PG_SURUM_UYUSMAZ, format!("sunucu {v} diyor, beklenen {want}"))),
                Err(e) => e,
            };
            if ctx.env.clock.now_ms() >= deadline {
                return Err(step_err(codes::PG_BASLAMADI, format!("PostgreSQL 60 sn içinde bağlantı kabul etmedi: {last}")));
            }
            ctx.env.clock.sleep(Duration::from_secs(2));
        }
    }

    /// ICU collation'a bağlı index'ler katalogdan bulunup yeniden kurulur, collation sürümleri tazelenir.
    fn reindex_icu(&self, ctx: &Ctx, bin_dir: &Path) -> Result<(), StepError> {
        let db = &ctx.backend.db;
        let sql = "SET statement_timeout = 0; DO $$ DECLARE r record; BEGIN \
            FOR r IN SELECT DISTINCT i.indexrelid::regclass AS ix FROM pg_index i JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = i.indexrelid AND d.refclassid = 'pg_collation'::regclass JOIN pg_collation c ON c.oid = d.refobjid WHERE c.collprovider = 'i' LOOP EXECUTE 'REINDEX INDEX ' || r.ix; END LOOP; \
            FOR r IN SELECT c.oid::regcollation AS co FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace WHERE c.collprovider = 'i' AND n.nspname NOT IN ('pg_catalog', 'information_schema') LOOP EXECUTE 'ALTER COLLATION ' || r.co || ' REFRESH VERSION'; END LOOP; END $$;";
        let psql = bin_dir.join("bin").join(if cfg!(windows) { "psql.exe" } else { "psql" });
        let c = crate::env::Cmd::new(&psql)
            .env("PGPASSWORD", &db.password)
            .args([
                "-X",
                "-w",
                "-h",
                &db.host,
                "-p",
                &db.port.to_string(),
                "-U",
                &db.user,
                "-d",
                &db.database,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
            ])
            .timeout(Duration::from_secs(3600));
        let out = ctx.env.procs.run(&c).map_err(|e| step_err(codes::PG_ICU_HATASI, e.0))?;
        if !out.ok() {
            return Err(step_err(codes::PG_ICU_HATASI, tools::describe_failure("ICU yeniden dizinleme", &out)));
        }
        Ok(())
    }

    fn set_image_path(&self, ctx: &Ctx, want: &str) -> Result<(), StepError> {
        let svc = ctx.env.svc.as_ref();
        if svc.image_path(&self.plan.service).map_err(|e| step_err(codes::PG_YOL_HATASI, e.0))? == want {
            return Ok(());
        }
        svc.set_image_path(&self.plan.service, want).map_err(|e| step_err(codes::PG_YOL_HATASI, e.0))?;
        let back = svc.image_path(&self.plan.service).map_err(|e| step_err(codes::PG_YOL_HATASI, e.0))?;
        if back != want {
            return Err(step_err(codes::PG_YOL_HATASI, "ImagePath geri okunduğunda farklı"));
        }
        Ok(())
    }

    fn backend_health(&self, ctx: &Ctx) -> Result<(), StepError> {
        let c = crate::health::Criteria { version: self.plan.backend_version.clone(), require_license: false, baseline: None };
        crate::health::wait_healthy(ctx.env, ctx.backend.port, &c, ctx.settings.health_timeout(), Some(ctx.settings.backend_service()))
            .map(|_| ())
            .map_err(|(code, m)| step_err(code, m))
    }

    fn update_instance(&self, ctx: &Ctx) -> Result<(), StepError> {
        let mut inst = read_instance(ctx.env, ctx.layout).ok_or_else(|| step_err(codes::IC_HATA, "ornek.json okunamadı"))?;
        let (surum, derleme) = self.plan.target_tag.split_once('-').unwrap_or((&self.plan.target_tag, ""));
        inst.surum = surum.to_string();
        inst.derleme = derleme.to_string();
        inst.previous_bin_dir = Some(self.plan.old_dir.clone());
        inst.bin_dir = self.plan.new_dir.clone();
        inst.guncellendi = Some(timefmt::iso_seconds(ctx.env.clock.now_ms()));
        let text = serde_json::to_vec_pretty(&inst).map_err(|e| step_err(codes::IC_HATA, e.to_string()))?;
        ctx.env.fs.write_atomic(&ctx.layout.pg_instance_file(), &text).map_err(|e| step_err(codes::IC_HATA, e.to_string()))?;
        // Bir önceki sürüm KALIR (geri dönüş); daha eskileri silinir.
        let keep =
            [&self.plan.new_dir, &self.plan.old_dir].map(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
        for name in ctx.env.fs.list(&ctx.layout.pgsql()).unwrap_or_default() {
            let p = ctx.layout.pgsql().join(&name);
            let versioned = name
                .split_once('-')
                .is_some_and(|(v, b)| v.split('.').all(|x| x.bytes().all(|c| c.is_ascii_digit())) && b.bytes().all(|c| c.is_ascii_digit()));
            if (name.starts_with(".hazirlik-") || versioned) && !keep.contains(&name) && ctx.env.fs.is_dir(&p) {
                let _ = ctx.env.fs.remove_dir_all(&p);
            }
        }
        Ok(())
    }
}

impl Operation for PgOp {
    fn op_id(&self) -> &str {
        &self.plan.op_id
    }
    fn product(&self) -> &'static str {
        "pg"
    }
    fn source(&self) -> &str {
        &self.plan.source_tag
    }
    fn target(&self) -> &str {
        &self.plan.target_tag
    }
    fn approval_id(&self) -> Option<&str> {
        self.plan.approval_id.as_deref()
    }
    fn steps(&self) -> &'static [&'static str] {
        PG_STEPS
    }
    fn rollback_if_interrupted(&self, _step: &str) -> bool {
        false
    }

    fn run_step(&self, ctx: &Ctx, _view: &crate::journal::OpView, step: &str) -> Result<Value, StepError> {
        let p = &self.plan;
        match step {
            "PG_YEDEK" => operation::take_backup(ctx, &p.op_id, &p.tools_dir),
            "BACKEND_DURDUR" => {
                stop_service(ctx, ctx.settings.backend_service(), codes::HIZMET_YOK, codes::HIZMET_DURMADI).map(|()| Value::Null)
            }
            "PG_DURDUR" => {
                stop_service(ctx, &p.service, codes::HIZMET_YOK, codes::PG_DURMADI)?;
                if ctx.env.fs.exists(&p.data_dir.join("postmaster.pid")) {
                    return Err(step_err(codes::PG_DURMADI, "postmaster.pid duruyor (PostgreSQL tam kapanmadı)"));
                }
                Ok(Value::Null)
            }
            "PG_YOL" => self.set_image_path(ctx, &p.new_image_path).map(|()| Value::Null),
            "PG_BAGLANTI" => {
                switch_link(ctx, &ctx.layout.pg_bin_link(), &p.new_dir.join("bin"), codes::PG_YOL_HATASI).map(|()| Value::Null)
            }
            "PG_BASLAT" => {
                start_service(ctx, &p.service, &[], codes::PG_BASLAMADI)?;
                self.wait_version(ctx, &p.new_dir, &p.target_server_version).map(|()| Value::Null)
            }
            "PG_ICU" => {
                if p.icu_changed {
                    self.reindex_icu(ctx, &p.new_dir)?;
                }
                Ok(json!({ "yenidenDizinlendi": p.icu_changed }))
            }
            "BACKEND_BASLAT" => {
                start_service(ctx, ctx.settings.backend_service(), &[], codes::HIZMET_BASLAMADI)?;
                self.backend_health(ctx).map(|()| Value::Null)
            }
            "ONAY" => self.update_instance(ctx).map(|()| Value::Null),
            other => Err(step_err(codes::IC_HATA, format!("bilinmeyen adım {other}"))),
        }
    }

    fn has_compensation(&self, step: &str) -> bool {
        matches!(step, "BACKEND_DURDUR" | "PG_DURDUR" | "PG_YOL" | "PG_BAGLANTI" | "PG_BASLAT" | "BACKEND_BASLAT")
    }

    fn compensate(&self, ctx: &Ctx, view: &crate::journal::OpView, step: &str) -> Result<Value, StepError> {
        let p = &self.plan;
        let done = |r: Result<(), StepError>| r.map(|()| Value::Null);
        match step {
            "BACKEND_BASLAT" => {
                done(operation::stop_and_settle(ctx, ctx.settings.backend_service(), codes::HIZMET_YOK, codes::HIZMET_DURMADI))
            }
            "PG_BASLAT" => done(stop_service(ctx, &p.service, codes::HIZMET_YOK, codes::PG_DURMADI)),
            "PG_BAGLANTI" => done(switch_link(ctx, &ctx.layout.pg_bin_link(), &p.old_dir.join("bin"), codes::PG_YOL_HATASI)),
            "PG_YOL" => done(self.set_image_path(ctx, &p.old_image_path)),
            "PG_DURDUR" => {
                start_service(ctx, &p.service, &[], codes::PG_BASLAMADI)?;
                self.wait_version(ctx, &p.old_dir, &p.source_server_version)?;
                if view.began("PG_ICU") && p.icu_changed {
                    self.reindex_icu(ctx, &p.old_dir)?;
                }
                Ok(Value::Null)
            }
            "BACKEND_DURDUR" => {
                start_service(ctx, ctx.settings.backend_service(), &[], codes::GERI_DONUS_SAGLIKSIZ)?;
                done(
                    self.backend_health(ctx).map_err(|e| {
                        step_err(codes::GERI_DONUS_SAGLIKSIZ, format!("backend sağlıklı başlamadı: {} {}", e.code, e.message))
                    }),
                )
            }
            _ => Ok(Value::Null),
        }
    }

    fn after_result(&self, ctx: &Ctx, view: &crate::journal::OpView, outcome: &OpOutcome) {
        let (result, code) = match outcome {
            OpOutcome::Succeeded => (crate::ipc::State::Succeeded, None),
            OpOutcome::RolledBack(e) => (crate::ipc::State::RolledBack, Some(e.code.to_string())),
            OpOutcome::Failed(e) => (crate::ipc::State::Failed, Some(e.code.to_string())),
        };
        let line = crate::ipc::HistoryLine {
            v: 1,
            op_id: self.plan.op_id.clone(),
            approval_id: self.plan.approval_id.clone(),
            product: "pg".into(),
            backend_target: Some(self.plan.backend_target.clone()),
            source_version: self.plan.source_tag.clone(),
            version: self.plan.target_tag.clone(),
            result,
            error_code: code.as_deref().map(|c| codes::report_code(c).to_string()),
            detail_code: code,
            data_restored: false,
            started: timefmt::iso_millis(self.plan.started_ms),
            finished: ctx.now_iso(),
            migrations: crate::ipc::MigrationCounts { before: None, after: None },
            backup: view.ended("PG_YEDEK").then(|| self.plan.op_id.clone()),
            approval: None,
        };
        let _ = crate::ipc::append_history(ctx.env.fs.as_ref(), ctx.layout, &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_path_dir_replacement() {
        let old = PathBuf::from("/k/pgsql/16.9-1");
        let new = PathBuf::from("/k/pgsql/16.15-4");
        let cl = "\"/k/pgsql/16.9-1/bin/pg_ctl\" runservice -N \"TeksERP-PostgreSQL\" -D \"/k/pgveri\" -w";
        assert_eq!(
            replace_dir(cl, &old, &new).as_deref(),
            Some("\"/k/pgsql/16.15-4/bin/pg_ctl\" runservice -N \"TeksERP-PostgreSQL\" -D \"/k/pgveri\" -w")
        );
        assert_eq!(replace_dir("\"/baska/bin/pg_ctl\"", &old, &new), None);
    }
}
