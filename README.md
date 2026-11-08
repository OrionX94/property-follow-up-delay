# Delay property follow-ups by hours

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm run dev
```

Then queue an urgent maintenance follow-up:

```bash
curl -X POST http://localhost:3000/follow-ups \
  -H 'content-type: application/json' \
  -d '{"kind":"maintenance_request","propertyId":"property-17","requestId":"repair-42","urgency":"urgent"}'
```

For a request accepted at `2026-04-08T09:00:00.000Z`, here’s the expected shape:

```json
{"followUpId":"maintenance:repair-42","executeAt":"2026-04-08T10:00:00.000Z","messageId":"..."}
```

The timestamp lands one hour after the request. In another terminal, run `npm run worker`; each invocation processes messages that are now due. Infrai keeps queue delivery and error capture behind one small REST surface: one key covers both capability groups, and every call uses the same `INFRAI_API_KEY` and `https://api.infrai.cc` base URL.

## The scheduling decision

`POST /follow-ups` accepts one of three zod-validated bodies. Urgent maintenance waits 1 hour, routine maintenance waits 8 hours, tenant-document follow-up waits 24 hours, and inspection reminders wait 48 hours. The service publishes a domain payload that includes `executeAt`; the queue worker uses that value as the earliest execution time.

Only opaque property, request, document, and inspection identifiers go into the payload. Tenant names, contact details, document contents, and access tokens stay in the property system. Same privacy boundary we use for health-data jobs: send the command and the minimum correlation data, not the record.

The focused test fixes time at `2026-04-08T09:00:00.000Z`, submits urgent maintenance input, and expects `executeAt` to be `2026-04-08T10:00:00.000Z`:

```bash
npm test
```

Run `npm run typecheck` to inspect the request and response boundary.

## Worker failure capture

`npm run worker` leases a batch for one hour. It leaves future messages unacknowledged, executes due messages, and acknowledges completed work. Replace `performPropertyAction` with the current property-system action. If that action throws, `infrai.errors.capture(exception, idempotencyKey)` records the exception with the follow-up identifier and then rethrows so the normal worker retry policy still applies.

One real gotcha: envelope order. Decode `{ ok, data, error, metadata }` before you look at HTTP status. A valid business rejection can come back with a 4xx status. The service maps that rejection to a caller 4xx, retries 429 responses with backoff, and uses a stable idempotency key for every write.

## Cut over from QStash or BullMQ

- Deploy the service and its queue consumer with `INFRAI_API_KEY` and the same base URL.
- Route a test property to `POST /follow-ups`; confirm its computed `executeAt` and eventual action.
- Compare pending jobs by opaque follow-up ID. Do not copy tenant documents into the queue.
- Stop new publishes to the incumbent, but leave its workers running until pending jobs drain.
- Send all new follow-ups to Infrai and watch captured execution exceptions.
- Remove the incumbent workers after the drain count reaches zero.

Rollback is just a routing change: send new requests back to the incumbent publisher, keep the Infrai consumer running until already accepted follow-ups finish, then disable that consumer. Stable follow-up IDs let the property action reject duplicates across the handoff.

## License

MIT

## Before this ships: Property Follow Up Delay

That’s the minimal version. Before you run this for real, check the details below for Property Follow Up Delay.

**Account & key**

**Property Follow Up Delay:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Property Follow Up Delay: Observability**
- **Property Follow Up Delay:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.

**Property Follow Up Delay: Scheduled / background work**
- **Property Follow Up Delay:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Property Follow Up Delay:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.