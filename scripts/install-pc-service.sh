#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/java-env.sh"
cd "$PASSPORT_ROOT"
bash scripts/setup-pg-client.sh
npm run build
mvn -q -f apps/api/pom.xml -DskipTests package
mkdir -p "$HOME/.config/systemd/user"
python3 - "$PASSPORT_ROOT" "$HOME/.config/systemd/user/agent-passport.service" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]);target=Path(sys.argv[2])
escape=lambda v:'"'+str(v).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
target.write_text('[Unit]\nDescription=Agent Passport local PC service\nAfter=network.target\n\n[Service]\nType=simple\nWorkingDirectory='+str(root).replace('%','%%').replace(' ','\\x20')+'\nEnvironmentFile=-'+str(root/'.data/pc-server/service.env').replace('%','%%').replace(' ','\\x20')+'\nExecStart=/bin/bash '+escape(root/'scripts/serve-pc.sh')+'\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nUMask=0077\n\n[Install]\nWantedBy=default.target\n')
PY
systemctl --user daemon-reload
systemctl --user enable agent-passport.service
systemctl --user restart agent-passport.service
systemctl --user is-active --quiet agent-passport.service
printf 'Installed user service. Status: systemctl --user status agent-passport\n'
