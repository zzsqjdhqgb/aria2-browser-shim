export interface DownloadRequest {
  url: string;
  filename?: string;
  directory?: string;
  headers?: Record<string, string>;
}

export type DownloadStatus =
  | "pending"
  | "in_progress"
  | "paused"
  | "complete"
  | "error"
  | "cancelled";

export interface DownloadTask {
  gid: string;
  browserDownloadId?: number;
  request: DownloadRequest;
  status: DownloadStatus;
  bytesReceived: number;
  totalBytes: number;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface TaskQuery {
  status?: DownloadStatus | DownloadStatus[];
  limit?: number;
  offset?: number;
}

export type TaskChangeListener = (task: DownloadTask) => void;

export interface DownloadStrategy {
  name: string;
  canHandle(req: DownloadRequest): boolean;
  execute(req: DownloadRequest, task: DownloadTask): Promise<DownloadResult>;
  cancel(task: DownloadTask): Promise<void>;
}

export interface DownloadResult {
  success: boolean;
  error?: string;
}

export interface AppSettings {
  interceptionEnabled: boolean;
  perSiteOverrides: Record<string, boolean>;
  pendingTimeoutMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  interceptionEnabled: true,
  perSiteOverrides: {},
  pendingTimeoutMs: 120_000,
};
