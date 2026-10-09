//! Tanı paketinin Linux ölçümleri (W4): Docker sürümü · compose projesinin konteynerlerinin SÜZÜLMÜŞ `docker inspect` alanları ·
//! systemd birim durumu · `df` (kök · veri · Docker kök dizini). Fail-soft: komut yoksa ya da düşerse ölçüm "ölçülemedi" satırıyla girer, paket
//! yine yazılır. `docker inspect`in `Env`/`Cmd`/`Args`/sağlık çıktısı sır taşıyabilir — yalnız izinli alanlar
//! alınır (allowlist; yeni Docker alanı kendiliğinden girmez).
use crate::tani::{Olcum, TaniHedefi};
use serde_json::{json, Map, Value};
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(20);
/// systemd'den okunan özellikler (`Environment` gibi sır taşıyabilen alanlar yok).
const SYSTEMD_PROPS: &str = "Id,LoadState,ActiveState,SubState,UnitFileState,Result,NRestarts,ExecMainStatus,ExecMainStartTimestamp,\
ActiveEnterTimestamp,StateChangeTimestamp,FragmentPath,DropInPaths,Restart,RestartUSec,WatchdogUSec";

/// Komutu zaman aşımıyla koşar; stdout (çıkış kodu sıfır değilse de) ya da hata metni.
fn run(program: &str, args: &[&str]) -> Result<(i32, String), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("{program} çalıştırılamadı: {}", e.kind()))?;
    let mut out = child.stdout.take().ok_or("stdout yok")?;
    let reader = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.by_ref().take(8 * 1024 * 1024).read_to_end(&mut b);
        b
    });
    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s.code().unwrap_or(-1),
            Ok(None) if started.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program}: zaman aşımı ({} sn)", TIMEOUT.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(format!("{program}: {}", e.kind())),
        }
    };
    let b = reader.join().unwrap_or_default();
    Ok((code, String::from_utf8_lossy(&b).into_owned()))
}

fn pick(v: &Value, path: &[&str]) -> Value {
    path.iter().try_fold(v, |x, k| x.get(k)).cloned().unwrap_or(Value::Null)
}

/// `docker inspect` nesnesinin izinli alanları.
pub fn filter_container(v: &Value) -> Value {
    let labels = v.pointer("/Config/Labels").and_then(Value::as_object);
    let label = |k: &str| labels.and_then(|l| l.get(k)).cloned().unwrap_or(Value::Null);
    let mounts: Vec<Value> = v
        .get("Mounts")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|m| json!({ "tur": m.get("Type"), "kaynak": m.get("Source"), "hedef": m.get("Destination"), "yazilabilir": m.get("RW") })).collect())
        .unwrap_or_default();
    json!({
        "ad": pick(v, &["Name"]),
        "imaj": pick(v, &["Config", "Image"]),
        "imajKimligi": pick(v, &["Image"]),
        "olusturuldu": pick(v, &["Created"]),
        "durum": {
            "durum": pick(v, &["State", "Status"]),
            "calisiyor": pick(v, &["State", "Running"]),
            "yenidenBasliyor": pick(v, &["State", "Restarting"]),
            "oomKilled": pick(v, &["State", "OOMKilled"]),
            "olu": pick(v, &["State", "Dead"]),
            "cikisKodu": pick(v, &["State", "ExitCode"]),
            "hata": pick(v, &["State", "Error"]),
            "basladi": pick(v, &["State", "StartedAt"]),
            "bitti": pick(v, &["State", "FinishedAt"]),
            "saglik": pick(v, &["State", "Health", "Status"]),
            "saglikHataDizisi": pick(v, &["State", "Health", "FailingStreak"]),
        },
        "yenidenBaslatmaSayisi": pick(v, &["RestartCount"]),
        "yenidenBaslatmaPolitikasi": pick(v, &["HostConfig", "RestartPolicy"]),
        "compose": {
            "proje": label("com.docker.compose.project"),
            "hizmet": label("com.docker.compose.service"),
            "surum": label("com.docker.compose.version"),
        },
        "baglar": mounts,
    })
}

/// `docker version --format '{{json .}}'`in izinli alanları.
pub fn filter_version(v: &Value) -> Value {
    json!({
        "istemci": { "surum": pick(v, &["Client", "Version"]), "api": pick(v, &["Client", "ApiVersion"]) },
        "sunucu": {
            "surum": pick(v, &["Server", "Version"]),
            "api": pick(v, &["Server", "ApiVersion"]),
            "os": pick(v, &["Server", "Os"]),
            "mimari": pick(v, &["Server", "Arch"]),
        },
    })
}

/// `ayar.json`daki compose projesi (W4 açık noktası, L4b): yalnız o projenin konteynerleri ölçülür — aynı
/// konaktaki başka proje (ikinci kanal, başka yazılım) pakete girmez.
fn proje(h: &TaniHedefi) -> String {
    let layout = crate::layout::Layout::new(&h.root, &h.data);
    crate::settings::read_settings(&crate::env::RealFs, &layout).unwrap_or_default().compose_project().to_string()
}

fn docker(proje: &str) -> Value {
    let mut m = Map::new();
    m.insert("proje".into(), json!(proje));
    m.insert(
        "surum".into(),
        match run("docker", &["version", "--format", "{{json .}}"]) {
            Ok((_, out)) => {
                serde_json::from_str::<Value>(out.trim()).map_or_else(|_| json!("ölçülemedi: çıktı JSON değil"), |v| filter_version(&v))
            }
            Err(e) => json!(format!("ölçülemedi: {e}")),
        },
    );
    let filter = format!("label=com.docker.compose.project={proje}");
    let ids = match run("docker", &["ps", "-a", "-q", "--no-trunc", "--filter", &filter]) {
        Ok((0, out)) => out.split_whitespace().map(str::to_string).collect::<Vec<_>>(),
        Ok((c, _)) => {
            m.insert("konteynerler".into(), json!(format!("ölçülemedi: docker ps çıkış {c}")));
            return Value::Object(m);
        }
        Err(e) => {
            m.insert("konteynerler".into(), json!(format!("ölçülemedi: {e}")));
            return Value::Object(m);
        }
    };
    let containers = if ids.is_empty() {
        json!([])
    } else {
        let mut args = vec!["inspect"];
        args.extend(ids.iter().map(String::as_str));
        match run("docker", &args) {
            Ok((_, out)) => match serde_json::from_str::<Value>(&out) {
                Ok(Value::Array(a)) => Value::Array(a.iter().map(filter_container).collect()),
                _ => json!("ölçülemedi: docker inspect çıktısı JSON dizisi değil"),
            },
            Err(e) => json!(format!("ölçülemedi: {e}")),
        }
    };
    m.insert("konteynerler".into(), containers);
    Value::Object(m)
}

fn systemd(units: &[String]) -> String {
    let mut out = String::new();
    for u in units {
        out.push_str(&format!("## {u}\n"));
        match run("systemctl", &["show", u, &format!("--property={SYSTEMD_PROPS}")]) {
            Ok((_, s)) => out.push_str(&s),
            Err(e) => out.push_str(&format!("ölçülemedi: {e}\n")),
        }
        out.push('\n');
    }
    out
}

pub fn olcumler(h: &TaniHedefi) -> Vec<Olcum> {
    let units = vec![format!("{}.service", h.updater_service.to_ascii_lowercase()), "docker.service".to_string()];
    let root = h.root.to_string_lossy().into_owned();
    let data = h.data.to_string_lossy().into_owned();
    // Docker kök dizini (imajlar + birimler) çoğu zaman diski dolduran yerdir; bilinmiyorsa varsayılanı.
    let docker_root = match run("docker", &["info", "--format", "{{.DockerRootDir}}"]) {
        Ok((0, s)) if s.trim().starts_with('/') => s.trim().to_string(),
        _ => "/var/lib/docker".to_string(),
    };
    let df = match run("df", &["-Pk", &root, &data, &docker_root]) {
        Ok((_, s)) => s,
        Err(e) => format!("ölçülemedi: {e}\n"),
    };
    vec![
        Olcum::new(
            "platform/docker.json",
            "Docker sürümü + konteynerler (süzülmüş inspect: durum · sağlık · imaj · bağlar; ortam/komut YOK)",
            docker(&proje(h)).to_string(),
        ),
        Olcum::new("platform/systemd.txt", "systemd birim durumu (güncelleyici + docker)", systemd(&units)),
        Olcum::new("platform/df.txt", "disk (df -Pk: kök · veri · Docker kök dizini)", df),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inspect_suzgeci_ortam_ve_komut_almaz() {
        let v = json!({
            "Name": "/tekserp-backend-1",
            "Image": "sha256:abc",
            "Args": ["--parola", "ARGSIRRI"],
            "Config": { "Image": "tekserp/backend:1.2.3", "Env": ["DATABASE_URL=postgresql://u:ENVSIRRI@db/x"], "Cmd": ["node"],
                        "Labels": { "com.docker.compose.project": "tekserp", "gizli": "ETIKETSIRRI" } },
            "State": { "Status": "running", "Running": true, "Health": { "Status": "healthy", "Log": [{ "Output": "SAGLIKSIRRI" }] } },
            "Mounts": [{ "Type": "bind", "Source": "/opt/tekserp", "Destination": "/app", "RW": false }],
        });
        let f = filter_container(&v).to_string();
        for s in ["ARGSIRRI", "ENVSIRRI", "ETIKETSIRRI", "SAGLIKSIRRI"] {
            assert!(!f.contains(s), "{s} süzgeçten geçti: {f}");
        }
        assert!(f.contains("healthy") && f.contains("tekserp/backend:1.2.3") && f.contains("/opt/tekserp"));
    }

    #[test]
    fn olcum_fail_soft() {
        assert!(run("tekserp-olmayan-komut-xyz", &[]).is_err());
    }
}
