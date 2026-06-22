import { useState, useEffect, useCallback, Component } from "react";
import type { ReactNode } from "react";
import {
  MSG_GET_POPUP_STATE,
  MSG_UPDATE_SETTINGS,
} from "@/lib/message-router";

interface InfoItem {
  message: string;
  timestamp: number;
}

interface PopupState {
  activeCount: number;
  waitingCount: number;
  interceptionEnabled: boolean;
}

// ─── StatusIndicator ────────────────────────────────────────────────

interface StatusIndicatorProps {
  active: boolean;
  info: InfoItem[];
}

function StatusIndicator({ active, info }: StatusIndicatorProps) {
  return (
    <div className="status-indicator">
      <div className="status-row">
        <span className={`status-dot ${active ? "active" : "inactive"}`} />
        <span className="status-label">
          {active ? "Interception Active" : "Interception Disabled"}
        </span>
      </div>
      {info.length > 0 && (
        <div className="status-toast">
          {info[info.length - 1].message}
        </div>
      )}
    </div>
  );
}

// ─── ControlsSection ────────────────────────────────────────────────

interface ControlsSectionProps {
  interceptionEnabled: boolean;
  currentOrigin: string;
  perSiteEnabled: boolean;
  onToggleGlobal: (enabled: boolean) => void;
  onTogglePerSite: (enabled: boolean) => void;
}

function ControlsSection({
  interceptionEnabled,
  currentOrigin,
  perSiteEnabled,
  onToggleGlobal,
  onTogglePerSite,
}: ControlsSectionProps) {
  const hostname = currentOrigin
    ? new URL(currentOrigin).hostname
    : null;

  return (
    <div className="controls-section">
      <div className="control-row">
        <label className="toggle-label">Global Interception</label>
        <button
          className={`toggle-switch ${interceptionEnabled ? "on" : "off"}`}
          onClick={() => onToggleGlobal(!interceptionEnabled)}
          aria-pressed={interceptionEnabled}
          role="switch"
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="control-row">
        <label className="toggle-label">
          {hostname ? `Enable on ${hostname}` : "No active page"}
        </label>
        <button
          className={`toggle-switch ${perSiteEnabled ? "on" : "off"}`}
          onClick={() => onTogglePerSite(!perSiteEnabled)}
          aria-pressed={perSiteEnabled}
          role="switch"
          disabled={!hostname}
        >
          <span className="toggle-knob" />
        </button>
      </div>
    </div>
  );
}

// ─── StatsSection ───────────────────────────────────────────────────

interface StatsSectionProps {
  activeCount: number;
  waitingCount: number;
}

function StatsSection({ activeCount, waitingCount }: StatsSectionProps) {
  return (
    <div className="stats-section">
      <div className="stat-item">
        <span className="stat-value">{activeCount}</span>
        <span className="stat-label">Active</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{waitingCount}</span>
        <span className="stat-label">Waiting</span>
      </div>
    </div>
  );
}

// ─── ErrorBoundary ──────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <p>Something went wrong.</p>
          <p className="error-detail">{this.state.errorMessage}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── App ────────────────────────────────────────────────────────────

function App() {
  const [popupState, setPopupState] = useState<PopupState>({
    activeCount: 0,
    waitingCount: 0,
    interceptionEnabled: false,
  });
  const [currentOrigin, setCurrentOrigin] = useState<string>("");
  const [perSiteEnabled, setPerSiteEnabled] = useState<boolean>(false);
  const [info, setInfo] = useState<InfoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const addInfo = useCallback((message: string) => {
    const item: InfoItem = { message, timestamp: Date.now() };
    setInfo((prev) => [...prev.slice(-4), item]);
    setTimeout(() => {
      setInfo((prev) => prev.filter((i) => i.timestamp !== item.timestamp));
    }, 2000);
  }, []);

  // Fetch popup state on mount
  useEffect(() => {
    async function fetchState() {
      try {
        const state = (await browser.runtime.sendMessage({
          type: MSG_GET_POPUP_STATE,
        })) as PopupState;
        setPopupState(state);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addInfo(`Failed to load state: ${message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchState();
  }, [addInfo]);

  // Get current tab origin on mount
  useEffect(() => {
    async function fetchTabOrigin() {
      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs[0]?.url) {
          setCurrentOrigin(tabs[0].url);
        }
      } catch {
        // Silently ignore tab query errors
      }
    }

    fetchTabOrigin();
  }, []);

  const handleToggleGlobal = useCallback(
    async (enabled: boolean) => {
      try {
        await browser.runtime.sendMessage({
          type: MSG_UPDATE_SETTINGS,
          payload: { interceptionEnabled: enabled },
        });
        setPopupState((prev) => ({ ...prev, interceptionEnabled: enabled }));
        addInfo(enabled ? "Interception enabled globally" : "Interception disabled globally");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addInfo(`Error: ${message}`);
      }
    },
    [addInfo],
  );

  const handleTogglePerSite = useCallback(
    async (enabled: boolean) => {
      try {
        setPerSiteEnabled(enabled);
        addInfo(
          enabled
            ? "Per-site interception enabled"
            : "Per-site interception disabled",
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        addInfo(`Error: ${message}`);
      }
    },
    [addInfo],
  );

  const handleOpenAriaNg = useCallback(() => {
    browser.tabs.create({
      url: browser.runtime.getURL("/ariang/index.html" as Parameters<typeof browser.runtime.getURL>[0]),
    });
  }, []);

  if (loading) {
    return (
      <div className="popup loading">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="popup">
        <StatusIndicator active={popupState.interceptionEnabled} info={info} />

        <ControlsSection
          interceptionEnabled={popupState.interceptionEnabled}
          currentOrigin={currentOrigin}
          perSiteEnabled={perSiteEnabled}
          onToggleGlobal={handleToggleGlobal}
          onTogglePerSite={handleTogglePerSite}
        />

        <StatsSection
          activeCount={popupState.activeCount}
          waitingCount={popupState.waitingCount}
        />

        <button className="ariang-button" onClick={handleOpenAriaNg}>
          Open AriaNg Dashboard
        </button>
      </div>
    </ErrorBoundary>
  );
}

export { App };
