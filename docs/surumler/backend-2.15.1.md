# Backend `2.15.1`

**Durum:** TASLAK — terfide kullanıcı onayı. İlk hedef yalnız `test` grubu (bizim yönettiğimiz Linux deneme sunucusu,
kullanıcı onayı 2026-10-10); Windows fabrika filosuna çıkış ayrı karar ve `docs/design/GUNCELLEYICI-SAGLAMLIK.md`
§9.5 kanıt kapısıyla.
**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** 2.15.0 (son etiket `backend-v2.15.0`; Linux deneme sunucusunda elle kurulu 2.15.0 Docker imajı).
Güncellenecek her kurulumda sahadaki sürüm kurulumdan önce sunucunun sağlık bilgisinden okunur; tahmin edilmez.

Sürüm numarası: yama hanesi (otomatik, `scripts/backend-surum.mjs`). 2.15.0 derlenip imzalandığı için güncelleme
programı 0.2.3'ü taşıyan paket aynı numarayla çıkamaz — sahadaki güncelleyici eşit sürümü almaz. Güncelleme
programının sürümü 0.2.0 → 0.2.3; sunucu hizmet konağı 0.2.0 (değişmedi).

## 1. Özet

Linux (Docker) sunucuda güncelleme programını ilk kez devreye alan sürüm: program artık elle kurulmuş bir Docker
kurulumunu kendi yönetimine geçirebilir (`gecis`), disk ön kontrolü veritabanı ve Docker depolarını ayrı ayrı ölçer,
disk dolunca indirme doğru hatayla durur. Yanında dokuma için Tezgah Salonu canlı ekranının sunucu tarafı gelir.

## 2. Ne değişti

Önceki etiket `backend-v2.15.0`a göre; yalnız sunucu ve kurulum tarafı. Ölçüm: `git log backend-v2.15.0..` (sunucu,
veritabanı, native, docker, deploy yolları).

**Güncelleme programı (0.2.0 → 0.2.3)**

- `20e3c6085` — Linux'ta güvenli bağlantı sistem OpenSSL'iyle kurulur (konakta `libssl3` gerekir).
- `58483316f` — Linux'ta `kur` ve `gecis`: elle kurulmuş Docker kurulumu envanterlenir, kuru koşuyla gösterilir,
  onay sayısıyla uygulanır, geri alınabilir; imaj kaydı kurulumda tutulur, yerel compose eki korunur.
- `975236a65` — açılan paket dizinleri güvenilen izinle doğar (Linux'ta yanlış `IZIN_GUVENSIZ` reddi kalktı).
- `fade995d5` — indirme sırasında disk dolarsa hata `DISK_DOLU` olur (önce `INDIRME_HATASI` görünüyordu).
- `be518228d` — disk ön kontrolü her yazım kökünü (kurulum dizini, Docker deposu) ayrı ölçer, aynı dosya
  sistemindekileri toplar.

**Dokuma — Tezgah Salonu (sunucu tarafı)**

- `0404021d3` · `2c6b5ff0a` · `b66eccf06` — `GET /api/loom-floor` (salt okuma canlı salon görünümü), sebep başına hedef
  süre, duruşa donan hedef ve iletim payı, `settings:dokuma` altında iletim payı ayarı. Modül `tezgahEnabled`
  kapalıyken uç 403 `MODULE_DISABLED` döner; varsayılan davranış değişmez.

**Değişmeyen:** `dist-web` bu imajda yok (Docker); Windows paketi bu belgeyle ayrıca derlenirse `dist-web` o derlemede
beyan edilir.

## 3. Sözleşme

- **Kırıldı mı:** HAYIR — yalnız ekleme: yeni uç (`/api/loom-floor`), yeni izin kodu, sebep kaydına isteğe bağlı alan.
- **Eski istemci ne yapar:**
  - Panel 1.6.0 yeni ucu çağırmaz; Tezgah Salonu ekranı yalnız yeni panelde görünür.
  - Yeni izin `loom:live-view` (salt okuma): katalogdan gelir, rol şablonunda vardiya amirine önerilir; atama panelden.
  - Uç kaldırma, alan adı/tip değişimi, zorunlu parametre, enum değişimi yok.
- **`minVersion` dokunuldu mu:** HAYIR.

## 4. Migration

- **Var mı:** EVET — 1 adet, yalnız ekler: `20261010130000_tezgah_hedef_sure_iletim_payi` (üç boş bırakılabilir kolon +
  iki CHECK; var olan satırların hepsi boş kalır, veri yazılmaz).
- **Toplam migration:** 374 (2.15.0'da 373). 2.15.0'dan gelen kurulum 1 uygulanan migration görmelidir. Farklı sayı =
  yanlış paket ya da yanlış veritabanı → DUR.
- **Veri yazan adımlar:** yok.
- **Geri alınabilir mi:** HAYIR — veritabanı değişikliği geri alınmaz; dönüş, güncelleme öncesi alınan yedekten geri
  yüklemedir. Kolonlar boş ve eklemeli olduğundan 2.15.0 imajı bu şemayla da açılır.

## 5. Kurulum notu

- **Beklenen kesinti:** güncellemede sunucu kısa süre kapalı kalır; süre kurulumda ölçülür ve raporlanır.
- **Sıra:** sunucu önce; panel değişikliği bu belgenin kapsamı dışında.
- **Bu sürüme özel:**
  - Linux deneme sunucusu elle kurulu 2.15.0'dan güncelleme programının yönetimine `gecis` ile geçer (kuru koşu →
    onaylı uygulama); sıra `Teks-Erp-wt/P1A-GECIS-SIRASI.md` ile runbook `docs/ops/LINUX-DOCKER-KURULUM.md`.
  - Konakta `libssl3` kurulu olmalı (güncelleme programı sistem OpenSSL'ine bağlanır).
- **Bilinen sınırlar (dürüst):** 2.15.0 belgesindeki güncelleme programı sınırları aynen geçerli.
- **Sınırlar (her sürümde geçerli):** veritabanı sıfırlanmaz, yeniden doldurulmaz, silinmez · uygulanmış
  migration'lara dokunulmaz · `docker compose down -v` verilmez · başarısız kurulum tekrar denenmez ·
  **migration adımından sonra herhangi bir hata → DUR, düzeltme yapma, insana rapor et**.

## 6. Geri alma

Güncelleme programıyla yapılan güncellemede yeni sürüm açılmazsa önceki imaja kendiliğinden dönülür; migration yarıda
kalırsa veriler güncelleme öncesi yedekten geri yüklenir; geri dönülen sürüm kendiliğinden yeniden denenmez. Elle
geçişi geri almak için `tekserp-guncelleyici gecis --geri-al` (kuru koşu, sonra onay sayısıyla).

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- Sağlık bilgisi: sürüm 2.15.1, sunucu ve veritabanı ayakta.
- Güncelleme programı hizmeti çalışıyor; `durum` kurulu sürüm 2.15.1, güncelleme programı 0.2.3.
- Veritabanı: 374 migration bitmiş, sorunlu migration yok.
- İmajın bütünlük öz-denetimi geçerli (açılış günlüğü).
- Hata günlüğünün son satırları — yeni hata var mı.
