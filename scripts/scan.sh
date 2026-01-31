#!/bin/bash

# Vintage Searcher Cron Script
# Add to crontab with: crontab -e
# Example: Run every 5 minutes
# */5 * * * * /Users/adrianchang/SideProjects/vintage-searcher/scripts/scan.sh

PROJECT_DIR="/Users/adrianchang/SideProjects/vintage-searcher"
LOG_FILE="$PROJECT_DIR/logs/scan.log"

# Create logs directory if it doesn't exist
mkdir -p "$PROJECT_DIR/logs"

# Log start time
echo "=== Scan started at $(date) ===" >> "$LOG_FILE"

# Change to project directory and run scan
cd "$PROJECT_DIR"

# Run the scan and append output to log
npm run scan >> "$LOG_FILE" 2>&1

# Log end time
echo "=== Scan completed at $(date) ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
