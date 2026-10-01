import { jsonError, toErrorResponse } from "@/lib/http";
import { readInvoiceFile } from "@/lib/uploads";

type Context = { params: Promise<{ filename: string }> };

/**
 * GET /api/invoices/:filename
 * Serves a stored invoice from UPLOAD_DIR. The filename is validated against
 * path traversal before anything is read from disk.
 */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { filename } = await params;

    let decoded: string;
    try {
      decoded = decodeURIComponent(filename);
    } catch {
      // Malformed percent-escape: a broken URL, not a server fault.
      return jsonError("نام فایل نامعتبر است", "VALIDATION", 400);
    }

    const { buffer, mimeType } = await readInvoiceFile(decoded);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
