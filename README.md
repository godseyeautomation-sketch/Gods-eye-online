<div align="center">

<br/>

<img src="public/favicon.svg" width="80" height="80" alt="Gods Eye Logo" />

# Gods Eye Studio v2.1

**The AI Creative Suite That Connects to Everything**

Generate images, videos, content calendars, and full marketing campaigns — powered by multi-model AI, connected to 25+ messaging channels via the Gods Eye Gateway.

[![Live Demo](https://img.shields.io/badge/Live-gods--eye--online-CCFF00?style=for-the-badge&logo=google-cloud&logoColor=black)](https://gods-eye-online-732048625045.us-central1.run.app)
[![License](https://img.shields.io/badge/License-Private-333?style=for-the-badge)](LICENSE)
<img src="https://img.shields.io/badge/Made_in-India-FF9933?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSI0IiBmaWxsPSIjMDAwMDgwIi8+PC9zdmc+" alt="Made in India">

</div>

---

## What is Gods Eye Studio?

Gods Eye Studio is the cloud-hosted creative brain of the **Gods Eye** ecosystem. It combines cutting-edge AI models into one unified workspace for agencies, creators, and anyone who wants AI that actually works.

### Creative Capabilities

- **Image Generation** — Gemini Flash, Flux Ultra, SeedDream v4.5
- **Video Generation** — Kling 3 Pro, Veo 3.1 Fast
- **Chat Intelligence** — Gemini 3.x, Kimi K2.5
- **Brand DNA Scanner** — Extract colors, fonts, tone from any website
- **Content Calendar** — Plan and schedule across 10+ social platforms
- **Skills & Agents** — Extensible skill system for custom workflows
- **Spaces** — Visual workflow canvas with drag-and-drop AI nodes

### Part of a Bigger System

Gods Eye Studio doesn't live alone. It connects to the **Gods Eye Gateway** — a local AI gateway you run on your own hardware that speaks across 25+ messaging channels.

```
Gods Eye Studio (Cloud)          Gods Eye Gateway (Local)
┌─────────────────────┐         ┌─────────────────────────┐
│  Image Generation    │         │  WhatsApp / Telegram    │
│  Video Generation    │◄──MCP──►│  Slack / Discord        │
│  Brand Intelligence  │ Bridge  │  Signal / iMessage      │
│  Content Calendar    │ :18790  │  Teams / Matrix / 25+   │
│  Workflow Spaces     │         │  macOS / iOS / Android   │
└─────────────────────┘         └─────────────────────────┘
```

**One brain, every channel.** Generate an image on the web, publish it from Telegram, review it on Discord — the brain remembers everything.

---

## The Gods Eye Ecosystem

| Component | What It Does | Repo |
|-----------|-------------|------|
| **Gods Eye Gateway** | Local AI gateway with 24 production modules, 635+ tests, 25+ channels | [gods-eye](https://github.com/bitan-del/gods-eye) |
| **Gods Eye Studio** | Cloud creative suite — image/video gen, brand intel, content calendar | This repo |
| **MCP Bridge** | WebSocket bridge connecting Studio to Gateway | Built into both |

### What the Gateway Brings

The Gods Eye Gateway (installed with one command) solves 8 problems every AI tool gets wrong:

| Problem | Solution |
|---------|----------|
| Setup Hell | `godseye quickstart` — one-command wizard with `godseye doctor` health checks |
| Cost Explosions | LiteLLM-style token budgets + RouteLLM-style smart model routing |
| Context Amnesia | Mem0-style pinned memory + structured JSON compaction |
| Runaway Agents | 3-state circuit breaker + progressive autonomy governor |
| Security Gaps | Meta LlamaFirewall-inspired 3-layer runtime firewall |
| Over-Permissioning | OWASP-aligned permission profiles + 5-layer audit trail |
| Not Beginner-Friendly | Interactive tutorial, Elm-style friendly errors, 6 agent templates |
| Channel Failures | Per-channel health diagnostics with auto-fix hints |

Install the gateway:
```bash
curl -fsSL https://raw.githubusercontent.com/bitan-del/gods-eye/main/scripts/install.sh | bash
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Tailwind CSS |
| AI Models | Gemini 3.x, Kimi K2.5, Flux, Kling, Veo |
| Backend | Express.js (API proxy + SSR) |
| Database | Supabase (auth, storage, conversations) |
| Media | fal.ai (image/video generation) |
| Deploy | Docker + Google Cloud Run |
| Gateway Bridge | MCP WebSocket (port 18790) |

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

### Connect to Gods Eye Gateway

To connect Studio to your local gateway for cross-channel AI:

```bash
# Install the gateway (if not already installed)
curl -fsSL https://raw.githubusercontent.com/bitan-del/gods-eye/main/scripts/install.sh | bash

# The quickstart wizard sets up the MCP bridge automatically
godseye quickstart
```

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

## Made in India

Gods Eye is proudly built in India. The entire ecosystem — the Gateway with its 24 modules and 635+ tests, and the Studio with its multi-model creative suite — represents Indian engineering solving real problems with world-class solutions.

**Built with intensity. Built to be unstoppable.**

---

<div align="center">
<sub>Built with intensity in India by <a href="https://github.com/bitan-del">@bitan-del</a> · <a href="https://github.com/godseyeautomation-sketch">Gods Eye Automation</a></sub>
</div>
