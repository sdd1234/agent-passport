#!/usr/bin/env bash
set -euo pipefail
PASSPORT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSPORT_JDK="$(find "$PASSPORT_ROOT/.tools" -maxdepth 1 -type d -name 'jdk*' 2>/dev/null | head -1 || true)"
if [ -n "$PASSPORT_JDK" ]; then export JAVA_HOME="$PASSPORT_JDK"; fi
if [ -d "$PASSPORT_ROOT/.tools/apache-maven-3.9.11/bin" ]; then export PATH="$PASSPORT_ROOT/.tools/apache-maven-3.9.11/bin:$PATH"; fi
if [ -n "${JAVA_HOME:-}" ]; then export PATH="$JAVA_HOME/bin:$PATH"; fi
