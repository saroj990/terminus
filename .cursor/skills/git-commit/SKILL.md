---
name: git-commit
description: >-
  Creates git commits as saroj990 with no Cursor co-author trailer.
  Use when committing, git commit, or the user asks to make commits.
---

# Git commit (saroj990)

## Author

Use `--author` on every commit. Do not run `git config`.

```
saroj990 <saroj990@github.com>
```

## Forbidden trailers

Never include in the message or via `git interpret-trailers`:

- `Co-authored-by: Cursor <cursoragent@cursor.com>`
- `Co-authored-by: Cursor`
- any other Cursor / cursoragent attribution

If a hook or template would add those, omit extra `-m` trailers and do not pass `--trailer`.

## Command shape

```bash
git add <paths>
git commit --author="saroj990 <saroj990@github.com>" -m "$(cat <<'EOF'
Concise why-focused message.

EOF
)"
```

Follow the user's granular-commit requests. Do not amend unless they ask and the amend rules allow it.