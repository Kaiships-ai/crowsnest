#!/bin/zsh
# test-keys.sh save <umami|graph|ig-session> | check
# Real-service keys for a real-data run live in one place, outside the repo: ~/.config/lead-studio-test/<service>.env (mode 600).
# `save` asks Kai with hidden input and tests the key at once; `check` tests every saved key. Neither prints a key.
set -u
DIR="$HOME/.config/lead-studio-test"
mkdir -p "$DIR" && chmod 700 "$DIR"

test_umami() { [ -f "$DIR/umami.env" ] || { echo "umami: not saved"; return 1; }; . "$DIR/umami.env"
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $UMAMI_API_KEY" "${UMAMI_URL%/}/api/websites")
  [ "$code" = 200 ] && echo "umami: ok" || { echo "umami: HTTP $code"; return 1; }; }
test_graph() { [ -f "$DIR/graph.env" ] || { echo "graph: not saved"; return 1; }; . "$DIR/graph.env"
  local out; out=$(curl -s "https://graph.instagram.com/v23.0/me?fields=username&access_token=$IG_GRAPH_TOKEN")
  echo "$out" | grep -q '"username"' && echo "graph: ok @$(echo "$out" | sed -E 's/.*"username":"([^"]*)".*/\1/')" || { echo "graph: refused"; return 1; }; }
# No direct Instagram call for the session: only the sidecar (its own device settings) may use it, so a check here
# could look like a login from a new device. The sidecar card's Test connection proves it.
test_ig_session() { [ -f "$DIR/ig-session.env" ] && echo "ig-session: saved (prove it with the sidecar card's Test connection)" || { echo "ig-session: not saved"; return 1; }; }

case "${1:-}" in
  save)
    umask 077
    case "${2:-}" in
      umami) read -r "U?Umami address (https://...): "; read -rs "K?Umami API key (hidden): "; echo
             printf 'UMAMI_URL=%s\nUMAMI_API_KEY=%s\n' "$U" "$K" > "$DIR/umami.env"; test_umami ;;
      graph) read -rs "K?Instagram Graph token (hidden): "; echo
             printf 'IG_GRAPH_TOKEN=%s\n' "$K" > "$DIR/graph.env"; test_graph ;;
      ig-session) read -rs "K?Instagram sessionid cookie (hidden): "; echo
             printf 'IG_SESSIONID=%s\n' "$K" > "$DIR/ig-session.env"; test_ig_session ;;
      *) echo "usage: test-keys.sh save umami|graph|ig-session" >&2; exit 2 ;;
    esac ;;
  check) rc=0; for t in test_umami test_graph test_ig_session; do $t || rc=1; done; exit $rc ;;
  *) echo "usage: test-keys.sh save <umami|graph|ig-session> | check" >&2; exit 2 ;;
esac
