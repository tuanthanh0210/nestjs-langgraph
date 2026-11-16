#!/usr/bin/env bash
set -euo pipefail

pr_dir="${PR_DIR:?PR_DIR is required}"
base_sha="${BASE_SHA:?BASE_SHA is required}"
head_sha="${HEAD_SHA:?HEAD_SHA is required}"
patterns="${PROTECTED_PATTERNS:?PROTECTED_PATTERNS is required}"

sha_re='^[0-9a-f]{40}$'
[[ "$base_sha" =~ $sha_re ]] || { echo "BASE_SHA is not a full commit SHA" >&2; exit 2; }
[[ "$head_sha" =~ $sha_re ]] || { echo "HEAD_SHA is not a full commit SHA" >&2; exit 2; }
[[ -s "$patterns" ]] || { echo "protected path list is missing or empty" >&2; exit 2; }

merge_base="$(git -C "$pr_dir" merge-base "$base_sha" "$head_sha")"
[[ "$merge_base" =~ $sha_re ]] || { echo "could not compute merge base" >&2; exit 2; }

violations=0
while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
  read -r _ new_mode _ <<<"$meta"
  status="${meta##* }"
  reason=""
  if printf '%s\n' "$path" | grep -qE -f "$patterns"; then
    reason="protected path (${status})"
  elif [[ "$new_mode" == "120000" ]]; then
    reason="symlink added or changed"
  elif [[ "$new_mode" == "160000" ]]; then
    reason="git submodule added or changed"
  fi
  if [[ -n "$reason" ]]; then
    violations=$((violations + 1))
    printf 'BLOCKED  %-34s %q\n' "$reason" "$path"
  fi
done < <(git -C "$pr_dir" diff --no-renames --no-ext-diff --no-textconv --raw -z "$merge_base" "$head_sha")

if (( violations > 0 )); then
  printf '\n%d change(s) touch CI, scanner configuration, install hooks or developer-tool hooks.\n' "$violations"
  printf 'These can disable or bypass the security checks, so this PR cannot pass automatically.\n\n'
  printf 'If the change is intended:\n'
  printf '  1. Keep it in its own small PR with no application code mixed in.\n'
  printf '  2. A repository admin reviews every listed file line by line.\n'
  printf '  3. The admin merges with "Merge without waiting for requirements to be met (bypass rules)".\n'
  printf '     The bypass is recorded in the ruleset insights audit log.\n'
  printf 'Re-running this job will not change the result; there is no label or comment override.\n'
  exit 1
fi

echo "No protected paths, symlinks or submodules changed (merge base ${merge_base})."
