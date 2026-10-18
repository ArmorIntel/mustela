import { isExcluded } from '../shared/exclusions.js';
import { getExclusionRules } from '../storage/storage.js';

// Per-action authority: do not trust a stale result, disabled button, or only
// the caller's sourceContext. Check both the source and the actual tab/frame.
export function createDirectActionGuard(ioc, sender = {}, pageUrls = [], sourceTabId) {
  const sources = new Set([ioc?.sourceContext?.pageUrl, sender.url, sender.tab?.url, ...pageUrls].filter(Boolean));
  let tabId = sender.tab?.id ?? sourceTabId;
  let failure;
  return async function assertAllowed() {
    if (failure) throw failure;
    try {
      if (!sender.tab && chrome.tabs.query) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId ??= tab?.id;
        if (tab?.url) sources.add(tab.url);
      }
      if (tabId !== undefined && chrome.tabs.get) {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) sources.add(tab.url);
      }
      const rules = await getExclusionRules();
      const excludedIoc = isExcluded(rules, { ioc });
      const excludedPage = [...sources].some((pageUrl) => isExcluded(rules, { pageUrl }));
      if (excludedIoc || excludedPage) {
        failure = new Error(excludedIoc
          ? 'This IOC is excluded by your local exclusion rules. Remove the rule explicitly before starting a new action.'
          : 'This source page is excluded by your local exclusion rules. Remove the rule explicitly before starting a new action.');
        failure.code = 'MUSTELA_EXCLUDED';
        throw failure;
      }
    } catch (error) {
      failure ||= Object.assign(new Error(`Unable to verify local exclusion rules: ${error.message || error}. No further action is allowed.`), { code: 'MUSTELA_EXCLUSION_UNAVAILABLE' });
      throw failure;
    }
  };
}
