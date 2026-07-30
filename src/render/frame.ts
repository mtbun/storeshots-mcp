import sharp from "sharp";
import type { Preset } from "../presets.js";

export interface FramedDevice {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * A user-supplied device frame: a transparent PNG whose screen area is a
 * rectangle in the frame image's own pixel space. The screenshot is placed
 * into that rectangle and the frame is drawn on top, so bezels, notches, and
 * rounded corners come from the frame art rather than the built-in renderer.
 */
export interface CustomFrame {
  image: string;
  screenX: number;
  screenY: number;
  screenWidth: number;
  screenHeight: number;
}

/**
 * Composites a screenshot into a custom frame PNG, then scales the result so
 * its width matches the preset's device width (aspect ratio preserved).
 */
export async function renderCustomDevice(
  preset: Preset,
  screenshotPath: string,
  frame: CustomFrame,
): Promise<FramedDevice> {
  let frameMeta: sharp.Metadata;
  try {
    frameMeta = await sharp(frame.image).metadata();
  } catch (err) {
    throw new Error(
      `Could not read frame image "${frame.image}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const frameW = frameMeta.width ?? 0;
  const frameH = frameMeta.height ?? 0;
  if (
    frame.screenX < 0 ||
    frame.screenY < 0 ||
    frame.screenX + frame.screenWidth > frameW ||
    frame.screenY + frame.screenHeight > frameH
  ) {
    throw new Error(
      `Screen rectangle (${frame.screenX},${frame.screenY} ${frame.screenWidth}x${frame.screenHeight}) ` +
        `falls outside the ${frameW}x${frameH} frame image.`,
    );
  }

  let screenshot: Buffer;
  try {
    screenshot = await sharp(screenshotPath)
      .resize(frame.screenWidth, frame.screenHeight, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
  } catch (err) {
    throw new Error(
      `Could not read screenshot "${screenshotPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Screenshot first (into the screen rect), frame art on top.
  const composited = await sharp({
    create: { width: frameW, height: frameH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: screenshot, left: frame.screenX, top: frame.screenY },
      { input: frame.image },
    ])
    .png()
    .toBuffer();

  const targetW = Math.round(preset.width * preset.deviceWidthRatio);
  const targetH = Math.round(targetW * (frameH / frameW));
  const buffer = await sharp(composited).resize(targetW, targetH).png().toBuffer();
  return { buffer, width: targetW, height: targetH };
}

/**
 * Renders the device (body, screen content, camera cutout) as one image.
 * Frames are drawn programmatically as SVG, no binary frame assets.
 * The screen aspect ratio equals the preset canvas aspect ratio, because
 * store screenshots are full-screen captures of that device class.
 */
export async function renderDevice(preset: Preset, screenshotPath: string): Promise<FramedDevice> {
  const { device } = preset;
  const deviceW = Math.round(preset.width * preset.deviceWidthRatio);
  const bezel = Math.round(deviceW * device.bezelRatio);
  const screenW = deviceW - bezel * 2;
  const screenH = Math.round(screenW * (preset.screenAspect ?? preset.height / preset.width));
  const deviceH = screenH + bezel * 2;
  const bodyRadius = Math.round(deviceW * device.bodyRadiusRatio);
  const screenRadius = Math.round(deviceW * device.screenRadiusRatio);

  // Device body: dark slab with a subtle metallic edge.
  const bodySvg = `<svg width="${deviceW}" height="${deviceH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${deviceW}" height="${deviceH}" rx="${bodyRadius}" fill="#0b0b0d"/>
  <rect x="1.5" y="1.5" width="${deviceW - 3}" height="${deviceH - 3}" rx="${bodyRadius - 1}"
        fill="none" stroke="#4a4a52" stroke-width="3"/>
</svg>`;

  // Screenshot, cover-fitted to the screen area with rounded corners.
  let screenshot: Buffer;
  try {
    screenshot = await sharp(screenshotPath)
      .resize(screenW, screenH, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
  } catch (err) {
    throw new Error(
      `Could not read screenshot "${screenshotPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const maskSvg = `<svg width="${screenW}" height="${screenH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${screenW}" height="${screenH}" rx="${screenRadius}" fill="#fff"/>
</svg>`;
  const roundedScreenshot = await sharp(screenshot)
    .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
    .png()
    .toBuffer();

  const overlays: sharp.OverlayOptions[] = [
    { input: roundedScreenshot, left: bezel, top: bezel },
  ];

  // Camera cutout on top of the screen content.
  if (device.cutout === "island") {
    const islandW = Math.round(screenW * 0.3);
    const islandH = Math.round(screenW * 0.085);
    const islandSvg = `<svg width="${islandW}" height="${islandH}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${islandW}" height="${islandH}" rx="${Math.round(islandH / 2)}" fill="#0b0b0d"/>
</svg>`;
    overlays.push({
      input: Buffer.from(islandSvg),
      left: Math.round((deviceW - islandW) / 2),
      top: bezel + Math.round(screenW * 0.04),
    });
  } else if (device.cutout === "punch") {
    const r = Math.round(screenW * 0.022);
    const punchSvg = `<svg width="${r * 2}" height="${r * 2}" xmlns="http://www.w3.org/2000/svg">
  <circle cx="${r}" cy="${r}" r="${r}" fill="#0b0b0d"/>
</svg>`;
    overlays.push({
      input: Buffer.from(punchSvg),
      left: Math.round(deviceW / 2 - r),
      top: bezel + Math.round(screenW * 0.035),
    });
  }

  const buffer = await sharp(Buffer.from(bodySvg)).composite(overlays).png().toBuffer();
  return { buffer, width: deviceW, height: deviceH };
}
