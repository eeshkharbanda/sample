# Faster, lower-error LaTeX workflow for book typesetting

If your current flow (Gemini + Canva + LaTeX) is producing frequent compile errors and very slow reloads, use this setup for rapid iteration.

## 1) Split your project and compile only what changed

- Keep one `main.tex` file that includes chapter files:

```tex
\documentclass[11pt]{book}
\usepackage{import}
\begin{document}
\frontmatter
\import{chapters/}{00-preface.tex}
\mainmatter
\import{chapters/}{01-intro.tex}
\import{chapters/}{02-method.tex}
\end{document}
```

- Put each chapter in `chapters/*.tex`.
- While editing a chapter, use `\includeonly{...}` in `main.tex` so LaTeX compiles only that part.

## 2) Use `latexmk` for incremental builds + preview refresh

Run:

```bash
make watch
```

This starts continuous compilation (`latexmk -pvc`) with SyncTeX and non-stop error mode.

### Why this is faster

- Incremental build caches auxiliary files.
- No manual rerun loop.
- Errors are surfaced immediately instead of full-stop compile failures.

## 3) Common hard errors from AI-generated LaTeX (and quick fixes)

### A) “Undefined control sequence”

Cause: Gemini inserted commands requiring packages that are not loaded.

Fix pattern:
- Add missing packages in preamble (`\usepackage{...}`).
- If command is custom, define it with `\newcommand`.

### B) “Missing $ inserted”

Cause: math symbols outside math mode.

Fix:
- Wrap math in `$...$` (inline) or `\[ ... \]` (display).

### C) “Extra alignment tab has been changed to \cr”

Cause: wrong number of `&` in tables/alignment.

Fix:
- Ensure each row has same number of columns as table definition.

### D) “File ... not found”

Cause: wrong image/path from copied Canva export references.

Fix:
- Put figures under `figures/`.
- Reference as `\includegraphics{figures/name}` (no extension preferred).

## 4) Keep Canva and LaTeX responsibilities separate

- Canva: produce final figures (PNG/PDF/SVG).
- LaTeX: layout, typography, references.

Do **not** copy Canva text layout into LaTeX verbatim. Export only assets and place them in figure environments.

## 5) Make AI output safer before paste

Ask Gemini for:
- “Return only LaTeX body content, no preamble.”
- “Use only these packages: `graphicx`, `booktabs`, `amsmath`, `hyperref`.”
- “No custom commands unless explicitly listed.”

This prevents package drift and command collisions.

## 6) Debug sequence that saves time

1. Compile chapter-only (`\includeonly`).
2. Fix first error only (ignore cascading errors).
3. Re-run compile.
4. When clean, re-enable full book compile.

## 7) Performance guardrails for large books

- Prefer PDF/JPG images over huge SVG when compile is slow.
- Avoid very high-DPI images unless print requires it.
- Clear stale aux files if build gets stuck:

```bash
make clean
```

## 8) Minimal stable preamble template

```tex
\documentclass[11pt]{book}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{amsmath,amssymb}
\usepackage[hidelinks]{hyperref}
```

Use this baseline and add packages one at a time.

## 9) If reload is still too slow

- Switch to chapter-only compilation during editing.
- Reduce heavy image usage in draft mode.
- Temporarily disable expensive features (high-res assets, complex TikZ) until final pass.

---

If you share your exact error log (`.log` first 30 lines around the first error), you can pinpoint and patch the root cause quickly.
