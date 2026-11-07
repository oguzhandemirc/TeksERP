# El terminali donanım okuyucu — plan (2026-11-07)

> Kullanıcı kararı 2026-11-07: sahada el terminali (tepesinde donanım barkod/QR okuyucu) ile TAM uyum.
> İlk cihaz Point Mobile PM68 (Android 15, `Build.MANUFACTURER` = `POINTMOBILE`); yapı genel: Point Mobile +
> Zebra (DataWedge) + Honeywell + klavye kaması (wedge) yedeği. Ana dalda (ortak paket) yapılır; müşteri
> farkı yalnız cihaz ayarıdır (`if (musteri===…)` yok). Cihaz bulguları: `~/.tekserp/adnan/pm68/BULGULAR.md`,
> okutma noktaları: `~/.tekserp/adnan/pm68/OKUTMA-ENVANTERI.md` (32 nokta).

## 0. Kök neden ve değişmez

Point Mobile'da uygulama kamerası açılınca `CameraService` okuyucuyu kapatır ("Scanner power is controlled");
eski firmware'de sistem çöküp yeniden başlar. ⇒ **Donanım okuyuculu cihazda barkod için kamera ASLA açılmaz**
(`BarcodeScannerModal` kamerayı hiç bağlamaz). Kamera yalnız barkod DIŞI işlerde (belge fotoğrafı) kalır.

## 1. Mimari (kullanıcıyla konuşuldu — değişmez)

1. **İnce yerel katman, mantık JS'te (OTA ile düzeltilebilir).** Repo içi Expo modülü
   `mobil/modules/teks-erp-donanim-okuyucu` (Kotlin, yeni npm paketi YOK). Yalnız:
   - (a) JS'in verdiği eylem listesi için dinamik `BroadcastReceiver` (API 33+ `RECEIVER_EXPORTED`); ön planda
     kayıt, arka planda kaldırma; gelen intent extras'ı jenerik biçimde (string/int/long/bool/double, byte[] →
     `{ $bytes: base64 }`, dizi, iç içe Bundle → nesne) `onIntent` olayıyla JS'e;
   - (b) JS'in verdiği action + extras ile `sendBroadcast` (setPackage opsiyonel; etiketli değerle `Bundle`,
     `Bundle[]`, `ArrayList<Bundle>`, `String[]`, int/long/bool — Zebra `SET_CONFIG` için);
   - (c) yaşam döngüsü yayınları: JS "ön plana gelince şunları, arka plana gidince şunları gönder" listesini
     verir; native sıralı gönderir (JS askıdayken de arka plan geri yüklemesi kaçmasın);
   - (d) yetenek sorgusu: paket kurulu mu (manifest `<queries>` ile sınırlı paketler), sistem paylaşımlı
     kütüphaneleri (`getSystemSharedLibraryNames`), `Build.MANUFACTURER/MODEL/BRAND`;
   - (e) ayar ekranı açmak için `startActivity(action, package?)` ve `launchPackage(package)`.
   Marka tanıma, action/extra adları, kod çözme, tekrar eleme, yönlendirme TAMAMEN JS'te.
2. **Point Mobile:** SDK yok. Etkinleştirme `device.common.GET_RESULT_TYPE` (önceki modu yakala; yanıt
   `device.common.STATE_RESULT_TYPE` / `EXTRA_RESULT_TYPE`) → `device.common.SET_RESULT_TYPE`
   `EXTRA_RESULT_TYPE=3` (EVENT). Sonuç `device.scanner.EVENT`: `EXTRA_EVENT_DECODE_VALUE` (byte[]),
   `EXTRA_EVENT_DECODE_LENGTH`, `EXTRA_EVENT_SYMBOL_NAME`. Arka plana gidince önceki mod geri yüklenir (yakalanamadı
   ya da 3 ise COPYPASTE=2) — diğer uygulamalarda wedge çalışsın. USERMSG(0) kullanılmaz (veri intent'te yok).
   Ayar ekranı: `device.common.LAUNCH_SCAN_SETTING` → `device.settings.scanner/.ScanSettingsActivity`.
3. **Zebra / Honeywell:** adaptör + birim testiyle sözleşme kilidi; **sahada doğrulanmadı** işaretli.
   Zebra: `com.symbol.datawedge.api.ACTION` + `SET_CONFIG` (profil `TeksERP`, uygulama bağlı, INTENT çıkışı
   yayın, KEYSTROKE kapalı), veri `com.symbol.datawedge.data_string` / `label_type`. Honeywell:
   `com.honeywell.aidc.action.ACTION_CLAIM_SCANNER` (paket `com.intermec.datacollectionservice`,
   `DPR_DATA_INTENT=true`, kendi eylemimiz), veri `data` / `codeId` / `aimId`; arka planda `ACTION_RELEASE_SCANNER`.
4. **Yedek yol (wedge):** tanınmayan/yapılandırılamayan ya da yerel modülü olmayan (eski APK) okuyuculu cihazda
   görünmez, klavye açmayan odaklı `TextInput` (`showSoftInputOnFocus={false}`) + Enter / yapıştırma / tuş
   aralığı zaman aşımıyla okuma. Cihaz bu yola ayardan zorlanır ("Okuyucu bağlantısı: Klavye (yedek)"); model
   tablosu JS'te olduğu için OTA ile de zorlanabilir (`FORCE_WEDGE_MODELS`).
5. **Tek boğaz:** her kaynak `onScan({ data, symbology, source })` üretir → `normalizeScanCode` → yalnız aynı
   yayının çift teslimi (≤300 ms, aynı veri) elenir — kasıtlı tekrar okuma ekranın mükerrer geri bildirimine
   ("ZATEN OKUTULDU") gider (cihazda ölçüldü 2026-11-07: okuyucu kendiliğinden tekrarlamıyor) → **en üstteki
   hedef** (LIFO hedef yığını) alır. API:
   `useHardwareScanTarget(handler, { active })`. Hedef yoksa okuma düşer (sessiz değil: hafif uyarı tonu +
   "Bu ekranda okutma beklenmiyor" toast'ı). Geri bildirim mevcut `signalScan`/`useScanFeedback`; havuz ekranı
   `resolvePoolScan`.
6. **Ayarlar → "Barkod ve Kamera":** en üstte "Okutma Yöntemi" kartı: Otomatik (varsayılan) · Donanım okuyucu ·
   Kamera; Otomatik'te algılanan yazılır ("Algılanan: Point Mobile PM68 — tepedeki okuyucu"); "Okuyucuyu dene"
   alanı (okunan kod + semboloji + kaynak); "Okuyucu ayarlarını aç". "Elle Barkod Girişi / Kamera arızalı"
   metni yöntemden bağımsız: "Elle yazma alanlarını göster" (aynı `manualBarcodeEntry`). Ayar CİHAZ başına
   (`deviceSettingsStore`). Not: kamera yönü bugün ayar ekranında değil, tarayıcıdaki çevir tuşunda — donanım
   modunda tarayıcı hiç açılmadığı için kendiliğinden gizli kalır.
7. **Donanım modunda arayüz:** kamera düğmesi, OKUT düğmesi ve elle barkod kutusu gösterilmez (elle yazma ayarı
   açıksa kutu kalır); tuşa basınca ekranın okuma işi doğrudan yapılır.
8. **Çok amaçlı ekran kuralı:** en üstte açık pencere okumayı alır; ekran adımlıysa o adımın hedefi. Kurala
   uymayan/belirsiz ekran → ekran görüntüsüyle kullanıcıya rapor, ajan karar vermez.

### Yöntem çözümü (saf yüklem `resolveScanMethod`)

| Ayar | Yerel modül + tanınan adaptör | Modül yok/tanınmadı, okuyuculu üretici | Okuyucusuz cihaz |
|---|---|---|---|
| Otomatik | donanım (intent) | donanım (wedge) | kamera (bugünkü) |
| Donanım okuyucu | donanım (intent) | donanım (wedge) | donanım (wedge) |
| Kamera | kamera | kamera | kamera |
| + "Klavye (yedek)" | donanım (wedge) | donanım (wedge) | "Donanım okuyucu"da wedge, Otomatik'te kamera |

"Okuyuculu üretici" listesi JS'te (POINTMOBILE, ZEBRA, HONEYWELL, DATALOGIC, UROVO, NEWLAND, CIPHERLAB,
SUNMI, iData, Chainway, Unitech, M3) — OTA ile genişler. Varsayılan = bugünkü davranış: okuyucusuz cihazda
Otomatik = kamera (ölçüt: kök CLAUDE.md "yeni bayrağın varsayılanı bugünkü davranış").

## 2. Senaryolar

- S1 PM68 + yeni APK: Otomatik → Point Mobile adaptörü; uygulama ön planda EVENT(3), tuşa basınca okunan kod
  en üstteki hedefe gider; arka plana alınca okuyucu önceki moda döner (Adnan uygulaması wedge ile çalışır).
- S2 PM68 + eski APK (yerel modülsüz) + yeni JS: üretici POINTMOBILE → wedge; cihaz COPYPASTE'te odaklı görünmez
  kutuya yapıştırır; kamera açılmaz.
- S3 Zebra/Honeywell: adaptör yapılandırır (sahada doğrulanmadı); çalışmazsa ayardan "Klavye (yedek)".
- S4 Sıradan tablet/telefon: Otomatik = kamera; bugünkü akış değişmez.
- S5 Ekran üstünde açık modal (ör. top seçici) → okuma modala gider, alttaki ekran almaz.
- S6 Hedefsiz ekran (ana menü): okuma düşer, hafif uyarı.
- S7 Aynı yayın ≤300 ms içinde iki kez teslim edilir → bir kez işlenir; operatör aynı etiketi yeniden okutursa
  ekranın mükerrer uyarısı çalışır.
- S8 Elle yazma ayarı açık + donanım: kutu görünür, okuyucu da çalışır (kutu odaktayken wedge kutuya yazar).

## 3. Dilimler ve kabul testleri

### D1 — yerel modül + JS çekirdek (bu PR)
Dosyalar: `mobil/modules/teks-erp-donanim-okuyucu/**` · `mobil/src/services/hardwareScanner/**`
(native köprü, extras çözücü, adaptörler, `resolveScanMethod`, boğaz + hedef yığını, yaşam döngüsü yöneticisi) ·
`mobil/src/hooks/useHardwareScanTarget.ts` · `mobil/src/components/HardwareScannerHost.tsx` (wedge kutusu + host,
`App.tsx`te bir kez) · `deviceSettingsStore` (`scanMethod`, `hardwareLink`) · `ScannerSettingsScreen` (Okutma
Yöntemi kartı + Okuyucuyu dene + ayar aç; elle yazma metni).
Kabul (jest): extras çözücü (base64/uzunluk/UTF-8, latin1 yedeği) · Point Mobile `parse` + etkinleştirme/geri
yükleme yayınları + önceki mod yakalama · Zebra `SET_CONFIG` paketi (etiketli değerler) + `parse` · Honeywell
claim/release + `parse` · `resolveScanMethod` tablo testi (yukarıdaki 12 hücre) · boğaz: normalize, 300 ms
çift teslim eleme (301 ms'de geçer), LIFO (üstteki alır, pop sonrası alttaki), `active:false` hedef yığından çıkar · wedge birleştirici
(Enter, yapıştırma, zaman aşımı) · JS ↔ native ad/işlev eşitliği bekçisi (Kotlin metninden) · ayar kartı render.
Cihaz kabulü (PM68, test APK `com.etkiliyazilim.tekserp`): ayar kartında "Algılanan: Point Mobile PM68";
"Okuyucuyu dene"de tuş → kod + semboloji görünür (KULLANICI tetikler); uygulama arka plana → `GET/SET_RESULT_TYPE`
yayınları logcat'te, önceki mod 2'ye döner; logcat'te `CameraService`/`Scanner power is controlled` YOK.

### D2 — `BarcodeScannerModal`/`ScannerEntryBar` donanım modu + tek amaçlı ekranlar + Hızlı İE düzeni
- `BarcodeScannerModal`: donanım modunda kamera BAĞLANMAZ; `visible` iken modal hedef olur (sürekli ekranlarda
  "Tuşa basarak okutun" paneli + sayaç/şerit; tek okumalılarda okununca kapanır). Böylece 32 noktanın çoğu
  çağıranı değiştirmeden kameradan kurtulur.
- `ScannerEntryBar`: donanım modunda CTA yok; ekran hedefi `useHardwareScanTarget` ile `onResolve` yolunu çağırır.
- Hızlı İE → Yeni İş Emri, 1. adım TOPLAR (`StepRolls`): OKUT düğmesi yok; "Sipariş Bağla" alt çubukta İLERİ'nin
  yanında; adım okutulan topları TABLO olarak gösterir (480×800 dikey birinci hedef; tablet düzeni bozulmaz).
- Tek amaçlı ekranlar (envanter 1–4, 13, 17, 21–23, 25–27, 32).
  Uygulanan (PR #603'ye bakın): modal `listenWhileHidden` (modal açılmadan tuş okur; gizli okumada `onModalHide`
  işleyici bitince çağrılır) + `ScannerEntryBar hardwareListening`; ekranlar: Hızlı İE adım ①, Depo, Kartela Sevk.
  D2b (ayrı PR): Muayene, Kurşun KK, İade (seri modda kamera döngüsü yerine ekran sürekli dinler; her tuş sıradaki
  top, sayaç aynı), Paketleme (yükleme bitince), Hızlı Sipariş, Çuvalsız sevk (sonuç kartı alt barın üstünde), Fason
  Kabul (tablet hep; telefonda kabul açılmamışken ya da el girişi bandında), İE'ye parti ekle (sheet içinde), Gelen
  Belge irsaliye (kilitli değilken), giriş kartı (kart görünümünde, giriş sürmüyorken). Lisans/eşleme QR'ları
  bilinçli modal-yalnız (seyrek, ayar ekranı): açılınca panel çıkar, kamera yok. Bekçi §7 listeyi kilitler.
  "En üstteki açık pencere" kuralı (D3'ün de temeli): görünür AppModal, kendisini kapsamayan arka plan
  dinleyicisini örter → ret sesi + "Önce açık pencereyi kapatın"; sıra değil KAPSAMA (bağlam) belirler, sheet
  içindeki kapalı tarayıcı kendi sheet'i açıkken dinler. Yan panel (`RightPanelDrawer`) `scanPassThrough`.
Kabul: jest (modal donanım modunda `BarcodeScannerView` render ETMEZ; StepRolls donanım modunda OKUT yok, tablo
var; hedef adım değişince değişir) · cihaz: ekran görüntüleri 480×800, kamera logu yok, kullanıcı tetik listesi.

### D3 — çok amaçlı ekranlar
Envanter 5–12, 14–16, 18–20, 24, 28–31: adım/öncelik hedefleri (PlaceConfirm istasyon→modül, KK1 bekleyen
doğrulama öncelikli, Tambur kart/kesme/çıkan top, CuvalDuzelt top→hedef, FasonSevk kart→top, Devere/Dokuma
levent ekranları). Belirsiz ekran → kullanıcıya rapor (ekran görüntüsü).
Kabul: ekran başına hedef testi (hangi adımda hangi işleyici) + cihaz tetik listesi.
Uygulanan kural (ekran durumu yönlendirir; önek/biçim yönlendirmesi KULLANILMADI — sunucu çözer, yanlış tipi
ekran reddeder). Varsayılan dinleyici kapalı tarayıcı; ikincil okutma düğmesi kendi görünür panelini açar ve üstte
olduğu için okumayı o alır; açık AppModal arka planı örter (D2b kuralı).
- Tambur: varsayılan refakat kartı; Kesme / Çıkan Toplar / Topu Buraya Al kendi paneli ("Tara" çipi okuyucu
  paneli açar). Topu Buraya Al sheet'i açıkken tuş top barkodu (sheet `scanPassThrough`, dinleyici kardeş).
- Fason Sevk: iş emri seçilmemişken kart; iş emri + adım seçiliyken top (sonuç kartı bandın altında); arada yok.
- KK1: tezgah etiketi barı görünürken tezgah etiketi; etiket doğrulama kendi panelinden (plan "doğrulama
  öncelikli" demişti — biçimle ayırmak yerine düğmeyle açılan panel seçildi, bekleyen sayacı düğmede).
- Çuval Düzelt: varsayılan top bul; "Taşı" paneli açıkken hedef çuvaldaki top.
- Levent Sarım: sekme üst bileşende; "Tezgahta" sekmesinde levent-tak bandı, diğerlerinde sar bandı (yalnız etkin
  bant "tuşa basın" gösterir). Tak formu (sheet): tezgah etiketi (oturum makinesi yoksa). Dokuma levent bandı:
  çevrimiçiyken.
- Yer onayı: seçim görünümünde (yükleme/oturum açma sürmüyorken) makine QR'ı.
- Dokunulmayanlar (zaten panelle kamerasız, açık eylem): Sevkiyat yük ekleme akışı, müşteri kodu bağlama sheet'i.

### D4 — Adnan Şahin teslim yolu (yalnız plan; uygulama kullanıcı kararıyla)
Bulgular: Adnan tableti eski kanal (`com.teks.erp.mobil`, `runtimeVersion` 54.2, `deploy/kanallar.json`
`adnansahin`); kural `surum-yayin.md` "[PROFİL] Eski kanal APK künye yolu `eski-kanal-son` etiketinde DONUK; ana
dalda kodu yok (K-14), yeni iş eklenmez". Ana dalın ortak tablet kimliği `com.etkiliyazilim.tekserp`, rv 59.0.
Seçenekler (karar KULLANICIDA):
- A) Adnan'ı ortak pakete geçirmek (Play, `com.etkiliyazilim.tekserp`): paket adı değişir ⇒ yan yana kurulum,
  cihaz eşleme yeniden, yerel ayarlar taşınmaz; backend sürümü ortak tabletin istediği sözleşmeyi taşımalı
  (Adnan backend `bakim/adnansahin-backend-2.11.x`) — eski backend uyumu ayrıca ölçülür.
- B) Eski kanala tek seferlik bakım dalı (`bakim/adnansahin-tablet-*`, `eski-kanal-son`dan): yerel modül native
  olduğu için OTA YETMEZ (rv 54.2 → yeni rv, APK elle/kanal yolu); dondurma kuralına istisna = kullanıcı kararı.
- C) Yalnız JS (OTA) ile wedge yolu: S2 senaryosu eski native'de çalışır (yerel modül gerekmez); ama eski kanalın
  JS'i ana daldan çok geride — wedge çekirdeğinin geri taşınması gerekir; yine dondurma istisnası.
`minVersion`: gerekmez (sözleşme kırılmıyor; backend değişmiyor). Yeni native ⇒ ortak pakette `runtimeVersion`
artışı + AAB (Play) — yayın turunda `yayinla:ortak:check` "NATIVE DEĞİŞTİ" der; rv artırımı o turun işi.

**Yayın turu ZORUNLU maddesi (2026-11-07 cihaz bulgusu):** `runtimeVersion` artırılmadan çıkan APK/AAB, cihazda
önbellekte duran aynı rv'li eski OTA paketini çalıştırabilir — PM68'de yeni APK kurulduğu hâlde eski JS açıldı
(veri temizlenince yeni kod geldi). Yerel modül taşıyan bu sürüm rv artışı + AAB olmadan YAYINLANMAZ.

## 4. Açık noktalar
- Hedefsiz okuma davranışı (S6) uyarı tonu mu, sessiz mi — D1'de uyarı + toast; kullanıcı aksini derse değişir.
- Güvenlik: `RECEIVER_EXPORTED` alıcıya başka uygulama sahte okuma yollayabilir (DataWedge/PM ile aynı sınıf);
  okuma yalnız ekranın normal okutma yoluna girer (yetki/doğrulama sunucuda) — kabul edilen risk.
- Uygulama EVENT modundayken çökerse okuyucu 3'te kalabilir (diğer uygulamada wedge çalışmaz); yeniden
  açılış/arka plan geçişi düzeltir; ayar ekranındaki "Okuyucu ayarlarını aç" elle çıkıştır.
