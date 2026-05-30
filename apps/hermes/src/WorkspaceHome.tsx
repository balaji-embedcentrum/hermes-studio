/**
 * Hermes Studio's workspace home — the view shown in the editor area when no
 * file is selected. The shared files screen renders `useBrand().WorkspaceHome`.
 *
 * SCAFFOLD STUB: during Phase 1/2, move Hermes's existing home content here.
 * Hermes does NOT include the MBSE Quick-Action cards (Coverage/Traceability/
 * FMEA) — those live in the Sylang home.
 */
export function HermesWorkspaceHome() {
  return (
    <div className="flex h-full items-center justify-center text-ink/60">
      <p>Hermes Studio — select a file to start, or open the chat.</p>
    </div>
  )
}
