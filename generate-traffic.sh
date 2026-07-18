#!/bin/bash
# Traffic generator for catalog-api demo
# Generates realistic request patterns to create interesting traces in SigNoz

BASE_URL="http://localhost:5000"
DELAY=${1:-1}  # seconds between requests (default: 1)

echo "Generating traffic to $BASE_URL (Ctrl+C to stop)"
echo "Watch the traces at http://localhost:8080/traces"
echo ""

i=0
while true; do
  i=$((i + 1))

  # Normal fast requests
  curl -s "$BASE_URL/" > /dev/null
  curl -s "$BASE_URL/books" > /dev/null
  curl -s "$BASE_URL/books/1" > /dev/null

  # Slightly heavier requests
  curl -s "$BASE_URL/books" > /dev/null
  curl -s "$BASE_URL/books/2" > /dev/null

  # Every 10 iterations: trigger an error (for error rate metric)
  if [ $((i % 10)) -eq 0 ]; then
    curl -s "$BASE_URL/books/9999" > /dev/null  # likely 404
    echo "  [$i] Sent batch (incl. error trigger)"
  else
    echo "  [$i] Sent batch"
  fi

  sleep "$DELAY"
done
