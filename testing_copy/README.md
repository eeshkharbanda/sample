# Testing Copy (Safe Sandbox)

This folder is a **second copy** intended for experimentation so your original files stay untouched.

## What is duplicated
- `LATEX_WORKFLOW.md`
- `Makefile`
- `latexmkrc`

## What is added in this testing copy
- `main.tex` so you can compile immediately without affecting original content.

## Use this copy in a separate terminal tab/window

```bash
cd testing_copy
make build
# or live reload while editing
make watch
```

## Verify original remains unchanged

From repo root:

```bash
git status --short
```

Only files under `testing_copy/` should appear as new/modified.
