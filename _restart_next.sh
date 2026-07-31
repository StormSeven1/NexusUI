#!/bin/bash
cd /workspace/nexus-ui
for pid in $(ls /proc | grep -E '^[0-9]+$'); do
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null || true)
  case "$cmd" in
    *next-server*) kill -9 "$pid" 2>/dev/null || true ;;
    *"next start"*) kill -9 "$pid" 2>/dev/null || true ;;
  esac
done
sleep 2
export PORT=22411 FRONTEND_PORT=22411 BACKEND_URL=http://127.0.0.1:27003 BACKEND_PORT=27003
nohup npm run start > /tmp/next-start-22411.log 2>&1 &
sleep 4
curl -s -o /dev/null -w "p22411:%{http_code}\n" http://127.0.0.1:22411/ || true
