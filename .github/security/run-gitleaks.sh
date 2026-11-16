#!/usr/bin/env bash
set -euo pipefail

gitleaks_bin="${GITLEAKS_BIN:?GITLEAKS_BIN is required}"
config="${GITLEAKS_CONFIG_FILE:?GITLEAKS_CONFIG_FILE is required}"
pr_dir="${PR_DIR:?PR_DIR is required}"
base_sha="${BASE_SHA:?BASE_SHA is required}"
head_sha="${HEAD_SHA:?HEAD_SHA is required}"
report_dir="${RUNNER_TEMP:-/tmp}/gitleaks-reports"

sha_re='^[0-9a-f]{40}$'
[[ "$base_sha" =~ $sha_re && "$head_sha" =~ $sha_re ]] || { echo "BASE_SHA/HEAD_SHA must be full commit SHAs" >&2; exit 2; }
[[ -s "$config" ]] || { echo "trusted gitleaks config missing" >&2; exit 2; }

merge_base="$(git -C "$pr_dir" merge-base "$base_sha" "$head_sha")"
[[ "$merge_base" =~ $sha_re ]] || { echo "could not compute merge base" >&2; exit 2; }

mkdir -p "$report_dir/empty-ignore"
common=(--config "$config" --gitleaks-ignore-path "$report_dir/empty-ignore" --ignore-gitleaks-allow
        --redact --no-banner --no-color --max-archive-depth 3 --exit-code 1 --report-format json)

token="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
echo "::stop-commands::${token}"
set +e
"$gitleaks_bin" git "${common[@]}" --report-path "$report_dir/history.json" \
  --log-opts="${merge_base}..${head_sha}" "$pr_dir"
history_rc=$?
"$gitleaks_bin" dir "${common[@]}" --report-path "$report_dir/tree.json" "$pr_dir"
tree_rc=$?
set -e
for report in "$report_dir/history.json" "$report_dir/tree.json"; do
  [[ -s "$report" ]] && jq -r '.[] | "LEAK  rule=\(.RuleID)  file=\(.File):\(.StartLine)  commit=\(.Commit // "-" | .[0:12])"' "$report"
done
echo "::${token}::"

if (( history_rc != 0 || tree_rc != 0 )); then
  echo "::error title=Gitleaks::Secrets detected (or scan error) in PR commits ${merge_base:0:12}..${head_sha:0:12} or the PR tree. Rotate any real credential; removing it in a later commit is not enough."
  exit 1
fi
echo "No secrets in PR commits ${merge_base:0:12}..${head_sha:0:12} or in the PR tree."
