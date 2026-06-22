import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { LocalStore } from './storage';

// ============================================================================
// Mock LocalStore — we control getSettings, getPerSiteEnabled, setPerSiteEnabled
// ============================================================================
vi.mock('./storage', async () => {
  const actual = await vi.importActual<typeof import('./storage')>('./storage');
  return {
    ...actual,
    LocalStore: {
      getSettings: vi.fn(),
      getPerSiteEnabled: vi.fn(),
      setPerSiteEnabled: vi.fn(),
    },
  };
});

const mockLocalStore = vi.mocked(LocalStore);

import { isInterceptionEnabled, setInterceptionEnabled, isGloballyEnabled } from './per-site-config';

// ============================================================================
// Helper to set up both global and per-site state in a single call
// ============================================================================
function mockSettings(overrides: Partial<AppSettings> = {}) {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...overrides };
  mockLocalStore.getSettings.mockResolvedValue(settings);
}

function mockPerSiteValue(value: boolean) {
  mockLocalStore.getPerSiteEnabled.mockResolvedValue(value);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// isInterceptionEnabled
// ============================================================================
describe('isInterceptionEnabled', () => {
  describe('when globally enabled', () => {
    it('returns the per-site value (default true) when no override exists', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: true });
      mockPerSiteValue(true); // default — no explicit override

      // Act
      const result = await isInterceptionEnabled('https://example.com/file.zip');

      // Assert
      expect(result).toBe(true);
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledWith('https://example.com');
    });

    it('returns false when the site is explicitly disabled', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: true });
      mockPerSiteValue(false);

      // Act
      const result = await isInterceptionEnabled('https://blocked.com/download');

      // Assert
      expect(result).toBe(false);
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledWith('https://blocked.com');
    });
  });

  describe('when globally disabled', () => {
    it('returns false by default (site not explicitly enabled)', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: false });
      mockPerSiteValue(true); // default, not explicitly overridden

      // Act
      const result = await isInterceptionEnabled('https://example.com/file');

      // Assert
      expect(result).toBe(false);
    });

    it('returns true when the site is explicitly enabled (opt-in override)', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: false, perSiteOverrides: { 'https://allowed.com': true } });
      mockPerSiteValue(true);

      // Act
      const result = await isInterceptionEnabled('https://allowed.com/file');

      // Assert
      expect(result).toBe(true);
    });

    it('returns false when the site is explicitly disabled (double no)', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: false, perSiteOverrides: { 'https://no-way.com': false } });
      mockPerSiteValue(false);

      // Act
      const result = await isInterceptionEnabled('https://no-way.com/file');

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('origin extraction', () => {
    it('extracts the correct origin from a URL with path and query', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: true });
      mockPerSiteValue(true);

      // Act
      await isInterceptionEnabled('https://sub.example.com/path?query=1#hash');

      // Assert
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledWith(
        'https://sub.example.com',
      );
    });

    it('handles URLs without a path correctly', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: true });
      mockPerSiteValue(true);

      // Act
      await isInterceptionEnabled('https://example.com');

      // Assert
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledWith(
        'https://example.com',
      );
    });

    it('preserves non-default ports in the origin', async () => {
      // Arrange
      mockSettings({ interceptionEnabled: true });
      mockPerSiteValue(true);

      // Act
      await isInterceptionEnabled('https://localhost:8080/api/download');

      // Assert
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledWith(
        'https://localhost:8080',
      );
    });
  });

  describe('edge cases', () => {
    it('reads per-site value from getPerSiteEnabled not from raw settings', async () => {
      // getPerSiteEnabled already defaults to true if not in overrides.
      // Our function should use getPerSiteEnabled to determine the per-site value,
      // not look directly at perSiteOverrides.
      mockSettings({
        interceptionEnabled: true,
        perSiteOverrides: {},
      });
      mockPerSiteValue(true);

      const result = await isInterceptionEnabled('https://anything.com/f');

      expect(result).toBe(true);
      expect(mockLocalStore.getPerSiteEnabled).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// setInterceptionEnabled
// ============================================================================
describe('setInterceptionEnabled', () => {
  it('calls LocalStore.setPerSiteEnabled with the origin extracted from the URL', async () => {
    // Arrange
    mockLocalStore.setPerSiteEnabled.mockResolvedValue(undefined);

    // Act
    await setInterceptionEnabled('https://example.com/path/to/file', false);

    // Assert
    expect(mockLocalStore.setPerSiteEnabled).toHaveBeenCalledWith(
      'https://example.com',
      false,
    );
  });

  it('calls LocalStore.setPerSiteEnabled with true when enabling a site', async () => {
    // Arrange
    mockLocalStore.setPerSiteEnabled.mockResolvedValue(undefined);

    // Act
    await setInterceptionEnabled('https://example.com', true);

    // Assert
    expect(mockLocalStore.setPerSiteEnabled).toHaveBeenCalledWith(
      'https://example.com',
      true,
    );
  });

  it('extracts origin from URLs with non-standard ports', async () => {
    // Arrange
    mockLocalStore.setPerSiteEnabled.mockResolvedValue(undefined);

    // Act
    await setInterceptionEnabled('http://localhost:3000/download?id=1', true);

    // Assert
    expect(mockLocalStore.setPerSiteEnabled).toHaveBeenCalledWith(
      'http://localhost:3000',
      true,
    );
  });
});

// ============================================================================
// isGloballyEnabled
// ============================================================================
describe('isGloballyEnabled', () => {
  it('returns true when settings.interceptionEnabled is true', async () => {
    // Arrange
    mockSettings({ interceptionEnabled: true });

    // Act
    const result = await isGloballyEnabled();

    // Assert
    expect(result).toBe(true);
  });

  it('returns false when settings.interceptionEnabled is false', async () => {
    // Arrange
    mockSettings({ interceptionEnabled: false });

    // Act
    const result = await isGloballyEnabled();

    // Assert
    expect(result).toBe(false);
  });

  it('reads from getSettings each time it is called', async () => {
    // Arrange
    mockSettings({ interceptionEnabled: true });

    // Act
    await isGloballyEnabled();

    // Assert
    expect(mockLocalStore.getSettings).toHaveBeenCalledTimes(1);
  });
});
