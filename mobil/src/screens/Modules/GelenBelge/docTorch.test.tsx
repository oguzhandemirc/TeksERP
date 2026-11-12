// Bekçi: belge kamerası feneri. Varsayılan AÇIK (kayıt yok / bozuk → açık); başlangıç değeri TEK yüklemden
// (`initialDocTorch`); operatör çekimde kapatır, kamera yeniden açılınca ayara döner; kapalı kamerada fener istenmez.
import React from 'react';
import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { DOC_TORCH_AUTO_DEFAULT, parseDocTorchAuto, useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { initialDocTorch, useDocTorch } from './docTorch';
import PageCameraModal from './PageCameraModal';

const mockCam: { torch: unknown[] } = { torch: [] };
jest.mock('expo-camera', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const CameraView = R.forwardRef((p: { enableTorch?: boolean }, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ takePictureAsync: jest.fn(), getAvailablePictureSizesAsync: async () => [] }));
    mockCam.torch.push(p.enableTorch);
    return R.createElement(View, { testID: 'kamera-goruntusu' });
  });
  return { CameraView, useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] };
});

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View };
});

beforeEach(() => {
  mockCam.torch = [];
  useDeviceSettingsStore.setState({ docTorchAuto: true });
});

describe('docTorch — varsayılan ve ayrıştırma', () => {
  it('⭐ kayıt yokken flaş otomatik AÇIK', () => {
    expect(DOC_TORCH_AUTO_DEFAULT).toBe(true);
    expect(parseDocTorchAuto(null)).toBe(true);
  });

  it('bozuk kayıt varsayılana düşer; yalnız birebir "false" kapatır', () => {
    expect(parseDocTorchAuto('evet')).toBe(true);
    expect(parseDocTorchAuto('false')).toBe(false);
    expect(parseDocTorchAuto('true')).toBe(true);
  });

  it('başlangıç değeri yalnız ayardan', () => {
    expect(initialDocTorch(true)).toBe(true);
    expect(initialDocTorch(false)).toBe(false);
  });
});

describe('useDocTorch', () => {
  it('ayar kapalıysa sönük başlar', () => {
    useDeviceSettingsStore.setState({ docTorchAuto: false });
    const { result } = renderHook(() => useDocTorch(true));
    expect(result.current.torch).toBe(false);
  });

  it('⭐ çekimde kapatılır; kamera yeniden açılınca ayara döner; kapalı kamerada istenmez', () => {
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useDocTorch(active), { initialProps: { active: true } });
    expect(result.current.torch).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.torch).toBe(false);
    rerender({ active: false });
    expect(result.current.torch).toBe(false);
    rerender({ active: true });
    expect(result.current.torch).toBe(true);
  });
});

describe('PageCameraModal — fener düğmesi', () => {
  it('kamera fener açık başlar; "Flaş" düğmesi söndürür', async () => {
    renderWithPaper(<PageCameraModal visible pageNo={1} onDismiss={jest.fn()} onCaptured={jest.fn()} onError={jest.fn()} />);
    await act(async () => {});
    expect(mockCam.torch.at(-1)).toBe(true);
    const btn = screen.getByTestId('belge-tara-flas');
    expect(btn.props.accessibilityLabel).toBe('Flaş');
    fireEvent.press(btn);
    await act(async () => {}); // AppModal içeriği portalda: host bir tur sonra çizer
    expect(mockCam.torch.at(-1)).toBe(false);
  });
});
