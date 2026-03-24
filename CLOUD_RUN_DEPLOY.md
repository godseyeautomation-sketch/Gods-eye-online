# Cloud Run Deployment Guide

## 📋 Prerequisites

Before deploying to Cloud Run, ensure you have:

1. **Google Cloud Account** - Sign up at https://cloud.google.com
2. **Billing Enabled** - Required but you'll stay in free tier
3. **gcloud CLI Installed** - Install from https://cloud.google.com/sdk/docs/install

## 🚀 Quick Deploy (Automated)

Run the deployment script:

```bash
./deploy-cloudrun.sh
```

This will:
- Check prerequisites
- Create/select project
- Enable required APIs
- Prompt for environment variables
- Deploy to Cloud Run
- Provide your live URL

## 🛠️ Manual Deployment

If you prefer manual control:

### 1. Install & Setup gcloud CLI

```bash
# Mac
brew install --cask google-cloud-sdk

# Windows - Download installer from:
# https://cloud.google.com/sdk/docs/install

# Login
gcloud auth login

# Create or select project
gcloud projects create klint-studio-prod
gcloud config set project klint-studio-prod
```

### 2. Enable Required APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### 3. Deploy

```bash
gcloud run deploy klint-studio \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300s \
  --max-instances 10 \
  --set-env-vars="VITE_GEMINI_API_KEY=your-key,VITE_SUPABASE_URL=your-url,VITE_SUPABASE_ANON_KEY=your-key,VITE_CLOUDINARY_CLOUD_NAME=your-name,VITE_CLOUDINARY_UPLOAD_PRESET=your-preset"
```

## 🌐 Your URLs

After deployment:
- **Vercel (Current)**: https://your-app.vercel.app
- **Cloud Run (New)**: https://klint-studio-xxx.run.app

Both can run simultaneously using the same database!

## 🔄 Continuous Deployment

### Option 1: Git-based (Recommended)

Connect Cloud Run to your GitHub repo:
1. Go to Cloud Run console
2. Click "Set up continuous deployment"
3. Connect GitHub repository
4. Auto-deploys on every push!

### Option 2: Manual Updates

Simply run again:
```bash
./deploy-cloudrun.sh
```

## 📊 Monitor & Manage

### View Logs
```bash
gcloud run services logs read klint-studio --region us-central1 --limit 100
```

### Update Configuration
```bash
gcloud run services update klint-studio \
  --region us-central1 \
  --set-env-vars="NEW_VAR=value"
```

### Check Status
```bash
gcloud run services describe klint-studio --region us-central1
```

## 💰 Cost Estimates

**Free Tier Includes:**
- 2 million requests/month
- 360,000 vCPU-seconds/month
- 180,000 GiB-seconds memory/month

**Your Usage (Estimated):**
- ~50,000 generations/month = **$0** (within free tier)
- ~100,000 generations/month = **$0-2**

## 🔐 Security

All environment variables are encrypted at rest and in transit on Cloud Run.

## 🆘 Troubleshooting

### Build Fails
- Check Dockerfile syntax
- Ensure all dependencies in package.json
- View build logs: `gcloud builds list`

### App Won't Start
- Check logs: `gcloud run services logs read klint-studio`
- Verify environment variables are set
- Ensure PORT=8080 is exposed

### Timeout Errors
- Increase timeout: `--timeout 300s`
- Check function execution time
- Consider optimizing API calls

## 📞 Support

- Cloud Run Docs: https://cloud.google.com/run/docs
- Pricing Calculator: https://cloud.google.com/products/calculator
- Community: https://stackoverflow.com/questions/tagged/google-cloud-run

