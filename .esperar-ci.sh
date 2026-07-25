#!/bin/sh
# Espera a que terminen los checks del PR 150 y los imprime.
i=0
while [ $i -lt 90 ]; do
  estado=$(gh run list --repo Goberna-Lab/hermes --branch feat/autorespuesta-supervisada --limit 1 --json status --jq '.[0].status' 2>/dev/null)
  if [ "$estado" = "completed" ]; then break; fi
  i=$((i + 1))
  sleep 20
done
gh run list --repo Goberna-Lab/hermes --branch feat/autorespuesta-supervisada --limit 1
gh pr checks 150 --repo Goberna-Lab/hermes
