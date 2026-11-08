import { createServer, type ServerResponse } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.ts";
import { buildDelayedFollowUp, followUpRequestSchema } from "./follow_up_policy.ts";

const infrai = new InfraiClient();

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/follow-ups") {
    send(response, 404, { error: "route_not_found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = followUpRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      send(response, 400, { error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const job = buildDelayedFollowUp(parsed.data, new Date());
    const published = await infrai.queue.publish(job, `follow-up:${job.followUpId}:${job.executeAt}`);
    send(response, 202, {
      followUpId: job.followUpId,
      executeAt: job.executeAt,
      messageId: published.message_id ?? null,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_json" });
      return;
    }
    if (error instanceof InfraiError && error.status < 500) {
      send(response, error.status, { error: error.code, message: error.message });
      return;
    }
    send(response, 502, { error: "upstream_request_failed" });
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`property follow-up service listening on http://localhost:${process.env.PORT ?? 3000}`);
});
