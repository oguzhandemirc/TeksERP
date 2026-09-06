---
name: bekci-kos
description: Bir değişiklikten sonra hangi bekçilerin (scripts/test_*.ts, vitest, jest) koşulacağını bulur ve koşturur; sonucu çıkış koduyla yorumlar. "testleri koş", "bekçileri çalıştır", "bu değişiklik neyi kırar" dendiğinde ve her kod değişikliğinin sonunda kullan.
---

# bekci-kos

Harita: `Teks-Erp/docs/BEKCI-HARITASI.md` (alan → dosya + ne ölçüyor). Her alan dosyasının (`docs/kurallar/<alan>.md`) sonunda o alanın bekçi listesi var.

## Adımlar

1. **Alanı belirle:** dokunduğun dosyalar hangi alana giriyor (servis/route/ekran adı → `docs/kurallar/README.md` tablosu). Birden çok alan olabilir.
2. **Listeyi çıkar:** alan dosyasının "Bekçiler" bölümü + haritada `grep -n "<servis-adı>" Teks-Erp/docs/BEKCI-HARITASI.md`.
3. **Koş (backend):** `cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` — tek testte tip kapısı atlanır; birden çok test için ad parçalarını ayrı ayrı koş. DB isteyen bekçiler `.env`deki dev DB'ye (`tekserp_demo`) yazar ve kendi fixture'ını temizler; canlı DB'ye ASLA. Tam paket `npm test` **~6,5 dakika** sürer (455 dosya, sıralı; ölçüldü 2026-09-05) ve PR/push öncesi koşulur.
4. **Koş (istemci):** `cd Electron && npx vitest run <yol>` · `cd mobil && npx jest <yol>`.
5. **Hüküm ÇIKIŞ KODUNDAN:** `echo $?` — 0 geçti. Çıktıdaki "temiz" metnine değil koda bak (tsc boruda renkli basar). `=== Sonuç: N geçti, M başarısız ===` satırını raporla.
6. **Kırmızı ise:** önce bekçinin ne ölçtüğünü oku (dosya başlığı); kırmızı üç şey olabilir — kod hatası · iş kararı bekleyen veri · bekçinin kör noktası. Bekçiyi daraltarak yeşile çekme.
7. **Yeni bekçi yazdıysan:** negatif sonda zorunlu — korunan davranışı bilerek boz, KIRMIZI verdiğini gör, geri al. Standart: `docs/RECETELER.md` § bekçi yazma.

## Kullanıcıya rapor
Koşulan dosyalar · çıkış kodları · kırmızıysa ilk hata satırı. "Test koşmadım" ise açıkça söyle.
