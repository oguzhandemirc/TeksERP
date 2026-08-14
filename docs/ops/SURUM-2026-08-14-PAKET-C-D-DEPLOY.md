# Sürüm 2026-08-14 — Deploy Notu (Paket C + D: muhasebe derinliği + ticaret genişlemesi)

> Hedef ortam: **demo** (`demo.etkiliyazilim.com`). Fabrika kurulumu bu sürümden
> **etkilenmez** — aşağıdaki "Fabrika sıfır-fark" bölümüne bak.

## TL;DR — deploy eden için dört cümle

1. **5 migration** var, hepsi additive (yeni tablo/kolon/enum değeri) — mevcut
   satırlara dokunulmaz, veri göçü YOK.
2. **6 yeni izin** var ve boot uzlaştırması onları DB'ye + rol şablonlarına
   getirir; **kullanıcıya ATAMA otomatik DEĞİLDİR** → demo seed'i tekrar
   koşturulmalı (adım 5).
3. Yeni yüzeylerin hepsi `finance.enabled` rejimine bağlı; fabrikada bayrak
   kapalı olduğu için hiçbiri görünmez ve uçları 403 döner.
4. Geri alma: `apps/tekserp-demo` down → `apps/etkiliyazilim-demo` up
   (placeholder dosyaları duruyor).

## Ne getiriyor

**Paket C — muhasebe derinliği**

| Yüzey | Adres | Ne yapar |
|---|---|---|
| Çek / Senet | `/finance/cheques` | Portföy: giriş · tahsile verme · tahsil · ciro · karşılıksız · iade · ödeme · iptal + olay defteri |
| Fatura Kapama | `/finance/allocations` | Tahsilat/çek ↔ fatura eşleştirme, FIFO **önerisi** (otomatik commit YOK) |
| Dönem Kapanışı | `/finance/period-close` | Geçmiş dönemi mühürle · doğrula · yeniden aç |
| Ön Muhasebe Raporları | `/reports/finance/{aging,cash-book}` | Yaşlandırma (kesit) · kasa-banka defteri · cari ekstre |

**Paket D — ticaret genişlemesi**

| Yüzey | Ne yapar |
|---|---|
| İplik kg-stok | Kalem × depo kg bakiyesi + append-only hareket defteri |
| Kalem fiyatı | Kart varsayılanı + müşteri istisnası; fatura/mal kabul satırında ön-dolum |
| Alış siparişi | "Ne ısmarladım, ne geldi" + mal kabulle karşılanma senkronu |

## Migration — 5 adet, hepsi additive

```
20260814100000_cheque_cari_txn_sources           CariTxnSource'a SONA 5 değer
20260814101000_cheque_portfolio                  Cheque + ChequeEvent + CariTransaction.chequeId
20260814102000_payment_allocation                PaymentAllocation + denormalize sayaçlar
20260814103000_cari_period_close                 CariPeriodClose
20260814072115_paket_d_yarn_price_purchase_order YarnStock/YarnMovement/ItemPrice/PurchaseOrder(+Line)
```

⚠️ **Sıra bağımlıdır** (`migrate deploy` zaten dosya adına göre sıralar).
Birincisi kendi migration'ında yalnız enum değeri ekler: PG'de `ALTER TYPE ADD
VALUE` ile eklenen değer **aynı transaction içinde kullanılamaz**.

⚠️ Boş/küçük veritabanında saniyeler sürer. Tablolar YENİ olduğu için
`CREATE INDEX` kilidi mevcut satırları etkilemez — vardiya penceresi gerekmez.

## Yeni izinler — 6 adet

```
finance:cheque         çek/senet portföyü yazma
finance:close          dönem mühürleme + yeniden açma
yarn:write             iplik stok hareketi
price:write            kalem fiyatı yazma
purchase-order:read    alış siparişi görüntüleme
purchase-order:write   alış siparişi aç/düzenle/iptal
```

Okumalar **mevcut** izinlere biner: iplik stoğu `warehouse:read`, fiyat
`item:read`, çek/kapama/dönem `finance:read`, raporlar `report:finance`.

⚠️ **Boot uzlaştırması izni DB'ye ve ŞABLONA getirir, KULLANICIYA getirmez.**
Kural yazılı: *katalog koda, atama panele.* Demo'da bu adım atlanırsa demo
kullanıcısı yeni ekranları göremez ve sebebi hiçbir yerde yazmaz — kullanıcı
siteye girer, "hani nerede?" der. Çözüm adım 5.

## Deploy sırası (demo)

```bash
# 1) kaynağı gönder (yerelden, depo kökünden)
rsync -az --delete \
  --exclude='.git' --exclude='node_modules' --exclude='mobil' \
  --exclude='dist' --exclude='dist-web' --exclude='out' \
  --exclude='.claude' --exclude='.env' \
  ./ yenisunucu:/opt/stack/apps/tekserp-demo/repo/

# 2-5) sunucuda
ssh yenisunucu
cd /opt/stack/apps/tekserp-demo
sudo docker compose build
sudo docker compose run --rm --entrypoint sh app -c "npx prisma migrate deploy"
sudo docker compose up -d          # ← boot uzlaştırması: 6 izin + rol şablonları
sudo docker compose run --rm --entrypoint sh app -c "npx tsx prisma/seed-ticaret-demo.ts"
```

⚠️ **5. adım (demo seed'i) ZORUNLU ve idempotenttir.** `applyTemplate(...,
"merge", ...)` kullanır: yeni izinleri demo kullanıcısına **ekler**, mevcutları
silmez. Master data `update: {}` ile ezilmez, token'lar deterministik
(`uuidv5`) olduğu için tekrar koşum yeni demo kaydı doğurmaz.

⚠️ **Sıra pazarlık dışı:** `migrate deploy` → `up -d` (uzlaştırma) → seed.
Uzlaştırma koşmadan seed koşarsa `WEB_TRADE` şablonu yeni izinleri henüz
taşımaz ve merge eski listeyi uygular.

## Fabrika sıfır-fark (kontrol edildi)

- Yeni router'ların **hepsi** `requireFinanceEnabled` rejim kapısı taşır ve bu
  artık **mekanik olarak** korunuyor: `scripts/test_finance_regime_gate.ts`.
  Kapsam elle listelenmez, türetilir (ticaret modeline dokunan servis →
  onu import eden router → kapı dosyada mı, mount eden zincirde mi).
- ⚠️ İzin kapısı tek başına yetmezdi: `ADMIN_FULL` tanımı gereği HER izni taşır,
  yani kapısız bir uç fabrikadaki admin'e cari deftere yazma yolu açardı —
  menüde hiçbir şey görünmese bile, çünkü adres bilmek yeterli.
- Panel tarafında rapor karosu `ReportTile.featureFlag` ile bayrağa bağlandı
  (`ReportsHubPage` süzgeci `isAdmin ||` ile kısa devre yaptığı için izin
  filtresi tek başına yetmiyordu).
- Mal kabul ekranı **fabrikada da** kullanılıyor → rejim kapısı KONULAMAZ;
  ticaret alanlarına dokunan dallar servis içinde ayrıca kapılı ve bu, rejim
  bekçisinin muaf listesinde gerekçesiyle yazılı.

## GEREKMEYENLER (kontrol edildi)

- **Mobil APK gerekmez** — mobil bu paketlerin hiçbirine dokunmuyor.
- **Veri göçü / backfill gerekmez** — tüm tablolar yeni, mevcut satır okunmuyor.
- **Yeni rol şablonu gerekmez** — mevcut WEB_TRADE / Muhasebe / Kasa genişletildi.

## Geri alma

Uygulama katmanı: `cd /opt/stack/apps/tekserp-demo && sudo docker compose down`
→ `cd /opt/stack/apps/etkiliyazilim-demo && sudo docker compose up -d`.

Şema katmanı: migration'lar **additive** olduğu için geri almak GEREKMEZ —
eski imaj yeni tabloları hiç görmez ve onlara yazmaz. (Prisma'da geri alma
zaten "yedekten restore" demektir; bkz. kök CLAUDE.md.)

## Doğrulama (deploy sonrası)

```bash
# 1) uçlar YAŞIYOR mu — 404 = mount edilmemiş (kesin sinyal)
for u in /api/finance/cheques /api/finance/period-closes /api/reports/finance/aging \
         /api/yarn/stocks /api/item-prices /api/purchase-orders; do
  printf '%-34s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "https://demo.etkiliyazilim.com$u"
done
```

⚠️ **401'i "uç var" diye OKUMA.** `/api/finance/*` altındaki bir istek, o uç
mount edilmemiş olsa bile üst `financeRoutes` router'ının `verifyToken`
middleware'ini tetikler ve **401** döner. Kesin olan tek sinyal **404 = yok**.
Uçların gerçekten çalıştığını görmek için giriş yapıp token'la sorgula.

2. Panelde: Muhasebe hub'ında **Çek/Senet · Fatura Kapama · Dönem Kapanışı**
   karoları; Raporlar hub'ında **Ön Muhasebe** karosu görünmeli.
3. Demo kullanıcısıyla giriş → karolar görünüyorsa izin ataması (adım 5) tuttu.

---

## Ek — bu sürümde kapatılan sessiz hatalar

Deploy eden için not değil, ama sürümün ne düzelttiğinin kaydı:

- **`money()` biçimlendirmesi**: Prisma `Decimal` JSON'a **string** düşüyor,
  panel `number` diye tipliyordu → `String.prototype.toLocaleString` seçenekleri
  sessizce yok sayıyor ve **mevcut** Faturalar/Tahsilat/Cari ekranlarında
  tutarlar binlik ayraçsız/kuruşsuz basılıyordu (`"3324"` → `3324`).
- **Mükerrer çek riski**: form `clientToken`'ı her denemede yeniliyordu →
  belirsiz timeout sonrası ikinci basış ikinci çek + ikinci defter satırı.
- **Boş tarih → 1900-01-01**: `parseYmdLocal("")` geçerli bir tarih üretiyordu
  ve bu değer belge numarasına + defter satırına yazılıyordu.
- **Pasif kalem** iplik yolundan sessizce deftere giriyordu (kumaş yolu
  reddediyor).
- **Türkçe virgüllü sayı** (`12,5`) ham `Decimal` hatasıyla **500** üretiyordu;
  artık 400 + doğru yazımı söyleyen mesaj (virgül sessizce noktaya
  ÇEVRİLMEZ — `1,500` hem 1,5 hem 1500 okunur).
- **İki router hiç mount edilmemişti** (9 uç sessiz 404). Artık mekanik bekçisi
  var: `scripts/test_route_mount_reachability.ts`.
