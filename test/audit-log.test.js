import assert from "node:assert/strict";
import test from "node:test";

import { appendAuditEvent } from "../src/server/audit-log.js";

test("appends immutable audit events with actor, action, and result", () => {
  const state = { trading: { auditLog: [] } };
  const next = appendAuditEvent(state, {
    actor: "AGENT",
    action: "ORDER_SUBMIT",
    payload: { instrumentId: "0.300750" },
    result: { status: "REQUIRES_CONFIRMATION" }
  });

  assert.equal(state.trading.auditLog.length, 0);
  assert.equal(next.trading.auditLog.length, 1);
  assert.equal(next.trading.auditLog[0].actor, "AGENT");
  assert.equal(next.trading.auditLog[0].action, "ORDER_SUBMIT");
  assert.ok(next.trading.auditLog[0].id);
  assert.ok(next.trading.auditLog[0].createdAt);
});
