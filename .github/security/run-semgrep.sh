#!/usr/bin/env bash
set -euo pipefail

pr_dir="$(cd "${1:?usage: run-semgrep.sh <pr-dir> <rules-path>}" && pwd)"
rules_path="${2:?usage: run-semgrep.sh <pr-dir> <rules-path>}"
image="${SEMGREP_IMAGE:?SEMGREP_IMAGE is required}"

[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || { echo "SEMGREP_IMAGE must be pinned by digest" >&2; exit 2; }
[[ -e "$rules_path" ]] || { echo "rules not found: $rules_path" >&2; exit 2; }
rules_abs="$(cd "$(dirname "$rules_path")" && pwd)/$(basename "$rules_path")"

exclude_args=()
for exclude_path in ${SEMGREP_EXCLUDE_PATHS:-}; do
  [[ "$exclude_path" =~ ^(/[A-Za-z0-9._-]+)+$ &&! "$exclude_path" =~ /\.\.?(/|$) ]] \
    || { echo "invalid path in SEMGREP_EXCLUDE_PATHS: must be an absolute repo path without . or .. segments" >&2; exit 2; }
  [[ -f "${pr_dir}${exclude_path}" ]] || { echo "SEMGREP_EXCLUDE_PATHS entry is not a file in the PR tree: ${exclude_path}" >&2; exit 2; }
  exclude_args+=(--exclude "$exclude_path")
done

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
    ${exclude_args[@]+"${exclude_args[@]}"} \
    /src
rc=$?
set -e
echo "::${token}::"
exit "$rc"
