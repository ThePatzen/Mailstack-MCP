---
name: Mailstack MCP
description: A calm, clear control surface for personal mailbox access.
colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  ground: "#f5f7fa"
  surface: "#ffffff"
  ink: "#182338"
  muted: "#778397"
  line: "#e5e9ef"
  success: "#15803d"
typography:
  body:
    fontFamily: "Lato, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  heading:
    fontFamily: "Lato, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.9px"
rounded:
  control: "7px"
  navigation: "8px"
  card: "10px"
  dialog: "12px"
spacing:
  control-height: "37px"
  desktop-content-gutter: "48px"
  tablet-content-gutter: "26px"
  mobile-content-gutter: "17px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "600 11px Lato, ui-sans-serif, system-ui, sans-serif"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "37px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "19px 20px"
---

## Overview

**Creative North Star: "A calm control surface for personal mailbox access."**

The management UI keeps mailbox identity and token controls easy to scan. A compact navigation rail, cool light ground, white bounded surfaces, restrained blue actions, and clear status labels make the service feel dependable without turning it into a generic operations dashboard. Locally hosted Lato supplies a consistent voice. The product title and optional raster logo are deployment-configurable; when no logo is set, the existing blue M mark remains.

**Key Characteristics:** light and neutral; mailbox-aware navigation; blue actions and permission controls; subtle borders with restrained depth; compact, work-focused typography.

## Colors

Blue carries primary actions, active navigation, links, and permission switches. The cool pale ground separates the white sidebar, cards, and login panel. Navy ink carries headings and important labels; muted gray supports metadata without competing. Green identifies a healthy connection or active token. Use the fine neutral border for structure and the soft red treatment only for destructive actions.

**The Quiet Surface Rule.** Use color to indicate action or state; rely on surface contrast and fine borders for ordinary structure.

## Typography

Use locally hosted Lato in regular, semibold, and bold weights. Body and metadata are compact; the 26px page heading establishes the main hierarchy, with the login heading slightly smaller. Small uppercase labels are secondary metadata and never replace a descriptive heading.

## Layout

On desktop, use a fixed 248px navigation rail and 48px content gutter. Below 900px, reduce the rail to 210px and the gutter to 26px. At 680px and below, turn the rail into a compact horizontal header, remove the content offset, and use a 17px gutter. Keep mailbox identity near the token-management flow and preserve readable token actions at narrow widths.

**The Mailbox Context Rule.** Keep the connected mailbox identity visible alongside its personal access-token controls.

## Elevation & Depth

Cards use a fine border and a low ambient shadow (`0 2px 8px #24324a06`). Primary buttons use a small blue shadow (`0 3px 7px #2563eb25`). Depth stays quiet; avoid heavy elevation and let surface contrast do most of the separating.

## Shapes

Controls use a modest 7px radius, navigation items 8px, cards and token rows 10px, and the login panel 12px. Inputs and primary buttons share a 37px height. Switches and compact status labels use pill silhouettes only where the control or state benefits from them.

## Components

### Buttons

Primary buttons are solid blue with white semibold text (11px), a 7px radius, and 37px minimum height; hover darkens the blue. Secondary actions are white with a quiet border. Destructive token actions use restrained red styling and remain visually secondary.

### Inputs / Fields

Inputs use a white fill, fine neutral border, 7px radius, and 37px height. Focus shifts the border to blue and adds a pale blue outline. Labels remain visible above fields; placeholders are hints, not labels.

### Navigation

The white rail pairs mailbox identity with a compact active link on a pale blue surface. At mobile width, it becomes a horizontal header. The sign-out action stays at the end of the rail or header.

### Cards / Containers

White bounded cards group token creation, client setup, token details, and the one-time secret. Use a 10px radius, fine border, quiet shadow, and roughly 19–20px internal padding. The one-time token callout uses a pale blue surface and keeps its copy action adjacent to the secret.

### Token Permissions

Each tool permission is independently labeled and toggled. Keep the scroll area inside the permission popover with clear space to the right of the switches; revoked tokens show disabled controls. SMTP permission appears only when SMTP is configured.

### Brand

The brand combines a compact mark and product title. A configured raster logo replaces the blue M mark while the title stays readable beside it.

## Do's and Don'ts

- **Do** keep mailbox identity, token state, and tool permissions in the same management flow.
- **Do** show the full user token only at creation and provide a copy action.
- **Do** keep SMTP permission conditional on SMTP being configured.
- **Do** use inline SVGs for interface icons instead of text glyphs.
- **Don't** add unrelated dashboard, billing, team, or account-navigation patterns.
- **Don't** use decorative display type or heavy shadows.
