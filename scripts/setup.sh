#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tools
if ! command -v java >/dev/null; then
  curl -fL --retry 2 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse' -o .tools/jdk.tar.gz
  tar -xzf .tools/jdk.tar.gz -C .tools
  rm .tools/jdk.tar.gz
fi
if [ ! -d .tools/apache-maven-3.9.11 ]; then
  curl -fL 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.tar.gz' -o .tools/maven.tar.gz
  tar -xzf .tools/maven.tar.gz -C .tools
  rm .tools/maven.tar.gz
fi
npm ci
source scripts/java-env.sh
mvn -q -f apps/api/pom.xml package
npm run build
