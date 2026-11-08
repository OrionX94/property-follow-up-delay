import { z } from "zod";
import { InfraiClient } from "./infrai_client.ts";

const delayedJobSchema = z.object({
  followUpId: z.string().min(1),
  propertyId: z.string().min(1),
  kind: z.enum(["maintenance_request", "tenant_document", "inspection_reminder"]),
  executeAt: z.string().datetime(),
  request: z.unknown(),
});

const infrai = new InfraiClient();

async function performPropertyAction(job: z.infer<typeof delayedJobSchema>): Promise<void> {
  console.log("follow-up completed", job.followUpId, job.kind);
}

export async function runDueFollowUps(now = new Date()): Promise<number> {
  const batch = await infrai.queue.consume(10, 3_600);
  let completed = 0;

  for (const message of batch.messages ?? []) {
    const parsed = delayedJobSchema.safeParse(message.payload);
    if (!parsed.success || Date.parse(parsed.data.executeAt) > now.getTime()) continue;

    try {
      await performPropertyAction(parsed.data);
      await infrai.queue.ack(message.message_id);
      completed += 1;
    } catch (error) {
      const exception = {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context: { followUpId: parsed.data.followUpId, kind: parsed.data.kind },
      };
      await infrai.errors.capture(exception, `follow-up-error:${parsed.data.followUpId}`);
      throw error;
    }
  }
  return completed;
}

runDueFollowUps()
  .then((completed) => console.log("due follow-ups completed", completed))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
