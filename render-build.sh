#!/usr/bin/env bash
# exit on error
set -o errexit

# Install dependencies
npm install

# Download and install the Google Chrome browser compatible with current Puppeteer
npx puppeteer browsers install chrome
