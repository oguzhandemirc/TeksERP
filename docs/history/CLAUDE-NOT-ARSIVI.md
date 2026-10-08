# CLAUDE.md Karar Notları Arşivi — DİZİN

> **Bu dosya nedir:** Kök `CLAUDE.md`'deki tarihli karar notlarının TAM METNİ.
> 2026-08-17'de taşındı — CLAUDE.md her oturumun bağlamına otomatik yüklendiği
> için 150k karakter sınırını aşmıştı (186k). İçerik SİLİNMEDİ, buraya birebir
> taşındı; CLAUDE.md'de her not için kısa bir tetik satırı duruyor.
>
> **Kullanım:** kural dosyalarındaki `(arşiv:YYYY-MM-DD)` atfı hangi notu
> işaret ediyorsa aşağıdaki tablodan AYIN dosyasını bul ve yalnız o notu oku
> (`grep -n "^## 2026-09-24" docs/history/arsiv/2026-09.md`). Notlar kronolojik
> değil, eski tek dosyadaki sırasıyla durur.
>
> **⚠️ Yeni not kuralı (dosya yeniden şişmesin):** Yeni tarihli karar notu
> `docs/history/arsiv/<YYYY-MM>.md` dosyasının SONUNA yazılır (ay dosyası yoksa
> açılır ve aşağıdaki tabloya satır eklenir); bu dizin dosyasına NOT yazılmaz.
> Başlık `## YYYY-MM-DD — Başlık [ÇEKİRDEK|PROFİL]` kalıbındadır ve TÜM ay
> dosyaları boyunca tekildir (`check-docs.mjs`).
>
> **⚠️ Sınıf etiketi kuralı (2026-09-03):** Bundan sonra her yeni karar notu başlığında `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency, kilit sırası, fail-closed kapılar, sır hijyeni, veri bütünlüğü) ya da `[PROFİL]` (bu kurulumun seçimi) etiketi taşır; karışık notta profil-bağımlı cümle satır içinde ⚠️ ile işaretlenir — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §0/§11.
>
> **Okuma kuralı:** "adnansahin'de yok" = "bayrağı kapalı". Hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz.

> **2026-09-05 yeniden yapılandırma:** kök `CLAUDE.md` kural kitabına indi (~6k token); tarihli notların dizin satırları kaldırıldı — bu dosya artık TEK tam-metin kaynağıdır. Canlı kural özeti alan dosyalarında (`docs/kurallar/<alan>.md`), teknik desenler `docs/KOD-KURALLARI.md`. Ezilen notlar aşağıda `⚠️ GEÇERSİZ/KISMEN` bloğu taşır; kökte tam metni olmayan 37 not dosya sonuna "Kökten taşınan tam metinler" başlığıyla eklendi.

---

> **2026-10-05 aylara bölme:** tek dosya ~2,1 MB / 15 bin satıra ulaşmıştı; notlar
> başlık tarihine göre `docs/history/arsiv/<YYYY-MM>.md` dosyalarına BİREBİR taşındı
> (bayt eşitliği ölçüldü). Yukarıdaki "Kökten taşınan tam metinler (2026-09-05)"
> bölümü 2026-09 dosyasındadır. Bu dosya artık yalnız dizindir.

| Ay | Dosya | Not sayısı | İçerik |
|---|---|---|---|
| 2026-08 | [`arsiv/2026-08.md`](arsiv/2026-08.md) | 13 | 25–27 Ağustos: saha deploy arızaları, sebep penceresi, sipariş görünürlüğü, yarı mamul (eski kısa Ağustos/Temmuz notları 2026-09'daki "Kökten taşınan tam metinler" bölümünde) |
| 2026-09 | [`arsiv/2026-09.md`](arsiv/2026-09.md) | 409 | defter-öncelikli mimari, bekçi/ölçüm dersleri, numaralandırma, finans, patron, lisans; "Kökten taşınan tam metinler" |
| 2026-10 | [`arsiv/2026-10.md`](arsiv/2026-10.md) | 92 | dağıtım v2, tek ana dal/tek paket (güncelleme grupları, indirme belirtecinde grup, OTA takma adı, panel · tablet · backend grup yayını, tablet ilk açılış, firma adı lisanstan, Tailscale kutusu kalktı, ortak backend paketi), patron DB-per-tesis, satıcı portalı, hazırlık satıcısı emekliliği, lisans küçük kalemler ve yanıt istek bağı, yıllık tören, sunucu saati, sunucu simgesi, sunucu güncellemesi onayı, panel tek bant alanı, hata raporları, LAN TLS, Traefik kenar sınırı, şifre sıfırlama, patron vekil güven zinciri, 2026-10-07 kararları (istemci yedek imza anahtarı, tablet Play gizli yayını, indirme kapısı adresi, LAN TLS yeni kurulum kipi), K-14 kodu (Play'e tek yol, AAB, ayrı test anahtarı), I7 ISTEMCI tören araçları (tören parolası dosyası/FIFO, yedek ayrı birimde, 30 gün kapısı), 2026-10-08: tablet API 36 hedefi, indirme kökeni VDS ve `indir.etkiliyazilim.com` yayını (joker rota olayı), satıcı açık sertifika okuyucusu, Play dahili test ve kişisel hesap bulgusu, yalnız şifreli yeni kurulum (required, API yalnız 127.0.0.1, sertifika 30 yıl) |
