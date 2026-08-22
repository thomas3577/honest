/** A per-request id, resolved via scoped() — see the README's "Request Scope" section. */
export class RequestId {
  readonly value = crypto.randomUUID();
}
