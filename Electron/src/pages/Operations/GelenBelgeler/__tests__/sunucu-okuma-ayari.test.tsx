// "Bilgisayarda ikinci okuma" (`gelenBelge.serverOcrEnabled`, 2026-11-09): ayar anahtarı yalnız değişince gövdeye girer,
// eski backend alanı göndermezse çizilmez; ayar kapalıyken düşen sayfa "yeniden çekin" der ve "Yeniden okut" çizmez;
// yeniden okut reddi SERVER_OCR_DISABLED Türkçe metne çevrilir; durum rozeti "kapalı · N sayfa bekliyor" der.
// Negatif sonda: `useReadOptionsDraft` gövdesinden `serverOcrEnabled` çıkarılınca "yalnız serverOcrEnabled:false gider" kırmızı;
// `canRequeue && !serverOcrOff` kaldırılınca "Yeniden okut çizmez" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";
import { ScanReadBanner, SERVER_OCR_OFF_FAIL_TEXT } from "../ScanReadBanner";
import { ReaderStatusBadge } from "../ReaderStatusBadge";
import type { DocumentScanInfo } from "../types";

const getSettings = vi.fn();
const updateSettings = vi.fn();
const requeueScan = vi.fn();
const getReaderStatus = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getIncomingDocumentSettings: () => getSettings(),
  updateIncomingDocumentSettings: (b: unknown) => updateSettings(b),
  requeueScan: (...a: unknown[]) => requeueScan(...a),
  getReaderStatus: () => getReaderStatus(),
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: { gelenBelgeEnabled: true } } }),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: () => null }));

const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: false };
const scan = (o: Partial<DocumentScanInfo> = {}): DocumentScanInfo => ({
  id: "s1", noteId: "n1", pageNo: 1, regionNo: null, mimeType: "image/jpeg", sizeBytes: 100, status: "READ_FAILED", attempts: 0, ...o,
});

beforeEach(() => {
  getSettings.mockReset();
  updateSettings.mockReset();
  requeueScan.mockReset().mockResolvedValue({});
  getReaderStatus.mockReset();
});

describe("Genel Ayarlar → Gelen Belge: bilgisayarda ikinci okuma", () => {
  it("⭐ varsayılan açık görünür; kapatılınca YALNIZ serverOcrEnabled:false gider", async () => {
    const server = { ...BASE, serverOcrEnabled: true, defaultServerOcrEnabled: true };
    getSettings.mockResolvedValue(server);
    updateSettings.mockResolvedValue({ ...server, serverOcrEnabled: false });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    const toggle = await screen.findByRole("switch", { name: "Bilgisayarda ikinci okuma" });
    expect(toggle).toBeChecked();
    expect(screen.getByTestId("gb-server-ocr").textContent).toContain("Sunucu donanımı zayıfsa kapatın");
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ serverOcrEnabled: false });
  });

  it("eski backend alanı göndermez → anahtar çizilmez, gövdeye girmez", async () => {
    getSettings.mockResolvedValue(BASE);
    updateSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await userEvent.click(await screen.findByRole("radio", { name: /Yalnız şüpheli değeri engelle/ }));
    expect(screen.queryByTestId("gb-server-ocr")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ unreviewedApproval: "BLOCK_SUSPECT" });
  });
});

describe("ayar kapalıyken okunamayan sayfa", () => {
  it("⭐ READ_FAILED: \"yeniden çekin\" metni, Yeniden okut çizmez", () => {
    renderWithProviders(<ScanReadBanner scans={[scan()]} canRequeue onRequeued={() => {}} serverOcrOff />);
    expect(screen.getByTestId("scan-read-failed").textContent).toContain(SERVER_OCR_OFF_FAIL_TEXT);
    expect(screen.queryByRole("button", { name: /Yeniden okut/ })).toBeNull();
  });

  it("ayar açıkken (ya da eski backend) bugünkü metin + Yeniden okut", () => {
    renderWithProviders(<ScanReadBanner scans={[scan({ attempts: 3 })]} canRequeue onRequeued={() => {}} />);
    expect(screen.getByTestId("scan-read-failed").textContent).not.toContain(SERVER_OCR_OFF_FAIL_TEXT);
    expect(screen.getByRole("button", { name: /Yeniden okut/ })).toBeTruthy();
  });

  it("yeniden okut reddi SERVER_OCR_DISABLED → Türkçe metin", async () => {
    const err = new AxiosError("409");
    err.response = { status: 409, data: { message: "x", details: { code: "SERVER_OCR_DISABLED" } } } as AxiosResponse;
    requeueScan.mockRejectedValue(err);
    renderWithProviders(<ScanReadBanner scans={[scan({ attempts: 3 })]} canRequeue onRequeued={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Yeniden okut/ }));
    expect((await screen.findByTestId("scan-reread-error")).textContent).toContain("Bilgisayarda ikinci okuma kapalı");
  });
});

describe("okuma servisi durum rozeti", () => {
  it("⭐ ayar kapalı → \"Bilgisayarda okuma: kapalı · N sayfa bekliyor\"", async () => {
    getReaderStatus.mockResolvedValue({ service: "var", engine: "rapidocr", version: "1", serverOcrEnabled: false, pending: 3 });
    renderWithProviders(<ReaderStatusBadge />);
    expect((await screen.findByTestId("reader-status")).textContent).toBe("Bilgisayarda okuma: kapalı · 3 sayfa bekliyor");
  });

  it("alan yoksa (eski backend) bugünkü rozet", async () => {
    getReaderStatus.mockResolvedValue({ service: "var", engine: "rapidocr", version: null });
    renderWithProviders(<ReaderStatusBadge />);
    expect((await screen.findByTestId("reader-status")).textContent).toContain("Okuma servisi: çalışıyor");
  });
});
