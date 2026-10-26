# Bildirim v2 — ölçüm ve duman sonuçları (N6-ENTEG, 2026-10-26)

> Kapsam: bildirim gelen kutusu (`bildirim.gelenKutusuEnabled`) uçtan uca — dağıtıcı, koşul tarayıcısı, SSE zil, web panel, bayrak aç/kapa.
> Ortam: test DB `tekserp_n6_test` (sentetik: 100 kullanıcı + 2000 sipariş / 600 iş emri / 300 sevkiyat). Fabrika yedeği KULLANILMADI.
> Betikler ve ham JSON'lar scratchpad'dedir (`~/.tekserp/bildirim-v2-1024/n6-olcum/`: `faz-a.ts`, `faz-b.ts`, `duman.ts`, `ekran.mjs`), REPOYA GİRMEZ (test parolası/TOTP dosyası yanlarında).
> Plan: `docs/design/BILDIRIM-SISTEMI-PLAN.md`; açma adımları: `docs/ops/BILDIRIM-ACMA-RUNBOOK.md`.

## 1. Ölçüm tablosu

| Ölçü | Sonuç | Not |
|---|---|---|
| Dağıtıcı turu: 100 outbox satırı × 52 alıcı | medyan 303 ms (2652 upsert) | tur başı 100 satır |
| Dağıtıcı turu: 100 satır × 102 alıcı | medyan 529 ms (5202 upsert) | alıcı sayısıyla doğrusal |
| Koşul `evaluate` medyanı | termin-yaklaştı 11,2 ms · termin-geçti 12,6 · iş emri 5,2 · KK1 26 · fason 2,6 · sevkiyat 4,4 · levent 5,2 | sistem/sertifika tam tur 8–74 ms; kararlı tur ≤ 38 ms |
| İLK açılış tam tur (su damgası ÖNCESİ) | termin-geçti 807 konu 4,9 sn · iş emri 210 konu 1,25 sn · sevkiyat 150 konu 0,9 sn | bkz. §3 bulgu |
| SSE gecikmesi (olay commit → zil), 50 akış | p50 190 / p95 273 ms, RSS 195 MB | boşta RSS 167 MB |
| SSE, 200 akış | p50 187 / p95 206 ms, RSS 433 MB | |
| SSE, 500 akış | p50 188 / p95 228 ms, RSS 465 MB | `merhaba` p95 ≤ 464 ms |
| Zil → `/api/bildirim/ozet` REST | p50 32–39 ms | |
| Teslim | 10.000 / 10.000 örnek | kayıp yok |
| Kapanış (500 akış açık, SIGTERM) | akışlar 29 ms'de `kapat{neden:kapanis}`; süreç çıkışı 149 ms | hedef < 5 sn |
| `endpoint_latency_daily` | yalnız `GET /api/bildirim/ozet` satırı; zil/bekle satırı YOK | uzun yaşayan akış gecikme istatistiğini bozmaz |
| gzip'li istemci | ilk olay 34,5 ms, `Content-Encoding` yok | sıkıştırma akışı tamponlamaz |

## 2. Duman (web panel, başsız Chromium 1440×900)

**Bayrak AÇIK:** 14 türün 14'ü gelen kutusuna düştü (ALARM türü hariç: LoomAlarm donmuş liste ister → `test_bildirim_alarm` 15/0 kapsar). Canlı gövdede Türkçe ondalık ("~0,8 gün") doğru. Zil rozeti, Bildirimler sayfası, Bildirim tercihleri (masaüstü bildirimi varsayılan KAPALI), Kullanıcı Tercihleri kartı, Bildirim profilleri çizildi.

**Bayrak KAPALI** (`PATCH /api/feature-flags` 200): emit 0 / outbox farkı 0; liste + zil + tercihler 409 `BILDIRIM_KAPALI`; `/ozet` → `{enabled:false}`; sunucu günlüğü "dağıtıcı … durdu (bayrak kapalı)"; zil çizilmiyor; sayfa "Bildirimler kapalı"; alarm yoklaması 15 sn (154 → 15215 → 30253 → 45283 ms). Yeniden açınca yoklama 60 sn (217 → 60297 → 120320 ms) + tek `/zil` akışı.

**Masaüstü OS tostu** canlı çekilmedi: Electron dev koşumu kullanıcının gerçek `~/Library/Application Support/TeksERP` verisini kullanır; N3 vitest kapsamı esas.
**Tablet:** emülatörde debug paket Metro'dan bundle aldı ama ekran beyaz kaldı (ortam); tablet görselleri N4-TABLET dilimininkiler esastır.

Görseller (`docs/design/bildirim-olcum-2026-10/`):

| Dosya | İçerik |
|---|---|
| `acik-02-zil-panel.png` | zil açılır paneli (bayrak açık) |
| `koyu-02-zil-panel.png` | aynı, koyu tema |
| `acik-03-bildirimler.png` | Bildirimler sayfası |
| `kapali-03-bildirimler.png` | bayrak kapalı → "Bildirimler kapalı" |
| `acik-04-tercihler.png` | Bildirim tercihleri (masaüstü varsayılan kapalı) |
| `acik-05-ayarlar-kart.png` | Kullanıcı Tercihleri kartı |
| `acik-06-profiller-once.png` | Bildirim profilleri → Fabrika varsayılanı: "Kaydet" çubuğu içeriğin üstüne biniyor (BULGU) |
| `acik-06-profiller-sonra.png` | düzeltme sonrası: çubuk kaydırma kabının altına yapışık, içerik altında kalır |

## 3. Bulgu: ilk açılış seli → su damgası

Bayrak ilk açıldığında koşul tarayıcısı birikmiş geçmişi "yeni" saydı: 807 geciken sipariş (+ iş emri, sevkiyat) → **102 kişiye 125.766 gelen kutusu satırı**, dağıtıcı boşaltması 13 tur / 14,3 sn. Kullanıcı açısından zil anlamsızlaşır.

**Karar (patron, 2026-10-26) — İLK AÇILIŞ SU DAMGASI:** bayrak açıldıktan sonra her KOSUL türünün ilk turu taban turudur; o an doğru olan konular koşul tablosuna sessizce yazılır, taban anında kaybolanlar sessizce kapanır, bildirim ÜRETİLMEZ. Sonraki turlarda yalnız yeni açılan/kapanan konular bildirim üretir. Damga tür başına `system_settings` satırıdır (`bildirim.kosulTabani.<tür>`); bayrak kapatılınca ya da kapalıdan açılınca bütün damgalar düşer (yeniden taban); açıkken yeniden "açık" yazmak damgayı düşürmez.

Kanıt (`test_bildirim_kosul_is` §W): 807 birikmiş → 0 ACILDI / 0 kutu satırı / 807 sessiz açık koşul; ardından 1 yeni → tek ACILDI, alıcı başına tek satır. Negatif sondalar: taban `continue`'su silinince 807 ACILDI; bayrak yazımındaki damga sıfırlaması silinince 83.928 kutu satırı (patlama yeniden üretildi).

OLAY türleri (tek seferlik olaylar) etkilenmez — bayrak kapalıyken emit edilmezler, birikmeleri yoktur.
