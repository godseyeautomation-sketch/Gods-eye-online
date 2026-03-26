<div align="center">

<br/>

<img src="public/favicon.svg" width="80" height="80" alt="Gods Eye Logo" />

# Gods Eye Studio v2.1

**Enterprise AI Creative Suite**

Generate images, videos, content calendars, and full marketing campaigns — powered by multi-model AI.

[![Live Demo](https://img.shields.io/badge/Live-gods--eye--online-CCFF00?style=for-the-badge&logo=google-cloud&logoColor=black)](https://gods-eye-online-732048625045.us-central1.run.app)
[![License](https://img.shields.io/badge/License-Private-333?style=for-the-badge)](LICENSE)

</div>

---

## What is Gods Eye?

Gods Eye Studio is a full-stack AI creative platform built for agencies and creators. It combines multiple AI models into one unified workspace:

- **Image Generation** — Gemini Flash, Flux Ultra, SeedDream v4.5
- **Video Generation** — Kling 3 Pro, Veo 3.1 Fast
- **Chat Intelligence** — Gemini 3.x, Kimi K2.5
- **Brand DNA Scanner** — Extract colors, fonts, tone from any website
- **Content Calendar** — Plan and schedule across 10+ social platforms
- **Skills & Agents** — Extensible skill system for custom workflows

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Tailwind CSS |
| AI Models | Gemini 3.x, Kimi K2.5, Flux, Kling, Veo |
| Backend | Express.js (API proxy + SSR) |
| Database | Supabase (auth, storage, conversations) |
| Media | fal.ai (image/video generation) |
| Deploy | Docker + Google Cloud Run |

## Run Locally

**Prerequisites:** Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in your API keys (Gemini, Supabase, fal.ai, Kimi)

# 3. Start dev server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001)

## Deploy to Cloud Run

```bash
# Build and deploy via Cloud Build
gcloud builds submit --config=cloudbuild.yaml

# Set environment variables
gcloud run services update gods-eye-online \
  --region=us-central1 \
  --set-env-vars="VITE_GEMINI_API_KEY=...,KIMI_API_KEY=...,VITE_SUPABASE_URL=...,VITE_SUPABASE_ANON_KEY=..."
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GEMINI_API_KEY` | Yes | Google Gemini API key |
| `KIMI_API_KEY` | No | Moonshot Kimi K2.5 API key |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `FAL_KEY` | Yes | fal.ai API key (image/video) |

---

<div align="center">
<sub>Built by <a href="https://github.com/godseyeautomation-sketch">Gods Eye Automation</a></sub>
</div>
