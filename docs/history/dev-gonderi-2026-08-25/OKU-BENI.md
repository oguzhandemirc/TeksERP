# Fabrika sunucusu → dev makinesi · 2026-08-25

Bu klasördeki her şey **yalnızca sunucuda var**. Repo'da bulunan hiçbir dosyanın kopyası
burada yok — `kur.ps1`, `paketle.ps1`, migration'lar, paket zip'i **gönderilmez**, dev'de
zaten var (ya da dev'in kendi kaynağından üretilir).

## Dosyalar

| Dosya | Ne | Ne yapılmalı |
|---|---|---|
| `DEV-CLAUDE-YAPILACAKLAR-2026-08-25.md` | **Asıl belge.** Sahada ne kuruldu, hangi doğrulamalar koştu, repo'da düzeltilecek 6 madde, sıradaki iş (Electron→APK) | Dev'deki Claude'a bunu ver |
| `test/kur-gerialma.harness.win.ps1` | Repo'daki `deploy/test/kur-gerialma.harness.ps1`'in Windows kolu. **Tek fark:** `$pm2` sahtesi `.sh` değil `.cmd` (PowerShell `.sh` çalıştıramaz) | İstenirse repoya al (`deploy/test/`) |
| `test/run-harness-win.ps1` | `run-harness.sh`'in PowerShell karşılığı. Aynı 3 senaryo / 12 kontrol. Fabrika sunucusunda `bash`+`pwsh` olmadığı için gerekti | İstenirse repoya al |
| `kanit/harness-onarilmis-vs-orijinal.txt` | Yukarıdaki koşucunun ham çıktısı: onarılmış **12/12**, orijinal **8/12** | `deploy/README.md`'nin macOS ölçümünün Windows'ta da tuttuğunun kanıtı |
| `kanit/bekci-ciktisi-canli-db.txt` | 4 salt-okunur bekçinin **canlı DB**'ye karşı ham çıktısı (91+4+40 kontrol, 0 hata) | Deploy sonrası doğrulama kaydı |
| `kanit/PAKET.json` | Üretimde kurulu paketin manifesti (`dee217f`, 191 migration, 13438 dosya) | Sahadaki sürümün kimliği |

## Gönderilmeyenler (bilerek)

- **Paket zip'i** (114 MB) — dev kendi kaynağından üretir, taşımanın anlamı yok.
- **`.env`, `db-credentials.json`, `*.dump`** — sır ve canlı veri; sunucudan çıkmaz.
- **`kur.ps1` / `paketle.ps1`** — repo'daki hâlleriyle aynı; sunucudaki kopya zaten repo'dan geldi.
- **pm2 log'ları** — ilgili satırlar asıl belgeye alıntılandı.

## Taşıma

Klasör küçük (birkaç yüz KB). Tek dosya isteniyorsa yalnız
`DEV-CLAUDE-YAPILACAKLAR-2026-08-25.md` yeter — kanıtlar ve harness kolu opsiyonel ek.
