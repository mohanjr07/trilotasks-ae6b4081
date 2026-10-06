#!/usr/bin/env bash
# Safe deploy for Trilo TaskFlow: always targets jhtfhjfwjsutkwebmrgv and refuses if the Supabase CLI
# is signed in to an account that can't see it (prevents cross-project deploys).
set -euo pipefail
REF="jhtfhjfwjsutkwebmrgv"
cd "$(dirname "$0")/.."
if ! npx --yes supabase projects list 2>/dev/null | grep -q "$REF"; then
  echo ""
  echo "STOP: the Supabase CLI is not signed in to the Trilo TaskFlow account (mohanjr216@gmail.com)."
  echo "Run:  npx --yes supabase logout && npx --yes supabase login   (approve in a browser logged in as mohanjr216@gmail.com)"
  exit 1
fi
FNS="${*:-admin-create-user admin-update-user admin-delete-user send-email-notification send-push}"
for f in $FNS; do
  echo "== deploying $f to Trilo TaskFlow ($REF)"
  npx --yes supabase functions deploy "$f" --project-ref "$REF"
done
echo "Done: Trilo TaskFlow functions deployed."
