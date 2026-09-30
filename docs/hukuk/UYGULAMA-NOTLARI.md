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
| (d) karar | 45 | Dokunulmadı; 15 soruya bağlandı (aşağıdaki tablo). |

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

### Metin ↔ kod farkları (metin kodun önünde; uygulama borcu)

1. Ek-6/A §2.5 ve Ek-6/C §3: kapatılan hesabın kimlik bilgileri 30 gün içinde silinir — kodda pasife alınan hesap için kimlik silme yok (`maintenance.ts` budama listesinde hesap tablosu yok).
2. Ek-6/A §4.2: hizmet bitişinden sonra 90 gün salt okunur giriş ve JSON/CSV dışa aktarma — kodda yok.
3. Ek-3 D ve Ek-6/A §2.4: sunucu erişim günlükleri (IP) 30 gün — VDS'te Docker günlükleri boyutla döner (20 MB × 5; `docs/ops/SUNUCU-ENVANTERI.md`); gün bazlı saklama ölçülmedi.
4. Ek-3 D "Lisans Veren'de tutulan uzak yedekler: Lisans Alan'ın belirlediği döngü" — işletimde döngü sabit: günlük arşiv 30 gün, aylık arşiv 12 ay (`docs/ops/SUNUCU-ENVANTERI.md`).
5. Ek-6 §6.2 ve Ek-6/C §3 "bildirim tutar içermez" — çek/senet vadesi bildirimi vade kovası başına toplam tutar ve döviz taşır; cari ve kişi adı yok (`patron/sunucu/src/services/notification-events.ts`). Soru 10(b).
6. Ek-6/A §4.4: yedek alınamayan dönemde budama çalışmaz ve son 7 kopya korunur (`deploy/patron/yedek-dongusu.sh`); "imhadan en geç 35 gün" bu arıza durumunda aşılabilir.
7. Ek-6/B §3.2: doğrudan veritabanı sorgusu için ayrı rol + oturum kaydı yok. Soru 14(a).
8. Ek-7 §5: satıcı kabul kaydı olmayan etkinleştirmeyi denetlemiyor (protokol v1'de alan yok). Soru 15.

### (d) karar soruları → metindeki yerler

| Soru | Konu | Yerler |
|---|---|---|
| 1 | Lisans Veren kimliği ve iletişim | Lisans Sözleşmesi §1 · Ek-4 §4.1 (telefon, e-posta) · Ek-6/C §3 · Mobil Gizlilik Politikası başlık ve §9 |
| 2 | VDS sağlayıcısı, şehir, disk şifrelemesi | Ek-3 C · Ek-6 §5.1, §6.1 · Ek-6/C §3 · Ek-6/B §1.5 |
| 3 | Fiyatlandırma (bakım oranı, fiyat listesi, ücretli hizmetler, eğitim) | Ek-4 §2.3 · Lisans Sözleşmesi §4.5 · Ek-4 §4.5, §8.2 |
| 4 | Bakımın otomatik yenilenmesi ve K1 askısı | Ek-4 §2.2, §3.7 |
| 5 | Sorumluluk tavanı ve KVKK cezası paylaşımı | Lisans Sözleşmesi §11.3 · Ek-4 §9 · Ek-6 §8.3 |
| 6 | Ceza koşulu | Lisans Sözleşmesi §12.3 |
| 7 | Bedel iadesi | Lisans Sözleşmesi §13.4 |
| 8 | Yetkili mahkeme | Lisans Sözleşmesi §15 |
| 9 | Barındırılan sınıf | Lisans Sözleşmesi §10.6 |
| 10 | Patron bulutu ticari modeli ve bildirim içeriği | Ek-4 §12.1 · Ek-6 §8.2, §6.2 |
| 11 | Yurt dışı aktarım yolu | Ek-6 §6.4 · Ek-6/C §3 |
| 12 | Denetim hakkı | Ek-3 B.6 · Ek-6 §7.3 |
| 13 | Lisans Veren ekibi ve iç tedbirler | Ek-8 §2 · Ek-6/B §2 · Ek-3 E |
| 14 | Bulut erişim güvenliği (doğrudan sorgu, yönetici TOTP sıfırlama) | Ek-6/B §3.2, §1.4 |
| 15 | Kabul kaydı olmayan etkinleştirme | Ek-7 §5 |
