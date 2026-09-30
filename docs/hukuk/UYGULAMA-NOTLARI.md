# Hukuk metinleri — uygulama notları

> **Bu dosya avukat paketine GİRMEZ.** Hukuk metinlerinden 2026-09-30'da çıkarılan teknik ve geliştirici notlarını, belgelerin hazırlanış kaynağını ve metne olgu olarak yazılan yerlerin kod kaynağını taşır. Kural `README.md`'dedir: hukuk metnine repo yolu, dosya adı, kod adı ya da geliştirici notu yazılmaz; buraya yazılır.

## Hazırlanış kaynağı

- Lisans metinleri (Lisans Sözleşmesi, Ek-2, Ek-3, Ek-4, Ek-7) kullanıcının 2026-09-29 lisanslama kararlarına ve onaylı lisanslama planına (Hukuk bölümü) göre Claude tarafından yazıldı. Kabul Metni'nin (Ek-7) dayandığı karar: "ilk kurulumda panelde kabul adımı; kabul kaydı kurulum geçmişine".
- Patron bulutu ekleri (Ek-6, Ek-6/A–C) ve ihlal prosedürü (Ek-8) kullanıcının 2026-09-29 patron bulutu kararlarına ve eşitleme sözleşmesi v1 tasarımına göre Claude tarafından yazıldı: `docs/design/PATRON-BULUTU.md`, `docs/design/PATRON-BULUTU-ESITLEME.md` §1, §9–§11; saklama ve imha için `docs/design/PATRON-BULUTU-ESITLEME.md` §9.5.

## Ek numaraları ve adlar

- Ek numaralarının tek kaynağı Lisans Sözleşmesi §16'dır; dosya ↔ Ek eşlemesi `README.md` tablosundadır. Belgeler birbirine "Belge adı (Ek-N)" biçiminde atıf yapar; 2026-09-30'a kadar dosya adıyla yapıyordu (81 atıf çevrildi).
- Ek-7 (Kabul Metni) ve Ek-8 (Kişisel Veri İhlali Bildirim Prosedürü) §16'ya 2026-09-30'da eklendi. Ek-8 hem Ek-3 (Bölüm B.4) hem Ek-6 için ortaktır; bu yüzden Ek-6'nın alt numarası değildir.
- Metinlerdeki "Patron Bulutu hakkı", Lisans Belgesi'ndeki `patron-bulut` hak anahtarıdır.

## Veri İşleme Eki (Ek-3)

- Bölüm A'daki alan listesi yazılımın lisans protokolünden birebir alınmıştır (`docs/design/LISANS-PROTOKOLU.md`); protokole alan eklenirse ek de yeni sürüm alır (`README.md` "Metinlerin koda bağlı olduğu sayılar").
- Bölüm P'de daha önce duran patron bulutu iskeleti Patron Bulutu Veri İşleme Eki'ne (Ek-6) taşındı ve tamamlandı.

## Yaptırım Maddeleri (Ek-2) §5.3

- Ticari kararın kaynağı: kullanıcı "ödemezse lisansını dondurabileyim" dedi. §5.3'teki sıralama cümlesi bu hakkı merdivene bağlar ve hukuki riski azaltmak için önerildi; avukat ve kullanıcı birlikte karar verir.

## Kabul Metni (Ek-7)

- Eski §4.3 (eski §4.4 şimdi §4.3): Kabulün sistem günlüğüne (audit) de bir ayak izi düşer, ama kabulün **kaynağı** §4.2'deki kayıttır; audit'ten kabul bilgisi türetilmez.
- Eski §7 "Uygulayıcılar için notlar":
  - Lisans protokolü v:1'de kabul kaydı için alan yoktur. Protokolün sürüm kuralı, v:1 içinde yalnız "yok sayılabilir" alan eklenmesine izin verir (`docs/design/LISANS-PROTOKOLU.md` §9). Kabul kaydı etkinleştirme isteğine isteğe bağlı bir alan olarak ya da ayrı bir istek amacıyla eklenir. Karar, lisans motorunun ve satıcı sunucusunun sahibine aittir.
  - Tam metinler ve özetleri tek kaynaktan gelir: Lisans Veren'in onaylı son metni. Panel metni kendi içinde kopyalamaz; aksi hâlde gösterilen metin ile kaydedilen özet ayrışır.

## Patron Bulutu Veri İşleme Eki (Ek-6)

- Bu ek, Veri İşleme Eki'nin (Ek-3) Bölüm P iskeletinin yerini aldı.
- §3.1'in teknik kaynağı: `docs/design/PATRON-BULUTU-ESITLEME.md` §3 ve §11 (projeksiyon kataloğu, veri sınıfları). Metindeki "yazılımın projeksiyon kataloğu" önceden "eşitleme sözleşmesinin projeksiyon kataloğu" idi; oradaki "sözleşme" teknik tel sözleşmesidir, hukuki sözleşme değil.
- §3.5'teki "buluta gitmeyenler" listesi teknik olarak kataloğun "dışarıda" listesiyle ölçülür.
- **§3.5 olgu dolgusu (2026-09-30; önceki işaret: "[DOLDURULACAK — v1 kararı: operatör performans raporu bulutta sunulmaz]").** Metin artık "kişi adı taşıyan performans raporları (operatör performans raporu bulutta sunulmaz)" der. Kaynak: fabrika tarafında buluttan istenebilir raporlar `Teks-Erp/src/cloud-sync/report-requests.ts` `REMOTE_REPORTS` (sekiz rapor, hepsi `personalData: "YOK"`; `production/operator-performance` listede yok); bulut tarafında `patron/sunucu/src/catalog/reports.ts` `REPORTS_NOT_IN_CLOUD` (`audit/*`, `production/operator-performance` → 404 `RAPOR_BULUTTA_YOK`); kural `docs/kurallar/patron-bulutu.md` ("kişi adı taşıyan rapor buluttan istenemez"); bekçi `patron/sunucu/scripts/test_rapor_istegi.ts`.

## Saklama ve İmha Prosedürü (Ek-6/A)

- §4.1'deki "Kullanım Onayı'nda yazılı patron bulutu bitiş tarihi" kira alanı `patronBulutBitis`tir (`Teks-Erp/src/lib/license/protocol/belgeler.ts` `LeaseSchema`; `docs/design/LISANS-PROTOKOLU.md` kira alanları tablosu).

## Teknik ve İdari Tedbirler (Ek-6/B)

- Yazım kuralı: bu ek bir taahhüt listesidir. Uygulanmamış bir tedbir metinden çıkarılır ya da [DOLDURULACAK] olarak işaretlenir; metin kodun önüne geçemez.
- §4'teki kabul senaryosu Senaryo P'dir (`docs/design/PATRON-BULUTU.md`).
- **§1.5 olgu dolgusu (2026-09-30; önceki işaret: "[DOLDURULACAK — B4 dilimi yöntemi]").** Metin artık önbelleğin uygulamanın korumalı alanında durduğunu, uygulamanın onu ayrıca şifrelemediğini, oturum anahtarının işletim sisteminin güvenli deposunda (web'de yalnız sekme açıkken) tutulduğunu ve önbelleğin ne zaman silindiğini yazar. Kaynak: `patron/uygulama/src/state/store.ts` — oturum belirteci `secretStore` (`expo-secure-store`: iOS Keychain / Android Keystore; web'de `sessionStorage`), son veri önbelleği `plainStore` (`@react-native-async-storage/async-storage` 2.2.0; web gerçekleştirimi tarayıcının `localStorage`'ı); `patron/uygulama/src/state/cache.ts` — `patron:onbellek:` önekli kayıtlar, yetki (403) ya da bulunamadı (404) yanıtında o kayıt silinir, `clearCache` hepsini siler; `patron/uygulama/src/state/session.tsx` — `reset` (çıkış ve 401) ve `login` (her yeni giriş) `clearCache` çağırır. Önbelleği şifreleyen bir katman kodda yok; şifreleme istenirse önce kod, sonra metin değişir.

## Aydınlatma Metni (Ek-6/C)

- Eski §4 "Uygulama için teknik notlar (metnin parçası değildir)" çıkarıldı; eski §5 artık §4:
  - Kısa ve tam metin **sunucudan** gelir (sürüm kimliği + SHA-256 özeti); uygulama metni gömülü taşımaz. Böylece metin değişince yeni sürüm gerekmez ve okundu kaydı hangi metnin gösterildiğini kanıtlar.
  - `{…}` yer tutucuları Tesis kaydından doldurulur; eksik alan varsa metin gösterilmez ve tesis yöneticisine "aydınlatma bilgileri eksik" uyarısı çıkar (eksik kimlikle metin yayınlanmaz).
  - Okundu teyidi hesap güvenlik kaydına yazılır; bu bir rıza değildir, kullanıcıya rıza gibi sunulmaz.

## Mobil Gizlilik Politikası (`docs/legal/GIZLILIK-POLITIKASI.md`, ayrı belge)

- Veri akışları `mobil/` kaynak kodundan çıkarılmıştır.
- Yayın: herkese açık, sabit bir URL'de barındırılmalı (GitHub Pages veya şirket sitesi). Play Console → Store listing → Privacy policy alanına bu URL girilir (akış: `docs/ops/PLAY-STORE-YAYIN.md`).
- Doldurulacak yer işareti 2026-09-30'da paketteki diğer belgelerle aynı biçime ("[DOLDURULACAK]") çevrildi.

## 2026-09-30 ikinci tur — "[DOLDURULACAK]" işlemesi

Kullanıcı kararı: "Önerilenleri doldur, gerisini sor." 112 işaret (damga kutularındaki 10 açıklama hariç) tek tek sınıflandı:

| Sınıf | Adet | Ne yapıldı |
|---|---|---|
| (a) öneri | 44 | Önerilen değer metne yazıldı (bağlam korunarak; ör. "30 gün"). Köşeli parantezli öneri değerleri (Ek-2 §5.3, Ek-4 §4.3 tabloları, Ek-8 §3 "[öneri]") de açıldı. |
| (b) olgu | 17 | Kod ya da işletim belgesinden yazıldı; kaynaklar aşağıda. |
| (c) şablon alanı | 6 | "[Lisans Alan ünvanı]" · "[Bakım başlangıç tarihi]" · "[Yürürlük tarihi]" · "[Yayın tarihi]" · Ek-5 "Lisans Alan'a özel" · Ek-6/C {…} alanı (işaret kalktı). |
| (d) karar | 45 | Dokunulmadı; 15 soru olarak kullanıcıya gitti. Cevaplar üçüncü turda işlendi (aşağıda). |

Damga açıklamaları: işareti kalmayan belgelerde (Ek-2, Ek-6/A) "[DOLDURULACAK] … ticari varsayımdır" cümlesi kalktı; "öneri" kalmayan belgelerde (Lisans Sözleşmesi, Ek-6) "öneri bağlayıcı değildir" yan cümlesi kalktı; Ek-8'de "kişi, kanal ve süre" → "kişi".

### (b) olgu dolgularının kaynağı

- Ek-3 C uzak yedek satırı ve Ek-4 §7.2(a): makine dışı yedek Lisans Veren'in kendi VDS'inde, fabrika başına SFTP hapsi, içerik şifreli (`docs/ops/YEDEK-VPS-KURULUM.md`, `docs/ops/SUNUCU-ENVANTERI.md`); ayrı bir depolama sağlayıcısı yok.
- Ek-3 D yoklama kayıtları ve sağlık özetleri 90 gün: `YOKLAMA_SAKLAMA_GUN` varsayılanı (`satici/sunucu/src/config.ts`, budama `satici/sunucu/src/services/maintenance.ts`; `yoklama` satırı `saglik` alanını taşır; dağıtımda üzerine yazılmıyor).
- Ek-4 §6.1 "başka bir araç": uzaktan erişim yalnız Tailscale (`docs/ops/DEPLOY-RUNBOOK.md`); başka araç tanımlı değil, işaret kalktı.
- Ek-6 §6.1 web bildirimi: sunucu yalnız dört tarayıcı hizmetine gönderir — `fcm.googleapis.com`, `push.services.mozilla.com`, `push.apple.com`, `notify.windows.com` (`WEB_PUSH_HOSTS`, `patron/sunucu/src/push/targets.ts`; VAPID `patron/sunucu/src/push/vapid.ts`).
- Ek-6/A §2.4 Gelen Kutusu: sonuçlanmış talep, talep tarihinden itibaren tesisin geçmiş seçeneği kadar tutulur; "Tümü"de silinmez (`patron/sunucu/src/services/maintenance.ts`). Rapor istekleri ve sonuçları 30 gün (`RAPOR_SONUC_SAKLAMA_GUN`, `patron/sunucu/src/config.ts`).
- Ek-6/A §4.4 ve Ek-6/B §1.7 yedek döngüsü: günlük, 30 gün, en yeni 7 kopya her durumda kalır (`YEDEK_ARALIK_SAAT=24` · `YEDEK_SAKLA_GUN=30` · `YEDEK_EN_AZ=7`, `deploy/patron/yedek-dongusu.sh`, `deploy/patron/ornek.env`).
- Ek-6/B §1.4 giriş kilidi: art arda 5 hata → 15 dk kilit (`GIRIS_ESIGI` · `KILIT_DK`, `patron/sunucu/src/auth/session.service.ts`), IP başına dakikada 20 giriş isteği (`GIRIS_HIZ_DK`, `patron/sunucu/src/http/rate-limit.ts`); dağıtımda üzerine yazılmıyor.
- Ek-6/B §1.5 yedek şifreleme: X25519 + AES-256-GCM, açık anahtarla (`docs/ops/YEDEK-SIFRELEME.md`); patron alıcısının özel yarısı VDS dışında, yönetim bilgisayarı + USB (`deploy/patron/yedek-dongusu.sh` başlığı, `docs/ops/PATRON-BULUTU-KURULUM.md` §2.1).
- Ek-6/B §1.6: işletim sistemi güvenlik yamaları günlük `unattended-upgrades` (`docs/ops/SUNUCU-ENVANTERI.md`); sürüm yükseltmesi önce yedek alır (`docs/ops/PATRON-BULUTU-KURULUM.md`).
- Ek-6/B §4 kanıt eki: kanıt, Senaryo P koşusunun çıktısıdır (`Teks-Erp/scripts/senaryo-patron.ts`); cümle zaten "satışa açılmadan iliştirilir" dediği için işaret kalktı.
- Mobil Gizlilik Politikası §5 demo adresi: `https://demo.etkiliyazilim.com` (`docs/ops/DEMO-YAYIN-RUNBOOK.md`). §7 "kuruluş politikasına atıf": uygulama her kuruluşun kendi sunucusuna bağlanır, mağaza metni tek bir kuruluşun politikasına atıf yapamaz; cümle atıfsız tamamlandı.

### Öneri ile kod ayrıştığında kod esas alındı

- Ek-3 D yoklama kayıtları: öneri 13 ay → kod 90 gün.
- Ek-6/A §2.4 Gelen Kutusu: öneri "13 ay ya da seçenek, hangisi uzunsa" → kod tesis seçeneği.
- Ek-6/A §4.4 ve Ek-6/B §1.7: öneri 35 gün döngü → kod 30 gün. "İmhadan en geç 35 gün" üst sınırı korundu (30 gün döngü + günlük budama).

### Metin ↔ kod farkları (durum 2026-09-30, üçüncü tur sonrası)

Kullanıcı kararı "KODU METNE UYDUR": metindeki vaatler kalır, kod ayrı dilimde yazılır.

1. **KAPANDI (PU, 2026-09-30 — kod metne uyduruldu).** Ek-6/A §2.5 ve Ek-6/C §3: kapatılan hesabın kimlik bilgileri 30 gün içinde silinir. Kaynak: `patron/sunucu/src/services/maintenance.ts` `purgeClosedIdentities` (`IDENTITY_PURGE_DAYS` = 30, kodda sabit) — bakım tiki (dakikada bir) kapanışın 30. gününün dolduğu dakikada ad ve e-postayı "Silinmiş hesap #<ilk 8>" / `silinmis-<id>@hesap.invalid`e çevirir; parola özeti, TOTP sırrı, davet belirteci NULL; oturumlar ve bildirim cihaz anahtarları silinir; gelen kutusundaki yazar adı da "Silinmiş hesap #…" olur. Hesap satırı ve kimliği (iş kayıtlarının izi) ile güvenlik kayıtları kendi süreleriyle KALIR. Kapanış anı `accounts.closed_at` (PASIF geçişiyle aynı işlem). Ayak izi `HESAP_KIMLIGI_SILINDI`. Bekçi `patron/sunucu/scripts/test_kimlik_silme.ts`. Metin ile birebir; §2.5'teki "[avukat: kapatılan hesabın adının güvenlik kaydında kalması ölçülü mü]" sorusunun olgusu: güvenlik kaydı adı değil hesap KİMLİĞİNİ (uuid) taşır, ad 30 günde silinir.
2. **KAPANDI (PU, 2026-09-30).** Ek-6/A §4.2: hizmet bitişinden sonra 90 gün salt okunur giriş ve JSON/CSV dışa aktarma. Kaynak: `patron/sunucu/src/services/service-lifecycle.ts` (`READ_ONLY_DAYS` = 90; aşama ACIK → SALT_OKUNUR → KAPALI, tek kaynak) · `src/services/export.service.ts` (`GET /api/disa-aktar`) · uygulama "Hesaplar › Dışa aktar" (yalnız web sürümü dosya kaydeder). Olgular: bitiş anı = kira bitişi (Kullanım Onayı'ndaki `patronBulutBitis`) ya da hak düşmesi/tesis kapanışının tespit anı; SALT_OKUNUR'da gelen kutusu, rapor isteği, eşitleme ve bildirim kapalı, hesap yönetimi (kilit/arşiv) açık; 90. gün dolunca giriş kapanır. Dışa aktarma yalnız hesap yöneticisine ve **hesabın okuyabildiği** veriyle sınırlı (finans/kişisel alt satır izin ister); bulutta doğan veri: Gelen Kutusu, hesap listesi (sırsız), hesap güvenlik kaydı, destek erişim kaydı. İmha OTOMATİK değil: satıcı komutu (`scripts/tesis.ts imha`; kuru koşum varsayılan; salt okuma süresi dolmadan yalnız yazılı erken talep numarasıyla), imha kaydı `facility_destructions` (tarih · tesis · kategori başına silinen sayı · işleyen · neden · yedekten düşme tarihi = imha + 35 gün; değiştirilemez) — Ek-6/A §4.5 tutanağının verisi. Runbook `docs/ops/PATRON-BULUTU-HIZMET-SONU.md`. Bekçi `test_hizmet_sonu.ts`. DR devri hizmet bitişi SAYILMAZ (eşitleme durur, okuma sürer) — metinde karşılığı yok, eklenmeli (öneri raporda).
3. **KISMEN KAPANDI (PU, 2026-09-30) — ölçüm + kod; Traefik ölçülmedi.** Ek-3 D ve Ek-6/A §2.4: sunucu erişim günlükleri (IP) 30 gün. Katman katman ölçüldü: patron uygulamasının erişim günlüğü satırı `[patron] <yöntem> <yol> <durum> <süre>`dir — IP ve sorgu dizgisi YOK; konteyner günlükleri (`deploy/patron/docker-compose.yml` `x-sertlik`: `json-file` 20 MB × 5, sunucu · DB · yedek) bu IP'siz satırları taşır ve boyutla döner — kişisel veri saklaması değildir. Hesap güvenlik kaydı ise metnin söylediği gibi IP taşır hâle getirildi (Ek-6 §3.3, Ek-6/C): giriş, başarısız giriş, reddedilen giriş ve geçici kilit olaylarında istemci adresi (Cloudflare `cf-connecting-ip` başlığı) tutulur ve **30 gün sonra yalnız IP alanı silinir** (zaman bazlı; olay kaydı 90 gün / 2 yıl kalır) — `patron/sunucu/src/services/maintenance.ts` `stripAgedIps` · `AGED_FIELDS` · `IP_RETENTION_DAYS` = 30 (kodda sabit). Bekçi `test_ip_saklama.ts`. **Kapsam dışı (bu repoda değil):** kenar vekili Traefik (VDS'te satıcı ve güncelleme sitesiyle ORTAK; yapılandırması `/opt/stack/traefik/traefik.yml`, erişim günlüğünün açık olup olmadığı ve saklaması bu dilimde ÖLÇÜLMEDİ — açıksa Docker günlüğü `/etc/docker/daemon.json` 20 MB × 5 ile boyutla döner) ve Cloudflare (kendi süresi). Metnin "Bulut sunucusu … erişim günlükleri (IP) 30 gün" satırı Traefik ölçülüp gün bazlı döndürme (ya da kapalı olduğu) doğrulanana kadar Traefik için doğrulanmış değildir. Ölçüm komutu (salt okuma, yönetim hesabıyla): `docker inspect traefik --format '{{json .Args}}'` + `sudo grep -n -i -A6 accesslog /opt/stack/traefik/traefik.yml` — satır yoksa Traefik v3 erişim günlüğü KAPALIDIR (varsayılan) ve kenarda IP yalnız Cloudflare'dedir.
4. **Kapandı** — Ek-3 D uzak yedek döngüsü metinde gerçeğe çevrildi: günlük 30 gün, aylık 12 ay, sabit (`docs/ops/SUNUCU-ENVANTERI.md`).
5. **Kapandı** — Ek-6 §6.2 ve Ek-6/C §3 bildirim içeriği metinde düzeltildi: "cari ve kişi adı içermez; toplam tutar içerebilir" (kod aynı: `patron/sunucu/src/services/notification-events.ts`).
6. **Bilinen sınır** — Ek-6/A §4.4: yedek alınamayan dönemde budama çalışmaz ve son 7 kopya korunur (`deploy/patron/yedek-dongusu.sh`); "imhadan en geç 35 gün" bu arıza durumunda aşılabilir.
7. **KAPANDI (PU, 2026-09-30).** Ek-6/B §3.2: doğrudan veritabanı sorgusu için ayrı rol + oturum kaydı. Kaynak: göç `patron/sunucu/prisma/migrations/20260930220000_destek_rolu` + `src/lib/db-grants.ts` `SUPPORT_GRANTS`; runbook `docs/ops/PATRON-BULUTU-DESTEK-ERISIMI.md`; bekçi `test_destek_rolu.ts`. Olgular (metnin "[DOLDURULACAK — teknik zorlama: ayrı rol + oturum kaydı]" yerine): ayrı destek rolü (`patron_destek`) yalnız okur, satır düzeyi güvenliği aşamaz, parola/TOTP/belirteç kolonlarını göremez; varsayılan girişi kapalıdır ve her destek için süreli açılır; içerik ancak `destek_ac` ile açılan, oturuma bağlı ve en çok 8 saatlik bir izinle, tek Tesis için görünür; her açılış silinemeyen kayda yazılır (kim · ne zaman · Tesis · veri kümesi · gerekçe + talep no · bitiş · kapanış), kayıt Tesis imhasında da kalır ve Tesis Yöneticisi kendi Tesis'inin kaydını uygulamadan dökebilir (§3.3). Sınır: sunucu yöneticisi (göç/süper kullanıcı) teknik olarak bu kayda tabi değildir — destek sorgusunun göç rolüyle yapılması idari olarak yasaktır; yerel soket girişini parolaya bağlamak ayrı iş (açık borç). Soru 14(a) teknik olarak cevaplandı; "silinemeyen" = uygulama ve destek rolleri için yetki yok + tablo sahibine de işleyen tetikleyici (süper kullanıcı tetikleyiciyi kapatabilir).
8. **Kod borcu** — Ek-7 §5: satıcı kabul kaydı olmayan etkinleştirmeyi reddeder, panel önce kabul adımını gösterir. Bugün protokol v1'de alan yok, satıcı denetlemiyor.

## 2026-09-30 üçüncü tur — kullanıcı cevapları

Kaynak: kullanıcının 15 cevabı ve yönetici notları. Metinde "[DOLDURULACAK]" kalmadı.

| Soru | Karar | Uygulandığı yer |
|---|---|---|
| S1 | Kısa ad "Etkili Yazılım"; resmî kuruluş sürüyor, kimlik alanları şablon; iletişim her yerde info@etkiliyazilim.com | Lisans Sözleşmesi §1 · Ek-4 §4.1 · Ek-6/C §2, §3, §4 · Ek-7 §2 · Mobil Gizlilik Politikası başlık, §9 |
| S2 | Sağlayıcı adı yazılmaz: "Türkiye'de yerleşik barındırma sağlayıcısı"; disk ayrıca şifrelenmez, yedekler ve TOTP sırları şifreli | Ek-3 C · Ek-6 §5.1, §6.1 · Ek-6/C §3 · Ek-6/B §1.5 |
| S3 | Bakım bedeli lisans bedelinin %15'i; fiyatlar teklif bazında; ilk kurulumda 2 saat eğitim dahil | Ek-4 §2.3, §4.5, §8.2 · Lisans Sözleşmesi §4.5 |
| S4 | Bakım kendiliğinden yenilenir (30 gün önce yazılı bildirimle çıkılır); K1 askısı bakımı uzatmaz | Ek-4 §2.2, §3.7 |
| S5 | Tek tavan: son 12 ayda ödenen lisans + bakım + varsa bulut bedeli; KVKK cezası kusur oranında | Lisans Sözleşmesi §11.3 · Ek-4 §9 · Ek-6 §8.3 |
| S6 | Ceza koşulu: izinsiz her kurulum için lisans bedelinin 3 katı | Lisans Sözleşmesi §12.3 |
| S7 | İade yok; bakımın kalan süresi de iade edilmez | Lisans Sözleşmesi §13.4 |
| S8 | Yetkili mahkeme Lisans Veren'in merkezinin bulunduğu il (il şablon alanı) | Lisans Sözleşmesi §15 |
| S9 | Barındırılan sınıf kalır; şartları hizmet sunulduğunda ayrı sözleşmeyle | Lisans Sözleşmesi §10.6 |
| S10 | Patron bulutu ayrı yıllık abonelik, bakımdan bağımsız; bildirimde toplam tutar olabilir, cari ve kişi adı yok, ayrıntılı seçenek yok | Ek-4 §12.1, §12.2 · Ek-6 §6.2, §8.2 · Ek-6/C §3 |
| S11 | Standart sözleşme imzalanamazsa bildirimler içeriksiz uyandırmaya iner; süreç avukatla sürer | Ek-6 §6.4 · Ek-6/C §3 |
| S12 | Denetim: 30 gün önceden yazılı bildirim, masraf Lisans Alan'da, denetçi gizlilik taahhüdü verir | Ek-3 B.6 · Ek-6 §7.3 |
| S13 | Roller yazılır, adlar iç kayıtta; yazılı gizlilik sözleşmesi, yılda bir eğitim, yılda bir bağımsız sızma testi | Ek-8 §2 · Ek-6/B §2 · Ek-3 E |
| S14 | Doğrudan sorgu ayrı salt okunur rol + oturum kaydıyla (işletim borcu); TOTP kaybında yazılı başvuru yok, kayıtlı telefona geri arama, yeniden kurulum bağlantısı | Ek-6/B §3.2, §1.4 |
| S15 | Kabul kaydı olmadan etkinleştirme reddedilir; panel önce kabul adımını gösterir (kod borcu) | Ek-7 §5 |

Cevapların zorunlu kıldığı tutarlılık düzeltmeleri: Lisans Sözleşmesi avukat kutusundaki "§12.3 boş bırakıldı" ve Ek-6 avukat kutusundaki "§6.4'teki seçenekler" cümleleri; Ek-4 §2.2 "o yılın fiyat listesiyle" → "§2.3'teki bedelle" (fiyat listesi yok); Ek-4 §12.2 bakıma dahil satış koşulu → abonelik bakımdan bağımsız; Ek-6 §6.1 "şifreli diskte" → disk şifresiz; Lisans Sözleşmesi §1 Lisans Alan alanlarına "irtibat kişisi ve telefonu" eklendi (Ek-8 §2 ve Ek-6/B §1.4 sözleşmedeki kayıtlı telefona dayanır); şablon alanlarında yazım "unvanı" oldu.

- Barındırma sağlayıcısı teyit bekliyor (whois: TEKNOSOS Bilişim, Antalya); teyit gelince Ek-3 C ve Ek-6 §6.1'e ad yazılır.
- S14 TOTP kurtarma işlemi: `patron/sunucu/scripts/tesis.ts yonetici-yeniden-davet` (yeniden davet; parola ve TOTP sıfırlanır).
- Kalan şablon alanları — şirket kuruluşuyla dolacaklar: `[Lisans Veren ticaret unvanı — kuruluş tamamlanınca]` · `MERSİS no` · `vergi dairesi / no` · `adresi` · `KEP adresi` · `telefonu` · `merkezinin bulunduğu il`. İmzada dolanlar: `[Lisans Alan unvanı]`, `MERSİS no`, `vergi dairesi / no`, `adresi`, `KEP adresi`, `irtibat kişisi ve telefonu`, `[Bakım başlangıç tarihi]`, Ek-5. Yayında dolanlar: `[Yürürlük tarihi]`, `[Yayın tarihi]`.
