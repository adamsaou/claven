# Claven — Brand Guide

Claven is an IDE built from scratch. The identity is **precision instrument**, not developer-lifestyle:
flat geometry, dark-first surfaces, one hot accent, no gradients, no glows, no rounded-soft UI.

## 1. Logo

### Concept
A **cleaved square** — a whole split into panes, the instant of a clean cut. It encodes the core
gesture of the product (split, diff, pane) and the name (cleave / clavis / -aven).

### Geometry (canonical, 96×96 viewBox)
| Property | Value |
|---|---|
| Square bounds | 8 → 88 on both axes (80×80) |
| Cleave direction | rise 80 / run −28 → 19.3° from vertical |
| Gap | 10 horizontal, ≈9.4 perpendicular |
| Left piece | `M8 8 H62 L34 88 H8 Z` |
| Right piece | `M72 8 H88 V88 H44 Z` |

The two cut edges are strictly parallel. Each piece retains the square's full outer vertical edge,
so the silhouette still reads as one square. Corners are never rounded.

### Colourways
| Name | Left piece | Right piece | Use |
|---|---|---|---|
| Primary on dark | `#F5F3EE` | `#FF5A2B` | default — dark UI, site, app icon |
| Primary on light | `#0F1115` | `#FF5A2B` | light theme, print, docs |
| Mono | `currentColor` | `currentColor` | ≤16px, embossing, single-colour print |
| Knockout | `#0F1115` | `#0F1115` | on an ember field |

Below 20px, always use the **mono** version — the two-tone reads as noise at small sizes.

### Wordmark
Space Grotesk **500**, **uppercase**, letter-spacing **+0.30em**, optical size ≥13px.
Add left padding equal to the tracking (0.30em) so the block stays optically centred — CSS
letter-spacing adds trailing space after the final N.
Never bold it, never lowercase it, never tighten the tracking.

### Lockups
- **Horizontal:** mark at height *x*, wordmark cap height 0.56*x*, gap 0.5*x*, optically centred (not box-centred).
- **Stacked:** mark above, wordmark below, gap 0.5*x*, both centred.
- **Mark only:** app icon, favicon, titlebar, loading states.

### Clearspace & minimums
Clearspace = 0.25*x* on all four sides. Minimum sizes: mark 24px (16px favicon with the mono
version), wordmark 13px, horizontal lockup 96px wide.

### Misuse
Never rotate, never recolour outside the four colourways, never widen or narrow the gap, never
stretch non-uniformly, never add shadow/glow/gradient, never outline the pieces, never place the
two-tone mark on a mid-tone photograph.

### App icon
512×512, corner radius 114 (22%), obsidian `#0F1115` field, mark inset 22% on all sides.

## 2. Colour

Dark-first. **Ember `#FF5A2B` is the only accent** — reserve it for the run action, the cursor,
the focused border, active file indicator, and the logo. If more than ~2% of a screen is ember,
remove some.

| Role | Hex |
|---|---|
| Ember (accent) | `#FF5A2B` |
| Ember hover | `#FF7248` |
| Ember pressed | `#C43D18` |
| Obsidian (canvas) | `#0F1115` |
| Surface 1 (chrome) | `#16191F` |
| Surface 2 (raised/input) | `#1E222A` |
| Line | `#2A2F39` |
| Text | `#E8E6E1` |
| Text muted | `#9AA0AA` |
| Text dim | `#6B7280` |
| Paper (light theme) | `#F5F3EE` |
| Success | `#5FBF7A` |
| Warning | `#F0B429` |
| Error | `#E5484D` |
| Info / link | `#5AD1E6` |

### Syntax theme — "Claven Dark"
comment `#6B7280` · keyword `#FF5A2B` · string `#5FBF7A` · number `#F0B429` ·
function `#5AD1E6` · type `#C8A2FF` · variable `#E8E6E1` · line number `#3A4049` ·
selection `#1E222A` · cursor `#FF5A2B`

## 3. Typography

Three faces, no more.

| Face | Role |
|---|---|
| **Space Grotesk** | wordmark (500 / +0.30em / caps) and display headings (600) |
| **IBM Plex Sans** | all product UI: menus, panels, labels, body copy (400/500/600) |
| **JetBrains Mono** | editor, terminal, paths, keybindings, micro-labels |

Scale: display 46/600/−0.025em · h1 34/600/−0.02em · h2 26/600/−0.01em · h3 20/600 ·
body 16/400/1.6 · ui 13/500 · code 13.5/400/1.65 · micro 10/500/+0.14em caps.

## 4. Form & motion
Tight radii (2/4/6/10px — the app icon is the only large radius). 4px spacing grid.
1px borders, no shadows in product chrome. Motion: 120ms for micro-interactions, 200ms for
panels, easing `cubic-bezier(.2,0,0,1)`. Focus = 1px ember border, never a glowing ring.
Chrome metrics: titlebar 38px, status bar 26px, sidebar 200px.

## 5. Voice
- **Terse.** "Opened 2.1 GB in 0.8s." not "We're excited to help you open large repos!"
- **Mechanical, not magical.** State what happened and how long it took. No exclamation marks, no emoji.
- **Lowercase in-product.** Commands and status read lowercase ("split editor right"); marketing headlines use sentence case.
