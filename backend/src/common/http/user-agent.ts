export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export interface ClientDescription {
  deviceType: DeviceType;
  browser: string;
  os: string;
  /** Crawlers, link previews and HTTP libraries (not counted as visits). */
  bot: boolean;
}

const BOT =
  /bot\b|crawl|spider|slurp|preview|headless|curl\/|wget\/|python-requests|axios\/|node-fetch|go-http-client/i;

/** Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari". */
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows NT/, 'Windows'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

/**
 * Coarse description of a browser from its User-Agent header (for analytics and session
 * lists; never used for security decisions). Unknown values are "Other".
 */
export function describeUserAgent(userAgent: string | null | undefined): ClientDescription {
  const ua = userAgent ?? '';
  const bot = ua === '' || BOT.test(ua);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? 'Other';
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? 'Other';
  const deviceType: DeviceType = /iPad|Tablet|Android(?!.*Mobile)/.test(ua)
    ? 'tablet'
    : /Mobi|iPhone|iPod|Android.*Mobile/.test(ua)
      ? 'mobile'
      : 'desktop';
  return { deviceType, browser, os, bot };
}
