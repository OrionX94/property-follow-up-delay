import { z } from "zod";

export const followUpRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("maintenance_request"),
    propertyId: z.string().min(1),
    requestId: z.string().min(1),
    urgency: z.enum(["routine", "urgent"]),
  }),
  z.object({
    kind: z.literal("tenant_document"),
    propertyId: z.string().min(1),
    documentId: z.string().min(1),
    documentType: z.enum(["insurance", "identity", "lease"]),
  }),
  z.object({
    kind: z.literal("inspection_reminder"),
    propertyId: z.string().min(1),
    inspectionId: z.string().min(1),
  }),
]);

export type FollowUpRequest = z.infer<typeof followUpRequestSchema>;

export function delayHoursFor(request: FollowUpRequest): number {
  if (request.kind === "maintenance_request") return request.urgency === "urgent" ? 1 : 8;
  if (request.kind === "tenant_document") return 24;
  return 48;
}

export function followUpIdFor(request: FollowUpRequest): string {
  if (request.kind === "maintenance_request") return `maintenance:${request.requestId}`;
  if (request.kind === "tenant_document") return `document:${request.documentId}`;
  return `inspection:${request.inspectionId}`;
}

export function buildDelayedFollowUp(request: FollowUpRequest, now: Date) {
  const delayHours = delayHoursFor(request);
  return {
    followUpId: followUpIdFor(request),
    propertyId: request.propertyId,
    kind: request.kind,
    executeAt: new Date(now.getTime() + delayHours * 60 * 60 * 1_000).toISOString(),
    request,
  };
}
