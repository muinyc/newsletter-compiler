# 📨 newsletter-compiler

**Problem:** Writing newsletters in email editors is painful. You lose version control, can't reuse templates easily, end up fighting CSS rendering across email clients, and have to manually publish to both your email platform and website.

**Solution:** Write in Markdown, compile to email-ready HTML. One command handles CSS inlining, image processing, and optionally pushes the result straight to [Listmonk](https://listmonk.app) and/or WordPress.

## What it does

You write your newsletter in a Markdown file with YAML frontmatter. The compiler:

1. Parses frontmatter for metadata (subject, issue number, description, etc.)
2. Converts Markdown to HTML via [markdown-it](https://github.com/markdown-it/markdown-it)
3. Applies email-specific transforms (full-bleed images, captions, callout boxes, text highlighting)
4. Injects the HTML into your email template
5. Inlines all CSS for maximum email client compatibility
6. Minifies the output
7. Optionally uploads images to WordPress and replaces local URLs
8. Optionally creates/updates a Listmonk campaign with the HTML + plaintext fallback
9. Optionally creates/updates a WordPress custom post type with the content

The result is a single HTML file that renders well across Gmail, Apple Mail, Outlook, and other major email clients.

## Installation

```bash
git clone https://gitlab.com/cynium/newsletter-compiler.git
cd newsletter-compiler
npm install
```

## Quick start

```bash
# Compile Markdown to HTML file
node compile-email.js examples/newsletter.md templates/example.html output.html

# Output to stdout instead
node compile-email.js examples/newsletter.md templates/example.html
```

Open `output.html` in a browser to preview the result.

## Configuration

Copy the example config and fill in your credentials:

```bash
cp config/example.js config/config.local.js
```

Edit `config/config.local.js` with your Listmonk and/or WordPress details. The file is gitignored so your secrets stay local.

For multiple newsletters, create named configs:

```bash
cp config/example.js config/weekly.js
cp config/example.js config/digest.js
```

Then pass them with `--config`:

```bash
node compile-email.js letter.md templates/example.html --config config/weekly.js --create-campaign
```

### Config structure

```javascript
module.exports = {
    listmonk: {
        baseUrl: 'https://lists.example.com',
        username: 'api',
        password: 'your-api-token',
        campaign: {
            name: 'My Newsletter',
            subject: '',                    // Usually set via frontmatter
            prefix: '[Newsletter]',         // Prepended to subject
            lists: [{ id: 1 }],
            from_email: 'hello@example.com',
            content_type: 'html',
            type: 'regular',
            messenger: 'email',
            template_id: 1,
            tags: ['newsletter']
        }
    },

    wordpress: {
        baseUrl: 'https://example.com',
        username: 'admin',
        password: 'xxxx xxxx xxxx xxxx',    // WordPress Application Password
        images: {
            prefix: 'newsletter-',
            allowedTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
            maxSizeBytes: 10 * 1024 * 1024
        },
        contentFormat: 'markdown'           // or 'html'
    },

    newsletter: {
        title: 'My Newsletter',
        webUrlDomain: 'example.com',        // Don't add UTM to this domain
        webUrlBase: 'https://example.com/newsletters/',
        trafficSource: 'newsletter',        // utm_source value
        attachmentsPath: ''                 // Absolute path to shared attachments folder
    }
};
```

You only need to configure the sections you use. If you only want local HTML compilation without Listmonk or WordPress, the config is optional.

## Frontmatter

Each Markdown file can include YAML frontmatter that drives both the email campaign and the template:

```yaml
---
newsletter_title: My Newsletter
issue: "42"
subject: The one about submarines
description: This week we explore underwater vessels.
from_email: hello@example.com
lists:
  - id: 1
  - id: 3
tags:
  - submarines
  - ocean
template_id: 2
---
```

All fields are optional. Values set here override the corresponding config defaults. `subject` and `from_email` map directly to Listmonk campaign fields.

The campaign name is automatically constructed as `{newsletter_title} {issue}` (e.g. "My Newsletter 42") when both fields are present.

## Template variables

Your HTML template should contain `{{content}}` where the compiled Markdown body goes. Additional variables available from frontmatter:

| Variable | Source |
|---|---|
| `{{content}}` | Compiled newsletter body |
| `{{newsletter_title}}` | `newsletter_title` frontmatter field |
| `{{issue}}` | `issue` frontmatter field |
| `{{description}}` | `description` frontmatter field |
| `{{slug}}` | URL-friendly slug generated from `subject` |

The example template also uses Listmonk's template syntax (`{{ .Campaign.Subject }}`, `{{ UnsubscribeURL }}`, `{{ TrackView }}`) for features that Listmonk renders at send time.

## Markdown features

### Full-bleed images

All images are automatically rendered full-width with `width` and `height` attributes for layout stability. Images that can be resolved locally (or uploaded to WordPress) get their dimensions detected automatically.

### Image captions

Place italic text immediately after an image to create a styled caption:

```markdown
![A mountain landscape](./images/mountain.jpg)
*Photo taken from the summit.*
```

### Callout boxes

Start a blockquote with bold "Callout:" to create a highlighted box:

```markdown
> **Callout:** Early-bird tickets are available until Friday.
```

### Text highlighting

Wrap text in double equals signs:

```markdown
This is ==really important== information.
```

### Everything else

Standard Markdown is fully supported: headings, bold/italic, links, lists, code blocks, blockquotes, tables, horizontal rules.

## Image handling

### Local images

By default, image paths in Markdown are resolved relative to the Markdown file. If `newsletter.attachmentsPath` is configured, paths starting with `Attachments/` resolve against that folder instead.

### WordPress upload

With `--upload-images`, the compiler:

1. Finds all images in the Markdown (local files and remote URLs)
2. Checks if each image already exists in WordPress (by filename hash)
3. Uploads new images to the WordPress Media Library
4. Replaces the original URLs with WordPress media URLs
5. Records dimensions for width/height attributes

Filenames are deterministic hashes of the source URL, so re-running the command won't create duplicate uploads.

## Link tracking

### Listmonk click tracking

All links in the email HTML get `@TrackLink` appended, which Listmonk uses for click tracking. Excluded: mailto links, anchor links, Listmonk template variables (e.g. `{{ UnsubscribeURL }}`), and links that already have `@TrackLink`.

### UTM tracking

External links automatically get `?utm_source={trafficSource}` appended. This applies to both the email HTML and WordPress markdown content. Links pointing to `webUrlDomain` are excluded so your own site analytics aren't polluted.

### Image links

When `newsletter.webUrlBase` and frontmatter `issue` are set, standalone full-bleed images are wrapped in links to the web version of the newsletter.

## Listmonk integration

```bash
node compile-email.js letter.md template.html --create-campaign
```

The compiler talks to the [Listmonk API](https://listmonk.app/docs/apis/campaigns/) to create or update campaigns:

- If no campaign with the name exists, a new one is created.
- If a draft campaign exists with the same name, it's updated in place.
- If a sent/scheduled campaign exists, a new one is created alongside it.

Each campaign includes the compiled HTML as the body and the raw Markdown as the plaintext alternative (`altbody`).

### Overriding campaign settings from the command line

```bash
node compile-email.js letter.md template.html --create-campaign \
  --campaign-name "Special Issue" \
  --campaign-subject "Breaking news" \
  --campaign-lists "1,2,3"
```

## WordPress integration

```bash
node compile-email.js letter.md template.html --upload-images --create-wordpress-post
```

Creates or updates a custom post type (`newsletters`) with content stored in [ACF](https://www.advancedcustomfields.com/) fields:

| ACF field | Value |
|---|---|
| `newsletter_content` | Newsletter body (markdown or HTML per `contentFormat`) |
| `newsletter_issue` | Issue number from frontmatter |
| `newsletter_description` | Description from frontmatter |

Posts are automatically categorized based on `newsletter.title` from the config.

Smart update behavior:
- Draft posts are updated automatically.
- Published posts prompt for confirmation before overwriting.
- If you decline, a new post is created instead.

WordPress authentication uses [Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).

## All command-line options

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

## Wrapper scripts

The `scripts/` directory holds per-newsletter wrapper scripts that bundle the right config, template, and source path into a single command. Copy the example to get started:

```bash
cp scripts/example.sh scripts/my-newsletter.sh
chmod +x scripts/my-newsletter.sh
```

Edit the script to set `NEWSLETTER_DIR` to where your markdown files live, and point at the correct config and template:

```bash
#!/bin/bash

cd "$(dirname "$0")/.."

NEWSLETTER_DIR="/path/to/your/newsletter/files"

node compile-email.js "$NEWSLETTER_DIR/$1" templates/my-newsletter.html \
  --config config/my-newsletter.js \
  --upload-images \
  --create-campaign \
  --create-wordpress-post
```

Then publish an issue by filename alone:

```bash
./scripts/my-newsletter.sh "Issue 42.md"
```

User scripts are gitignored — only `scripts/example.sh` is tracked.

## License

MIT
