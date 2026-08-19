import { Callout } from "@/components/ui/callout";
import { TypeToConfirm } from "@/components/forms/TypeToConfirm";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { MergePreview } from "@/services/mergeService";

/**
 * ONAY KAPISI — DÖRT KATMAN.
 *
 * ① survivor seçimi (sayfada, referans sayısıyla) → ② bu önizleme (satır satır
 * somut) → ③ gerekçe ≥10 karakter → ④ yazarak onay = survivor'ın KODU.
 *
 * ⚠️ Yazılacak metin KOD, AD DEĞİL. Aracın var olma sebebi adların birbirine
 * karışması; "ŞAHİN TEKSTİL" yazdırmak, tam da ayırt edilemeyen şeyi onaylatmak
 * olurdu. Kod tekildir ve belgelerde yazan da odur.
 *
 * ⚠️ `count === null` → "?" basılır, "0" DEĞİL. "Sayamadım" ile "hiç yok" farklı
 * cümlelerdir ve operatör ikincisini "dokunulmayacak" diye okur
 * (`backup-impact.service.ts` disiplini).
 */
export function MergeConfirmGate({
  preview,
  typed,
  onTypedChange,
  reason,
  onReasonChange,
  seenConflicts,
  onSeenConflictsChange,
}: {
  preview: MergePreview;
  typed: string;
  onTypedChange: (v: string) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  seenConflicts: boolean;
  onSeenConflictsChange: (v: boolean) => void;
}) {
  const moves = preview.moves.filter((m) => m.count === null || m.count > 0);
  const survivorCode = preview.survivor?.code ?? preview.survivor?.name ?? "";

  if (!preview.canMerge) {
    return (
      <Callout tone="danger" title="Bu kayıtlar birleştirilemez">
        <ul className="list-inside list-disc space-y-1">
          {preview.blockers.map((b) => (
            <li key={b.key}>{b.message}</li>
          ))}
        </ul>
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      <Callout tone="danger" title="Bu işlem geri alınamaz">
        <b>{preview.sources.length}</b> kayıt <b>{preview.survivor?.name}</b> altına birleşecek.
        Birleşen kayıtlar silinmez — pasifleşir ve “→ {preview.survivor?.name} altına birleşti”
        olarak görünmeye devam eder. Ancak <b>geri alınamaz</b>: referanslar hedefe taşındıktan
        sonra hangi satırın hangi kayıttan geldiği ayrıştırılamaz.
      </Callout>

      {preview.warnings.map((w) => (
        <Callout key={w} tone="warning">
          {w}
        </Callout>
      ))}

      <div>
        <h4 className="mb-2 text-sm font-medium">Taşınacak kayıtlar</h4>
        {moves.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Taşınacak referans yok — kayıtlar yalnız listede birleşecek.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {moves.map((m) => (
              <li key={`${m.table}.${m.column}`} className="flex justify-between gap-4">
                <span>{m.label}</span>
                <span className={m.count === null ? "text-amber-600" : "font-medium"}>
                  {m.count === null ? "ölçülemedi" : m.count.toLocaleString("tr-TR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview.conflicts.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Çakışmalar ve nasıl çözülecekleri</h4>
          <ul className="space-y-2 text-sm">
            {preview.conflicts.map((c) => (
              <li key={c.table} className="rounded border p-2">
                <div className="font-medium">
                  {c.label} — {c.count} kayıt
                </div>
                <div className="text-muted-foreground">{c.why}</div>
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={seenConflicts}
              onChange={(e) => onSeenConflictsChange(e.target.checked)}
            />
            <span>Çakışma listesini okudum ve yukarıdaki çözümleri kabul ediyorum.</span>
          </label>
        </div>
      )}

      <div>
        <h4 className="mb-1 text-sm font-medium">Yan etkiler</h4>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {preview.sideEffects.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="merge-reason" className="text-sm font-normal">
          Gerekçe (en az 10 karakter) — bu kararın başka hiçbir kaydı yok
        </Label>
        <Textarea
          id="merge-reason"
          rows={2}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Örn: aynı firmanın iki kez açılmış kaydı, vergi no aynı"
        />
      </div>

      <TypeToConfirm
        expected={survivorCode}
        value={typed}
        onChange={onTypedChange}
        label={
          <>
            Onaylamak için hedef kaydın <b>kodunu</b> yazın: <code>{survivorCode}</code>
          </>
        }
      />
    </div>
  );
}
