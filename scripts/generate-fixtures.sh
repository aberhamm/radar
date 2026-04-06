#!/bin/bash
# Generate demo fixtures for both target repos.
# Run before demos for instant comparison output.
# Requires repos cloned to tmp/ (see Demo Runbook in TODOS.md).
set -e

OUT=output/demo-fixtures
mkdir -p "$OUT/sitecore" "$OUT/optimizely"

echo "=== Generating Sitecore fixture ==="
npx tsx src/index.ts analyze \
  --repo tmp/sitecore-xmcloud \
  --goal onboarding \
  --output "$OUT/sitecore" \
  --budget 45 \
  --verbose 2>&1 | tee "$OUT/sitecore/run.log"

echo ""
echo "=== Generating Optimizely fixture ==="
npx tsx src/index.ts analyze \
  --repo tmp/optimizely-saas \
  --goal onboarding \
  --output "$OUT/optimizely" \
  --budget 45 \
  --verbose 2>&1 | tee "$OUT/optimizely/run.log"

echo ""
echo "=== Generating CI-check fixture (Sitecore) ==="
npx tsx src/index.ts analyze \
  --repo tmp/sitecore-xmcloud \
  --goal ci-check \
  --output "$OUT/sitecore" \
  --budget 20 \
  --json > "$OUT/sitecore/ci-check.json"

echo ""
echo "Done. Fixtures in $OUT/"
ls -lh "$OUT/sitecore/" "$OUT/optimizely/"
