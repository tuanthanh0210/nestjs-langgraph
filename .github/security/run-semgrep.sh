#!/usr/bin/env bash
set -euo pipefail

pr_dir="$(cd "${1:?usage: run-semgrep.sh <pr-dir> <rules-path>}" && pwd)"
rules_path="${2:?usage: run-semgrep.sh <pr-dir> <rules-path>}"
image="${SEMGREP_IMAGE:?SEMGREP_IMAGE is required}"

[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "SEMGREP_IMAGE must be pinned by digest" >&2; exit 2; }
[[ -e "$rules_path" ]] || { echo "rules not found: $rules_path" >&2; exit 2; }
rules_abs="$(cd "$(dirname "$rules_path")" && pwd)/$(basename "$rules_path")"

exclude_args=()
read -r -a exclude_list <<<"${SEMGREP_EXCLUDE_PATHS:-}"
for exclude_path in ${exclude_list[@]+"${exclude_list[@]}"}; do
  if [[ ! "$exclude_path" =~ ^(/[A-Za-z0-9._-]+)+$ || "$exclude_path" =~ /\.\.?(/|$) ]]; then
    echo "invalid path in SEMGREP_EXCLUDE_PATHS: must be an absolute repo path without . or .. segments" >&2
    exit 2
  fi
  [[ -f "${pr_dir}${exclude_path}" ]] || { echo "SEMGREP_EXCLUDE_PATHS entry is not a file in the PR tree: ${exclude_path}" >&2; exit 2; }
  exclude_args+=(--exclude "$exclude_path")
done

out_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/semgrep-out.XXXXXX")"

token="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
echo "::stop-commands::${token}"
set +e
docker run --rm \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,size=512m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --env SEMGREP_SEND_METRICS=off \
  --volume "${pr_dir}:/src:ro" \
  --volume "${rules_abs}:/rules:ro" \
  --volume "${out_dir}:/out" \
  --workdir /src \
  "$image" \
  semgrep scan \
    --config /rules \
    --metrics off \
    --disable-version-check \
    --disable-nosem \
    --no-git-ignore \
    --max-target-bytes 0 \
    --timeout 0 \
    --strict \
    --error \
    --json-output /out/results.json \
    ${exclude_args[@]+"${exclude_args[@]}"} \
    /src
rc=$?
if [[ -s "$out_dir/results.json" ]]; then
  jq -r '.errors[]? | "SCAN-ERROR level=\(.level // "-") type=\(.type | if type == "array" then .[0] else . end) file=\(.path // "-"):\(.spans[0].start.line? // "-")"' "$out_dir/results.json"
fi
set -e
echo "::${token}::"

case "$rc" in
  0) echo "Semgrep: no blocking findings and every file was fully parsed." ;;
  1) echo "::error title=Semgrep::Blocking findings in the PR tree. See the findings above." ;;
  *) echo "::error title=Semgrep::Semgrep exited ${rc}. At least one file could not be fully parsed or scanned (SCAN-ERROR lines above). Content the scanner cannot read is rejected, not skipped: rewrite it or have a maintainer review and bypass." ;;
esac
exit "$rc"
