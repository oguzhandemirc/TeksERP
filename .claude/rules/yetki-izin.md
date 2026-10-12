---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{permission,Permission,role-template,rbac,tile-config,content-routes,ProtectedRoute,PermissionGate}*"
---

**Yetki · izin · rol** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/yetki-izin.md § "Ortak"`
- `docs/kurallar/yetki-izin.md § "Backend"`

- İzin doğrudan kullanıcıya (`UserPermission`); eşleşme tek yüklem `matchesPermission`.
- Yeni izin = `permission-catalog.ts`e satır; migration yazma; reçete `docs/RECETELER.md`.
- Katalog atama içermez; atama panelden; süperadmin rol değildir.
- Mobil ekranın dokunduğu uç `requireAnyPermission('<web>', ...MOBILE_X)`; düz OR'a çevirme.
- Bir yetenek VAR = motor + çıkış yüzeyi + izin ataması.
- Bitince alan bekçilerini koş (`/bekci-kos yetki-izin`; liste `docs/kurallar/yetki-izin.md § "Bekçiler"`); yeni karar → `/karar-notu`.
