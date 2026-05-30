import type { Brand } from '@studio/core/brand'
import { HermesWorkspaceHome } from './WorkspaceHome'

export const brand: Brand = {
  id: 'hermes',
  appTitle: 'Hermes Studio',
  legalName: 'Hermes Studio',
  description:
    'Hermes Studio — AI agent workspace with chat, files, terminal, memory, and skills.',
  logo: '/hermes-crest.svg',
  iconHref: '/hermes-crest.svg',
  themes: [
    'hermes-official',
    'hermes-official-light',
    'hermes-classic',
    'hermes-slate',
    'hermes-mono',
  ],
  defaultTheme: 'hermes-official',
  loadingQuips: [
    'Consulting the oracle…',
    'Loading ancient knowledge…',
    'Warming up the messenger…',
    'Calibrating tool chain…',
    'Summoning Hermes…',
    'Preparing the workspace…',
    'Bridging realms…',
    'Initializing agent runtime…',
  ],
  // Hermes does not show the MBSE (Coverage/Traceability/FMEA) tools.
  showMbseTools: false,
  WorkspaceHome: HermesWorkspaceHome,
}
