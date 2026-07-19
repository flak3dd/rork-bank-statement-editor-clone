#!/usr/bin/env bash
# Refresh short-lived Google OAuth access token into web/.env.local
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.local"
TOKEN=$(gcloud auth print-access-token)
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
# Update token lines in place
tmp=$(mktemp)
awk -v t="$TOKEN" '
  /^VITE_GOOGLE_DOCAI_TOKEN=/ { print "VITE_GOOGLE_DOCAI_TOKEN=" t; next }
  /^VITE_GOOGLE_ACCESS_TOKEN=/ { print "VITE_GOOGLE_ACCESS_TOKEN=" t; next }
  { print }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"
echo "Updated Doc AI access token in .env.local (expires ~1h). Restart Vite."
