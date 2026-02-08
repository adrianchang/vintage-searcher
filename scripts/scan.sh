#!/bin/bash

# Vintage Searcher Cron Script
# Scheduled: 0 8 * * * (daily at 8am)

# Set PATH for cron (homebrew on Apple Silicon)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

PROJECT_DIR="/Users/adrianchang/SideProjects/vintage-searcher"
LOG_FILE="$PROJECT_DIR/logs/scan.log"

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_DIR/logs"

# Log start time
echo "=== Scan started at $(date) ===" >> "$LOG_FILE"

# Change to project directory and run scan
cd "$PROJECT_DIR"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Run the scan and append output to log
/opt/homebrew/bin/npm run scan >> "$LOG_FILE" 2>&1

# Log end time
echo "=== Scan completed at $(date) ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
