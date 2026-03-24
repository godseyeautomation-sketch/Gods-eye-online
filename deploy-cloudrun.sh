#!/bin/bash

# Klint Studio - Cloud Run Deployment Script
# This script deploys your app to Google Cloud Run while preserving existing secrets.

set -e

echo "🚀 Klint Studio - Cloud Run Deployment"
echo "======================================="
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    echo "📥 Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

echo "✅ gcloud CLI found"

# Default region
REGION="us-central1"
SERVICE_NAME="gods-eye-online"

# Get current project
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: No Google Cloud project selected."
    echo "Please run: gcloud config set project [PROJECT_ID]"
    exit 1
fi
echo "📦 Using project: $PROJECT_ID"

# 1. Fetch current environment variables from .env
echo "🔍 Fetching configuration from local .env context..."

if [ -f .env ]; then
  # Export .env vars so they are available in Bash
  export $(grep -v '^#' .env | xargs)
fi

CUR_GEMINI=$VITE_GEMINI_API_KEY
CUR_SUPABASE_URL=$VITE_SUPABASE_URL
CUR_SUPABASE_KEY=$VITE_SUPABASE_ANON_KEY
CUR_FAL_KEY=$FAL_KEY

echo "✅ Local configuration parsed."
echo ""

# 2. Prompt for environment variables
echo "🔐 Update Environment Variables"
echo "--------------------------------"
echo "Press Enter to keep the [current] value shown in brackets."
echo ""

read -p "VITE_GEMINI_API_KEY [${CUR_GEMINI:-empty}]: " GEMINI_KEY
GEMINI_KEY=${GEMINI_KEY:-$CUR_GEMINI}

read -p "VITE_SUPABASE_URL [${CUR_SUPABASE_URL:-empty}]: " SUPABASE_URL
SUPABASE_URL=${SUPABASE_URL:-$CUR_SUPABASE_URL}

read -p "VITE_SUPABASE_ANON_KEY [${CUR_SUPABASE_KEY:-empty}]: " SUPABASE_KEY
SUPABASE_KEY=${SUPABASE_KEY:-$CUR_SUPABASE_KEY}

read -p "FAL_KEY [${CUR_FAL_KEY:-empty}]: " FAL_KEY
FAL_KEY=${FAL_KEY:-$CUR_FAL_KEY}

echo ""
echo "🚀 Deploying to Cloud Run ($REGION)..."

# 3. Build comma-separated env vars string
ENV_VARS="VITE_GEMINI_API_KEY=$GEMINI_KEY,VITE_SUPABASE_URL=$SUPABASE_URL,VITE_SUPABASE_ANON_KEY=$SUPABASE_KEY,FAL_KEY=$FAL_KEY"

# 4. Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --source . \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 300s \
  --max-instances 10 \
  --min-instances 0 \
  --set-env-vars="$ENV_VARS" \
  --quiet

echo ""
echo "✅ Deployment complete!"
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format='value(status.url)')
echo "🌐 Your app is now live at: $SERVICE_URL"
echo ""
