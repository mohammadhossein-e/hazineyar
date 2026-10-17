import type { AccessRequest } from "@prisma/client";
import { formatJalali } from "@/lib/jalali";
import { channelLabel } from "../channels";

const STATUS_LABELS = {
  PENDING: "در انتظار",
  APPROVED: "تاییدشده",
  REJECTED: "ردشده",
} as const;

export type PresentedAccessRequest = ReturnType<typeof presentAccessRequest>;

/**
 * Keeps API/JSON responses and the dashboard from having to know the enum.
 * Nothing here escapes the display name: React escapes it at render time,
 * which is the only place it becomes HTML.
 */
export function presentAccessRequest(request: AccessRequest) {
  return {
    id: request.id,
    channel: request.channel,
    channelLabel: channelLabel(request.channel),
    externalId: request.externalId,
    displayName: request.displayName,
    username: request.username,
    status: request.status,
    statusLabel: STATUS_LABELS[request.status],
    createdAt: request.createdAt.toISOString(),
    createdAtJalali: formatJalali(request.createdAt),
    decidedAt: request.decidedAt?.toISOString() ?? null,
  };
}

export function presentAccessRequests(requests: AccessRequest[]) {
  return requests.map(presentAccessRequest);
}
