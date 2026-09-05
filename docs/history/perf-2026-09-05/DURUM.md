# Durum özeti — 2026-09-05 (halk dili)

Dal `feature/kod-standardi`, GitHub'a push edildi, `main`'e **dokunulmadı**. Beş commit.

---

## 1 · Kenara bıraktıklarım

**Pahalı ve riskli oldukları için hiç başlamadım:**

- Beş dev backend servisini bölmek (en büyüğü 7.143 satır).
- Beş dev mobil ekranı bölmek (`TamburScreen` 9.386 satır).
- Bekçi paketini paralelleştirmek. Not: şema ayırmak **yetmiyor**, veritabanı başına işçi gerekiyor; ölçtük.
- Backend'e düzgün log sistemi koymak (bugün 137 `console` çağrısı tek kanal).
- Mobile şema doğrulama katmanı eklemek (`zod` hiç yok).
- Üç projedeki TypeScript/ESLint sürümlerini hizalamak.
- Swagger'da 117 belgesiz ucu doldurmak.

**Ölçtüm ama karar bekliyor:**

- **`TamburScreen` sebep adımını ortak bileşene geçirmek.** Ortak bileşen, 2026-08-26'da alınan üç kararı (kayan liste, basılı tut-sürükle, gizli satırın yerinde kalması) taşıyor mu doğrulanmadı. Doğrulamadan çevirmek sahada ısıran bir gerileme olurdu, o yüzden dokunmadım.
- **`rolls` tablosundaki 28 index.** Güncellemelerin %99,2'si hepsine yazıyor. Hangisinin düşeceğini **canlı** tarama verisi söyler; dev veritabanında ölçülemez.
- **Katalog seçicilerini sunucu aramalı yapmak.** Bugün 2,2–3,9 kat pay var, acele yok; dönüşüm cihaz üstünde ölçüm ister.
- **Index migration'ının kurulum penceresini kaç saniye uzattığı.** Dump elde olduğunda ölçülür. Engel değil: migration uygulama durmuşken koşuyor.

---

## 2 · Bitirdiklerim — öncesi / sonrası

### Kural kitabı (yeni)
Önce: rutin konvansiyonlar hiçbir yerde yazılı değildi, herkes koddan çıkarsıyordu.
Sonra: `docs/standart/` altında 9 dosya, 267 kural. Her kuralın bir **kapısı** (lint/bekçi/derleyici/commit) ve bir **kanıtı** (dosya:satır ya da ölçüm) var.

### main'de duran kırmızılar
| | Önce | Sonra |
|---|---|---|
| Electron tip hatası | 9 tane, bir gündür duruyor | 0 |
| Electron testi | 7 kırmızı | 213 dosya / 2.290 test yeşil |
| Backend bekçileri | 453'ün 134'ü kırmızı (dev DB geride) | **457/457** |
| CI'ın Electron tip adımı | hiçbir dosyayı derlemiyordu | gerçekten derliyor |
| Sessizce atlanan kontrol | 66 tane, görünmüyordu | çıktıda yazıyor |

### Performans
| | Önce | Sonra |
|---|---|---|
| İptal topun detayı/barkodu (audit sorgusu) | 7,95 ms, 51 bin satır tarıyor | **0,56 ms** |
| İçe aktarım detayı | 11,5 ms | **1,33 ms** |
| Audit ekranı dropdown'ları | 63.946 satır tel üzerinden | **139 satır** |
| Kayıt geçmişi sorgusu | 478 buffer | **4 buffer** |
| Envanter sayfası açılışı | 9–10 istek | **2 istek** |
| Kanban ekranı | tek istekte 115 sorgu | **66 sorgu** |
| İş emri listesi | 24 sorgu | **18 sorgu** |
| Sekme içi gidip gelme | her dönüşte 9 istek | **0** |
| `system_logs` üzerindeki index | 3.600 KB, hiç okunmuyor | **56 KB** |

### Kalan küçük işler
- **Okutma sinyali:** 7 handler ortak kanala geçti. Üç dal ilk kez konuşuyor ("Bekleyen sevk yok", "Kart zaten açık", "Bu top zaten eklendi"). Tambur'da tek okutmaya binen çift titreşim tek sinyale indi.
- **Üç kuyruksuz mutasyon:** üçü de gerekçeyle kapandı, kuyruğa alınmadı. Davranış birebir aynı.
- **Katalog seçici uyarısı:** 12 sorgu uyarısızdı, kapsam 8'den 20 çağrıya açıldı.
- **Sayım uygulama:** toplu yazıma çevrildi; tek tek yazan döngü **korundu**, çünkü o hız değil anlam taşıyordu.

### Harness
Commit kapısı kuruldu (`node scripts/hooks-kur.mjs`). Değişene göre koşuyor: tek proje 30–50 sn, üç proje 168 sn. CI'da emekli dal kaldırıldı, mobil işi eklendi, üç işe lint tavanı kondu.

---

## 3 · Bulduğum anormallikler

Bunların hiçbirini aramıyordum, ölçerken çıktılar.

1. **Yazılı olup hiç koşmayan iki kural.** `DATE_TRUNC` yasağı ve bekçi kapsamındaki isim kuralı config'de tanımlıydı ama listeye hiç eklenmemişti. Kural metni bir kapı olduğunu kanıtlamıyor.
2. **İki kilit numarası iki ayrı yerde kullanılıyordu.** İki alt sistem birbirini sessizce sıraya sokuyordu. Zarar veri değil gecikme; kaynağı da bulunamazdı.
3. **Bir ekranda yazma butonu izin kapısız.** Sayfa salt-okuma yetkisiyle açılıyordu ama düzenle butonu herkese görünüyordu.
4. **Birleştirme haritasında 7 eksik bağ.** Cari/ürün birleştirmesi bu satırları sessizce atlıyordu; satırlar silinmiş kayda bakmaya devam ediyordu.
5. **Test fixture'ları kodu damgalıyor ama adı damgalamıyordu.** Yarım kalan bir koşumdan sonra ikinci koşum çöküyordu. Ad üzerinde 15 canlı benzersizlik kuralı var ve bunların bir kısmı şemada görünmüyor.
6. **`db-guard` eski veritabanı adını taşıyordu** ve ikinci bir kapı aynı adı ÜRETİM sayıyordu. İki kapı aynı şeye zıt hüküm veriyordu.
7. **Planda "Index Scan" yazması yetmiyor.** Bir sorgu index kullanıyor görünürken index'in tamamını okuyordu. Asıl ölçüt okunan blok sayısı.
8. **Uygulanmış migration'ın yorumu bile değiştirilemiyor.** Denedim, kapı durdurdu. Kural olarak yazıldı.
9. **`rolls` tablosunda 28 index** yüzünden güncellemelerin %99,2'si en pahalı yoldan yazılıyor.
10. **Prisma'nın `distinct` özelliği veritabanına inmiyor.** Filtreleme Node tarafında yapılıyordu, 63 bin satır tel üzerinden geçiyordu.
11. **Bir bekçi kendi sayısıyla çelişiyordu:** "console yasak" diyordu ama config `warn`/`error`'ı bilinçli muaf tutuyor ve koddaki 11 çağrının hepsi `warn`.

---

## 4 · codebase-memory-mcp — bize yarar mı?

**Ne yapıyor.** Kodun haritasını çıkarıp yerel bir veritabanına yazıyor: hangi fonksiyon nerede tanımlı, kim kimi çağırıyor. Sonra bu soruları anında cevaplıyor. Yapay zekâ kullanmıyor, sadece yapıyı okuyor.

**Bizim boyumuz uygun.** 2.821 dosya, ~640 bin satır. Araç Linux çekirdeğini (28 milyon satır) 3 dakikada indeksliyor; bizimki dakikanın altında kalır.

**Nerede işe yarardı.** Bugün 13 fonksiyonu 45 dosyada yeniden adlandırdım; bunu `grep` ve düzenli ifadeyle yaptım ve bir metin tarayan bekçiyi farkında olmadan kör ettim (yakaladım, düzelttim). Çağrı grafiği olsaydı "bunu değiştirirsem ne kırılır" sorusunun cevabı hazır olurdu.

**Nerede işe yaramaz — ve bu önemli.** Bu projenin zor soruları yapısal değil anlamsal: "bu kuralın gerçekten bir kapısı var mı", "bu bekçi ölçtüğünü söylediği şeyi ölçüyor mu". Harita bunları cevaplamaz. Bugün bulduğum 11 anormalliğin **hiçbirini** bulamazdı. O işi bu turda kurduğumuz belge katmanı yapıyor.

**Riskler.**
- Harita bayatlar ve **otoriter görünür**. Bu, tam da bu repoda savaştığımız hata sınıfı.
- Arka planda bir izleyici süreç çalışıyor.
- Harita dosyasını repoya koymak `.git`'i şişirir (bugün 92 MB); aracın kendi belgesi de uyarıyor.

**Önerim: 30 dakikalık ölçülü deneme, sonra karar.**

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
codebase-memory-mcp cli index_repository --repo-path /Users/demirci/Documents/Projeler/Teks-Erp --project tekserp
```

Kurulum Claude Code'u kendisi ayarlıyor, API anahtarı istemiyor, veritabanı `~/.cache/` altında kalıyor, lisansı MIT.

Deneme şu üç soruyla yapılır (üçünün de cevabını **biliyoruz**, yani aracı ölçebiliriz):
1. `recomputeOrderStatusTx` fonksiyonunu kim çağırıyor?
2. `stepCanApplyQuality` ile `QUALITY_STATION_WHERE` ikizini kim birlikte kullanıyor?
3. `writeWarehouseMovements` değişirse hangi dosyalar etkilenir?

**Karar ölçütü:** `grep`ten belirgin biçimde hızlı ve daha eksiksiz mi? Evetse kalsın. Hayırsa kaldır, çünkü bakımı olan her araç bir borçtur.

**Şunları yapma:** harita dosyasını repoya commit'leme, ve haritayı belgelerin yerine koyma. Harita "nerede" der, belge "neden" der; bu projede pahalı olan ikincisi.
