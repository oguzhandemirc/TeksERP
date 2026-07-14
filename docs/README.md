# Doküman Haritası

Kanonik kaynak her zaman **kod + `CLAUDE.md` dosyaları**dır. Bu klasör onları tamamlayan
tasarım/operasyon/tarihçe dokümanlarını tasnif eder.

## Yapı

| Klasör | İçerik | Güncellik |
|---|---|---|
| `design/` | **Canlı** domain tasarımları — çuval havuzu, parti modeli, etiket stüdyosu, kartela, iade | Koda karşı güncel (nokta bayatlıklar için dosya başı banner'lara bak) |
| `ops/` | Deploy/runbook — kurulum, deploy runbook, üretim kontrol listesi, raster fiziksel checklist | Operasyonel, bakımlı |
| `qa/` | Manuel kabul testi senaryoları (UAT — gerçek cihaz/UI) | Bakımlı |
| `history/` | **Arşiv (salt-okunur, tarihsel)** — kapanmış kod incelemeleri, eski risk raporları, tamamlanmış plan/faz dokümanları, superseded tasarımlar | Donmuş; envanter sayıları/satır referansları bayat — referans SANMA |

## Kanonik referanslar (bu klasörde DEĞİL)

- Kök `CLAUDE.md` — üretim akışı + domain kuralları (harness'e yüklenir)
- `Teks-Erp/CLAUDE.md`, `Teks-Erp/ARCHITECTURE.md` — backend derin referans
- `Electron/CLAUDE.md`, `mobil/CLAUDE.md` — alt-proje talimatları
- `Teks-Erp/MIGRATION-DEPLOY.md`, `Teks-Erp/DB-MIMARI-DENETIM.md` — DB operasyon otoritesi
- `Teks-Erp/API_TEST_GUIDE.md`, `Teks-Erp/INSTALL-HARDWARE.md`

> **Not:** `history/` altındaki dosyalar yazıldıkları anın fotoğrafıdır. Model/enum/migration
> sayıları ve dosya:satır referansları o günden bu yana bayatlamıştır — güncel gerçek için
> her zaman `schema.prisma` + kanonik `CLAUDE.md`'lere bak.

## Bayatlık bekçisi (CI)

`scripts/check-docs.mjs` (zero-dep Node) her push/PR'da CI'da koşar (`docs` job'ı) +
elle `cd Teks-Erp && npm run check:docs`:

- **GATE (fail):** ölü doküman-link — bir doküman taşınmış/silinmiş bir repo dosyasına
  atıf yaparsa CI kırılır (bu oturumda dosya taşındığında referanslar kırıldı — tam bu senaryoyu yakalar).
- **ADVISORY (fail etmez):** kaldırılmış-sembol atıfları (`batchSplitId`, `MachineLog`,
  `packedQty`...) — tasarım dokümanları tarihsel bağlamı meşru anlattığı için yalnız listelenir.

Yeni bir sembol/model kaldırıldığında `REMOVED_SYMBOLS`'e ekle; geri gelirse çıkar. Sayı
bayatlığı ayrıca kanonik-kaynak yönlendirmesiyle azaltıldı (docs "~N (kanonik: schema.prisma)" der).
