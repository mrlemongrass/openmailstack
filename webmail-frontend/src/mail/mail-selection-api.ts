export interface MailSelection { token: string; count: number; completed: number; state: 'ready' | 'complete' | 'cancelled' | 'uncertain'; allJunk: boolean; includesTrash: boolean; error?: string; confirmedBatch?: { folder: string; uids: number[] } }
export async function selectionRequest(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<MailSelection> {
  const response = await fetch(`/api/messages/selection${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Selection could not be confirmed.');
  return data;
}
