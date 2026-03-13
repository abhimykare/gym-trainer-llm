#!/bin/bash
# Script to clear WhatsApp session for fresh start

echo "🧹 Clearing WhatsApp session..."

# Remove session folder
rm -rf ./whatsapp-session/*
rm -rf /app/whatsapp-session/*

# Remove temp QR files
rm -f /tmp/whatsapp-qr*.png

echo "✅ Session cleared! Ready for fresh start."
