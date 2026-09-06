# Tur 3 devam bilgisi (kesinti olursa)

- Run ID: `wf_fefcd561-f36`
- Model: **args'ta `model` YOK** (oturumdan Opus 5 miras alınır — bilinçli), `effort: "high"`; çürütme/doğrulama/birleştirme motor içinde Sonnet/medium (`OPT2`).
- seenFile: `audit/tours/seen-t1t2.json` (208 kayıt)
- Denetçiler: S-1…S-5 (senaryo). Görev metinleri Tur 3 çağrısında inline verildi; `tours/tur3-finders.json` ile AYNI DEĞİL (S-2/S-4/S-5'e Tur 2 bulgularına atıf eklendi) → devam ederken **workflow çağrısındaki args birebir tekrarlanmalı**, aksi halde önbellek düşer.
- Devam: `Workflow({scriptPath: 'audit/tools/denetim-tur.workflow.js', resumeFromRunId: 'wf_fefcd561-f36', args: <aynı args>})`
- Tur bitince: `python3 audit/tools/rebuild-tour.py 3 <task-output.json> <journal.jsonl>` → `tours/tur3.json` + `tours/tur3-seen.json`; sonra Tur 4 için `seen-t1t2.json` + `tur3-seen.json` birleştirilip `seen-t1t2t3.json` yapılır.
