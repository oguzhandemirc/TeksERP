## uzak-erisim

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Teks-Erp/scripts/test_discovery_identity.ts` | Kurulum kimliği bir kez üretilip değişmez; /health alan kümesi DONMUŞ (dört tüketici); kimlik ucu DB'ye DOKUNMAZ. | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_totp.ts` | Kendi yazdığımız HOTP/TOTP'un RFC 4226/6238 test vektörleriyle DIŞARIDAN doğrulanmasını, replay penceresinin kapalılığını ve 15 dk'lık kurulum pencere · §7 iki adımlı giriş İSTEĞE BAĞLI (B6-2): açık kullanıcı kodsuz 409 `TOTP_REQUIRED` · yanlış kod 401 `TOTP_INVALID` · reddedilen deneme oturum açmaz · doğru/kurtarma koduyla girer · PIN/kart kodsuz · tohumlanmış sır 'açık' sayılmaz · sıfırlanınca sorulmaz | ✓ | ✓B3 (`38707c72`) — kapı kaldırılınca §7 4 ❌ · herkese sorulunca 3 ❌ · kanıt yüklemi (tüketilmiş pencere) kaldırılınca 2 ❌, geri alındı |  |
| `Teks-Erp/scripts/test_web_hardening.ts` | Sertleştirme ortam değişkeni yokken fabrikanın SIFIR FARK kalmasını (trust proxy/CORS/HSTS/CSP/hız sınırı yok) ve her sertleştirme açıkken gerçekten ç |  | ✓ · ✓B1 (bu commit) — (B6) `REMOTE_PORT` kalıntısında başlığı yok sayma kaldırılınca §CI-11 ❌, geri konunca yeşil |  |
