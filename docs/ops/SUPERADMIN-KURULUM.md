# Satıcı hesabı (süperadmin) ve ayar şifresi — kurulum reçetesi

> 2026-09-30: eski `UZAK-ERISIM-KURULUM.md`in (tünel emekli, B6) tünelden bağımsız iki bölümü buraya taşındı; içerik aynen korunur.

## Satıcı hesabı (süperadmin) — `npm run superadmin:kur`

Modül anahtarlarını (Ticaret / İplik / Çoklu depo / Üretim …) **yalnız satıcı
hesabı** değiştirebilir. Hesap **sunucuda elle koşulan bir script'le** doğar.

> ⚠️ **2026-09-03 — `.env` YOLU KALDIRILDI.** Eski `SUPERADMIN_USERNAME` /
> `SUPERADMIN_PASSWORD_HASH` / `SUPERADMIN_PIN` / `SUPERADMIN_TOTP_SECRET` /
> `SUPERADMIN_FORCE_SYNC` satırları artık **hiçbir işe yaramaz**; boot job'ı
> onları OKUMAZ. Varsa **silin** — sırrı diskte kalıcılaştırmaktan başka bir şey
> yapmazlar; boot log'u da kalanları görürse uyarır (`[superadmin] ⚠️ Ortamda
> ARTIK KULLANILMAYAN … satır var` — yalnız **anahtar adı** basılır, değer asla). Gerekçe: iki doğuş yolu = iki sır yüzeyi; `.env` yolunda hash + PIN
> + TOTP sırrı yedeğe, `kur.ps1`in taşıdığı dosyaya ve ekran paylaşımına
> giriyordu, üstelik "FORCE_SYNC satırını sonra kaldırın" gibi unutulabilir bir
> adım gerektiriyordu.

```powershell
cd C:\TeksERP\app
npm run superadmin:kur                # kurulum (idempotent — hesap varsa DOKUNMAZ)
npm run superadmin:kur -- --rotate    # parola + PIN yenile, açık 2FA kapanır
```

> ⚠️ **GERÇEK TERMİNAL ŞART — uzaktan koşuyorsan `-t` VER.** Script parolayı
> maskeleyerek sorar; girdi boru/dosya olduğunda hiçbir soru cevaplanamaz ve
> **süreç hata vermeden, zaman aşımına düşmeden bekler**. Doğrusu:
> `ssh -t sunucu 'cd C:\TeksERP\app && npm run superadmin:kur'`,
> `docker exec -it <konteyner> npm run superadmin:kur` ya da doğrudan sunucu
> konsolu. `-t` unutulursa script artık **gürültülü hata verip çıkar**
> ("etkileşimli terminal ister") — eskiden sessizce donuyordu, yani kurulum
> tamamlanmamış olur ve kimse fark etmezdi. Kurulum betiğinden / pm2 / CI
> içinden çağırmayın.

Script sırayla sorar: **kullanıcı adı** (öneri `bakim` — nötr seçin, satıcıyı
çağrıştırmasın) · **parola** (iki kez, ekrana basılmaz) · **6 haneli hızlı giriş
PIN'i** (boş bırakılırsa üretilir). İki adımlı doğrulama **tohumlanmaz**: 2FA
kimseye zorunlu değildir (kullanıcı kararı 2026-09-30); isterseniz panelde kendi
hesabınızın **2FA sekmesinden** "Kurulumu başlat" → "Bu bilgisayarda kurulumu
aç" deyin — açıksa her
parolalı girişte kod sorulur, PIN girişi etkilenmez.

> ⚠️ **Çıktı bir daha gösterilmez.** PIN parola yöneticisinde
> tutulur, **fabrikaya VERİLMEZ**. Hiçbir dosyaya/log'a/audit yüküne yazılmaz;
> audit'e yalnız `SUPERADMIN_PROVISIONED` / `SUPERADMIN_ROTATED` izi düşer
> (sırsız, gerçek kullanıcı adı da yok).
> ⚠️ **Var olan bir kullanıcı YÜKSELTİLEMEZ.** Mevcut bir kullanıcı adı
> verilirse script hata verir: gizli hesap görünür bir hesaptan türetilemez —
> o kullanıcının geçmişi, oturumları ve audit satırları maskeli hesaba TAŞINAMAZ
> (audit maskesi satır düzeyindedir; taşınsaydı fabrikanın kendi kayıtları bir
> anda "Sistem Bakımı" adına geçerdi). Panelde düğme, API'de uç YOKTUR.
> ⚠️ **İkinci koşum hiçbir şeye dokunmaz** ("zaten kurulu", çıkış 0) — yoksa
> "bir daha çalıştırayım" refleksi satıcının elindeki parolayı öldürürdü.
> ⚠️ **RESTART GEREKMEZ.** Kilit defteri, hesabın olmadığı kurulumda her istekte
> tembel doğrulama yapar: hesap doğduğu AN kilit yürürlüğe girer.
> ⚠️ Hesap **hiç kurulmazsa** modül anahtarları bugünkü gibi `admin:settings`
> ile yazılmaya devam eder (emniyet supabı — kilitlenme yok). Boot log'unda
> `[superadmin] Satıcı hesabı yok — emniyet supabı devrede` satırı bunu söyler.

**ROTASYON** (`--rotate`): parola + PIN **yenilenir**, açık 2FA **kapanır**
(konsol erişimi = yönetici sıfırlaması; telefonunu kaybeden satıcının kurtarma
yolu — isterse panelden yeniden açar) ve `tokenVersion` artar → **açık oturumların hepsi anında düşer**. Kalıcı bir
"rotasyon bayrağı" YOKTUR; kaldırılması unutulacak bir satır bırakmaz.

> ⚠️ **KULLANICI ADI DEĞİŞMEZ** (giriş kimliğidir; sessizce değiştirmek satıcıyı
> bir sonraki girişte dışarıda bırakırdı). Ad gerçekten değişecekse hesap elle
> güncellenir.
> ⚠️ **PIN başka bir kullanıcıdaysa** rotasyon UYGULANMAZ — script hata verir ve
> hesaba hiçbir şey yazılmaz (`quickPin` sistem genelinde benzersiz).
> ⚠️ **Kurulu hesap yokken `--rotate`** hata verir; hesap YARATMAZ.

> ⚠️ **Hesabı KALDIRMA** (satıcı ilişkisi biterse):
> `UPDATE users SET "isSystemAccount"=false, "isActive"=false WHERE "isSystemAccount"=true;`
> + **`pm2 restart tekserp` ŞART**. Kilit defteri TEK YÖNDE tazelenir: yokluktan
> varlığa istek anında, varlıktan yokluğa yalnız restart'ta (fail-closed) —
> restart'sız bırakılırsa modül anahtarlarını restart'a kadar HİÇ KİMSE yazamaz.
> ⚠️ **Kabul edilmiş risk (F287):** `pg_dump` / `db-copy` bu hesabın düz PIN'ini
> de taşır; yedek indirebilen personel onu okuyabilir. Karşılığı hızlı rotasyondur
> (`--rotate`).

## Ayar şifresi (ikinci kapı) — opsiyonel, süperadmin yönetir

Tanımlıysa **ayar/bayrak kaydeden her istek** ikinci bir şifre sorar (açık
kalmış bir admin oturumundan ayar değişmesin). `.env`'de **DEĞİLDİR** — satıcı
hesabıyla girip tanımlanır:

```
PUT    /api/admin/settings-password   { "password": "<8-72 karakter, boşluksuz ASCII>" }  # tanımla / değiştir
DELETE /api/admin/settings-password                                          # kaldır (kapı uyur)
GET    /api/admin/settings-password                                          # tanımlı mı
```

> ⚠️ Üç uç da **yalnız satıcı hesabına** açıktır; fabrika yöneticisi için
> **404** döner (403 ucun varlığını doğrulardı).
> ⚠️ **Tanımlı değilse hiçbir istek şifre istemez** — mevcut kurulumlarda sıfır fark.
> ⚠️ **ŞİFRE YALNIZ BOŞLUKSUZ ASCII OLABİLİR (8–72 karakter).** Türkçe harf
> (ş/ğ/ü/ö/ç/ı) ve boşluk **reddedilir** — sebep teknik ve serttir: şifre
> `X-Settings-Password` başlığıyla taşınır, HTTP başlığı bu karakterleri
> taşıyamaz. Kabul edilseydi tanımlama 200 dönerdi ama **hiçbir istemci o
> şifreyi iletemezdi** ve fabrika, rotasyona kadar bütün ayar/bayrak
> ekranlarından kilitli kalırdı. Üst sınır 72'dir çünkü bcrypt yalnız ilk 72
> baytı karıştırır (daha uzunu sessizce kırpılırdı).
> ⚠️ Kapsam **beş yazma yüzeyi**: `PATCH /api/feature-flags` ·
> `PUT /api/feature-flags/documents-logo` · `PUT /api/admin/settings/:key` ·
> `PATCH /api/admin/backups/offsite` · `POST /api/admin/backups/offsite/authorize`.
> Son ikisi "yedek" ekranında yaşıyor ama `system_settings`e yazar ve
> **yedeklerin gideceği yeri** belirler — kapsamın yüklemi ekran değil, yazma.
> **Süperadmin muaftır** (kapıyı o kurar) ve yalnız belge tasarımı anahtarı
> taşıyan gövde (Belge Şablonları / Refakat Kartı) da muaftır — o ekranın
> personeli `admin:settings` taşımaz.
> ⚠️ **Unutulursa** yalnız satıcı yeniler/kaldırır; fabrikanın kendi başına
> sıfırlayacağı bir yol BİLİNÇLİ OLARAK yoktur (olsaydı kapı hiçbir şey korumazdı).
> ⚠️ Hatalı deneme sayısı **giriş kilidiyle AYNI şaltere** bağlıdır
> (`auth.pinLockoutEnabled`) ama **AYRI SAYAÇ** kullanır: ayar şifresini yanlış
> girmek kimsenin oturum açmasını engellemez, tersi de geçerlidir. Eşik aşılınca
> `429` + `Retry-After` başlığı + bekleme süresi döner; denetim kaydı (`SETTINGS_PASSWORD_LOCKED`)
> **kilidin kurulduğu anda bir kez** yazılır, her 429'da değil.
> ⚠️ Şifre `system_settings` içinde **bcrypt hash** olarak durur; ham ayar
> ucundan ne yazılabilir ne de listelenir (`GET /api/admin/settings` yükünde
> `security.` ile başlayan satır DÖNMEZ).

---

