// Çoklu etiket seti (2026-11-11): yeniden basım seçicisinin iki ucu. Eski backend 404 → null (tost yok, doğrudan bas).
import { apiClient } from './api';
import { labelService } from './label.service';

jest.mock('./api', () => ({ apiClient: { get: jest.fn(), put: jest.fn() } }));

const get = apiClient.get as jest.Mock;
const put = apiClient.put as jest.Mock;
beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

const data = { kind: 'ROLL_FINISHED', currentTemplateId: null, defaultTemplateId: 'tr', options: [{ id: 'tr', name: 'TR', source: 'DEFAULT', isDefault: true }] };

it('seçenekler topun ucundan okunur', async () => {
  get.mockResolvedValue({ data: { success: true, data } });
  await expect(labelService.getRollTemplateOptions('r1')).resolves.toEqual(data);
  expect(get).toHaveBeenCalledWith('/labels/rolls/r1/template-options');
});

it('eski backend: 404 (sarmalanmış ya da ham) → null', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
  await expect(labelService.getRollTemplateOptions('r1')).resolves.toBeNull();
  get.mockRejectedValueOnce({ response: { status: 404 } });
  await expect(labelService.getRollTemplateOptions('r1')).resolves.toBeNull();
});

it('404 dışı hata yükselir; options alanı yoksa null', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
  await expect(labelService.getRollTemplateOptions('r1')).rejects.toThrow('x');
  get.mockResolvedValueOnce({ data: { success: true, data: { kind: 'ROLL_RAW' } } });
  await expect(labelService.getRollTemplateOptions('r1')).resolves.toBeNull();
});

it('şablon yazımı: templateId (null = varsayılan) gövdede; expectedEditedAt yalnız doluysa', async () => {
  put.mockResolvedValue({ data: { success: true } });
  await labelService.setRollTemplate('r1', { templateId: 'en' });
  expect(put).toHaveBeenLastCalledWith('/labels/rolls/r1/template', { templateId: 'en' });
  await labelService.setRollTemplate('r1', { templateId: null, expectedEditedAt: '2026-11-11T10:00:00Z' });
  expect(put).toHaveBeenLastCalledWith('/labels/rolls/r1/template', { templateId: null, expectedEditedAt: '2026-11-11T10:00:00Z' });
});
