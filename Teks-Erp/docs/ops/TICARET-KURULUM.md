# Ticaret Kurulumu — Adım Adım Reçete

Alım-satım firması (birkaç depo · mal kabul · depodan satış · sevkiyat · ön
muhasebe; **üretim ve mobil kullanılmaz**) için sıfırdan kurulum.

> ⚠️ Bu reçete **ticaret** kurulumu içindir. Üretici fabrikada hiçbir adımı
> uygulama — özellikle §2 (bayraklar) fabrikada **kapalı kalmalıdır**; bütün
> ticaret yüzeyleri o iki bayrağın ve izinlerin arkasında.

## 1) Veritabanı ve sürüm

```bash
npm run prisma:migrate        # migrate deploy
pm2 restart tekserp-api       # boot uzlaştırması: izin + rol kataloğu DB'ye gelir
```

Boot log'unda şunları gör: `[permission-catalog] … güncel` ve
`[role-templates] … güncel`. Yeni izinler/roller **kod deploy edilince** gelir;
kimseye **atanmaz** (kural: *katalog koda, atama panele*).

## 2) Rejim bayrakları — Genel Ayarlar

| Bayrak | Değer | Ne açar |
|---|---|---|
| `finance.enabled` | **AÇIK** | Muhasebe menüsü, cari/fatura/tahsilat/kasa, Tanımlar'da tek "Cariler" listesi, TCMB kur çekme zamanlayıcısı |
| `finance.pricingEnabled` | **AÇIK** | Sipariş ekranlarında para birimi + birim fiyat + tutar alanları |

⚠️ `finance.enabled` bir **görünürlük** ayarı değil **rejim** anahtarıdır:
kapalıyken backend `/api/finance/*` uçlarını 403'ler ve menü satırı hiç
çizilmez — izin taşıyan kullanıcıda bile.

## 3) Kullanıcı ve yetki

1. **Yetkilendirme → Kullanıcılar** → kullanıcıyı aç.
2. Yetki şablonu **"Ticaret (Depo + Satış + Muhasebe)"** (`WEB_TRADE`) uygula.
   Tek şablon yeterlidir — depo, mal kabul, stok, sipariş, sevkiyat, iade,
   etiket ve ön muhasebenin tamamını içerir.
3. Görev ayrılığı isteniyorsa (ayrı muhasebeci/kasiyer):
   - Depocu: `WEB_TRADE`'den `finance:*` izinlerini kaldır.
   - Muhasebeci: **"Muhasebe"** (`WEB_ACCOUNTING`) şablonu.
   - Kasiyer: **"Kasa / Tahsilat"** (`WEB_CASHIER`) şablonu.

⚠️ Kullanıcı **çıkış yapıp yeniden girmeli** — izin listesi giriş anında
token'a yazılır; atama sonrası açık oturum eski listeyi taşır.

## 4) Depolar — Tanımlar → Depolar

Her fiziksel yeri bir depo olarak aç (Merkez, Şube A, …). İlk kurulumda sistem
**"Merkez Depo"**yu kendiliğinden açmıştır; adını değiştirebilirsin.

⚠️ **İkinci depo açıldığı an** depo yüzeyleri kendiliğinden belirir: Envanter'de
"Depo" kolonu/filtresi, Mal Kabul'de depo seçici, Operasyon'da Depo Transferi
karosu. Tek depoluysan hiçbiri görünmez ve görünmemeli.

> **Ham/bitmiş ile depo aynı eksen DEĞİL:** "ham stok / bitmiş depo" malın
> DURUMU, depo ise malın YERİDİR. Her depo ikisini de tutar; "her deponun ham ve
> bitmiş tarafı" diye bir şey oluşmaz. Ticaret kurulumunda zaten satın alınan
> mal doğrudan satılabilir durumda girer.

## 5) Kasa, banka, kur — Muhasebe

1. **Kasa & Banka** → kasaları ve banka hesaplarını aç.
   ⚠️ Her kasa/hesap **TEK para birimlidir**; dövizli iş için ayrı kart aç
   ("Merkez Kasa" TRY, "Döviz Kasası" USD…).
2. **Kurlar** → "TCMB'den Çek" (ya da elle gir).
   ⚠️ Kuru girilmemiş bir günde **döviz faturası kesilemez** — sistem uyarır,
   sessizce 1 saymaz. Elle girilen kur TCMB tarafından **ezilmez**.

## 6) Açılış / devir bakiyeleri — **kurulumun en kritik adımı**

Bu adım atlanırsa hiçbir bakiye, ekstre veya yaşlandırma doğru başlamaz.

1. **Kasa & Banka** → her hesapta **"Devir Gir"** → sistemdeki mevcut para.
   Hesap başına **TEK** açılış girilir (yanlışsa iptal edip yeniden gir).
2. **Cari Hesaplar** → müşteri/tedarikçi bazında **"Devir Gir"**:
   - **Pozitif** tutar = cari **size borçlu** (alacağınız).
   - **Negatif** tutar = **siz ona borçlusunuz**.
   - Cari + para birimi başına **TEK** devir.
   ⚠️ Cari kartı ilk fatura/tahsilatta kendiliğinden doğar; devir girmek için
   önce **Tanımlar → Cariler**'den kartı açmış olman yeterli.

Devir bir **hareket** olarak yazılır (ekstrede görünür, açıklaması okunur);
yanlışsa ters bir düzeltme kaydıyla düzeltilir — bakiyeye elle yazılmaz.

## 7) Katalog

**Tanımlar → Kumaşlar** (ve gerekiyorsa Renkler) — sattığın malların kartları.
Kart kodu sistem tarafından üretilir.

## 8) Günlük akış — özet

```
Mal Kabul (fiş: depo · tedarikçi · para birimi · satırlar [+ birim fiyat])
   → "Alış Faturası Oluştur"  → Muhasebe → Faturalar → Onayla
   → (istersen) "Etiketleri Bas"
Sipariş (opsiyonel)  →  Paketleme/Çuvallar → sevkiyat kur → Sevk Et → İrsaliye
   → Muhasebe → Faturalar (satış) → Onayla
Tahsilat / Ödeme  →  Cari Hesaplar → Ekstre
Masraf, virman, devir  →  Muhasebe → Kasa Hareketleri
```

⚠️ **Etiket basmak zorunlu değildir.** Barkod topun veritabanı kimliğidir ve mal
kabulde kendiliğinden doğar; kâğıda basmak tamamen isteğe bağlıdır.

## 9) Kurulum sonrası kontrol listesi

- [ ] Menüde **Muhasebe** görünüyor (yoksa: bayrak kapalı ya da çıkış/giriş
      yapılmadı).
- [ ] Tanımlar'da **tek "Cariler"** listesi var (Müşteriler + Fason Firmalar
      kartları ticaret rejiminde gizlenir).
- [ ] Envanter'de mal kabulle giren toplar görünüyor.
- [ ] Kasa/banka bakiyeleri gerçek sayımla tutuyor.
- [ ] Bir cari ekstresi açılıp devir satırı görülüyor.
