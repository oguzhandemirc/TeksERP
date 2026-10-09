//! Compose kuralları (L4c-2, `GUNCELLEYICI-SAGLAMLIK.md` §5 halka 7): imzalı compose dosyası bile bu kurallara
//! uymuyorsa YÜKLENMEZ (`COMPOSE_HATASI`; savunma derinliği). Girdi `docker compose config --format json`un
//! normalleştirilmiş çıktısıdır — YAML'ı compose çözer, kurallar yalnız yapıya bakar. Üçüncü taraf imajlı servis
//! (PG: açılışta root ister) yalnız ortak kurallara tabidir; `tekserp-korumali` imajlı her servis sertleştirilmiş koşar.
use serde_json::{Map, Value};

/// TLS'i sonlandıran vekil servisi: yayımlı port ve ana makine ağı yalnız onda serbest.
pub const KENAR: &str = "kenar";

fn arr<'a>(s: &'a Map<String, Value>, k: &str) -> &'a [Value] {
    s.get(k).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn has_str(s: &Map<String, Value>, k: &str, want: &[&str]) -> bool {
    arr(s, k).iter().filter_map(Value::as_str).any(|v| want.contains(&v))
}

fn loopback(ip: &str) -> bool {
    ip == "127.0.0.1" || ip == "::1" || ip == "[::1]"
}

fn root_user(u: &str) -> bool {
    let name = u.split(':').next().unwrap_or_default();
    name.is_empty() || name == "0" || name == "root"
}

/// Kural ihlalleri (boşsa geçer). `surum` paketin sürümü: bizim imajımızı kullanan servis yalnız onu gösterir.
pub fn ihlaller(cfg: &Value, surum: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Some(services) = cfg.get("services").and_then(Value::as_object).filter(|s| !s.is_empty()) else {
        return vec!["servis yok".into()];
    };
    let ours = crate::oci::image_tag(surum);
    let prefix = format!("{}:", crate::oci::IMAJ_ADI);
    match services.get(super::docker::BACKEND).and_then(Value::as_object).and_then(|b| b.get("image")).and_then(Value::as_str) {
        Some(i) if i == ours => {}
        other => out.push(format!("backend imajı {other:?} ({ours} bekleniyor)")),
    }
    for (name, s) in services {
        let Some(s) = s.as_object() else {
            out.push(format!("{name}: biçimsiz"));
            continue;
        };
        let mut bad = |m: String| out.push(format!("{name}: {m}"));
        if s.get("pull_policy").and_then(Value::as_str) != Some("never") {
            bad("pull_policy never değil (imaj dışarıdan çekilebilir)".into());
        }
        if s.get("privileged").and_then(Value::as_bool) == Some(true) {
            bad("privileged".into());
        }
        for k in ["pid", "ipc", "userns_mode"] {
            if s.get(k).and_then(Value::as_str) == Some("host") {
                bad(format!("{k}: host"));
            }
        }
        if name != KENAR && s.get("network_mode").and_then(Value::as_str) == Some("host") {
            bad("network_mode: host".into());
        }
        for v in arr(s, "volumes") {
            let src = v.get("source").and_then(Value::as_str).unwrap_or_default();
            let dst = v.get("target").and_then(Value::as_str).unwrap_or_default();
            if src.ends_with("docker.sock") || dst.ends_with("docker.sock") || src.trim_end_matches('/') == "/run/docker" {
                bad(format!("Docker soketi bağlı ({src})"));
            }
        }
        if name != KENAR {
            for p in arr(s, "ports") {
                let ip = p.get("host_ip").and_then(Value::as_str).unwrap_or_default();
                if p.get("published").is_some_and(|x| !x.is_null()) && !loopback(ip) {
                    bad(format!("port yalnız bu makineye değil ({:?}:{})", ip, p.get("published").cloned().unwrap_or_default()));
                }
            }
        }
        let image = s.get("image").and_then(Value::as_str).unwrap_or_default();
        if image.starts_with(&prefix) {
            if image != ours {
                bad(format!("imaj {image} ({ours} bekleniyor)"));
            }
            if s.get("read_only").and_then(Value::as_bool) != Some(true) {
                bad("kök dosya sistemi salt okunur değil".into());
            }
            if !has_str(s, "cap_drop", &["ALL", "all"]) {
                bad("cap_drop ALL yok".into());
            }
            if !has_str(s, "security_opt", &["no-new-privileges:true", "no-new-privileges", "no-new-privileges=true"]) {
                bad("no-new-privileges yok".into());
            }
            if root_user(s.get("user").and_then(Value::as_str).unwrap_or_default()) {
                bad("root kullanıcısıyla koşar".into());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sertlesmis(image: &str) -> Value {
        json!({ "image": image, "pull_policy": "never", "read_only": true, "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"], "user": "10001:10001",
            "volumes": [{ "type": "volume", "source": "lisans", "target": "/var/lib/tekserp/lisans" }] })
    }
    /// `docker-compose.guncelleyici.yml`in `config --format json` biçimi (yapı; değerler kısaltılmış).
    fn sablon() -> Value {
        let mut b = sertlesmis("tekserp-korumali:2.0.0");
        b["ports"] = json!([{ "mode": "ingress", "host_ip": "127.0.0.1", "target": 4000, "published": "4000", "protocol": "tcp" }]);
        json!({ "name": "tekserp", "services": {
            "postgres": { "image": "postgres:16-bookworm", "pull_policy": "never",
                "volumes": [{ "type": "volume", "source": "pg_data", "target": "/var/lib/postgresql/data" }] },
            "backend": b,
            "yedek": sertlesmis("tekserp-korumali:2.0.0"),
        } })
    }

    #[test]
    fn sablon_gecer() {
        assert_eq!(ihlaller(&sablon(), "2.0.0"), Vec::<String>::new());
        // Kenar vekili ana makine ağında ve yayımlı portla durabilir.
        let mut c = sablon();
        c["services"]["kenar"] = json!({ "image": "nginx:1", "pull_policy": "never", "network_mode": "host",
            "ports": [{ "host_ip": "0.0.0.0", "target": 443, "published": "443" }] });
        assert_eq!(ihlaller(&c, "2.0.0"), Vec::<String>::new());
    }

    /// `compose_kurali_reddeder`: her kural tek başına ihlal edilince reddeder (ihlal iletisi kuralı adlandırır).
    #[test]
    fn compose_kurali_reddeder() {
        type Boz = fn(&mut Value);
        let cases: [(&str, Boz, &str); 14] = [
            (
                "postgres pull_policy",
                |c| c["services"]["postgres"].as_object_mut().unwrap().remove("pull_policy").map(drop).unwrap(),
                "postgres: pull_policy",
            ),
            ("backend pull_policy always", |c| c["services"]["backend"]["pull_policy"] = json!("always"), "backend: pull_policy"),
            ("read_only", |c| c["services"]["backend"]["read_only"] = json!(false), "backend: kök dosya sistemi"),
            ("cap_drop", |c| c["services"]["yedek"]["cap_drop"] = json!(["NET_RAW"]), "yedek: cap_drop"),
            ("no-new-privileges", |c| c["services"]["backend"]["security_opt"] = json!([]), "backend: no-new-privileges"),
            ("root", |c| c["services"]["yedek"]["user"] = json!("0:0"), "yedek: root"),
            ("port dışarı", |c| c["services"]["backend"]["ports"][0]["host_ip"] = json!("0.0.0.0"), "backend: port"),
            (
                "port adressiz",
                |c| c["services"]["backend"]["ports"][0].as_object_mut().unwrap().remove("host_ip").map(drop).unwrap(),
                "backend: port",
            ),
            (
                "soket",
                |c| c["services"]["postgres"]["volumes"] = json!([{ "type": "bind", "source": "/var/run/docker.sock", "target": "/s" }]),
                "postgres: Docker soketi",
            ),
            ("privileged", |c| c["services"]["postgres"]["privileged"] = json!(true), "postgres: privileged"),
            ("host ağı", |c| c["services"]["yedek"]["network_mode"] = json!("host"), "yedek: network_mode"),
            ("başka sürümün imajı", |c| c["services"]["yedek"]["image"] = json!("tekserp-korumali:1.9.0"), "yedek: imaj"),
            ("backend yok", |c| c["services"].as_object_mut().unwrap().remove("backend").map(drop).unwrap(), "backend imajı"),
            ("servis yok", |c| c["services"] = json!({}), "servis yok"),
        ];
        for (ad, boz, want) in cases {
            let mut c = sablon();
            boz(&mut c);
            let v = ihlaller(&c, "2.0.0");
            assert!(v.iter().any(|m| m.contains(want)), "{ad}: {v:?}");
        }
        // Sürüm bildirimin sürümü değil: backend de reddedilir.
        assert!(ihlaller(&sablon(), "2.0.1").iter().any(|m| m.starts_with("backend imajı")));
    }
}
