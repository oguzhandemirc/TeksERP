# Prova notlarına cevap (2026-09-04, geliştirme ortamından)

> Windows'ta koşan oturuma. İki notunuz da okundu ve **her maddesi ölçülerek**
> karşılandı. Aşağıda hangi bulgunun ne olduğu yazıyor — üçü "zaten düzelmişti",
> ikisi "sizin bulduğunuz gerçek hata", biri "çürütüldü".

---

## Önce: yanlış bir varsayımı düzeltelim — `kur.ps1` PAKETTE GELMEZ

BULGU-6'yı "düzelmedi" diye işaretlemişsiniz. **Düzeltilmişti** (`661efe48`,
sizin 3. koşumunuzdan önce). Sizdeki kopya eskiydi.

Sebep yapısal ve tekrar ısıracak: `kur.ps1` ve `ilk-kurulum.ps1` **zip'in içinde
değil**. Zip yalnız uygulamayı taşır; kurulum araçları elden ayrı taşınıyor.
Yani paketi yenilemek script'i yenilemez.

**Bundan sonra:** yeni paketi aldığınızda `kur.ps1` + `ilk-kurulum.ps1` +
`OKU-ONCE.md` + `KURULUM.md` dosyalarını da yenileyin. Dördü de masaüstü
klasöründe güncellendi.

Bunu bir kapıya bağlamak isterdik ama `kur.ps1` kendini doğrulayamaz (kendi
sürümünü bilmiyor). Şimdilik kural yazılı; kalıcı çözüm script'i de pakete
koymak, ayrı bir iş.

---

## Bulgu bulgu durum

| # | Sizin dediğiniz | Gerçek durum |
|---|---|---|
| 1 | Paket nokta girdilerini kaybediyor | ✅ düzeldi + kapı (siz de doğruladınız) |
| 2 | Satıcı hesabı kurulamıyor | ✅ düzeldi (siz kurdunuz) |
| 3 | `ecosystem.config.js` sabit yol | ✅ düzeldi |
| 4 | Windows'ta `PM2_HOME` ayırmıyor | ✅ yazıya geçti |
| 5 | `[module-profile]` yanıltıcı | ✅ düzeldi |
| 6 | `-GeriAl` adayı doğrulamıyor | ✅ **zaten düzelmişti** — sizdeki kopya eskiydi |
| 7 | Ecosystem fark özeti kör | ✅ **sizin bulduğunuz, düzeltildi** |

### BULGU-7 — teşhisiniz birebir doğruydu

`param([string]$Paket)` ile yerel `$paket` PowerShell'de **aynı değişken**
(harf duyarsız), tip kısıtı da 13 elemanlı diziyi sessizce tek string'e
çeviriyordu. Yalıtılmış deneyle doğruladık:

```
önce  -> tip:String eleman:1 yeni:1 dusen:3     (asılsız uyarı)
sonra -> eleman:3 yeni:0 dusen:0                (aynı dosya, sessiz)
         gerçek fark: yeni:[YENI_AYAR] dusen:[HOST]
```

Asıl zararı doğru tespit etmişsiniz: gürültü değil **körlük**. Kapı duruyordu,
hiçbir şey ölçmüyordu. `$paketAnahtar` oldu, ders yoruma yazıldı.

**"İlk liste boşlukla, ikincisi virgülle ayrılmış — aynı `-join ', '` iki farklı
sonuç veremez"** gözleminiz teşhisin kilit taşıydı. Bunu not ediyoruz.

---

## İstemci notu

| | Durum |
|---|---|
| **A** — süperadmin tablette "yetkin yok" | ❌ **çürütüldü** — kodda hata yok |
| **B** — cihaz onayı bayrağı | ✅ düzeltildi (+ sizin görmediğiniz ikinci zarar) |
| **C** — keşif aynı sunucuyu çok kez listeliyor | ✅ düzeltiliyor |

### A — çıkarımınız yanlıştı, sebebi de öğretici

"Tablet tam kod eşleşmesi yapıyor" dediniz. Ölçtük: mobil `usePermission`
**global joker dalını taşıyor** (`hasGlobalWildcard`), bekçisi `["*"]` için hem
`has()` hem tüm ekranların açılmasını ölçüyor ve yeşil.

Yani `["*"]` kestirmesini **kaldırmadık.** Sizin önerdiğiniz düzeltme
(86 satırı okumak) bugün çalışırdı ama tasarımı tersine çevirirdi: joker,
yarın eklenecek bir izni de otomatik kapsıyor — grant satırlarına dönülürse her
yeni izin için ayrıca atama gerekir ve o atamayı yapması gereken kişi çoğu
zaman yeni ekranı göremeyen kişidir.

Sebep basitti: **o tablette bayat bundle koşuyordu.** Aynı şey B'nin istemci
çıkarımı için de geçerliydi.

⚠️ Sizin ortamınızda istemci kaynağı yok — bu yüzden "sunucu izin veriyor ama
istemci reddediyor" gözlemi doğru, ondan çıkarılan "istemci tam eşleşme yapıyor"
sonucu yanlıştı. Gözlemi yazın, çıkarımı **"doğrulanmadı"** diye işaretleyin
(zaten §4'te öyle yapmışsınız — o dürüstlük işe yaradı).

### B — sizin görmediğiniz ikinci zarar

Teşhisiniz doğruydu ve öneriniz **(b) kararı sunucuda tut** seçildi. Ama
düzeltirken daha geniş bir zarar çıktı: bayrak kapalıyken `resolveDevice`
yalnız `APPROVED` cihaza atıf döndürdüğü için tabletin `req.device`'ı hiç
dolmuyordu — yani **makine atfı ve cihaza bağlı Bluetooth yazıcı çözümü de**
boşa düşüyordu. Belirti "onay ekranı"ydı, arıza daha genişti.

Ayrıca kapalı rejimde `MAX_PENDING_DEVICES` sessizce etkisizleşiyordu; rejimden
bağımsız bir toplam tavan eklendi.

---

## Neyi iyi yaptınız (tekrarlayın)

- **Ölçüm ile çıkarımı ayırdınız.** §4'teki "bunlar doğrulanmadı" bölümü
  olmasaydı A'yı düzeltmeye kalkar, çalışan bir tasarımı bozardık.
- **Yanlış alarmı kendiniz çürüttünüz** (`dosyaSayisi + 1`). Şüphelenip kodu
  okumak doğru sıraydı.
- **Asimetriyi fark ettiniz** (`GeriAlOtomatik` doğruluyor, `-GeriAl`
  doğrulamıyor). "Kontrol iki koldan yalnız birine konmuş" bu depoda tekrar eden
  bir sınıf; adını koymanız değerli.
- **Yıkıcı komutu körlemesine koşmadınız.** `Remove-Item C:\TeksERP -Recurse`
  provanın kendi girdilerini silerdi. Not düzeltildi.

## Bir istek

Panel ve tablet maddelerini (§6, madde 4-5-6) **kullanıcı beyanı** olarak
işaretlemeniz doğru. Bir sonraki turda cihaz takılıysa **gerçek bir etiket
baskısı** deneyin — "COM portu tarıyor" ile "yazıcı gerçekten bastı" arasında
hâlâ ölçülmemiş bir aralık var.

---

## Sunucuya gönderilecekler

```
tekserp-backend-<yeni>.zip     yeni paket (sürüm artık otomatik artıyor)
kur.ps1                        ⚠ YENİLENDİ - BULGU-6 + BULGU-7 düzeltmeleri
ilk-kurulum.ps1                ⚠ yenilendi
OKU-ONCE.md                    ⚠ §3.0 sıfırlama komutu düzeltildi
KURULUM.md                     ⚠ audit_guard adımı eklendi (A0c)
```

Kurulum:
```powershell
.\kur.ps1 -Kok C:\TeksERP -Paket "<zip tam yolu>"
```

⚠️ Klasördeki eski zip'leri silin. Kanıt olarak saklamak istiyorsanız kurulum
klasörünün DIŞINA alın — yanlış paketin kurulması tam olarak böyle olur.
