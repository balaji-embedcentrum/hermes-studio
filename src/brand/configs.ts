import type { Brand } from './types'

const HERMES_THEMES = [
  'hermes-official',
  'hermes-official-light',
  'hermes-classic',
  'hermes-classic-light',
  'hermes-slate',
  'hermes-slate-light',
  'hermes-mono',
  'hermes-mono-light',
]

export const sylangBrand: Brand = {
  id: 'sylang',
  appTitle: 'Sylang Studio',
  description:
    'Sylang Studio — browser IDE for Model-Based Systems Engineering, with AI assist.',
  logo: '/sylang-logo.svg',
  loadingTagline: 'Model-Based Systems Engineering, in the browser',
  loadingQuips: [
    'Parsing your model...',
    'Loading the symbol graph...',
    'Warming up the messenger...',
    'Calibrating tool chain...',
    'Aligning variants...',
    'Preparing the workspace...',
    'Bridging realms...',
    'Initializing agent runtime...',
  ],
  // Sylang keeps the full set (its editorial themes first, then the hermes set).
  themes: ['sylang-studio', 'sylang-studio-light', ...HERMES_THEMES],
  defaultTheme: 'sylang-studio-light',
  showMbseTools: true,
}

export const hermesBrand: Brand = {
  id: 'hermes',
  appTitle: 'Hermes Studio',
  description:
    'Hermes Studio — AI agent workspace with chat, files, terminal, memory, and skills.',
  logo: '/hermes-crest.svg',
  loadingTagline: 'AI Agent Workspace',
  loadingQuips: [
    'Consulting the oracle...',
    'Loading ancient knowledge...',
    'Warming up the messenger...',
    'Calibrating tool chain...',
    'Summoning Hermes...',
    'Preparing the workspace...',
    'Bridging realms...',
    'Initializing agent runtime...',
  ],
  themes: HERMES_THEMES,
  defaultTheme: 'hermes-official',
  showMbseTools: false,
}

/**
 * Sample Studio — a complete reference brand. It isn't shipped as a product;
 * it exists so you can see (and copy) a full, working brand end to end. Build
 * it with `VITE_BRAND=sample pnpm build` (or `pnpm dev:sample`). To make your
 * own studio, copy this block, rename it, swap the identity + themes (declared
 * as `[data-theme='…']` blocks in src/styles.css), and add it to ./index.ts.
 * See the "Branding" section of the README.
 */
export const sampleBrand: Brand = {
  id: 'sample',
  appTitle: 'Sample Studio',
  description:
    'Sample Studio — a reference brand showing how to skin studio-core. Copy it to build your own.',
  logo: '/sample-logo.svg',
  loadingTagline: 'A reference brand for studio-core',
  loadingQuips: [
    'Booting the sample...',
    'Loading the workspace...',
    'Warming up the agent...',
    'Preparing your editor...',
  ],
  themes: ['sample-dark', 'sample-light'],
  defaultTheme: 'sample-dark',
  showMbseTools: false,
}
