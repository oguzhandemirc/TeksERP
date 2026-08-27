# Sürüm Notları — nasıl yazılır, nasıl yayınlanır

Her yayın turunda fabrikaya **operatör diliyle** bir not gider. Panel ve tablet,
güncelleme kurulduktan sonraki ilk açılışta bu notu **bir kez** gösterir; eski
notlara Ayarlar'dan her zaman ulaşılır.

**Tek kaynak:** `surum-notlari.json` (repo kökü). Bu dosya düzenlenir, sonra:

```bash
node scripts/surum-notlari-kopyala.mjs     # panel + tablet paketlerine kopyala
node scripts/check-surum-notlari.mjs       # şema + dil + kopya denetimi
```

⚠️ `Electron/src/data/` ve `mobil/src/data/` altındaki kopyaları **elle
düzenleme** — bekçi drift'i yakalar ve paketleme durur.

---

## Kim yazar

**Taslağı Claude yazar, kullanıcı onaylar.** Sürüm çıkarma isteği geldiğinde
akış şudur:

1. Claude o turda ne yapıldığını operatör diline çevirip taslağı **sunar**
2. Kullanıcı okur, düzeltir ya da onaylar
3. Onaydan sonra kayıt dosyaya yazılır ve paketlemeye geçilir

⚠️ Onay alınmadan paketleme adımına geçilmez. Notu okuyacak olan fabrika
çalışanıdır; bir maddenin gerçekten öyle görünüp görünmediğini ancak sahayı
bilen kişi teyit edebilir. Kapı yalnız notun VAR olduğunu denetler, DOĞRU
olduğunu değil.

## Not yazma kuralları

**Okuyucu fabrika çalışanı.** Teknik terim yok; bekçi bunu mekanik olarak
denetliyor (`endpoint`, `migration`, `cache`, `deploy`, dosya yolu… → kırmızı).

| Kötü | İyi |
|---|---|
| `rollScope` artık fail-closed | Stok listesinde bilinmeyen bir filtre gelirse liste boş döner |
| `orders/stats` endpoint'i eklendi | Sipariş ekranının üstüne özet şeridi geldi |
| Kanban kolonu `currentStepId` ile süzülüyor | Üretim Akışı panosundaki "Ham Stok" sayısı artık envanterle aynı |

**Her madde iki etiket taşır:**

- `kapsam`: **`panel`** · **`tablet`** · **`her-ikisi`** — operatör hangi ekranda
  göreceğini bilsin. ⚠️ **`sunucu` kapsamı YOKTUR**: sunucudaki bir değişiklik
  operatöre ya panelde ya tablette görünür, operatör sunucuyu hiç görmez.
- `tip`: **`yeni`** · **`iyilestirme`** · **`duzeltme`** — ikon ve renk buradan.

## Kayıt yapısı

```json
{
  "id": "2026-09-05",
  "baslik": "Kısa tema — tarih değil",
  "surumler": { "panel": "2.8.3", "tablet": "2.9.10" },
  "maddeler": [
    { "kapsam": "panel", "tip": "yeni", "metin": "Operatör diliyle tek cümle." }
  ]
}
```

- **`id` = tarih** (`YYYY-AA-GG`). Üç ürünün sürümü bağımsız ilerlediği için
  yayın turunun kimliği sürüm numarası olamaz. Aynı gün ikinci tur: `2026-09-05b`.
  ⚠️ **Salt ASCII** — çıktı kapıları bu kimliği paketin içinde arıyor.
- **`surumler`**: o turda hangi ürün hangi sürüme çıktı. O turda çıkmayan ürünün
  alanı **yazılmaz** (yalnız panel turuysa `tablet` alanı yok).
- Dizi **en yeni önce** sıralıdır — gösterim mantığı buna dayanıyor.

⚠️ **`surumler` alanını hiçbir script `package.json`/`app.json`'dan okuyup
YAZMAZ.** Elle yazılır, kapı kıyaslar. Yazsaydı kapı kendi yazdığını doğrular,
yani hiçbir şey doğrulamazdı.

---

## Yayın akışı

```
0. NOTU YAZ         → surum-notlari.json'a kayıt ekle
1. KOPYALARI ÜRET   → node scripts/surum-notlari-kopyala.mjs
2. SÜRÜMÜ ARTIR + PAKETLE + YAYINLA   (mevcut komutlar)
```

**Adım 0 ya da 1 atlanırsa adım 2 DURUR:**

| Atlanan | Nerede durur |
|---|---|
| Not yazılmadı | `electron-paketle.sh` / `npm run yayinla` → "bu sürüm için operatör notu yok" |
| Kopya üretilmedi | Aynı kapı → "kaynakla aynı değil" |
| Teknik terim kaldı | Aynı kapı → hangi terim olduğunu yazar |

Kapı **derlemeden önce** koşar ve **dairesel değildir**: beklenen sürüm
argümandan gelir, not dosyası onu üretmez yalnız doğrular.

---

## Operatör ne görüyor

**Panel:** güncelleme kurulup uygulama açıldığında pencere bir kez çıkar
("Bu güncellemede neler değişti"). Kalıcı erişim: **Ayarlar → Sürüm Notları →
Tümünü gör**.

**Tablet:** aynı akış; kalıcı erişim **Ayarlar → Sürüm Notları**.

| Durum | Davranış | Neden |
|---|---|---|
| İlk kurulum (hiç not görülmemiş) | Yalnız **en yeni** kayıt | Hiç göstermemek özelliği görünmez kılar; 20 kaydı basmak körleştirir |
| Sürüm atlama | Aradaki **tüm** notlar (en fazla 5) | Atlanan turların değişiklikleri o makinede yeni |
| Fazlası | "…ve N eski not daha → Ayarlar" | Bir ay kapalı kalmış makine duvar gibi metinle açılmasın |
| Sürüm geri alındı | Pencere çıkmaz | Geriye giden makineye "yenilikler" göstermek yanlış |
| Güncelleme kapısı açık | Pencere çıkmaz | Güncelleme kapısı her zaman öncelikli |

⚠️ **"Gösterildi" bilgisi makine başına** saklanır (kullanıcı başına değil):
sürüm notu "bu bilgisayarda kurulan sürüm" hakkındadır. Aynı kişi eski sürümlü
başka bir makineye geçerse orada da bir kez görür — çünkü o makinede o sürüm
gerçekten yeni.

⚠️ **Bilinen bedel:** bir makine geri alınıp tekrar ileri alınırsa, atladığı
turun notunu pencerede kaçırır — Ayarlar'daki arşivde durur. Tam doğruluk için
işaretin bir *küme* olması gerekirdi; geri alma elle ve nadir bir işlem.

---

## Bekçiler

`node scripts/check-surum-notlari.mjs` — 13 kontrol (+ argümanla yayın kapısı):
kimlik biçimi/benzersizlik/sıra/ASCII · şema · `sunucu` kapsamının reddi ·
operatör dili · sürüm biçimi · kapsam↔sürüm çift yönlü tutarlılık · kopya
tazeliği · körlük zemini.

Gösterim mantığı: `Electron/src/lib/surum-notlari.test.ts` (12) ve
`mobil/src/services/surumNotlari.test.ts` (11) — aynı senaryolar, iki üründe de.

Dördü negatif sondayla kırmızı verdiği ölçülerek doğrulandı: `sunucu` kapsamı ·
teknik terim · kopya drift · kaydı olmayan sürümle paketleme.
