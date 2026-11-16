#!/usr/bin/env bash
set -euo pipefail

pr_dir="${1:?usage: prepare-pr-tree.sh <pr-dir> [trusted-semgrepignore]}"
trusted_ignore="${2:-}"

[[ -d "$pr_dir/.git" ]] || { echo "not a git checkout: $pr_dir" >&2; exit 2; }

links="$(find "$pr_dir" -path "$pr_dir/.git" -prune -o -type l -print | wc -l | tr -d ' ')"
find "$pr_dir" -path "$pr_dir/.git" -prune -o -type l -print0 | xargs -0 -r rm -f --

find "$pr_dir" -path "$pr_dir/.git" -prune -o -type f \
  \( -name .semgrepignore -o -name .gitleaksignore -o -name .gitleaks.toml -o -name osv-scanner.toml \) \
  -print0 | xargs -0 -r rm -f --

if [[ -n "$trusted_ignore" ]]; then
  [[ -s "$trusted_ignore" ]] || { echo "trusted semgrepignore missing: $trusted_ignore" >&2; exit 2; }
  cp "$trusted_ignore" "$pr_dir/.semgrepignore"
fi

echo "PR tree prepared: removed ${links} symlink(s) and every PR-supplied scanner config."
