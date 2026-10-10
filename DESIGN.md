---
name: Mailstack MCP
description: Klarer, ruhiger Zugang zur Verwaltung persönlicher Mailbox-Zugriffstoken.
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

The management UI follows the user-selected light administration reference. It keeps the mailbox identity and token controls easy to scan, with a compact navigation rail, restrained blue actions, white cards, and clear status labels. The application uses locally hosted Lato font files.

## Colors

Use blue for the primary action, active navigation, and permission controls. Keep the page ground cool and light, cards white, and text navy. Muted gray is for supporting labels; green communicates a healthy connection or active state. Borders stay subtle.

## Typography

Use Lato at regular, semibold, and bold weights. Body copy is compact and readable; page headings provide the main hierarchy. Small uppercase labels are secondary metadata and should not replace descriptive headings.

## Layout

On desktop, use a fixed 248px navigation rail and content with a 48px gutter. At widths below 900px, reduce the rail to 210px and content gutter to 26px. At 680px and below, convert the rail into a compact horizontal header and remove the content offset; use a 17px content gutter.

## Elevation & Depth

Cards use a fine border and a very low ambient shadow. Primary actions may use a small blue shadow. Avoid heavy elevation; separation comes primarily from surface and border contrast.

## Shapes

Controls use a modest 7px radius, navigation items 8px, cards 10px, and the login panel 12px. Inputs and primary buttons share a 37px minimum height.

## Components

Primary buttons use solid blue with white text and a darker hover state. Secondary buttons remain white with a quiet border. Destructive token actions use muted red styling. Permission controls are individually labeled switches; revoked tokens have disabled permission controls and can be permanently deleted.

## Do's and Don'ts

- Keep the mailbox owner, token state, and tool permissions visible in the same management flow.
- Show the full user token only at creation and provide a copy action.
- Keep SMTP permission conditional on SMTP being configured.
- Do not add unrelated dashboard, billing, team, or account-navigation patterns.
- Do not use decorative display type or heavy shadows in this interface.
- Use inline SVGs for decorative interface icons; keep icon graphics out of text glyphs.
