export function appendAuditEvent(state, event) {
  const trading = structuredClone(state.trading || {});
  const auditLog = trading.auditLog || [];
  const nextEvent = {
    id: crypto.randomUUID(),
    actor: String(event.actor || "SYSTEM").toUpperCase(),
    action: String(event.action || "UNKNOWN").toUpperCase(),
    payload: structuredClone(event.payload || {}),
    result: structuredClone(event.result || {}),
    createdAt: new Date().toISOString()
  };

  return {
    ...state,
    trading: {
      ...trading,
      auditLog: [nextEvent, ...auditLog].slice(0, 500)
    }
  };
}
