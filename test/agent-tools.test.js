import assert from "node:assert/strict";
import test from "node:test";

import { getAgentToolPolicy, requireAgentPermission } from "../src/server/agent-tools.js";

test("allows agent read tools and blocks direct trading execution", () => {
  assert.equal(getAgentToolPolicy("market.read").permission, "ALLOW");
  assert.equal(getAgentToolPolicy("order.execute").permission, "DENY");
});

test("requires confirmation for agent order drafts", () => {
  const policy = requireAgentPermission("order.draft");

  assert.equal(policy.permission, "CONFIRM");
  assert.equal(policy.requiresHumanConfirmation, true);
});
