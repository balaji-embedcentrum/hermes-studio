/**
 * CodeMirrorEditor — re-export from @sylang/code-editor.
 *
 * The actual CodeMirror 6 setup now lives in sylang-core so all hosts
 * share one implementation. This file is kept so the existing
 * `import { CodeMirrorEditor } from '@/components/code-editor/CodeMirrorEditor'`
 * call sites in src/routes/files.tsx don't need to change.
 */
export { CodeMirrorEditor } from '@sylang/code-editor'
