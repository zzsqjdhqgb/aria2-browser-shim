import { LocalStore } from './storage';

/**
 * Returns whether Aria2 interception is enabled for the given URL.
 *
 * Logic:
 *  1. If global interception is enabled, return the per-site value
 *     (true by default via getPerSiteEnabled).
 *  2. If global interception is disabled, return true only when
 *     the site is explicitly opted in (present in perSiteOverrides
 *     and set to true).
 */
export async function isInterceptionEnabled(url: string): Promise<boolean> {
  const origin = new URL(url).origin;
  const settings = await LocalStore.getSettings();
  const perSite = await LocalStore.getPerSiteEnabled(origin);

  if (settings.interceptionEnabled) {
    return perSite;
  }

  // Global is disabled — only return true if the site was explicitly opted in
  const isExplicitlySet = origin in settings.perSiteOverrides;
  return isExplicitlySet && perSite === true;
}

/**
 * Sets whether interception is enabled for the origin extracted from the URL.
 */
export async function setInterceptionEnabled(url: string, enabled: boolean): Promise<void> {
  const origin = new URL(url).origin;
  await LocalStore.setPerSiteEnabled(origin, enabled);
}

/**
 * Returns whether global interception is enabled in settings.
 */
export async function isGloballyEnabled(): Promise<boolean> {
  const settings = await LocalStore.getSettings();
  return settings.interceptionEnabled;
}
