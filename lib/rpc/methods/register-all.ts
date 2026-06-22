import type { MethodRegistry } from '../dispatcher';
import { register as registerAddUri } from './add-uri';
import { register as registerGetVersion } from './get-version';
import { register as registerTellStatus } from './tell-status';
import { register as registerTellActive } from './tell-active';
import { register as registerTellWaiting } from './tell-waiting';
import { register as registerTellStopped } from './tell-stopped';
import { register as registerGetGlobalStat } from './get-global-stat';
import { register as registerGetFiles } from './get-files';
import { register as registerGetUris } from './get-uris';
import { register as registerPause } from './pause';
import { register as registerUnpause } from './unpause';
import { register as registerRemove } from './remove';
import { register as registerForceRemove } from './force-remove';
import { register as registerRemoveDownloadResult } from './remove-download-result';
import { register as registerPurgeDownloadResult } from './purge-download-result';
import { register as registerChangeOption } from './change-option';
import { register as registerChangeGlobalOption } from './change-global-option';
import { register as registerGetOption } from './get-option';
import { register as registerGetGlobalOption } from './get-global-option';
import { register as registerAddMetalink } from './add-metalink';
import { register as registerAddTorrent } from './add-torrent';
import { register as registerSystemMulticall } from './system-multicall';

/**
 * Registers all aria2 RPC method handlers on the given MethodRegistry instance.
 */
export function registerAll(registry: MethodRegistry): void {
  registerAddUri(registry);
  registerGetVersion(registry);
  registerTellStatus(registry);
  registerTellActive(registry);
  registerTellWaiting(registry);
  registerTellStopped(registry);
  registerGetGlobalStat(registry);
  registerGetFiles(registry);
  registerGetUris(registry);
  registerPause(registry);
  registerUnpause(registry);
  registerRemove(registry);
  registerForceRemove(registry);
  registerRemoveDownloadResult(registry);
  registerPurgeDownloadResult(registry);
  registerChangeOption(registry);
  registerChangeGlobalOption(registry);
  registerGetOption(registry);
  registerGetGlobalOption(registry);
  registerAddMetalink(registry);
  registerAddTorrent(registry);
  registerSystemMulticall(registry);
}
