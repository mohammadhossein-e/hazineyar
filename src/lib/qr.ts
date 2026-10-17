import QRCode from "qrcode";

/**
 * Renders a QR code as an inline `data:` URL, for embedding in an `<img>`.
 *
 * Server-only: `qrcode` is a Node library, so this must not be imported into a
 * client component. SVG is used rather than PNG because it stays crisp when the
 * onboarding card is printed, and a data URL avoids shipping the drawing code
 * (or `dangerouslySetInnerHTML`) to the browser.
 */
export async function qrCodeDataUrl(text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
