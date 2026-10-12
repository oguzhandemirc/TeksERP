---
paths:
  - "{Teks-Erp,Electron,mobil}/src/**/*{tambur,Tambur,finalize,roll-cut,RollCut,undo,roll-step,plan-gate}*"
---

**Tambur · finalize · kesim · geri alma** — öz. Tam metni baştan okuma; yalnız ilgili bölümü oku:
- `docs/kurallar/tambur.md § "Ortak"`
- `docs/kurallar/tambur.md § "Backend"`

- Her rotanın SON adımı topu finalize eder; Tambur özel değil, depo bekleme statüsüdür.
- Finalize iş emrini `currentStep`'ten çözer, `producedInStep`'ten değil.
- `RollOperation`/`RollMovement` geri alınırken silinmez, `revokedAt` damgalanır.
- İş emri kapaması yalnız `completeWorkOrderIfStepsDone` ile.
- Movement kapanışında `qtyOut = qtyIn`; `finalizedAt`ı DB trigger'ı yazar.
- Bitince alan bekçilerini koş (`/bekci-kos tambur`; liste `docs/kurallar/tambur.md § "Bekçiler"`); yeni karar → `/karar-notu`.
