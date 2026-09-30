# Patron Bulutu Aydınlatma Metni (uygulamada gösterilir)

> **TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu metin bir taslaktır; hukuki görüş değildir. Aydınlatma yükümlülüğü (KVKK md. 10) **veri sorumlusu olan fabrikanındır**; bu metin fabrika adına, onun onayıyla gösterilecek şablondur. `{…}` yer tutucuları uygulamada o Tesis'in bilgisiyle doldurulur; `[DOLDURULACAK]` ticari ya da eksik bilgidir.
>
> Metin kimliği: `PBAM-2026.1-taslak` · Ek-6/C · Patron Bulutu Veri İşleme Eki'ne (Ek-6) dayanır.

> **Avukat şu maddelere özellikle baksın**
> - **Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ:** Metin katmanlı (kısa ekran + tam metin) kurgulandı. Kısa ekran Tebliğ'in asgari içeriğini karşılıyor mu?
> - **Aydınlatma ile açık rıza ayrımı:** Metinde onay kutusu YOK; yalnız "okudum" teyidi var. Bu ayrım Kurul'un yaklaşımına uygun mu?
> - **İlgili kişi grupları:** Bu metin yalnız Bulut Hesabı sahiplerine gösterilir. Buluttaki cari yetkilileri ve keşideciler için fabrikanın kendi genel aydınlatma metnine bulut işlemesi eklenmeli mi (§4)?
> - **Veri sorumlusu kimliği:** Fabrika şahıs işletmesiyse kimlik bilgisinin nasıl yazılacağı.

---

## 1. Nerede ve ne zaman gösterilir

- **İlk girişte**, parola ve TOTP kurulumundan sonra, uygulama açılmadan önce: kısa metin (§2) + "Tam metni oku" bağlantısı (§3) + **"Okudum"** düğmesi. Okundu teyidi hesap güvenlik kaydına metin kimliği ve özetiyle yazılır.
- **Metin değişince** bir sonraki girişte yeniden gösterilir.
- Her zaman: **Profil → Kişisel veriler** altında.
- Web sürümünde giriş sayfasının altında "Aydınlatma metni" bağlantısı.

## 2. Kısa metin (ilk ekran)

> **Kişisel verileriniz hakkında**
>
> Bu uygulamada gördüğünüz ve girdiğiniz veriler **{Tesis ünvanı}** adına işlenir; veri sorumlusu {Tesis ünvanı}'dır. Uygulamayı ve bulut sunucusunu **{Lisans Veren ünvanı}** veri işleyen olarak Türkiye'deki sunucularda işletir.
>
> Hesabınız için adınızı, e-postanızı, giriş kayıtlarınızı (IP ve zaman) ve bildirim tercihlerinizi; hesabınızla girdiğiniz sipariş ve cari taleplerini işliyoruz. Amaç: hesabınızı güvenle çalıştırmak, fabrika verisini size göstermek, girdiğiniz talebi fabrikaya iletmek ve istediğiniz bildirimleri göndermek.
>
> Bağlantı güvenliği ve bildirimler için yurt dışındaki hizmet sağlayıcılar kullanılır (Cloudflare, Apple, Google, Expo).
>
> KVKK md. 11'deki haklarınız için {Tesis başvuru adresi} adresine başvurabilirsiniz.
>
> [Tam metni oku] [Okudum]

## 3. Tam metin

**Veri sorumlusu:** {Tesis ünvanı}, {Tesis adresi}, {MERSİS no / vergi no}. İletişim: {Tesis KVKK iletişim adresi}.

**Veri işleyen:** {Lisans Veren ünvanı} [DOLDURULACAK], {adres}. Uygulamayı ve bulut sunucusunu {Tesis ünvanı}'nın talimatıyla işletir; verilerinizi kendi amaçları için kullanmaz.

**Hangi verileriniz işlenir**
- Kimlik ve iletişim: adınız, e-posta adresiniz.
- Hesap güvenliği: parolanızın geri döndürülemez özeti, iki aşamalı doğrulama sırrınız (şifreli), giriş ve başarısız giriş kayıtları, IP adresi, hesap durumu ve size verilen izinler, hesabınızda yapılan değişiklikler.
- Bildirim: bildirim tercihleriniz, sessiz saatleriniz, cihazınızın bildirim anahtarı.
- İşlem: hesabınızla girdiğiniz sipariş ve cari talepleri ve sonuçları. Bu talepler fabrika sistemine iletildiğinde adınız ve hesap kimliğiniz de kaydın kaynağı olarak fabrika sisteminde saklanır.
- Cihaz: uygulama, son görüntülediğiniz veriyi çevrimdışı görebilmeniz için cihazınızda saklar; oturumu kapattığınızda siler.

**Amaçlar ve hukuki sebepler**

| Amaç | Hukuki sebep (KVKK md. 5/2) |
|---|---|
| Hesabınızın açılması, girişiniz, izinlerinizin uygulanması | (c) sözleşmenin kurulması ve ifası — {Tesis ünvanı} ile aranızdaki iş ya da hizmet ilişkisi [avukat] |
| Hesap güvenliği, yetkisiz erişimin önlenmesi ve tespiti | (f) meşru menfaat; (ç) veri güvenliği yükümlülüğü [avukat] |
| Girdiğiniz taleplerin fabrikaya iletilmesi ve sonucunun size gösterilmesi | (c) |
| İstediğiniz bildirimlerin gönderilmesi | (c) |
| Bir uyuşmazlıkta talebin kimden geldiğinin ispatı | (e) bir hakkın tesisi, kullanılması veya korunması |

**Kimlere aktarılır**
- **Yurt içi:** {Lisans Veren ünvanı} (veri işleyen) ve Türkiye'deki sunucu sağlayıcısı [DOLDURULACAK].
- **Yurt dışı:** Cloudflare, Inc. (bağlantı güvenliği; bağlantınız onun sunucusundan geçer), Apple Inc., Google LLC ve 650 Industries, Inc. (Expo) (bildirim iletimi). Bildirimler varsayılan olarak tutar ve kişi adı içermez. Aktarım KVKK md. 9'a uygun güvencelere dayanır [DOLDURULACAK — dayanak kurulunca: standart sözleşme].
- Hukuken yetkili kamu kurumlarına, talep hâlinde.

**Toplama yöntemi:** Uygulamaya girdiğiniz bilgiler, uygulamanın ve sunucunun otomatik oluşturduğu kayıtlar ve hesabınızı açan tesis yöneticisinin girdiği bilgiler yoluyla, elektronik ortamda.

**Saklama:** Hesabınız açık kaldığı sürece. Başarısız giriş kayıtları 90 gün, diğer güvenlik kayıtları 2 yıl saklanır. Hesabınız kapatılınca kimlik bilgileriniz 30 gün içinde silinir. Ayrıntı: {saklama ve imha prosedürü bağlantısı}.

**Haklarınız (KVKK md. 11):** verinizin işlenip işlenmediğini öğrenme; işlenmişse bilgi isteme; amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme; aktarıldığı üçüncü kişileri bilme; eksik ya da yanlışsa düzeltilmesini, şartları oluşmuşsa silinmesini ya da yok edilmesini isteme ve bunun aktarılanlara bildirilmesini isteme; münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz; kanuna aykırı işleme nedeniyle zarara uğrarsanız zararın giderilmesini isteme.

**Başvuru:** {Tesis ünvanı}'na {başvuru adresi / KEP / e-posta} yoluyla, Veri Sorumlusuna Başvuru Usul ve Esasları Hakkında Tebliğ'e uygun olarak başvurabilirsiniz. Başvurunuz en geç 30 gün içinde sonuçlandırılır. {Lisans Veren ünvanı}'na gelen başvurular {Tesis ünvanı}'na iletilir.

Metin sürümü: `PBAM-2026.1` · Yürürlük: [Yürürlük tarihi]

## 4. Fabrikanın kendi aydınlatma metnine eklenecek cümle (öneri)

Buluttaki cari yetkilileri ve keşideciler uygulamayı kullanmaz; onlar için aydınlatma, fabrikanın müşteri ve tedarikçilerine verdiği genel aydınlatma metniyle yapılır. O metne eklenmesi önerilen cümle [avukat]:

> "Cari ilişkimiz kapsamında işlenen ad, yetkili adı ve telefon bilgileriniz ile finansal kayıtlarınız, yöneticilerimizin uzaktan erişimi amacıyla, veri işleyenimiz {Lisans Veren ünvanı}'nın Türkiye'deki sunucularında tutulan bir kopyada da işlenir."
