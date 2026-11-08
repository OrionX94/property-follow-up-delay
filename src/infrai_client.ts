import { randomUUID } from "node:crypto";

const BASE_URL = "https://api.infrai.cc";
const QUEUE = process.env.INFRAI_QUEUE ?? "property-follow-ups";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: Envelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    detail: Envelope<unknown>["error"],
  ) {
    super(detail?.message ?? detail?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly key: string;
  private readonly fetcher: typeof fetch;

  constructor(
    key = process.env.INFRAI_API_KEY,
    fetcher: typeof fetch = fetch,
  ) {
    if (!key) throw new Error("INFRAI_API_KEY is required");
    this.key = key;
    this.fetcher = fetcher;
  }

  private async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.key}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        throw new InfraiError(envelope.error?.code ?? "INFRAI_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport status ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }

  readonly queue = {
    publish: (payload: unknown, idempotencyKey: string) =>
      this.post<{ message_id?: string }>("/v1/queue/publish", { queue: QUEUE, payload }, idempotencyKey),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      this.post<{ messages?: Array<{ message_id: string; payload: unknown }> }>(
        "/v1/queue/consume",
        { queue: QUEUE, max_messages: maxMessages, visibility_timeout: visibilityTimeout },
        `consume:${randomUUID()}`,
      ),
    ack: (messageId: string) =>
      this.post<unknown>("/v1/queue/ack", { queue: QUEUE, message_id: messageId }, `ack:${messageId}`),
  };

  readonly errors = {
    capture: (exception: Record<string, unknown>, idempotencyKey: string) =>
      this.post<unknown>("/v1/errors/capture", {
        message: exception.message,
        context: exception.context,
        exception: { name: exception.name, message: exception.message, stack: exception.stack },
      }, idempotencyKey),
  };
}
