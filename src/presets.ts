/**
 * Platform presets. All layout metrics live here, never inline in render code.
 * Dimensions follow current store upload requirements:
 * - App Store iPhone 6.9" display: 1320x2868
 * - Google Play phone: 1080x1920 (16:9 minimum standard)
 * - App Store iPad Pro 13": 2064x2752
 * - Google Play 10" tablet: 1600x2560
 */

export interface DeviceStyle {
  /** Bezel thickness around the screen, as a ratio of device width. */
  bezelRatio: number;
  /** Outer body corner radius, as a ratio of device width. */
  bodyRadiusRatio: number;
  /** Screen corner radius, as a ratio of device width. */
  screenRadiusRatio: number;
  /** Camera cutout: iPhone pill (dynamic island) or Android punch hole. */
  cutout: "island" | "punch" | "none";
}

export interface Preset {
  id: string;
  store: "app-store" | "google-play";
  label: string;
  width: number;
  height: number;
  /**
   * portrait: centered headline on top, device below (store screenshots).
   * landscape: left-aligned headline vertically centered, device on the right
   * (Play Store feature graphic).
   */
  layout: "portrait" | "landscape";
  /**
   * Screen height as a multiple of screen width. Defaults to height/width of
   * the canvas; landscape presets must set it to a phone screen ratio.
   */
  screenAspect?: number;
  /** Device outer width as a ratio of canvas width. */
  deviceWidthRatio: number;
  /** Device top edge as a ratio of canvas height. */
  deviceTopRatio: number;
  /** Device left edge as a ratio of canvas width (landscape only). */
  deviceLeftRatio?: number;
  /** Headline block top as a ratio of canvas height (portrait only). */
  textTopRatio: number;
  /** Max headline width as a ratio of canvas width. */
  textMaxWidthRatio: number;
  /** Starting font size for the verb line, in px. */
  verbFontPx: number;
  /** Starting font size for the descriptor line, in px. */
  descFontPx: number;
  device: DeviceStyle;
}

const PHONE_STYLE: DeviceStyle = {
  bezelRatio: 0.022,
  bodyRadiusRatio: 0.16,
  screenRadiusRatio: 0.14,
  cutout: "island",
};

const ANDROID_PHONE_STYLE: DeviceStyle = {
  bezelRatio: 0.022,
  bodyRadiusRatio: 0.12,
  screenRadiusRatio: 0.1,
  cutout: "punch",
};

const TABLET_STYLE: DeviceStyle = {
  bezelRatio: 0.03,
  bodyRadiusRatio: 0.06,
  screenRadiusRatio: 0.04,
  cutout: "none",
};

export const PRESETS: Record<string, Preset> = {
  "ios-phone": {
    id: "ios-phone",
    store: "app-store",
    label: 'App Store, iPhone 6.9"',
    layout: "portrait",
    width: 1320,
    height: 2868,
    deviceWidthRatio: 0.78,
    deviceTopRatio: 0.3,
    textTopRatio: 0.055,
    textMaxWidthRatio: 0.86,
    verbFontPx: 170,
    descFontPx: 92,
    device: PHONE_STYLE,
  },
  "android-phone": {
    id: "android-phone",
    store: "google-play",
    label: "Google Play, phone",
    layout: "portrait",
    width: 1080,
    height: 1920,
    deviceWidthRatio: 0.72,
    deviceTopRatio: 0.32,
    textTopRatio: 0.06,
    textMaxWidthRatio: 0.86,
    verbFontPx: 130,
    descFontPx: 72,
    device: ANDROID_PHONE_STYLE,
  },
  "ipad-13": {
    id: "ipad-13",
    store: "app-store",
    label: 'App Store, iPad Pro 13"',
    layout: "portrait",
    width: 2064,
    height: 2752,
    deviceWidthRatio: 0.82,
    deviceTopRatio: 0.34,
    textTopRatio: 0.06,
    textMaxWidthRatio: 0.86,
    verbFontPx: 230,
    descFontPx: 120,
    device: TABLET_STYLE,
  },
  "android-tablet": {
    id: "android-tablet",
    store: "google-play",
    label: 'Google Play, 10" tablet',
    layout: "portrait",
    width: 1600,
    height: 2560,
    deviceWidthRatio: 0.78,
    deviceTopRatio: 0.33,
    textTopRatio: 0.06,
    textMaxWidthRatio: 0.86,
    verbFontPx: 180,
    descFontPx: 96,
    device: TABLET_STYLE,
  },
  "play-feature-graphic": {
    id: "play-feature-graphic",
    store: "google-play",
    label: "Google Play, feature graphic",
    layout: "landscape",
    width: 1024,
    height: 500,
    screenAspect: 1920 / 1080,
    deviceWidthRatio: 0.3,
    deviceTopRatio: 0.14,
    deviceLeftRatio: 0.64,
    textTopRatio: 0,
    textMaxWidthRatio: 0.52,
    verbFontPx: 88,
    descFontPx: 44,
    device: ANDROID_PHONE_STYLE,
  },
};

export function getPreset(id: string): Preset {
  const preset = PRESETS[id];
  if (!preset) {
    const known = Object.keys(PRESETS).join(", ");
    throw new Error(`Unknown preset "${id}". Valid presets: ${known}`);
  }
  return preset;
}
