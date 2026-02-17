#!/bin/bash

cd "$(dirname "$0")/.."

NEWSLETTER_DIR="/path/to/your/newsletter/files"

node compile-email.js "$NEWSLETTER_DIR/$1" templates/example.html --config config/example.js
