import type { Brand } from '@studio/core/brand'
import { SylangWorkspaceHome } from './WorkspaceHome'

export const brand: Brand = {
  id: 'sylang',
  appTitle: 'Sylang Studio',
  legalName: 'Sylang Studio',
  description:
    'Sylang Studio — browser IDE for Model-Based Systems Engineering, with AI assist.',
  logo: '/sylang-logo.svg',
  iconHref: '/sylang-logo.svg',
  themes: [
    'sylang-studio-light',
    'sylang-studio',
    'hermes-official',
    'hermes-official-light',
    'hermes-classic',
    'hermes-slate',
    'hermes-mono',
  ],
  defaultTheme: 'sylang-studio-light',
  loadingQuips: [
    'Parsing your model…',
    'Loading the symbol graph…',
    'Warming up the messenger…',
    'Calibrating tool chain…',
    'Aligning variants…',
    'Preparing the workspace…',
    'Bridging realms…',
    'Initializing agent runtime…',
  ],
  // Sylang shows the MBSE (Coverage/Traceability/FMEA) tools.
  showMbseTools: true,
  WorkspaceHome: SylangWorkspaceHome,
}
