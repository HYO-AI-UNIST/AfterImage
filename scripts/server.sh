#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
service_name=afterimage.service

case "${1:-status}" in
  start|stop|restart)
    systemctl --user "$1" "$service_name"
    ;;
  status)
    systemctl --user status "$service_name" --no-pager
    ;;
  logs)
    journalctl --user -u "$service_name" -n 80 -f
    ;;
  update)
    cd "$project_dir"
    export PATH="$project_dir/.sites-runtime/node/bin:$PATH"
    systemctl --user stop "$service_name"
    # Prepare the complete build and migrate local data before starting again.
    # A failed build leaves the service stopped rather than serving mixed assets.
    node scripts/prepare-local.mjs
    systemctl --user start "$service_name"
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|update}" >&2
    exit 2
    ;;
esac
