# Newsletter Compiler — Agent Instructions

## Branch workflow

This repo uses a two-branch model for public/private separation:

- **`main`** — public branch, mirrored to GitHub. Must not contain credentials, personal configs, or private templates.
- **`private`** — GitLab only. Contains personal configs (`config/detours.js`, `config/pirateutopia.js`), scripts, and templates. Never mirrored to GitHub.

**Rules:**
- Merge `main` → `private` to keep the private branch up to date.
- Never merge `private` → `main`. This would leak credentials into the public branch.
- When working on public features or fixes, work on `main`.
- The `.gitignore` on `main` excludes user configs/scripts/templates. The `.gitignore` on `private` does not.
