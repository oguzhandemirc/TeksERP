---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{superadmin,system-account,settings-password,SettingsPassword,auth,Auth}*"
---

**Süperadmin · ayar şifresi** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/superadmin.md § "Ortak"`
- `docs/kurallar/superadmin.md § "Backend"`

- Süperadmin = `User.isSystemAccount` + geçerli mühür; kimliği JWT'ye koyma.
- Görünür ama kimlik teslim edilmez: düz PIN ucu başkasına 403.
- `flagWriteGuard` sırası: modül dalı en önde.
- Hesap yalnız TTY'li `superadmin:kur` ile doğar; mevcut kullanıcı yükseltilmez.
- Parola/PIN/TOTP/ayar şifresi repoya, log'a, audit yüküne girmez.
- Bitince alan bekçilerini koş (`/bekci-kos superadmin`; liste `docs/kurallar/superadmin.md § "Bekçiler"`); yeni karar → `/karar-notu`.
