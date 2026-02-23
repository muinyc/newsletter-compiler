# > newsletter-compiler

Write newsletters in Markdown, compile to email-ready HTML. One command handles CSS inlining, image processing, and optionally pushes the result to [Listmonk](https://listmonk.app) and/or WordPress.

## Requirements

- Node.js
- [Listmonk](https://listmonk.app) (optional, for campaign creation)
- WordPress with [ACF](https://www.advancedcustomfields.com/) (optional, for web publishing)

## Quick start

```bash
git clone https://gitlab.com/cynium/newsletter-compiler.git
cd newsletter-compiler
npm install
```

Compile a newsletter:

```bash
# Markdown to HTML file
node compile-email.js examples/newsletter.md templates/example.html output.html

# Output to stdout
node compile-email.js examples/newsletter.md templates/example.html
```

Open `output.html` in a browser to preview. If you only want local HTML compilation without Listmonk or WordPress, no config is needed.

## How it works

```
Markdown + YAML frontmatter
    ──> markdown-it ──> email transforms ──> template injection
    ──> CSS inlining ──> minification ──> output.html
    ──> (optional) WordPress image upload
    ──> (optional) Listmonk campaign
    ──> (optional) WordPress post
```

The compiler parses YAML frontmatter for metadata, converts Markdown to HTML, applies email-specific transforms (full-bleed images, captions, callout boxes, text highlighting), injects into your template, inlines all CSS, and minifies. The result renders well across Gmail, Apple Mail, Outlook, and other major clients.

## Features

**Markdown authoring** — Standard Markdown plus email-specific extensions: full-bleed images with auto-detected dimensions, image captions via italic text after images, callout boxes via `> **Callout:**`, and `==highlighted==` text.

**Listmonk integration** — `--create-campaign` creates or updates campaigns via the API. Draft campaigns are updated in place; sent campaigns get a new sibling. Includes compiled HTML as body and raw Markdown as plaintext fallback. All links get `@TrackLink` for click tracking.

**WordPress integration** — `--upload-images` uploads to the Media Library with deterministic filenames (no duplicates on re-run). `--create-wordpress-post` creates/updates a custom `newsletters` post type with ACF fields. Draft posts update automatically; published posts prompt before overwriting.

**UTM tracking** — External links automatically get `?utm_source={trafficSource}`. Links to your own domain are excluded.

**Template variables** — `{{content}}`, `{{newsletter_title}}`, `{{issue}}`, `{{description}}`, `{{slug}}` are replaced from frontmatter values.

## Configuration

Copy the example config and fill in your credentials:

```bash
cp config/example.js config/config.local.js
```

The file is gitignored so secrets stay local. For multiple newsletters, create named configs and pass with `--config`:

```bash
node compile-email.js letter.md templates/example.html --config config/weekly.js --create-campaign
```

You only need to configure the sections you use (Listmonk, WordPress, or both).

## Frontmatter

```yaml
---
newsletter_title: My Newsletter
issue: "42"
subject: The one about submarines
description: This week we explore underwater vessels.
from_email: hello@example.com
lists:
  - id: 1
tags:
  - submarines
template_id: 2
---
```

All fields are optional. Values override the corresponding config defaults. The campaign name is automatically constructed as `{newsletter_title} {issue}` when both are present.

## Wrapper scripts

The `scripts/` directory holds per-newsletter wrapper scripts that bundle the right config, template, and source path into a single command:

```bash
cp scripts/example.sh scripts/my-newsletter.sh
chmod +x scripts/my-newsletter.sh
# Edit to set NEWSLETTER_DIR, config, and template paths
./scripts/my-newsletter.sh "Issue 42.md"
```

User scripts are gitignored — only `scripts/example.sh` is tracked.

## All options

```
node compile-email.js <markdown-file> <template-file> [output-file] [options]

Options:
  --config <file>             Config file (default: config/config.local.js or config/example.js)
  --create-campaign           Create/update a Listmonk campaign
  --upload-images             Upload images to WordPress media library
  --create-wordpress-post     Create/update a WordPress newsletter post
  --campaign-name <name>      Override campaign name
  --campaign-subject <subj>   Override campaign subject line
  --campaign-lists <ids>      Comma-separated list IDs (e.g. "1,2,3")
  --help, -h                  Show usage information
```

## License

[MIT](LICENSE)

***
© 2026 [Stefan Kubicki](https://kubicki.org) • a [CYNIUM](https://cynium.com) release • shipped from the [Atoll](https://kubicki.org/atoll)
***
Canonical URL: https://forge.cynium.com/stefan/newsletter-compiler
