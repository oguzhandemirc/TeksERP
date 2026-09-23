import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, Package, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { saveTextAs } from "@/lib/file-save";
import {
  configBundleService,
  type BundleEnvelope,
  type BundleKind,
  type BundlePlan,
  type ConflictStrategy,
} from "@/services/configBundleService";

const STRATEGY_LABEL: Record<ConflictStrategy, string> = {
  rename: "Yeni ad ver (mevcut kayda dokunma)",
  overwrite: "Üzerine yaz (mevcut kaydın içeriğini değiştir)",
  skip: "Atla (mevcut kayıt varsa hiçbir şey yapma)",
};

const ACTION_LABEL: Record<BundlePlanRow["action"], string> = {
  CREATE: "Yeni",
  OVERWRITE: "Üzerine yaz",
  RENAME: "Yeni adla ekle",
  SKIP: "Atla",
  ERROR: "Hata",
};

type BundlePlanRow = BundlePlan["rows"][number];

/**
 * Yapılandırma paketi — kurulumlar arası TANIM taşıma.
 *
 * Ana veri içe aktarımından ayrıdır ve bilinçli olarak DAR: taşınan şey
 * şablon/profil/rol TANIMIdır, kayıt değil. Rol şablonları taşınırken
 * ATAMALAR (kim hangi rolü taşıyor) GELMEZ — o kuruluma özgüdür.
 */
export function ConfigBundleCard() {
  const [selected, setSelected] = useState<Set<BundleKind>>(new Set());
  const [strategy, setStrategy] = useState<ConflictStrategy>("rename");
  const [envelope, setEnvelope] = useState<BundleEnvelope | null>(null);
  const [plan, setPlan] = useState<BundlePlan | null>(null);
  const [busy, setBusy] = useState<null | "export" | "preview" | "apply">(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const kindsQuery = useQuery({
    queryKey: ["config-bundle-kinds"],
    queryFn: configBundleService.kinds,
    staleTime: 5 * 60 * 1000,
  });
  const kinds = kindsQuery.data?.data ?? [];
  const exportable = kinds.filter((k) => k.canRead);

  const toggle = (k: BundleKind) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const wanted = selected.size > 0 ? [...selected] : exportable.map((k) => k.kind);
      const res = await configBundleService.export(wanted);
      const stamp = new Date().toISOString().slice(0, 10);
      const ok = await saveTextAs(
        JSON.stringify(res.data, null, 2),
        `TeksERP yapilandirma ${stamp}.json`,
        "application/json;charset=utf-8",
      );
      if (ok) toast.success(`${res.data.items.length} tanım paketlendi.`);
    } catch {
      toast.error("Paket oluşturulamadı.");
    } finally {
      setBusy(null);
    }
  };

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setBusy("preview");
    setPlan(null);
    try {
      const parsed = JSON.parse(await file.text()) as BundleEnvelope;
      setEnvelope(parsed);
      const res = await configBundleService.preview(parsed, strategy);
      setPlan(res.data);
    } catch (e) {
      setEnvelope(null);
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Paket okunamadı (geçerli bir TeksERP paketi mi?).");
    } finally {
      setBusy(null);
    }
  };

  const onApply = async () => {
    if (!envelope) return;
    setBusy("apply");
    try {
      const res = await configBundleService.apply(envelope, strategy);
      setPlan(res.data);
      toast.success(`${res.data.applied ?? 0} tanım aktarıldı${res.data.failed ? `, ${res.data.failed} hata` : ""}.`);
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Paket uygulanamadı.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1">
          <p className="font-medium">Yapılandırma Paketi</p>
          <p className="text-xs text-muted-foreground">
            Etiket / refakat kartı / belge şablonlarını ve rol tanımlarını başka bir kuruluma taşır.
            Kayıt (kumaş, müşteri…) taşımaz.
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {kinds.map((k) => (
          <label
            key={k.kind}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
              k.canRead ? "" : "opacity-50"
            }`}
            title={k.canRead ? undefined : "Bu tür için yetkiniz yok"}
          >
            <Checkbox
              checked={selected.has(k.kind)}
              disabled={!k.canRead}
              onCheckedChange={() => toggle(k.kind)}
            />
            {k.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Hiçbiri seçilmezse yetkiniz olan TÜM türler paketlenir.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null || exportable.length === 0} onClick={() => void onExport()}>
          {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Paketi indir
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Paket yükle
        </Button>
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as ConflictStrategy)}
          title="Hedefte aynı adlı bir kayıt varsa ne yapılsın"
        >
          {(Object.keys(STRATEGY_LABEL) as ConflictStrategy[]).map((s) => (
            <option key={s} value={s}>
              Çakışmada: {STRATEGY_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onPickFile(f);
        }}
      />

      {plan ? (
        <div className="mt-3 space-y-2">
          {/* Paketin BİLEREK taşımadıkları — "yok" ile "dışarıda" aynı şey değil. */}
          {envelope?.excluded?.length ? (
            <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
              <div className="font-medium">Bu paket şunları TAŞIMAZ:</div>
              <ul className="ml-4 list-disc">
                {envelope.excluded.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(plan.summary).map(([action, n]) => (
              <span key={action} className="rounded-md border px-2 py-0.5">
                {ACTION_LABEL[action as BundlePlanRow["action"]] ?? action}: <strong>{n}</strong>
              </span>
            ))}
          </div>
          <div className="max-h-48 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Tür</th>
                  <th className="px-2 py-1 text-left">Ad</th>
                  <th className="px-2 py-1 text-left">İşlem</th>
                  <th className="px-2 py-1 text-left">Açıklama</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r, i) => (
                  <tr key={`${r.kind}-${r.key}-${i}`} className="border-t">
                    <td className="px-2 py-1">{kinds.find((k) => k.kind === r.kind)?.label ?? r.kind}</td>
                    <td className="px-2 py-1">{r.newKey ?? r.key}</td>
                    <td className={`px-2 py-1 ${r.action === "ERROR" ? "text-destructive" : ""}`}>
                      {ACTION_LABEL[r.action]}
                    </td>
                    <td className="px-2 py-1 text-muted-foreground">{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.applied === undefined ? (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => void onApply()}>
                {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Paketi uygula
              </Button>
              {strategy === "overwrite" ? (
                <span className="flex items-center gap-1 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Üzerine yazma seçili — hedefteki aynı adlı tanımların içeriği DEĞİŞECEK.
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Uygulandı: {plan.applied} · Hata: {plan.failed ?? 0}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
