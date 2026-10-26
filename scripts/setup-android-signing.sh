#!/bin/sh
# One-time setup: creates the key that signs every release APK and stores it in the GitHub
# repo's Actions secrets (needs the GitHub CLI, logged in: gh auth login).
# The key and its password are kept in ~/spootify-signing. Back that folder up: every APK
# must be signed with the same key to install over the previous one.
set -e
REPO="${1:-ForsakenBlank/Prism}"
D="$HOME/spootify-signing"
mkdir -p "$D"; chmod 700 "$D"; cd "$D"
if [ -f release.p12 ]; then
  echo "Using the existing key in $D"
else
  openssl rand -hex 24 > password.txt; chmod 600 password.txt
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 10000 -nodes -subj "/CN=Spootify" 2>/dev/null
  openssl pkcs12 -export -inkey key.pem -in cert.pem -name spootify -out release.p12 -passout file:password.txt
  rm -f key.pem; chmod 600 release.p12
  echo "Created a new key in $D"
fi
base64 -w0 release.p12 | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
tr -d '\n' < password.txt | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
tr -d '\n' < password.txt | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"
printf spootify | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
echo "Done: release APKs for $REPO will be signed with this key. Back up $D somewhere safe."
