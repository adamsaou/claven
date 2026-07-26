# Handoff: Claven brand & design system

## Overview
Visual identity and design system for **Claven**, an IDE built from scratch. The package covers the
logo (a cleaved square), its lockups and usage rules, the colour system including the "Claven Dark"
syntax theme, typography, spacing/radius/motion tokens, and product-chrome metrics.

Chosen direction: mark **1e** ("cleaved square") + wordmark **1aa** (wide caps) from the
exploration sheet, developed into a two-tone mark and a full system.

## About the design files
The `.dc.html` files in this bundle are **design references created in HTML** — prototypes that
show intended look and specification, not production code to copy. Recreate them in the target
codebase using its existing environment and patterns (React/Vue/Tauri/SwiftUI/native). If no
environment exists yet, pick the framework appropriate to the project and implement there.
`tokens/tokens.css` and `tokens/tokens.json` ARE meant to be used directly (or translated into
whatever token format the codebase uses). The SVGs in `assets/` are production-ready.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, and motion are final values. The logo geometry is
canonical and must be reproduced exactly — see `BRAND.md` §1 for path data.

## Views in this package
### 1. `Claven Brand.dc.html` — brand system sheet
Sections: 01 mark construction (grid + geometry + four colourways), 02 lockups/clearspace/minimum
sizes/misuse, 03 colour (brand, neutral ramp, status, syntax sample), 04 typography (three faces +
8-step scale), 05 tokens in use (radius, spacing, controls, an IDE chrome mock), 06 voice.
Layout: 1120px max-width centred column, 40px side padding, 24px grid gutters, section rule
`1px #2A2F39` with 24px padding-bottom and 40px margin-bottom, 96px between sections.

### 2. `Claven Logo.dc.html` — original exploration (archive)
27 marks across six concept families plus three wordmark voices. Kept for provenance; not needed
for implementation.

## Components to implement
Everything is specified in **`BRAND.md`** — read it as the normative document. Key items:
- **Logo component** — props: `variant` (mark | horizontal | stacked), `theme` (dark | light | mono | knockout), `size`. Renders from the SVGs in `assets/`; below 20px force mono.
- **Buttons** — primary: ember bg `#FF5A2B`, obsidian text, radius 4, padding 9px 16px, 13px/500, hover `#FF7248`, active `#C43D18`, transition `background 120ms cubic-bezier(.2,0,0,1)`. Secondary: `#1E222A` bg, 1px `#2A2F39` border, text `#E8E6E1`, hover border `#4A515E`. Ghost: transparent, text `#9AA0AA`, hover `#E8E6E1`.
- **Keycap** — mono 11px, `#1E222A` bg, 1px `#2A2F39` border with 2px bottom border, radius 4, padding 4px 7px.
- **Command input** — `#1E222A` bg, 1px ember border when focused, mono 12.5px, 1.5px ember caret.
- **App chrome** — titlebar 38px (`#16191F`, 1px bottom line), sidebar 200px (`#12151A`), status bar 26px (`#16191F`, mono 10.5px `#6B7280`), active file row `#1E222A` with a 2px ember left border, line numbers `#3A4049`.

## Design tokens
`tokens/tokens.css` (CSS custom properties) and `tokens/tokens.json` (structured, for any build
pipeline). Both are the single source of truth for colour, type, radius, spacing, and motion.

## Assets
`assets/claven-mark.svg` (primary, on dark) · `claven-mark-light.svg` · `claven-mark-mono.svg`
(uses `currentColor`) · `claven-lockup-horizontal.svg` · `claven-lockup-stacked.svg` ·
`claven-app-icon.svg` (512, radius 114) · `favicon.svg` (32).

The two lockup SVGs contain **live text** in Space Grotesk. Convert the wordmark to outlines before
shipping anywhere the font may not be present, keeping 500 weight, uppercase, +0.30em tracking.

Fonts: Space Grotesk, IBM Plex Sans, JetBrains Mono — all OFL, available from Google Fonts; self-host
in production.

## Files
- `README.md` — this file
- `BRAND.md` — normative brand + design-system specification
- `tokens/tokens.css`, `tokens/tokens.json`
- `assets/*.svg`
- `Claven Brand.dc.html` — brand sheet design reference
- `Claven Logo.dc.html` — logo exploration (archive)
- `support.js` — runtime needed to open the two .dc.html files in a browser
