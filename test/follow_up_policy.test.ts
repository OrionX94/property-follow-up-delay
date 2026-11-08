import assert from "node:assert/strict";
import test from "node:test";
import { buildDelayedFollowUp, followUpRequestSchema } from "../src/follow_up_policy.ts";

test("an urgent maintenance request is followed up one hour later", () => {
  const request = followUpRequestSchema.parse({
    kind: "maintenance_request",
    propertyId: "property-17",
    requestId: "repair-42",
    urgency: "urgent",
  });

  const job = buildDelayedFollowUp(request, new Date("2026-04-08T09:00:00.000Z"));

  assert.equal(job.followUpId, "maintenance:repair-42");
  assert.equal(job.executeAt, "2026-04-08T10:00:00.000Z");
  assert.equal(job.propertyId, "property-17");
});

test("tenant documents and inspections use their privacy-safe identifiers", () => {
  const document = followUpRequestSchema.parse({
    kind: "tenant_document",
    propertyId: "property-17",
    documentId: "document-8",
    documentType: "insurance",
  });
  const inspection = followUpRequestSchema.parse({
    kind: "inspection_reminder",
    propertyId: "property-17",
    inspectionId: "inspection-3",
  });

  assert.equal(buildDelayedFollowUp(document, new Date(0)).executeAt, "1970-01-02T00:00:00.000Z");
  assert.equal(buildDelayedFollowUp(inspection, new Date(0)).executeAt, "1970-01-03T00:00:00.000Z");
});
