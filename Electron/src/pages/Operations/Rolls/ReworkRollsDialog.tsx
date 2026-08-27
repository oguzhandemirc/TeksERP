import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Factory, Recycle, Tag, Truck, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useFoldValues } from "@/hooks/useFoldValues";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { routeService } from "@/pages/Routes/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import type { ProductionRoute } from "@/pages/Routes/types";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import type { Roll } from "./types";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

/**
 * ÜRETİME AL — seçili topları YENİ bir iş emrine sokar.
 *
 * İki mod, tek motor: `rework` (Bitmiş Depo — top bir tur görmüş, "yeniden") ve
 * `start` (Ham Stok / Yarı Mamul — ilk kez giriyor). Fark yalnız başlık, ikon ve
 * toast metnidir; payload, engel kuralları, fason firma seçimi ve ölü etiket
 * uyarısı üçünde de aynıdır — ayrı bir diyalog açmak o kuralları ikizlerdi.
 *
 * NEDEN VAR (2026-08-25 saha sorusu: "bitmiş bir kumaş tekrar iş emrine
 * bağlanabiliyor mu, tekrar boyahaneye gönderilebilir mi?"). Cevap evet'ti ve
 * backend bunu 2026'dan beri destekliyor (`quick-start` STOCK/WAREHOUSE/A1_STOCK
 * kabul eder — "her işlem final üretir" modeli), ama masaüstünde İSTEMCİSİ YOKTU:
 * akış yalnız tabletteki Hızlı İş Emri'nden yapılabiliyordu. Ölçüm: canlıda 980
 * topun 4'ü iki iş emrinden geçmiş ve dördü de HAM top — bitmiş malı geri üretime
 * alma yolu sahada hiç kullanılmamış.
 *
 * ⚠️ MEVCUT bir iş emrine top EKLENEMEZ: o uç 2026-06-12'de kaldırıldı. Bu diyalog
 * bilinçli olarak YENİ iş emri açar; başlık da bunu söyler.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `rework` = bitmiş depo (bir tur görmüş) · `start` = ham stok / yarı mamul. */
  mode?: "rework" | "start";
  rolls: Roll[];
  onDone?: () => void;
}

export function ReworkRollsDialog({ open, onOpenChange, mode = "rework", rolls, onDone }: Props) {
  const isRework = mode === "rework";
  const qc = useQueryClient();
  const [routeId, setRouteId] = useState<string | null>(null);
  const [colorId, setColorId] = useState<string | null>(null);
  const [width, setWidth] = useState("");
  const [foldType, setFoldType] = useState<string | null>(null);
  const [dispatchFirstStep, setDispatchFirstStep] = useState(true);
  /** İlk fason adımının firması — rotada planlı olan ön-dolu gelir, operatör değiştirir. */
  const [firmId, setFirmId] = useState<string | null>(null);
  // İdempotency: bu diyalog bir gönderim OTURUMUdur. Zaman aşımından sonra
  // yeniden basış aynı token'ı taşır → backend cached WO döner (mükerrer iş emri
  // + refakat kartı önlenir). Her mutate'te yeni token üretmek korumayı boşa
  // düşürürdü (2026-07-27 Tambur / 2026-08-03 KK1 dersi).
  const [clientToken, setClientToken] = useState(() => crypto.randomUUID());

  const routes = useQuery({
    queryKey: ["routes", "rework-picker"],
    // Elle `pageSize` YOK: picker verisi tek kapıdan geçer (`loadAllForPicker`),
    // o da veri seti sınırı aşarsa sessizce kesmek yerine AÇIK hata verir.
    queryFn: () => loadAllForPicker(routeService, { sortBy: "name" }),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const routeList = useMemo(() => (routes.data?.data ?? []).filter((r) => r.isActive), [routes.data]);
  const route: ProductionRoute | null = useMemo(
    () => routeList.find((r) => r.id === routeId) ?? null,
    [routeList, routeId],
  );

  const { values: foldValues, isEmpty: foldNotConfigured } = useFoldValues();

  // Rota yetenekleri — mobil `routeApplyCaps` ile AYNI yüklem: hem istasyonun
  // kendi bayrağı hem fason kategorisinin bayrağı sayılır. Ayrışırlarsa iki
  // yüzey aynı rota için farklı alan gösterir.
  const steps = useMemo(() => [...(route?.steps ?? [])].sort((a, b) => a.sequence - b.sequence), [route]);
  const canApplyColor = steps.some(
    (s) => s.station?.appliesColor || s.station?.defaultCategory?.appliesColor,
  );
  const hasTambur = steps.some((s) => s.station?.kind === "TAMBUR");
  const firstStepIsFason = steps[0]?.station?.type === "EXTERNAL";

  // ── FASON FİRMA ────────────────────────────────────────────────────────────
  // ⚠️ Bu blok olmadan "Fasona gönder" SESSİZ BİR NO-OP'tu: backend sevki ancak
  // adımın firması çözülebiliyorsa yapar ve sahadaki iki rotanın da adımlarında
  // planlı firma YOK (ölçüldü, 2026-08-25) → anahtar açık kalır, çeki listesi hiç
  // doğmazdı. Firma `stepPlanning` overlay'i ile gider (mobil Hızlı İş Emri'yle
  // aynı yol).
  const firstStepCategoryId = steps[0]?.requiredCategoryId ?? steps[0]?.station?.defaultCategoryId ?? null;
  const firms = useQuery({
    queryKey: ["subcontractors", "rework-picker", firstStepCategoryId],
    queryFn: () =>
      loadAllForPicker(subcontractorService, {
        filters: firstStepCategoryId ? { categoryId: firstStepCategoryId } : {},
      }),
    enabled: open && firstStepIsFason,
    staleTime: 5 * 60_000,
  });
  const firmList = useMemo(() => firms.data?.data ?? [], [firms.data]);

  // Rota değişince: şablonda planlı firma varsa onu al, yoksa temizle.
  useEffect(() => {
    setFirmId(steps[0]?.plannedSubcontractorId ?? null);
  }, [steps]);

  // Kat YALNIZ Tambur'lu rotada sorulur (mobil ile aynı sözleşme). Rota değişince
  // ön-seçim/temizlik: uygulanmayacak bir spec payload'da kalmasın.
  useEffect(() => {
    if (!hasTambur) {
      setFoldType(null);
      return;
    }
    setFoldType((cur) => cur ?? foldValues[0]?.code ?? null);
  }, [hasTambur, foldValues]);

  // Açılışta seçili topların ortak enini öner (hepsi aynıysa).
  useEffect(() => {
    if (!open) return;
    setClientToken(crypto.randomUUID());
    const widths = new Set(rolls.map((r) => r.width ?? null));
    setWidth(widths.size === 1 && rolls[0]?.width != null ? String(rolls[0].width) : "");
  }, [open, rolls]);

  // ── Sözleşme ön-kontrolleri: backend'in kurallarını TEKRARLAMAZ, ÖNCEDEN söyler.
  const itemIds = new Set(rolls.map((r) => r.item?.id).filter(Boolean));
  const multiItem = itemIds.size > 1;
  const committed = rolls.filter((r) => r.sackId || r.shipmentId);

  /**
   * ÖLÜ ETİKET UYARISI — dar ve bilinçli.
   *
   * Fason kabulünde orijinal top TERMINAL'e çekilir (`SUBCONTRACTOR_CONSUMED`) ve
   * makbuzdan YENİ kayıt doğar; koddaki gerekçe aynen: "Top fasona gittiyse mutlaka
   * açıldı — boyahane/zımpara fark etmez, KİMLİĞİNİ KAYBEDER." Yani bitmiş, etiketi
   * basılı bir topun barkodu bu yolculukta kesin olarak geçersizleşir.
   *
   * ⚠️ Bu, 2026-08-25'te KALDIRILAN genel iptal onayından FARKLI: orada etiketin
   * geçersizleşmesi bir OLASILIKTI (kâğıt henüz yapıştırılmamış olabilir), burada
   * KESİN. Yine de engel değil bilgi — operatör kâğıdı sökeceğini bilsin yeter.
   */
  const labelAtRisk = firstStepIsFason ? rolls.filter((r) => r.labelPrintedAt) : [];

  // Bu yol BARKODLA çalışır (`quick-start` gövdesi `rollBarcodes`). Seçimin
  // tamamı barkodsuzsa buton aktif kalır ama istek 0 top bağlar — sessiz
  // başarısızlık. Bugün ham stoktaki topların hepsi barkodlu (ölçüldü), ama
  // barkodsuz açık kumaş bu sekmelere de düşebilir.
  const allBarcodeless = rolls.length > 0 && rolls.every((r) => !r.barcode);

  const blocking = multiItem
    ? "Seçili toplar farklı kumaşlara ait — tek iş emri tek kumaş içindir."
    : allBarcodeless
    ? "Seçili topların hiçbirinde barkod yok — bu yol barkodla çalışır."
    : committed.length > 0
      ? `Çuvalda/sevkiyatta olan top üretime bağlanamaz: ${committed.map((r) => r.barcode ?? "—").join(", ")}`
      : !routeId
        ? "Bir rota seçmelisiniz."
        : hasTambur && !foldType
          ? foldNotConfigured
            ? "Kat değeri tanımlı değil — Tanımlar → Kumaş Özellikleri'nden KAT ekleyin."
            : "Kat tipi seçmelisiniz."
          : null;

  const mutation = useMutation({
    mutationFn: () =>
      workOrderService.quickStart({
        clientToken,
        rollBarcodes: rolls.map((r) => r.barcode).filter((b): b is string => !!b),
        routeTemplateId: routeId!,
        targetColorId: canApplyColor ? colorId : null,
        width: width.trim() ? Number(width.replace(",", ".")) : null,
        foldType,
        ...(firstStepIsFason && firmId
          ? {
              stepPlanning: [
                {
                  sequence: steps[0]!.sequence,
                  ...(firstStepCategoryId ? { requiredCategoryId: firstStepCategoryId } : {}),
                  plannedSubcontractorId: firmId,
                },
              ],
            }
          : {}),
        // Firma yoksa sevk YAPILAMAZ — anahtarı açık göstermek yalan olurdu.
        dispatchFirstStep: willDispatch,
      }),
    onSuccess: (res) => {
      const d = res.data;
      const parts = [`İş emri ${d.workOrder.workOrderNumber}`];
      if (d.batch) parts.push(`parti ${d.batch.batchNumber}`);
      if (d.dispatch) parts.push(`sevk ${d.dispatch.dispatchNo}`);
      toast.success(`${d.attached} top ${isRework ? "yeniden üretime" : "üretime"} alındı`, {
        description: parts.join(" · "),
        duration: 10_000,
      });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onDone?.();
      onOpenChange(false);
    },
    // onError YOK: apiClient interceptor'ı backend mesajını zaten toast'lar.
  });

  /**
   * SEVK GERÇEKTEN OLACAK MI — TEK KAYNAK. Payload, onay kutusu ve BUTON METNİ
   * hepsi bunu okur. Ayrıştığı an arayüz olmayacak bir şeyi vaat eder: buton
   * "…ve fasona gönder" derken firma çözülemediği için backend sevki atlar ve
   * operatör olmayan bir çeki listesini arar (bekçi bunu yakaladı).
   */
  const willDispatch = firstStepIsFason && dispatchFirstStep && !!firmId;

  const barcodeless = rolls.filter((r) => !r.barcode);

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isRework ? (
              <Recycle className="h-5 w-5 text-primary" />
            ) : (
              <Factory className="h-5 w-5 text-primary" />
            )}
            {isRework ? "Yeniden Üretime Al" : "Üretime Al"} — {rolls.length} top
          </DialogTitle>
          <DialogDescription>
            Seçili toplar için <strong>yeni bir iş emri</strong> açılır ve toplar ona bağlanır. Mevcut bir iş
            emrine sonradan top eklenemez.
          </DialogDescription>
        </DialogHeader>

        {blocking && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{blocking}</span>
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs text-muted-foreground">Rota</label>
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={routeId ?? ""}
              disabled={mutation.isPending}
              onChange={(e) => setRouteId(e.target.value || null)}
            >
              <option value="">— Rota seç</option>
              {routeList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {steps.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {steps.map((s) => s.station?.name ?? "—").join(" → ")}
              </p>
            )}
          </div>

          {canApplyColor && (
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">Hedef Renk</label>
              <ColorPickerModal
                value={colorId}
                onChange={setColorId}
                disabled={mutation.isPending}
                placeholder="Renksiz / Ham"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">En (cm)</label>
              <Input
                value={width}
                inputMode="decimal"
                disabled={mutation.isPending}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="—"
              />
            </div>
            {hasTambur && (
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Kat</label>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={foldType ?? ""}
                  disabled={mutation.isPending}
                  onChange={(e) => setFoldType(e.target.value || null)}
                >
                  <option value="">— Seç</option>
                  {foldValues.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Fasona gönderme yalnız ilk adım fasonsa anlamlı — aksi halde mal
              fabrikada ilk istasyona girer ve "gönder" diye bir şey yoktur. */}
          {firstStepIsFason && (
            <>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  Fason Firma ({steps[0]?.station?.name})
                </label>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={firmId ?? ""}
                  disabled={mutation.isPending}
                  onChange={(e) => setFirmId(e.target.value || null)}
                >
                  <option value="">— Firma seç</option>
                  {firmList.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-2.5 rounded-md border p-2.5">
                <Checkbox
                  checked={dispatchFirstStep && !!firmId}
                  disabled={mutation.isPending || !firmId}
                  onCheckedChange={(v) => setDispatchFirstStep(v === true)}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Truck className="h-3.5 w-3.5" /> Fasona gönder
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {firmId
                      ? "İş emri açılınca mal fasona sevk edilir ve çeki listesi oluşur. Kapatırsan yalnız planlanır."
                      : "Firma seçilmedi — sevk yapılamaz, iş emri yalnız planlanır."}
                  </span>
                </span>
              </label>
            </>
          )}
        </div>

        {/* ÖLÜ ETİKET — burada KESİN, o yüzden yazıyoruz (bkz. üstteki not). */}
        {labelAtRisk.length > 0 && (
          <div className="rounded-md border border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-medium">
              <Tag className="h-3.5 w-3.5" /> {labelAtRisk.length} topun etiketi geçersizleşecek
            </div>
            <p className="mt-1">
              Fasona giden top orada açılıp birleştirildiği için <strong>kimliğini kaybeder</strong>: kabulde
              bu kayıtlar kapanır ve mal <strong>yeni bir barkodla</strong> döner. Eski etiketleri toptan
              sökün, yoksa sahada okutulamayan kâğıt kalır.
            </p>
            <p className="mt-1 font-mono text-[11px]">{labelAtRisk.map((r) => r.barcode).join(" · ")}</p>
          </div>
        )}

        {barcodeless.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {barcodeless.length} topun barkodu yok — bu yol barkodla çalışır, onlar gönderilmez.
          </p>
        )}

        <div className="max-h-40 divide-y overflow-auto rounded-md border text-sm">
          {rolls.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-1.5">
              <span className="font-mono text-xs">{r.barcode ?? "—"}</span>
              <span className="flex-1 truncate">
                {r.item?.name ?? "—"}
                {r.color?.name ? ` · ${r.color.name}` : ""}
              </span>
              <span className="tabular-nums text-muted-foreground">{DEC.format(r.currentQty)} mt</span>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Vazgeç
          </Button>
          <Button
            className={cn(willDispatch && "gap-1.5")}
            disabled={!!blocking || mutation.isPending || rolls.length === 0}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              "Açılıyor…"
            ) : willDispatch ? (
              <>
                <Factory className="h-4 w-4" /> İş emri aç ve fasona gönder
              </>
            ) : (
              "İş emri aç"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
