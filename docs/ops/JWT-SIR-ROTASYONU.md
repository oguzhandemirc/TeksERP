# JWT sırrı rotasyonu

> Kod: `Teks-Erp/src/lib/jwt-secret.ts` (tek yüklem `checkJwtSecret`) · araç `Teks-Erp/scripts/jwt-sir.ts` (pakette `app\dist\tools\jwt-sir.cjs`) · bekçiler `test_jwt_sir_kapisi`, `test_izin_db_kaynagi` · kural `docs/kurallar/deploy-kurulum.md` · karar notu `docs/history/CLAUDE-NOT-ARSIVI.md` (2026-10-01, G20).

⚠️ **Canlı fabrikada rotasyonun ZAMANI ve ONAYI kullanıcıdadır.** Bu belge yalnız adımları verir. Sıra her zaman aynı: önce test sunucusunda (testfabrika) prova, ölçüm yeşilse fabrikada, **vardiya dışında** ve kullanıcının açık cümlesiyle.

## Kimin döndürmesi gerekir

- Sunucu `/api/admin/health` → `jwtSecret.rotationRequired: true` diyorsa (`status` `BILINEN` ya da `ZAYIF`). Panelde **Sistem → Sunucu Durumu** aynı satırı gösterir; backend açılış günlüğünde `JWT_SECRET DÖNDÜRÜLMELİ` uyarısı basılır.
- Tipik aday: `ilk-kurulum.ps1` sırrı makinede üretmeye başlamadan (2026-09-04) önce kurulmuş, `.env`i örnek dosyadan kopyalanmış kurulumlar ve sırrı elle doldurulmuş Docker kurulumları.
- `BILINEN` = değer depoda ya da bir örnek dosyada yazılı (ret listesi değer değil SHA-256 özeti tutar). `ZAYIF` = 8'den az farklı karakter. İkisinde de backend **açılır** — fabrika durmaz, yalnız uyarır. `EKSIK`/`KISA` (32 karakterden kısa) sırla backend zaten açılmaz.

## Neden

Sırrı bilen herkes geçerli imzalı token üretebilir. G20'den beri yetki kümesi ve kullanıcı adı her istekte DB'den okunur, oturum (jti) defterde ve kullanıcıya bağlıdır; yani sahte token yetki kazanamaz ve başkasının kimliğine bürünemez. Ama sızan bir oturum kimliğiyle token uzatmak ve ileride claim'e güvenen bir yolun açılması riski sürer — bilinen sır döndürülür.

## Etkisi

- **Bütün oturumlar düşer:** eski sırla imzalı her token 401 alır. Panel kullanıcıları yeniden giriş yapar; tabletler PIN/kart/parola ile döner. O anda yarım kalan istek kaybolur (tablette çevrimdışı kuyruk yok) → **vardiya dışında** yapılır.
- Veriye dokunmaz: DB, yedekler, lisans ve kısa kimlik anahtarları etkilenmez. Yalnız `JWT_SECRET` satırı değişir.
- Sonraki girişte her token süreli (`exp`) doğar.

## Windows kurulum (pm2)

Yollar `C:\TeksERP` köküyle yazıldı; kurulum başka kökteyse onu kullan.

1. **Ölçüm (salt okuma — mesai içinde de yapılabilir):**
   ```powershell
   cd C:\TeksERP\app
   node dist\tools\jwt-sir.cjs denetle --env .env
   ```
   İlk satır ölçülen dosyayı söyler (`Hedef dosya: …` — yan yana kurulumda doğru `.env` mi?). Çıkış: `0` kabul · `2` UYARI (döndürülmeli) · `3` RET (backend açılmaz) · `1` ölçülemedi. Sır değeri hiçbir çıktıya basılmaz.
2. **Hazırlık:** vardiya bitti, tabletlerde açık iş yok. `.env`in kopyası alınır (geri alma için; sır taşır):
   ```powershell
   Copy-Item .env .env.jwt-oncesi
   ```
3. **Kuru koşu:** `node dist\tools\jwt-sir.cjs yenile --env .env` — ne yapılacağını söyler, dosyaya yazmaz.
4. **Uygula:** `node dist\tools\jwt-sir.cjs yenile --env .env --apply` — yeni rastgele sır yazılır; dosyanın satır sonu (CRLF) ve izinleri korunur, birden çok `JWT_SECRET` satırı varsa hepsi değişir.
5. **Yeniden başlat:** `pm2 ls` ile backend adını bul (varsayılan `tekserp-backend-yeni`) → `pm2 restart <ad>`. Sır `.env`ten okunur (`dotenv`), pm2 ortamında tutulmaz.
6. **Doğrula:**
   - `node dist\tools\jwt-sir.cjs denetle --env .env` → `0`.
   - `/api/admin/health` → `jwtSecret.status: "OK"`, `rotationRequired: false`.
   - Panelden bir giriş, bir tablette PIN ile giriş.
7. Doğrulama yeşilse `.env.jwt-oncesi` silinir: `Remove-Item .env.jwt-oncesi`.

**Geri alma:** `Copy-Item .env.jwt-oncesi .env -Force` → `pm2 restart <ad>`. Herkes bir kez daha düşer.

⚠️ Rotasyondan sonra bir `kur.ps1 -GeriAl` eski `app` klasörünü (içindeki eski `.env` dahil) geri getirebilir. Geri almadan sonra 1. adımı tekrar koş.

## Docker kurulum

**Ölçüm:** `docker compose logs backend | grep "JWT_SECRET DÖNDÜRÜLMELİ"` (açılış uyarısı) ya da `/api/admin/health` → `jwtSecret`.

**Rotasyon (vardiya dışında):**
```sh
cd <compose dizini>                       # baslat.sh kurulumu: Teks-Erp/ (.env.docker) · korumalı paket: .env
cp .env.docker .env.docker.jwt-oncesi     # korumalı pakette: cp .env .env.jwt-oncesi
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 48)/" .env.docker
chmod 600 .env.docker
docker compose up -d                      # ortam değişti → backend yeniden yaratılır
docker compose logs backend | grep -c "JWT_SECRET DÖNDÜRÜLMELİ"   # beklenen 0 (yeni açılıştan sonra)
```
Doğrulama yeşilse `*.jwt-oncesi` silinir. Geri alma: kopyayı geri koy + `docker compose up -d`.

## Yeni kurulumlar

Yeni kurulum yolu bilinen ya da zayıf sırla **doğmaz**: Docker'ın ilk kurulum seed'i (`SEED_ON_EMPTY=1`) böyle bir sırla REDDEDER (yönetici hesabı açılmaz; sır düzeltilip konteyner yeniden başlatılınca seed tekrar koşar); `ilk-kurulum.ps1` ve `baslat.sh` sırrı makinede rastgele üretir; örnek dosyalarda (`example-env.txt`, `.env.docker.example`, korumalı `.env.ornek`) değer yoktur.
