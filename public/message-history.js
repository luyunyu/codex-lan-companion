export function messageHistoryKey(message) {
  if (Number.isSafeInteger(message.sourceOffset)) return `file:${message.sourceOffset}:${message.role}`;
  return `live:${message.id || message.requestId || [message.role, message.kind, message.timestamp, message.content].join(":")}`;
}

export function mergeMessageHistory(previous, incoming) {
  // Live approvals/notices must expire with the latest server response.
  const retained = previous.filter((message) => Number.isSafeInteger(message.sourceOffset) && message.role !== "interaction");
  const messages = new Map(retained.map((message) => [messageHistoryKey(message), message]));
  for (const message of incoming) messages.set(messageHistoryKey(message), message);
  return [...messages.values()].sort((a, b) => {
    const time = (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0);
    return time || (a.sourceOffset ?? Number.MAX_SAFE_INTEGER) - (b.sourceOffset ?? Number.MAX_SAFE_INTEGER);
  });
}
