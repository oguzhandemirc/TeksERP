# Çek/Senet Teslim Bordrosu — sektör kalıbı ve tek belge önerisi

> **Durum:** K1 + K2 İNDİ (2026-09-26). **K3 KARARLANDI (kullanıcı, 2026-09-26 sabah): bordro = hareket fişi**, kök kurallar gereği bir davranış bayrağı arkasında — varsayılan KAPALI (bugünkü belge-only), bu fabrika için yayın günü panelden açılır. K3 spec'i uygulamada; iniş commit'i `finans.md` satırını değiştirir.
> **Soru:** Bugün iki ayrı bordro var: kayıtsız "Teslim Bordrosu" (anlık) ve kayıtlı "Resmî Bordro"
> (`CHEQUE_DELIVERY_NOTE`). İkisi aynı kâğıdın iki biçimi ve ayrışıyorlar. Kullanıcının PDF↔Excel
> kuralı (`docs/kurallar/belge-etiket.md`) ile kullanıcının 2026-09-26 isteği ("sektörün önde gelen
> programlarında nasılsa öyle yap") ışığında hangisi resmî olmalı, anlık görünüm ne olmalı?

## 1. Bugün bizde (ölçüldü 2026-09-26, origin `c120e599`)

| | Anlık "Teslim Bordrosu" | "Resmî Bordro" |
|---|---|---|
| Kaynak | Panelde seçim; kayıt YOK (`Finance/Cheques/chequeBordro.ts`, rapor motoru) | `ChequeDeliveryNote` + kalemleri (J2 #18, `18c87bd5`) |
| Numara | yok (kâğıtta "ANLIK" yazar) | `BRD` + GGAAYY + sıra, `number_series` |
| Çıktı | PDF + Excel (tek rapor spec'i, kendi içinde eşit) | yalnız PDF (backend şablonu); **Excel yok** |
| Kolonlar | 9 anahtar, başlık "Sıra"; boş hücre "" | aynı 9 anahtar, başlık "SIRA"; boş hücre "—"; şablonun `columns.chequeTable` ayarı (gizle/sırala/başlık) YALNIZ burada |
| İzin | okuma (düğme `finance:cheque` kapısının dışında) | oluşturma/iptal `finance:write` |
| Çek durumu | değişmez | değişmez ("belge-only") |
| İptal | — | `CANCELLED` + sebep; kayıt kalır |
| İdempotency | — | **`clientToken` YOK** |

Durum geçişleri bordrodan ayrı ve çek başınadır: `deposit` · `endorse` · `pay` · `collect` ·
`bounce` · `returnToDrawer`. Her birinin `cancel*` ters yolu ve `ChequeEvent` defteri var
(`cheque.service.ts`). Sonuç: kâğıtta "bankaya teslim" yazan bir çek portföyde kalabilir, tersi de
olabilir. Bordro ile hareket arasında bağ yok.

## 2. Sektör (kaynaklı; kaynak bulunamayan hücre "kaynak yok")

| Program | Bordro kayıtlı belge mi | Çek durumunu değiştirir mi | Numara | Taslak / iptal | Çıktı kaynağı | Seçim ekranı |
|---|---|---|---|---|---|---|
| Logo Tiger/GO | Evet — "resmi bir belge sayılır" [L1][L2] | Evet; bordro türü hareketi belirler, muhasebeleşir [L1] | Tür başına sıra, tekil [L1] | Taslak yok, "Kilitle" onayı var; hareket görmüş bordro silinmez, iade bordrosu ile döner [L1] | Form basımı belgeden (Form Tanımları) [L1]; Excel liste/rapordan (F12, Bordro Dökümü) [L3][B1] | "Listelenir ve seçilerek bordro satırlarına aktarılır" [L1] |
| Netsis | Evet — "bordro ile alınıp bordro ile verilir" [B2] | Evet; iade dekontu yer kodunu portföye döndürür, cariye ters kayıt atar [N1] | Otomatik [P1][N3] | Taslak: kaynak yok; iade dekontu ayrı fiş [N1], toplu giriş iptali [N2] | Toplu bordro basımı kayıtlı bordrodan [N4]; "Verildi Bordro Listesi" raporu [N3]; Excel: kaynak yok | kaynak yok |
| Mikro | Evet, evrak (evrak no, tarih, cari/banka) [M1][M2][M3] | Evet; tahsile verilen çek "tahsilde" olur [M3] | Evrak no; seri ayrıntısı kaynak yok | Taslak: kaynak yok; geri dönüş İade Çek Giriş Bordrosu [M4] | Form dizaynı [V1]; Excel: kaynak yok | F10 listesinden "seçip evraka aktar" [M1][M3] |
| SAP Business One | Evet, Deposit belgesi [S1][S5] | Evet; yevmiye üretir, çek "deposited" olur [S1][S2] | Numara serisi [S5] | Ödemede taslak var [S3]; Cancel ters yevmiye atar, orijinal "Canceled" kalır [V2][S1] | Belge basımı PLD ile [S6]; Excel: kaynak yok | Deposit penceresi yatırılmamış çekleri listeler [V2] |
| Luca | Evet, giriş ve işlem bordrosu [LU1] | kaynak yok | Seri no girilmezse otomatik [LU1] | İade ayrı bordro [LU1] | kaynak yok | kaynak yok |
| Nebim V3/Winner | kaynak yok (broşür düzeyi [NB1][B3]) | kaynak yok | kaynak yok | kaynak yok | kaynak yok | kaynak yok |
| Paraşüt | Ayrı bordro belgesi bulunamadı; ciro çek kaydında [PR1][PR2] | — | — | — | — | — |

**Ortak kalıp:**

1. Resmî belge tektir ve bordrodur: numaralı, kayıtlı bir fiştir.
2. Kayıt anında bordro çekin durumunu değiştirir ve cari/muhasebeye yazar.
3. Seçim ekranı belgeyi OLUŞTURMANIN arayüzüdür. Seçimi kayıt açmadan "resmî teslim kâğıdı" diye basan bir akışa hiçbir kaynakta rastlanmadı.
4. Excel liste ve rapor ekranlarından alınır (bordro dökümü, verildi bordro listesi); basılan form belgeden gelir.
5. Taslak/kesin ayrımı zayıftır: kayıt kesinleştirir.
6. İptal ters belgeyle ya da "Canceled" işaretiyle yapılır; orijinal belge silinmez.
7. İmza alanları form tasarımına bırakılmıştır; sabit bir alan için kaynak yok.

## 3. Karşılaştırma

- **Resmî bordromuz sektörün BELGE yarısını karşılıyor:** numaralı, kayıtlı, iptal ters. İki eksiği var: Excel'i yok ve çek durumunu değiştirmiyor.
- **Anlık bordronun sektörde karşılığı yok.** Kayıtsız "teslim kâğıdı" basan bir akış bulunamadı. Ayrıca panelde ikinci bir kolon listesi taşıyor; şablon ayarı ona uygulanmıyor. Bu, "ayrışan yüzey" sınıfıdır.
- **"Belge-only" gerekçesi (2026-08-15) doğru bir riski adlandırıyordu:** aynı fiziksel olay iki yoldan tetiklenebilir. Sektör bu riski TEK YOLLA çözer: durum yalnız bordrodan değişir, tek çekli işlem tek satırlı bordrodur. Bizde ise iki bağımsız yol duruyor, çek geçişi ve kâğıt; kâğıt yalnız bağsız kaldığı için çelişmiyor.

## 4. Öneri

**K1 — Resmî belge tektir: `ChequeDeliveryNote` (BRD). Anlık bordro ayrı bir belge olmaktan çıkar,
resmî bordronun TASLAĞI olur.** (Önceki notta (b) M seçeneğinin sektöre göre genişletilmiş hâli.)

- Akış tek düğmeden yürür: seçim → **Önizle** (taslak) → **Kaydet** (BRD numarası) → resmî PDF/Excel. Seçim ekranı, Logo, Mikro ve SAP'deki gibi belgeyi oluşturmanın arayüzüdür.
- Taslak, kayıtsız seçimden aynı backend renderer ile üretilir:
  - `renderDraftHtml` + TASLAK filigranı, numarasız.
  - Önizleme okuma izniyle kalır, böylece bugün anlık bordroyu basan kullanıcı yetki kaybetmez. Kaydet `finance:write` ister.
- PDF ve Excel, taslakta da kesinde de tek `DocColSpec` çözücüsünden türer (sevk irsaliyesi deseni: `renderTables` → `/tables`). Şablonun `columns.chequeTable` ayarı ikisine de uygulanır.
  - Sonuç: tek kaynak, PDF = Excel, resmî bordro da Excel kazanır.
- `chequeBordro.ts` rapor spec'i ve ikinci kolon listesi kalkar.
  - Görünür değişiklik: anlık kâğıdın rapor stili, resmî belge stiline döner.
  - Başlıklar tek biçime iner ("SIRA"); boş hücre "—" olur.
- Aynı dilimde resmî bordro oluşturma ucuna `clientToken` eklenir. Çekirdek idempotency kuralı gereği; bugün çift gönderim iki BRD numarası üretebilir.
- **Neden (a) S değil:** panelde backend kolon motorunun aynası elle kopya olur. Sektörde karşılığı da yok.

**K2 — Kayıtlı bordroların LİSTESİ ayrı ve meşrudur.** Mevcut `ChequeDeliveryNoteListDialog` tutulur:
numara, tarih, hedef, tutar, durum, liste motoruyla Excel. Logo'daki Bordro Dökümü ve Netsis'teki
Verildi Bordro Listesi bunun karşılığıdır. Bu bir belge değil, rapordur; kendi PDF'i ile Excel'i
zaten tek spec'ten türer.

**K3 — (ayrı faz, kullanıcı kararı) Bordro = hareket fişi.** Sektörde bordro kaydı çekin durumunu
değiştirir. Bizdeki karşılığı:

- Bordro kaydı, seçili her çek için MEVCUT geçişi (`deposit` / `endorse` / `pay`) aynı tx'te çağırır.
- Bordro iptali, her satır için MEVCUT ters yolu (`cancelDeposit` / `cancelEndorse` / `cancelPay`) çağırır.
- İptal önizlemesi etkilenen her çeki listeler. Sonradan ilerlemiş bir çekin satırında iptal 409 döner.
- Yeni defter ya da yeni geçiş yok.
- Hangi (yön, hedef) çiftinin hangi geçişe karşılık geldiği K3 spec'inde tablo olarak yazılır. Serbest metin hedef (`targetLabel`) geçiş üretmez.
- Bu, 2026-08-15 "belge-only" kararını tersine çevirir. O kararın gerekçesi, iki yoldan tetikleme riski, ancak çek başına geçiş uçları bordroya indirgenirse kapanır (tek çekli işlem tek satırlı bordro olur). Bu yüzden K3 kullanıcıya sorulur.
- K1, K3'ü engellemez, hazırlığıdır.

**Karardan bağımsız bulgu:** `docs/kurallar/finans.md`teki çek bordrosu satırı bayat. "Donmuş
`PrintedDocument` üretilmez … önce `ChequeBatch` benzeri kaynak model" diyor, ama `ChequeDeliveryNote`
`18c87bd5`ten beri var. Karar verildiğinde satır tek cümleyle yeniden yazılır ve eski cümle silinir.

## 5. K1'in etkisi (karar verilirse)

- **Backend:**
  - `CHEQUE_DELIVERY_NOTE` builder'ına `renderTables` eklenir: tablo `DocColSpec` ile, HTML aynı specten.
  - Kayıtsız seçimden taslak HTML ve taslak tablo dönen okuma ucu eklenir.
  - Oluşturma ucuna `clientToken` eklenir.
  - Hepsi YENİ uç ya da isteğe bağlı alan. Eski panel sürümü bugünkü gibi çalışır, sözleşme kırılmaz.
- **Panel:**
  - Çekler sayfasında iki düğme ("Teslim Bordrosu" / "Resmî Bordro") tek akışa iner.
  - Önizleme `PrintedDocView` ile gösterilir; Excel `lib/doc-tables-export.ts` ile üretilir.
- **Bekçi:**
  - Altın kopya, ÖNCE mevcut resmî bordro PDF'inden alınır; PDF bilinçli değişmedikçe bayt bayt aynı kalır.
  - `test_sevk_belge_excel_esit` deseninde eşitlik bekçisi (hücre hücre, şablon kombinasyonları).
  - Mevcut `test_official_finance_docs` "çek durumuna dokunmama" iddiasını korur. K3 gelirse o iddia tersine döner.
- **Sürüm notu:** görünür değişiklik anlık kâğıdın biçimi ve tek düğme.

## Kaynaklar

- [L1] Logo GO 3 Çek ve Senet kılavuzu (resmî doküman, iş ortağı sitesinde): https://www.sdmyazilim.com.tr/var/uploads/1500476612-cek_senet.pdf
- [L2] Logo Tiger 3, Çek/Senet Bordroları (arama özeti): https://docs.logo.com.tr/pages/viewpage.action?pageId=22282003
- [L3] Logo Tiger 3, Özet Bordro Dökümü (arama özeti): https://docs.logo.com.tr/pages/viewpage.action?pageId=22273775
- [N1] Netsis 3, Senet/Çek İade Dekontu (arama özeti): https://docs.logo.com.tr/pages/viewpage.action?pageId=102274672
- [N2] Netsis 3, Toplu Giriş İptali (arama özeti): https://docs.logo.com.tr/pages/viewpage.action?pageId=24739869
- [N3] Netsis 3, Verildi Bordro Listesi (arama özeti): https://docs.logo.com.tr/display/N3ENTKD/Verildi+Bordro+Listesi
- [N4] Netsis 3, Toplu Bordro Basımı (arama özeti): https://docs.logo.com.tr/pages/viewpage.action?pageId=47055350
- [P1] Bworks, Netsis müşteri çekleri (iş ortağı): http://bworks.tc/destek/netsis-destek/253-musteri-cekleri-alinmasi-verilmesi-ve-tahsil-edilmesi
- [M1] Mikro Buluo, Çek Çıkış Bordrosu 072410: https://buluo.mikro.com.tr/s/article/Cek-Cikis-Bordrosu
- [M2] Mikro Buluo, Senet Çıkış Bordrosu 072210: https://buluo.mikro.com.tr/s/article/Senet-%C3%87%C4%B1k%C4%B1%C5%9F-Bordrosu-072210-New
- [M3] Mikro Buluo, Tahsile Çek Çıkış Bordrosu 072710: https://buluo.mikro.com.tr/s/article/Tahsile-Cek-Cikis-Bordrosu-072710
- [M4] Mikro Buluo, İade Çek Giriş Bordrosu 072315: https://buluo.mikro.com.tr/s/article/Iade-Cek-Giris-Bordrosu-072315
- [V1] Mikro form dizaynı (video): https://www.youtube.com/watch?v=mlcwBbn66HI
- [S1] SAP B1 Handling Payments (resmî eğitim): https://help.sap.com/doc/download_multimedia_ebooks_businessone90_tb1100_02_01_story_html/9.0/en-US/story_content/external_files/B1_90_TB1100_02_01.pdf
- [S2] SAP B1 Bill of Exchange Management (arama özeti): https://help.sap.com/docs/SAP_BUSINESS_ONE/5f530d15fa804bd48ec10d9c898e1e28/44eaec6aaf80363de10000000a1553f6.html
- [S3] SAP B1 Saving Documents as Drafts (arama özeti): https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/786aff213a7c46978440cfde66a3f3b1.html
- [S5] SAP B1 SDK DepositsService / Deposit: https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/SAPbobsCOM~Deposit_members.html
- [S6] SAP B1 Print Layout Designer: https://help.sap.com/doc/435818e2f4ee4f6aaf3339896a535339/10.0/en-US/How_to_Customize_Printing_Layouts_with_the_Print_Layout_Designerin_SAP_Business_One_10.0.pdf
- [V2] Vision33, How to Cancel a Deposit (iş ortağı): https://www.vision33.com/hubfs/Membership%20Site%20Full%20Resources/How%20to%20Cancel%20a%20Deposit%20in%20SAP.pdf
- [LU1] Luca destek, Lucanet çek-senet modülü: https://lucayazilim.freshdesk.com/support/solutions/articles/67000715069-lucanet-te-cek-senet-i%CC%87%C5%9Flemleri-mod%C3%BCl-kullan-m-
- [NB1] Nebim Winner broşürü: https://www.mayatek.com.tr/FileUpload/bs298119/File/nebim_winner_brosur.pdf
- [B1] Nora Bilişim, Logo'dan Excel'e F12 (blog): https://www.norabilisim.com/bilgi-merkezi/logo-dan-excele-veri-aktarimi/
- [B2] muhasebedersleri.com, Netsis çek senet (blog): https://www.muhasebedersleri.com/bilgisayarli-muhasebe/netsis-muhasebe-cek-senet.html
- [B3] Techiz, Nebim V3 muhasebe (blog): https://techiz.biz/tr/blog/nebim-v3-muhasebe-finans-yonetimi.html
- [PR1] Paraşüt, çek yönetimi: https://www.parasut.com/blog/parasutte-cek-yonetimi
- [PR2] Paraşüt, verilen çekler: https://www.parasut.com/kullanim-kilavuzu/verilen-ceklerin-yonetimi

Bazı resmî sayfalar doğrudan açılamadı; bu sayfalar arama özetinden okundu ve listede "arama özeti"
diye işaretlendi. Mikro Buluo metinleri sayfanın ham HTML'inden çıkarıldı.
