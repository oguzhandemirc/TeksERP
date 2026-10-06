# Patron bulutu — hizmet sonu, dışa aktarma ve imha (runbook)

> Hukuk kaynağı: Saklama ve İmha Prosedürü (Ek-6/A) §4 — `docs/hukuk/PATRON-BULUTU-SAKLAMA-IMHA.md`. Kod: `patron/sunucu/src/services/service-lifecycle.ts` (aşama, tek kaynak) · `src/services/export.service.ts` (dışa aktarma) · `src/services/facility-destruction.ts` (imha). Kural: `docs/kurallar/patron-bulutu.md` § Bulut sunucusu. Kurulum/yükseltme: `docs/ops/PATRON-BULUTU-KURULUM.md`.

## 1. Aşamalar — kim neyi görür

| Aşama | Ne zaman | Giriş · okuma · dışa aktarma | Eşitleme · gelen kutusu · rapor isteği · bildirim |
|---|---|---|---|
| ACIK | tesis AKTİF ∧ bir aktif kurulumda `patron-bulut` hakkı ∧ bitiş gelecekte | açık | açık (eşitleme ayrıca URETIM + devredilmemiş ister) |
| SALT_OKUNUR | kira bitti · hak düştü · tesis `tesis-durum --durum=PASIF` ile kapatıldı; bitişten 90 gün | açık (hesap yönetimi de açık: kilit/arşiv) | kapalı (403 `PATRON_BULUT_KAPALI`) |
| KAPALI | bitiş + 90 gün doldu | kapalı (giriş 403 `HIZMET_KAPANDI`) | kapalı — veri imha bekler |

- Bitiş anı **donar** (`facilities.service_ended_at`): bakım tiki kapanışı ilk gördüğü dakikada yazar — kira bitişiyle kapandıysa anı KİRA BİTİŞİDİR, hak düştüyse ya da tesis kapatıldıysa gözlem anı. Hizmet yenilenirse (yeni kira / `tesis-durum --durum=AKTIF`) damga silinir, aşama ACIK'a döner; veri yerindedir.
- DR'ye devir hizmeti BİTİRMEZ (eşitleme durur, okuma sürer; aşama ACIK kalır).
- Patron uygulamasında SALT_OKUNUR'da üstte bant: bitiş tarihi, salt okuma bitişi, "Hesaplar › Dışa aktar".

## 2. Dışa aktarma (tesis yöneticisi)

- Yol: uygulamanın **web sürümü** → Hesaplar → "Verileri dışa aktar (JSON / CSV)". Telefon uygulaması dosya indirmez (web'i gösterir).
- Yalnız `bulut:hesap:yonet` iznine açık; döküm hesabın **okuyabildiği** kadardır — finans/kişisel alt satırlar yalnız o izinler hesaptaysa gelir. Tam döküm isteyen yönetici önce kendine izinleri verir (ayak izine düşer).
- Kümeler: her projeksiyon (satır = fabrikanın gönderdiği alanlar + `surum`; CSV'de alt satır `finans.*` / `kisisel.*`), anlık özetler (yalnız JSON), bulutta doğan veri: gelen kutusu · bulut hesapları (sırsız) · hesap güvenlik kaydı.
- CSV: UTF-8 + BOM, virgül, CRLF; `= + - @` ile başlayan metin hücresi `'` önekli (tablolama programı komut çalıştırmasın).
- Her tamamlanan döküm hesap güvenlik kaydına `DISA_AKTARIM` (küme · biçim · satır sayısı) olarak düşer.
- API (destek için): `GET /api/disa-aktar` (manifest) · `GET /api/disa-aktar/<küme>?bicim=json|csv` (Bearer oturum).

## 3. İmha (satıcı operatörü)

Bakım işi her gün günlüğe `imha bekleyen tesis (salt okuma süresi doldu …)` satırını basar. İmha İNSAN işidir (tutanak):

```bash
# VDS, patron dizininde — göç konteyneri (tablo sahibi) ile; önce KURU KOŞUM:
sudo docker compose --profile goc run --rm --no-deps patron-goc \
  node dist-cli/scripts/tesis.js imha --tesis=<tesis uuid> --isleyen="Ad Soyad"
# Çıktı: aşama, neden (SURE_DOLDU | ERKEN_TALEP), tablo başına gidecek satır sayısı. Doğruysa:
sudo docker compose --profile goc run --rm --no-deps patron-goc \
  node dist-cli/scripts/tesis.js imha --tesis=<tesis uuid> --isleyen="Ad Soyad" --uygula
```

- Kapılar: aşama ACIK iken **asla** (409). SALT_OKUNUR'da yalnız Lisans Alan'ın **yazılı erken imha talebiyle**: `--erken-talep=<talep/yazı no>` (Ek-6/A §4.2). KAPALI'da talep gerekmez.
- Uygulama tesisin **veritabanını bütünüyle düşürür** (tesis başına ayrı DB, `docs/design/PATRON-TESIS-DB.md` §8): `facility_databases` HAZIR → IMHA_SURUYOR (plan merkezde; yönlendirme durur) → tesis rollerinin bağlanma yetkisi geri alınır, açık bağlantılar kesilir → tablo başına son sayım (`DESTRUCTION_STEPS`) plana → destek erişim kayıtları merkeze kopyalanır → `DROP DATABASE` + üç tesis rolü → imha kaydı `facility_destructions` MERKEZE (tesis · ad · neden · talep no · işleyen · hizmet bitişi · tablo başına sayı · yedekten düşme tarihi = imha + 35 gün) + yönlendirme satırları silinir → IMHA_EDILDI. Kayıt değiştirilemez ve silinemez (DB tetikleyicisi); en az 3 yıl durur.
- Yarıda kalan imha (bağlantı koptu, konteyner düştü) **aynı `--uygula` komutuyla** kaldığı yerden tamamlanır; kapı yeniden sorulmaz (veri kısmen gitmiş olabilir), tutanak plandaki kimlikle tek kez yazılır. İmha edilmiş tesiste komut 409 döner.
- Çıktıdaki JSON **imha tutanağının verisidir** (Ek-6/A §4.5): satıcının kayıtlarına konur, Lisans Alan'a tutanak olarak verilir.
- **Yedek:** imha edilmiş tesisin dökümleri (`tesis_<id>_*.dump.tkenc`) en-az-N kuralından muaftır, yalnız yaşa göre budanır ⇒ en geç `YEDEK_SAKLA_GUN` (30) içinde yedekten de düşer.
- **Yedekten geri yükleme** (Ek-6/A §4.4): imhadan sonraki 35 gün içinde imhadan ÖNCEKİ bir merkez yedeği geri yüklenirse o tesis HAZIR görünür ama DB'si yoktur — aynı tarihli tesis dökümü de geri yüklenir (`pg_restore --no-owner --no-acl -d <tesis DB>`, ardından `patron-goc`), sonra tutanaktaki her tesis için bu komut YENİDEN koşulur (geri yüklenen veride aşama KAPALI ise talepsiz; erken imha idiyse aynı `--erken-talep` ile) ve yeniden imha tutanağa eklenir.
- Kalan (merkezde): `facility_destructions` (imha kaydının kendisi) ve `support_access` kopyası (destek erişim kaydı silinemez, Ek-6/B §3.2). Fabrika tarafına (Kurulum verisi, gelen kutusu makbuzları) dokunulmaz.
- Satıcı kipinde (`KURULUM_KAYNAGI=satici`) bu kurulum imzalı istek atarsa kurulum dizini tesis satırını yeniden kurar (boş); aşama KAPALI olduğundan erişim açılmaz, komut tekrar koşulabilir.
