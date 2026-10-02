//! JSON yardımcıları — JS anlamıyla: `JSON.parse` (geçersiz UTF-8 yerine U+FFFD), sayı =
//! IEEE-754 double, dizge uzunluğu = UTF-16 kod birimi (Zod `.max()` böyle sayar).
//!
//! Beyanlı sapmalar (imzasız saldırı girdisi; iki tarafta da belge reddedilir, kod farklı
//! olabilir): eşlenmemiş vekil kaçışı (`"\ud800"`) ve 128'den derin iç içe yapı serde'de
//! ayrıştırma hatasıdır, JS'te değildir.
use serde_json::{Map, Value};

pub fn parse_lossy(bytes: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(&text).ok()
}

pub fn as_object(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}

/// JS `Number` değeri (arbitrary_precision: `1e400` → sonsuz, JS gibi).
pub fn js_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64().or_else(|| n.to_string().parse::<f64>().ok()),
        _ => None,
    }
}

pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JS `String(value)` — mesajlarda kullanılır (yalnız ilkel türler anlamlı).
pub fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Array(_)) => "[dizi]".to_string(),
        Some(Value::Object(_)) => "[object Object]".to_string(),
    }
}

/// Sayıları double olarak karşılaştıran derin eşitlik (`1` ile `1.0` aynı değerdir).
pub fn deep_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(_), Value::Number(_)) => js_number(a) == js_number(b),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| deep_equal(p, q)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| deep_equal(v, w))),
        _ => a == b,
    }
}
