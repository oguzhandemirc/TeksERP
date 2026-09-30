# TeksERP Lisans Yaptırım Maddeleri

> **TASLAK — AVUKAT İNCELEMESİ BEKLİYOR.** Bu metin Son Kullanıcı Lisans Sözleşmesi'nin (Sözleşme) ayrılmaz ekidir ve ayrıca kabul edilir (Kabul Metni, Ek-7, kutu 2); taslaktır, hukuki görüş değildir. `[DOLDURULACAK]` işaretli süre ve tutarlar ticari varsayımdır.
>
> Metin kimliği: `YM-2026.1-taslak` · Ek-2

> **Türk hukuku: FSEK, TBK, KVKK, TCK 244 açısından avukat şu maddelere özellikle baksın**
> - **TCK md. 244 — asıl risk:** Lisans Veren'in uzaktan verdiği kararla müşterinin bilişim sisteminin işleyişini kısıtlaması (K3, K4) ya da durdurması (K5), "sistemi engelleme, bozma" suçunun unsurlarına girebilir mi? Taslak üç önlem aldı: her kademede verilere erişim açık (§6); kademeler Sözleşme'de önceden ve ayrıca kabul ediliyor; K4 ve K5 dar ve sayılı gerekçelere bağlı (§4). Bu önlemler yeterli mi? Ayrıca K5'in hiç kullanılmaması mı, yoksa yalnız fesihten sonra mı kullanılması önerilir?
> - **TCK md. 243:** yaptırım, müşteri sistemine giriş gerektirmez. Karar Lisans Veren sunucusunda verilir; müşterinin kendi yazılımı, imzalı onayı yoklamayla kendisi çeker. Bu ayrım ceza hukuku açısından anlamlı mı?
> - **TBK md. 97 (ödemezlik def'i), 117–126 (temerrüt, süre verme, seçimlik haklar):** ödeme gecikmesinde güncellemeyi durdurmak (K1) ve kısıtlı kip (K3), ödemezlik def'inin ve temerrüt hükümlerinin sözleşmeyle genişletilmiş bir uygulaması olarak savunulabilir mi? §5'teki ihtar süreleri TBK md. 123'teki "uygun süre" için yeterli mi?
> - **TBK md. 20–25 (genel işlem koşulları) ve TMK md. 2 (hakkın kötüye kullanılması):** tek taraflı ve anında uygulanan K4 ve K5, özellikle §4.2'deki "olağan dışı hal" bendi, dürüstlük kuralına aykırı sayılıp yazılmamış kabul edilebilir mi? Bent daraltılmalı mı?
> - **Ölçülülük ve zarar:** yarım kalan üretim işinin kısıtlı kipte kapatılamaması Lisans Alan için ne tür bir zarar doğurur? K3'teki geri sayım (§2) bu riski yeterince azaltıyor mu?
> - **FSEK:** lisans ihlalinde (kopya, tersine mühendislik) K5, FSEK'in öngördüğü hukuki yolların (tespit, men, tazminat) yerine değil yanında mı durmalı?
> - **KVKK:** kısıtlı ya da durdurulmuş durumda Lisans Alan'ın veri sorumlusu yükümlülüklerini (ilgili kişi başvurusuna cevap, silme, düzeltme) yerine getirebilmesi gerekir. Kısıtlı kipte "değişiklik kapalı" kuralına KVKK kaynaklı düzeltme ve silme için istisna gerekir mi?

---

## 1. İlkeler

1.1. **Fabrika aniden durdurulmaz.** Otomatik mekanizmalar önce uyarır ve imzalı bir tarihten türeyen süre tanır. Anında uygulanan kademeler (K4, K5) yalnız §4'teki gerekçelerle ve iki onayla kullanılır.

1.2. **Veri erişimi her kademede açıktır** (§6).

1.3. **Her yaptırım geri alınabilir.** Lisans Veren bir kararı geri aldığında Yazılım genellikle birkaç saniye içinde, en geç bir saat içinde normale döner. Lisans Alan'ın elle bir şey yapması gerekmez.

1.4. **Her karar gerekçelidir ve kayıtlıdır.** Lisans Veren her yaptırım kararına bir sebep yazar. Kararlar Lisans Portalı'nın silinemeyen defterine yazılır; geri alma da o deftere ters kayıt olarak eklenir. Lisans Alan, kendisiyle ilgili kayıtların dökümünü isteyebilir.

1.5. **Sunucu kararı ek süreyle gevşemez.** Bir yaptırım kararı Kullanım Onayı'na yazıldıktan sonra, o onayın süresi dolup Ek Süre başlasa da geçerliliğini korur (ör. K2'de dondurulan modül ek sürede de kapalıdır). Ek Süre yalnız bağlantı kesintisine ve ölçüm belirsizliğine karşı bir korumadır; yaptırımı askıya almaz.

1.6. **Gözlem kipinde yaptırım uygulanmaz.** Sözleşme §8.4'teki geçiş döneminde kararlar hesaplanır ve raporlanır, ama Yazılım'ın davranışı değişmez.

## 2. Kademeler ve Yazılım'daki etkileri

| Kademe | Adı | Yazılım'da ne olur |
|---|---|---|
| **K0** | Mesaj | Yalnız bir uyarı bandı gösterilir; metni Lisans Veren yazar. Başka hiçbir işlev etkilenmez. |
| **K1** | Güncelleme dondurma | Yeni sürüm indirilemez. Kurulu sürüm tam işlevle çalışır. |
| **K2** | Modül dondurma | Seçilen lisanslı modüllerin ekranları ve işlemleri kapanır. O modüllerin verisi silinmez; tam yedekte yer alır ve §6'daki kapıyla dışa alınabilir. Diğer modüller çalışır. |
| **K3** | Süreli kısıtlı kip | Geri sayım bandı gösterilir. Seçilen süre sonunda (0 / 7 / 15 / 30 gün ya da belirli bir gün) Kısıtlı Kip başlar. |
| **K4** | Anında kısıtlı kip | Kısıtlı Kip hemen başlar. |
| **K5** | Durdurma | Olağan giriş kapanır. Yalnız lisans ekranı ve "verilerimi al" kapısı açık kalır (§6). |

**Kısıtlı Kip'te:**
- **Açık:** kayıtları okuma, arama, raporlar, belge ve etiketin yeniden basımı, dışa aktarma (Excel/PDF), yedek alma, lisans ekranı, giriş ve çıkış.
- **Kapalı:** yeni kayıt ve değişiklik. Buna tabletten üretim girişi ve yarım kalan işin kapatılması da dahildir.

## 3. Otomatik mekanizmalar (yaptırım değildir)

Aşağıdakiler Lisans Veren'in bir kararı değildir, Yazılım'ın kendi kuralıdır. Hepsi önce uyarır; Kısıtlı Kip'e geçmeden önce imzalı bir tarihten türeyen **30 gün Ek Süre** tanır.

3.1. **Lisans geçersiz ya da ölçülemiyor** (belge bozuk, makine bağı uyuşmuyor, Kullanım Onayı alınamıyor): uyarı → 30 gün Ek Süre → Kısıtlı Kip. İnternet varken ve Lisans Veren sunucusuna ulaşılabiliyorken Yazılım zamanın geçmesi yüzünden kendiliğinden kısıtlanmaz. Kısıtlı Kip'e geçmek için Ek Süre'nin bitmiş olması **ve** son 24 saatte bir yenileme denemesinin gerçekten başarısız olması gerekir.

3.2. **Bütünlük uyuşmazlığı** (kurulum dosyaları imzalı listeyle uyuşmuyor): §3.1'deki merdivenle işler.

3.3. **Bakım sonrası sürüm** (derleme tarihi Bakım Bitiş Tarihi'nden sonra): uyarı → derleme tarihinden 30 gün Ek Süre → Kısıtlı Kip. Bakım içinde derlenmiş sürüm bakım bittiğinde durmaz; yalnız güncelleme kesilir (Sözleşme §6).

3.4. **Kopya şüphesi:** önce yalnız Lisans Veren tarafında uyarı üretir. Bir sonraki pencerede de sürerse eşleşmeyen tarafa yeni Kullanım Onayı verilmez ve o taraf §3.1'deki merdivene girer. **Anında durdurma yapılmaz.**

3.5. **Felaket kurtarma devralması:** DR sunucusu devraldığında eski ana sunucu Kısıtlı Kip'e geçer ve "üretim DR sunucusunda" bandını gösterir (Sözleşme §10.3). Bu kural iki veritabanının ayrışmasını önler; veri erişimi açıktır.

3.6. Geçerli bir lisans ya da Kullanım Onayı gelince bu mekanizmaların hepsi **hemen** normale döner.

## 4. K4 ve K5'in sayılı gerekçeleri

4.1. **K4** yalnız şu hallerde uygulanabilir:
- (a) §5'teki ödeme merdiveninde K4 aşamasına gelinmiş olması;
- (b) Sözleşme §5'teki yasaklardan birinin ihlal edildiğinin tespiti (kopya, tersine mühendislik, lisans denetimini atlatma, devir);
- (c) §4.2'deki olağan dışı haller.

4.2. **Olağan dışı hal** [avukat — bent daraltılabilir]: Yazılım'ın Lisans Veren'e, üçüncü kişilere ya da kamu düzenine karşı hukuka aykırı bir amaçla kullanıldığının ciddi belirtisi; Lisans Veren sistemlerine Kurulum üzerinden saldırı; yetkili bir makamın kararı.

4.3. **K5** yalnız şu hallerde uygulanabilir:
- (a) Sözleşme'nin Sözleşme §13.2'ye göre feshedilmiş olması;
- (b) §4.1(b)'deki ihlalin sürmesi ve Lisans Alan'a gönderilen yazılı bildirime [DOLDURULACAK — öneri: 3 iş günü] içinde son verilmemesi;
- (c) §4.2'deki olağan dışı hallerin ağır ve süren biçimi.

4.4. **İki onay:** K4 ve K5, Lisans Portalı'nda sebep yazılarak ve ikinci bir onayla (kararı veren kişinin kademeyi elle yazması) uygulanır.

4.5. **Eşzamanlı bildirim:** K4 ya da K5 uygulandığında Lisans Alan'a aynı gün yazılı bildirim (KEP ya da e-posta) gönderilir. Bildirimde gerekçe ve kararın kaldırılması için yapılması gereken yazar.

## 5. Ödeme gecikmesi, taksit ve planlı eylem

5.1. **Taksitli ve vadeli lisans.** Bedel taksitle ödeniyorsa lisans, geçerlilik bitiş tarihi olan bir hak olarak verilir (Sözleşme §4.2). Lisans Veren'in ödemeyi onaylamasıyla bu tarih otomatik olarak bir sonraki vadeye (ya da Lisans Veren'in belirlediği gün sayısı kadar) ileri alınır. Son taksit ödenince lisans kalıcıya çevrilir.

5.2. **Lisans Veren'in esneklik hakları.** Lisans Veren her an ve tek taraflı olarak Lisans Alan **lehine** şunları yapabilir: süreyi belirli bir gün sayısı ya da tarih kadar uzatmak, vadeli lisansı kalıcıya çevirmek, taksit takvimini değiştirmek, uygulanmış bir kademeyi kaldırmak. Bunlar için Lisans Alan'ın onayı gerekmez.

5.3. **Ödeme merdiveni** (öneri, bütün süreler [DOLDURULACAK]):

| Aşama | Ne zaman | Ne olur |
|---|---|---|
| 1 | Vade günü | Hatırlatma (e-posta). İsteğe bağlı K0 bandı. |
| 2 | Vade + [7] gün | Yazılı ihtar (KEP): borcun ödenmesi için [15] günlük süre verilir; bu sürenin sonunda uygulanacak kademe ihtarda yazılır. K0 bandı. |
| 3 | İhtar süresi doldu | K1 ve/veya K3; K3 geri sayımı en az [7] gün. |
| 4 | K3 başladıktan [30] gün sonra hâlâ ödeme yok | K4 |
| 5 | Fesih bildirimi (Sözleşme §13.2) | K5 |

Ödeme gecikmesi nedeniyle Lisans Veren aşamaları atlayarak daha ağır kademeye geçemez. Daha hafif kademede kalabilir ya da hiç uygulamayabilir. §4'teki gerekçeler (ihlal, olağan dışı hal) bu merdivene bağlı değildir. [Ticari karar: bu cümle, ödeme gecikmesinde lisansı dondurma hakkını merdivendeki sıraya bağlar ve hukuki riski azaltmak için önerildi; avukat ve Lisans Veren birlikte karar verir.]

5.4. **Planlı eylem.** Lisans Veren, §5.3'teki bir aşamayı önceden planlayabilir. Örneğin "vade + 15 gün içinde ödeme kaydı yoksa K3". Planlı eylem Lisans Alan'a önceden bildirilir: Yazılım'da bant, ayrıca e-posta. Ödeme o tarihten önce onaylanırsa eylem kendiliğinden iptal olur.

5.5. **Ödeme gelince.** Borç ödenip Lisans Veren ödemeyi onaylayınca uygulanan kademe kalkar. Yazılım genellikle birkaç saniye içinde, en geç bir saat içinde normale döner (§1.3).

## 6. "Verilerimi al" kapısı

6.1. Her kademede, Durdurulmuş durum dahil, Lisans Alan'ın yöneticisi giriş ekranındaki **"verilerimi al"** kapısından kendi yönetici parolasıyla:
- veritabanının tam yedeğini alabilir. Yedek, şifreleme açıksa Lisans Alan'ın kendi kurtarma anahtarıyla açılabilir biçimdedir;
- kayıtları yaygın biçimlerde (Excel/CSV/PDF) dışa aktarabilir.

6.2. Bu kapı, K2 ile dondurulmuş modüllerin verisi dahil **bütün** veriyi kapsar.

6.3. Bu kapı Sözleşme'nin feshinden sonra da Sözleşme §13.3'teki süre boyunca açık kalır.

6.4. Lisans Veren bu kapıyı hiçbir kademede ve hiçbir gerekçeyle kapatmaz [avukat: TCK md. 244].

## 7. İhtar ve bildirim süreleri — özet

| Durum | Önceden bildirim |
|---|---|
| Gözlem kipinden zorlama kipine geçiş | [DOLDURULACAK — öneri: 30 gün], yazılı |
| K0, K1 | Gerekmez (Yazılım'daki bant yeter) |
| K2, K3 (ödeme nedeniyle) | §5.3'teki ihtar; K3'te ayrıca geri sayım |
| K4 | §4.1'deki gerekçe; aynı gün yazılı bildirim |
| K5 | §4.3'teki gerekçe; fesihte KEP ya da noter |
| Planlı eylem | Eylem gününden önce bant + e-posta |
