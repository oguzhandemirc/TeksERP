import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const getCompletePreview = vi.fn();
const complete = vi.fn();
vi.mock("./service", () => ({
  workOrderService: {
    getCompletePreview: (...a: unknown[]) => getCompletePreview(...a),
    complete: (...a: unknown[]) => complete(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Kalite picker'ı gerçek servise gitmesin — id/kod eşlemesi yeterli.
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () =>
    Promise.resolve({ data: [{ id: "q1", code: "1.KALITE", name: "1. Kalite", sortOrder: 1 }] }),
}));

const permissions = vi.fn<() => string[]>(() => ["workorder:write", "roll:manual-adjust"]);
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    user: null,
    permissions: permissions(),
    isAdmin: false,
    hasPermission: (p: string) => permissions().includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions().includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions().includes(p)),
  }),
}));

import { WorkOrderCompleteDialog } from "./WorkOrderCompleteDialog";

function roll(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    barcode: "BC-1",
    status: "IN_PRODUCTION",
    currentQty: 120,
    colorName: null,
    colorHex: null,
    propertyCount: 0,
    processed: false,
    qualityGrade: null,
    stepId: "st1",
    stationName: "Kurşun + KK2",
    canReturnToStock: true,
    ...over,
  };
}

function previewData(over: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      workOrderId: "wo1",
      workOrderNumber: "IE3007260001",
      status: "IN_PROGRESS",
      canComplete: true,
      blockReason: null,
      requiresDisposition: true,
      orderLinked: false,
      remainingSteps: [{ stepId: "st2", stationName: "Tambur", stepSequence: 2 }],
      inFlight: { count: 1, totalMeters: 120, byStep: [{ stationName: "Kurşun + KK2", count: 1, meters: 120 }] },
      dispositionRolls: [roll()],
      blockedRolls: [],
      ...over,
    },
  };
}

const render = () =>
  renderWithProviders(
    <WorkOrderCompleteDialog
      open
      onOpenChange={() => {}}
      workOrderId="wo1"
      workOrderNumber="IE3007260001"
    />,
  );

const confirmBtn = () => screen.getByRole("button", { name: /İş emrini kapat/i });

/** Devir açık onayı — devir seçilmeden görünmez. */
const transferAckBox = () =>
  screen.getByRole("checkbox", { name: /Yeni iş emri açılmasını onaylıyorum/i });

/** i. select (0 = dispozisyon, 1 = kalite) — TEK toplu senaryolar için. */
const combo = (i: number) => screen.getAllByRole("combobox")[i]!;

/** Belirli topun satırındaki i. select — index kaymasına bağışık (çok toplu). */
const rowCombo = (rollId: string, i = 0) =>
  within(screen.getByTestId(`dispo-${rollId}`)).getAllByRole("combobox")[i]!;

/** Belirli topun satırında verilen kararı seç. */
async function chooseFor(
  user: ReturnType<typeof userEvent.setup>,
  rollId: string,
  label: RegExp,
) {
  await user.click(rowCombo(rollId));
  await user.click(await screen.findByRole("option", { name: label }));
}

/** İlk (dispozisyon) select'ini aç ve verilen etiketi seç. */
async function chooseDisposition(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(combo(0));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("WorkOrderCompleteDialog (kapanış dispozisyonu)", () => {
  beforeEach(() => {
    permissions.mockReturnValue(["workorder:write", "roll:manual-adjust"]);
    getCompletePreview.mockReset().mockResolvedValue(previewData());
    complete.mockReset().mockResolvedValue({ success: true, data: {}, message: "İş emri manuel kapatıldı" });
  });

  it("istasyondaki topları listeler ve karar verilmeden kapatma disabled", async () => {
    render();
    expect(await screen.findByText("BC-1")).toBeInTheDocument();
    expect(screen.getByText(/hâlâ.*istasyonda/i)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
  });

  it("karar + sebep girilince payload dispositions ile gider", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("BC-1");

    await chooseDisposition(user, /Bitmiş depo/i);
    // Sebep girilmeden hâlâ kapalı (min 3 karakter).
    expect(confirmBtn()).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/sipariş iptal/i), "kalan mal depoya alındı");
    await waitFor(() => expect(confirmBtn()).toBeEnabled());

    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [woId, payload] = complete.mock.calls[0] as [
      string,
      { reason: string; dispositions: { rollId: string; action: string; qualityGradeId: string | null }[] },
    ];
    expect(woId).toBe("wo1");
    expect(payload.reason).toBe("kalan mal depoya alındı");
    expect(payload.dispositions).toEqual([
      { rollId: "r1", action: "WAREHOUSE", qualityGradeId: null },
    ]);
  });

  it("fason dönüşü topta 'Ham stok' seçeneği kapalı", async () => {
    const user = userEvent.setup();
    getCompletePreview.mockResolvedValue(
      previewData({ dispositionRolls: [roll({ canReturnToStock: false, processed: true })] }),
    );
    render();
    await screen.findByText("BC-1");
    await user.click(combo(0));
    const option = await screen.findByRole("option", { name: /Ham stok/i });
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("roll:manual-adjust yetkisi yoksa dispozisyon UI'ı yerine yetki uyarısı çıkar", async () => {
    permissions.mockReturnValue(["workorder:write"]);
    render();
    expect(await screen.findByText(/roll:manual-adjust/)).toBeInTheDocument();
    expect(screen.queryByText("BC-1")).not.toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
  });

  it("fasondaki top kapatmayı engeller: blok listesi + buton kilitli", async () => {
    getCompletePreview.mockResolvedValue(
      previewData({
        canComplete: false,
        blockReason: "1 top fasonda / açık fason sevkinde",
        requiresDisposition: false,
        dispositionRolls: [],
        blockedRolls: [
          {
            ...roll({ id: "r9", barcode: "BC-9", status: "AT_SUBCONTRACTOR" }),
            blockReason: "Fasonda (fiziksel olarak dışarıda) — önce fason kabul/iade yapılmalı",
          },
        ],
      }),
    );
    render();
    expect(await screen.findByText(/Kapatmayı engelleyen toplar/i)).toBeInTheDocument();
    expect(screen.getByText("BC-9")).toBeInTheDocument();
    expect(screen.getByText(/fiziksel olarak dışarıda/i)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("WIP yoksa dispozisyon sorulmaz, kapatma payload'ı boş gider", async () => {
    const user = userEvent.setup();
    getCompletePreview.mockResolvedValue(
      previewData({
        requiresDisposition: false,
        dispositionRolls: [],
        inFlight: { count: 0, totalMeters: 0, byStep: [] },
      }),
    );
    render();
    expect(await screen.findByText(/Bu kapatma şunları yapacak/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/sipariş iptal/i)).not.toBeInTheDocument();
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledWith("wo1", {}));
  });

  it("devir seçilince sipariş bağı toggle'ı çıkar ve transferOrderMode gider", async () => {
    const user = userEvent.setup();
    getCompletePreview.mockResolvedValue(previewData({ orderLinked: true }));
    render();
    await screen.findByText("BC-1");
    await chooseDisposition(user, /Yeni iş emrine devret/i);
    const toggle = await screen.findByRole("checkbox", { name: /siparişe bağlı kalsın/i });
    expect(toggle).toBeChecked(); // orderLinked=true → default keep
    await user.type(screen.getByPlaceholderText(/sipariş iptal/i), "üretim yeni emirde sürecek");
    // Devir YENİ İŞ EMRİ doğurur → açık onay olmadan kapatma kilitli.
    expect(confirmBtn()).toBeDisabled();
    await user.click(transferAckBox());
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [, payload] = complete.mock.calls[0] as [string, { transferOrderMode: string }];
    expect(payload.transferOrderMode).toBe("keep");
  });

  it("depo seçilince kalite seçici çıkar ve seçim payload'a girer", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("BC-1");
    await chooseDisposition(user, /2\. kalite/i);
    expect(screen.getAllByRole("combobox")).toHaveLength(2); // dispozisyon + kalite
    await user.click(combo(1));
    await user.click(await screen.findByRole("option", { name: /1\. Kalite/i }));
    await user.type(screen.getByPlaceholderText(/sipariş iptal/i), "ikinci kaliteye alındı");
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [, payload] = complete.mock.calls[0] as [
      string,
      { dispositions: { action: string; qualityGradeId: string | null }[] },
    ];
    expect(payload.dispositions[0]).toEqual({ rollId: "r1", action: "A1_STOCK", qualityGradeId: "q1" });
  });

  // Gerçek olay (2026-07-30): 700m + 1200m iki top kapatıldı, biri "devret" gitti.
  // Kararın DOĞRU topa yazıldığını iki-toplu senaryoda kanıtla (tek-toplu testler
  // satır↔karar eşlemesini hiç sınamıyordu).
  it("iki top: her satırın kararı kendi topuna yazılır (karışmaz)", async () => {
    const user = userEvent.setup();
    getCompletePreview.mockResolvedValue(
      previewData({
        dispositionRolls: [
          roll({ id: "r700", barcode: "BC-700", currentQty: 700 }),
          roll({ id: "r1200", barcode: "BC-1200", currentQty: 1200 }),
        ],
      }),
    );
    render();
    await screen.findByText("BC-700");
    // Kalite kutusunun yeri her satırda AYRILMIŞ olmalı → 2 satır × 2 select.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);

    await chooseFor(user, "r700", /Bitmiş depo/i);
    // 1. satır seçildikten SONRA 2. satırın kutusu yerinden kaymamalı.
    await chooseFor(user, "r1200", /Bitmiş depo/i);

    await user.type(screen.getByPlaceholderText(/sipariş iptal/i), "ikisi de depoya");
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));

    const [, payload] = complete.mock.calls[0] as [
      string,
      { dispositions: { rollId: string; action: string }[]; transferOrderMode?: string },
    ];
    expect(payload.dispositions).toEqual([
      { rollId: "r700", action: "WAREHOUSE", qualityGradeId: null },
      { rollId: "r1200", action: "WAREHOUSE", qualityGradeId: null },
    ]);
    // Hiçbir satır devir seçilmediyse devir alanı gönderilmez.
    expect(payload.transferOrderMode).toBeUndefined();
  });

  it("iki top: yalnız seçilen satır devre gider, diğeri depoda kalır", async () => {
    const user = userEvent.setup();
    getCompletePreview.mockResolvedValue(
      previewData({
        dispositionRolls: [
          roll({ id: "r700", barcode: "BC-700", currentQty: 700 }),
          roll({ id: "r1200", barcode: "BC-1200", currentQty: 1200 }),
        ],
      }),
    );
    render();
    await screen.findByText("BC-700");
    await chooseFor(user, "r700", /Bitmiş depo/i);
    await chooseFor(user, "r1200", /Yeni iş emrine devret/i);

    await user.type(screen.getByPlaceholderText(/sipariş iptal/i), "biri devir");
    // Yalnız devredilen top onay blokunda listelenir.
    expect(screen.getByText(/1 top YENİ bir iş emrine taşınacak/i)).toBeInTheDocument();
    // Devredilen top hem satırında hem onay blokunda görünür; depoya giden görünmez.
    expect(screen.getAllByText("BC-1200")).toHaveLength(2);
    expect(screen.getAllByText("BC-700")).toHaveLength(1);
    expect(confirmBtn()).toBeDisabled();
    await user.click(transferAckBox());
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
    await user.click(confirmBtn());
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    const [, payload] = complete.mock.calls[0] as [
      string,
      { dispositions: { rollId: string; action: string }[] },
    ];
    expect(payload.dispositions).toEqual([
      { rollId: "r700", action: "WAREHOUSE", qualityGradeId: null },
      { rollId: "r1200", action: "TRANSFER", qualityGradeId: null },
    ]);
  });

  it("önizleme yüklenemezse kapatma onaylanamaz", async () => {
    getCompletePreview.mockRejectedValue(new Error("boom"));
    render();
    expect(await screen.findByText(/Önizleme yüklenemedi/i)).toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();
  });
});
