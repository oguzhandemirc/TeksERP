// Gelen belge → istasyon belge okutma doğrulama eşiği (backend `gelenBelge.stationVerifyThreshold`, tek yazar `PUT /ayarlar`)
// + "Son okutmalar" listesi (puan · açıldı mı · görevli onayladı mı — eşiği veriyle ayarlamak için). Eski backend alanı
// göndermez → alan çizilmez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatFactory } from "@/lib/factory-time";
import { FieldLabel } from "./SettingRow";
import { listStationScanChecks } from "@/pages/Operations/GelenBelgeler/service";
import type { IncomingDocumentSettings } from "@/pages/Operations/GelenBelgeler/types";
import type { StationScanCheckRow } from "@/pages/Operations/GelenBelgeler/stationVerifyTypes";

/** Eşik taslağı: metin tutulur; 0–100 tam sayı geçerli (0 = doğrulama kapalı). */
export function useStationVerifyDraft(server: IncomingDocumentSettings | undefined) {
  const serverValue = server?.stationVerifyThreshold;
  const [text, setText] = useState(serverValue === undefined ? "" : String(serverValue));
  const n = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  const dirty = serverValue !== undefined && valid && n !== serverValue;
  const invalid = serverValue !== undefined && !valid;
  const reset = () => setText(serverValue === undefined ? "" : String(serverValue));
  return { serverValue, text, setText, dirty, invalid, body: dirty ? { stationVerifyThreshold: n } : {}, reset };
}

export function StationVerifyField({ draft, defaultValue }: { draft: ReturnType<typeof useStationVerifyDraft>; defaultValue: number | undefined }) {
  const [showRecent, setShowRecent] = useState(false);
  if (draft.serverValue === undefined) return null;
  return (
    <div data-testid="gb-station-verify-threshold">
      <FieldLabel
        htmlFor="gb-station-verify-threshold-input"
        label="İstasyonda belge okutma: doğrulama eşiği (%)"
        desc="Belge okutulunca fiş / parti no ile bulunan iş emri, aynı fotoğraftaki öteki bilgilerle (top no'ları, top metreleri, parti ve sipariş no, müşteri, gönderen, tarih) karşılaştırılır. Benzerlik bu eşiğin altındaysa iş emri kendiliğinden açılmaz; görevli listeden kendisi seçer. Top listesi okunamazsa iş emri hiç kendiliğinden açılmaz. 0 = doğrulama kapalı. Yalnız istasyonda belge okutma açıkken etkilidir."
      />
      <Input
        id="gb-station-verify-threshold-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={5}
        value={draft.text}
        onChange={(e) => draft.setText(e.target.value)}
        className="mt-2 w-28"
        aria-invalid={draft.invalid}
      />
      {draft.invalid && <p className="mt-1 text-xs text-destructive">Eşik 0 ile 100 arasında tam sayı olmalı.</p>}
      <p className="mt-1 text-xs text-muted-foreground">Varsayılan: %{defaultValue ?? 80}</p>
      <Button type="button" variant="link" className="h-auto px-0 text-xs" onClick={() => setShowRecent((v) => !v)} data-testid="gb-station-verify-recent-toggle">
        {showRecent ? "Son okutmaları gizle" : "Son okutmaları göster"}
      </Button>
      {showRecent && <RecentScans />}
    </div>
  );
}

const DECISION_TEXT: Record<string, string> = {
  VERIFIED: "Eşleşti", UNSURE: "Emin değil", NONE: "Bulunamadı", OFF: "Doğrulama kapalı", SAME_PHOTO: "Aynı fotoğraf",
};
const OPENED_TEXT: Record<string, string> = { AUTO: "Kendiliğinden açıldı", CHOSEN: "Listeden seçildi", CONFIRMED: "Görevli onayladı" };

/** Ne tuttu / ne tutmadı: "Top no 3/16 ✗ · Müşteri ✓". */
export function componentsText(row: Pick<StationScanCheckRow, "components">): string {
  return (row.components ?? []).map((c) => `${c.label} ${c.matched ? "✓" : "✗"}${c.detail && c.detail !== "tuttu" ? ` (${c.detail})` : ""}`).join(" · ");
}

function RecentScans() {
  const q = useQuery({ queryKey: ["gelen-belge", "istasyon-okutma", "son"], queryFn: () => listStationScanChecks(50) });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Yükleniyor…</p>;
  if (q.isError) return <p className="text-xs text-destructive">Son okutmalar alınamadı.</p>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="text-xs text-muted-foreground" data-testid="gb-station-verify-recent-empty">Henüz okutma yok.</p>;
  return (
    <div className="mt-2 max-h-80 overflow-auto rounded-md border" data-testid="gb-station-verify-recent">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left">
          <tr><th className="p-2">Zaman</th><th className="p-2">Okunan no</th><th className="p-2">Puan</th><th className="p-2">Sonuç</th><th className="p-2">Açılan</th><th className="p-2">Ne tuttu / ne tutmadı</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="p-2 whitespace-nowrap">{formatFactory(r.createdAt, "dd.MM HH:mm")}</td>
              <td className="p-2">{r.readDocNo ?? r.readBatchNo ?? "—"}</td>
              <td className="p-2 whitespace-nowrap">{r.bestScore === null ? "—" : `%${r.bestScore}`} <span className="text-muted-foreground">/ eşik %{r.threshold}</span></td>
              <td className="p-2">{DECISION_TEXT[r.decision] ?? r.decision}</td>
              <td className="p-2">{r.openedWorkOrderNumber ? `${r.openedWorkOrderNumber} · ${OPENED_TEXT[r.openedHow ?? ""] ?? r.openedHow}` : "Açılmadı"}</td>
              <td className="p-2">{componentsText(r) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
