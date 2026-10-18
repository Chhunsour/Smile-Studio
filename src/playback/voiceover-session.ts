/** Keep navigation from discarding an in-flight native take before it has been imported and saved. */
interface VoiceoverSession { pending(): boolean; finish(): Promise<void> }
const sessions = new Set<VoiceoverSession>();
let finishing: Promise<void> | null = null;
export function registerVoiceoverSession(session: VoiceoverSession): () => void {
  sessions.add(session);
  return () => { sessions.delete(session); };
}
export function hasPendingVoiceover(): boolean { return [...sessions].some(session => session.pending()); }
export function finishVoiceovers(): Promise<void> {
  if (finishing) return finishing;
  const operation = (async () => {
    // A new take may start while another panel's native recording is still importing.
    // Re-read the registry after every batch so navigation cannot overtake that newer take.
    for (;;) {
      const pending = [...sessions].filter(session => session.pending());
      if (!pending.length) return;
      await Promise.all(pending.map(session => session.finish()));
    }
  })();
  finishing = operation;
  void operation.finally(() => { if (finishing === operation) finishing = null; }).catch(() => {});
  return operation;
}
