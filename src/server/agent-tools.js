const AGENT_TOOL_POLICIES = {
  "market.read": {
    permission: "ALLOW",
    requiresHumanConfirmation: false,
    description: "Read quotes, watchlist, alerts, and paper account state."
  },
  "agent.briefing": {
    permission: "ALLOW",
    requiresHumanConfirmation: false,
    description: "Generate read-only market briefing with local summary or DeepSeek."
  },
  "rule.create": {
    permission: "CONFIRM",
    requiresHumanConfirmation: true,
    description: "Create watch rules after explicit user confirmation."
  },
  "order.draft": {
    permission: "CONFIRM",
    requiresHumanConfirmation: true,
    description: "Create candidate paper orders; no execution without confirmation."
  },
  "order.execute": {
    permission: "DENY",
    requiresHumanConfirmation: true,
    description: "Agent cannot directly execute orders."
  }
};

export function listAgentToolPolicies() {
  return Object.entries(AGENT_TOOL_POLICIES).map(([tool, policy]) => ({
    tool,
    ...policy
  }));
}

export function getAgentToolPolicy(tool) {
  return AGENT_TOOL_POLICIES[tool] || {
    permission: "DENY",
    requiresHumanConfirmation: true,
    description: "Unknown tools are denied by default."
  };
}

export function requireAgentPermission(tool) {
  const policy = getAgentToolPolicy(tool);
  if (policy.permission === "DENY") {
    throw new Error(`Agent tool is denied: ${tool}`);
  }
  return policy;
}
