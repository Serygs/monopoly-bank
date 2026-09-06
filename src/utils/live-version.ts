/** A snapshot is authoritative. Incremental events must be contiguous or the socket is resynced. */
export function acceptsLiveVersion(lastAppliedVersion: number, stateVersion: number): boolean {
  return stateVersion === lastAppliedVersion || stateVersion === lastAppliedVersion + 1;
}
