import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type WorkspaceState = {
  sidebarCollapsed: boolean
  fileExplorerCollapsed: boolean
  chatFocusMode: boolean
  /** Currently active sub-page route (e.g. '/skills', '/channels') — null means chat-only */
  activeSubPage: string | null
  /** Chat panel visible alongside non-chat routes */
  chatPanelOpen: boolean
  /** Session key for the chat panel (defaults to 'main') */
  chatPanelSessionKey: string
  /** Mobile keyboard / composer focus — hides tab bar */
  mobileKeyboardOpen: boolean
  mobileKeyboardInset: number
  mobileComposerFocused: boolean
  /**
   * Relative path (from WORKSPACE_ROOT) of the currently open project.
   * E.g. "2d3b924b.../balaji-embedcentrum/AutoInverter"
   * Sent to the Hermes agent so it works in the correct directory.
   */
  activeWorkspacePath: string
  /** URL of a local Hermes agent on the user's machine (e.g. http://localhost:8642). null = use remote. */
  localHermesUrl: string | null
  /** Folder on user's machine where projects are cloned/stored (local agent mode only). */
  localWorkspaceRoot: string | null
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleFileExplorer: () => void
  setFileExplorerCollapsed: (collapsed: boolean) => void
  toggleChatFocusMode: () => void
  setChatFocusMode: (enabled: boolean) => void
  setActiveSubPage: (page: string | null) => void
  toggleChatPanel: () => void
  setChatPanelOpen: (open: boolean) => void
  setChatPanelSessionKey: (key: string) => void
  setMobileKeyboardOpen: (open: boolean) => void
  setMobileKeyboardInset: (inset: number) => void
  setMobileComposerFocused: (focused: boolean) => void
  setActiveWorkspacePath: (path: string) => void
  setLocalHermesUrl: (url: string | null) => void
  setLocalWorkspaceRoot: (path: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      fileExplorerCollapsed: true,
      chatFocusMode: false,
      activeSubPage: null,
      chatPanelOpen: false,
      chatPanelSessionKey: 'main',
      mobileKeyboardOpen: false,
      mobileKeyboardInset: 0,
      mobileComposerFocused: false,
      activeWorkspacePath: '',
      localHermesUrl: null,
      localWorkspaceRoot: null,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleFileExplorer: () =>
        set((s) => ({ fileExplorerCollapsed: !s.fileExplorerCollapsed })),
      setFileExplorerCollapsed: (collapsed) =>
        set({ fileExplorerCollapsed: collapsed }),
      toggleChatFocusMode: () =>
        set((s) => ({ chatFocusMode: !s.chatFocusMode })),
      setChatFocusMode: (enabled) => set({ chatFocusMode: enabled }),
      setActiveSubPage: (page) => set({ activeSubPage: page }),
      toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
      setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
      setMobileKeyboardOpen: (open) => set({ mobileKeyboardOpen: open }),
      setMobileKeyboardInset: (inset) => set({ mobileKeyboardInset: inset }),
      setMobileComposerFocused: (focused) =>
        set({ mobileComposerFocused: focused }),
      setChatPanelSessionKey: (key) => set({ chatPanelSessionKey: key }),
      setActiveWorkspacePath: (path) => set({ activeWorkspacePath: path }),
      setLocalHermesUrl: (url) => set({ localHermesUrl: url }),
      setLocalWorkspaceRoot: (path) => set({ localWorkspaceRoot: path }),
    }),
    {
      name: 'hermes-workspace-v1',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        fileExplorerCollapsed: state.fileExplorerCollapsed,
        chatPanelOpen: state.chatPanelOpen,
        chatPanelSessionKey: state.chatPanelSessionKey,
        activeWorkspacePath: state.activeWorkspacePath,
        localHermesUrl: state.localHermesUrl,
        localWorkspaceRoot: state.localWorkspaceRoot,
      }),
    },
  ),
)
