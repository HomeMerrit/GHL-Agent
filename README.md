# GHL AI Engagement Agent

An automated AI-powered system that identifies stalled real estate leads in GoHighLevel (GHL) and re-engages them with personalized SMS follow-ups using Claude AI.

---

## What It Does

1. Fetches recent conversations from your GHL location
2. Filters for "stalled" leads (contacts who replied but went quiet)
3. Scores each lead's engagement quality with Claude AI (0–100)
4. Filters out low-quality leads and those without seller financing signals
5. Selects the top percentage of qualified leads
6. Generates a personalized SMS for each finalist using Claude AI
7. Sends the SMS via GHL with a drip delay between sends
8. Moves contacts to the target pipeline stage and adds notes to their record

---

## Project Structure

```
GHL-Agent/
├── src/
│   ├── index.ts                 # Main orchestration pipeline
│   ├── ai/
│   │   ├── analyzer.ts          # Claude engagement scoring (0-100)
│   │   └── generator.ts         # Claude SMS message generation
│   ├── ghl/
│   │   ├── client.ts            # Axios GHL API client wrapper
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── conversations.ts     # Fetch & paginate conversations
│   │   ├── messaging.ts         # Send SMS via GHL
│   │   ├── pipeline.ts          # Move contacts to pipeline stage
│   │   └── notes.ts             # Add notes to contact records
│   └── utils/
│       ├── config.ts            # Environment config & validation
│       └── logger.ts            # Structured logging utility
├── dist/                        # Compiled JavaScript (auto-generated)
├── .env                         # Your credentials (never commit this)
├── .env.example                 # Template — copy this to .env
├── package.json
└── tsconfig.json
```

---

## Requirements

- Node.js v18+
- A GoHighLevel account with API access
- An Anthropic (Claude) API key

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Then open `.env` and fill in your values:

```env
# GoHighLevel API Configuration
GHL_API_KEY=your_ghl_api_key_here
GHL_LOCATION_ID=your_location_id_here
GHL_PIPELINE_ID=your_pipeline_id_here
GHL_PIPELINE_STAGE_ID=your_target_pipeline_stage_id_here

# Anthropic / Claude API Configuration
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Agent Behavior (optional — defaults shown)
DRY_RUN=true
TOP_PERCENT=10
MIN_ENGAGEMENT_SCORE=60
STALL_DAYS_MIN=3
SMS_DRIP_DELAY_MS=30000
MAX_MESSAGES_PER_CONVERSATION=20
CONCURRENCY_LIMIT=5
```

### 3. Where to Find Your Values

| Variable | Where to Find It |
|---|---|
| `GHL_API_KEY` | GHL → Settings → API Keys → Create Key |
| `GHL_LOCATION_ID` | GHL → Settings → scroll to bottom → Location ID |
| `GHL_PIPELINE_ID` | GHL → Opportunities → open pipeline → check browser URL |
| `GHL_PIPELINE_STAGE_ID` | Same URL as above |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create Key |

---

## Running the Agent

### Test First (Dry Run)

Make sure `DRY_RUN=true` in your `.env`. This logs all actions without sending any SMS or modifying GHL records.

```bash
npm run dev
```

### Run in Production

Set `DRY_RUN=false` in your `.env`, then:

```bash
# Option A: Run TypeScript directly
npm run dev

# Option B: Compile then run
npm run build
npm start
```

---

## Environment Variables Reference

### Required

| Variable | Description |
|---|---|
| `GHL_API_KEY` | GoHighLevel API authentication token |
| `GHL_LOCATION_ID` | GHL location/workspace ID |
| `GHL_PIPELINE_ID` | GHL pipeline ID for creating opportunities |
| `GHL_PIPELINE_STAGE_ID` | Target pipeline stage to move contacts into |
| `ANTHROPIC_API_KEY` | Claude API key from Anthropic |

### Optional (with defaults)

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | Log all actions without sending SMS or modifying GHL |
| `TOP_PERCENT` | `10` | % of qualified contacts to target per run |
| `MIN_ENGAGEMENT_SCORE` | `60` | Minimum Claude score (0–100) required to proceed |
| `STALL_DAYS_MIN` | `3` | Days since last inbound message to consider "stalled" |
| `SMS_DRIP_DELAY_MS` | `30000` | Milliseconds between SMS sends (default = 30 seconds) |
| `MAX_MESSAGES_PER_CONVERSATION` | `20` | Max messages fetched per conversation for AI analysis |
| `CONCURRENCY_LIMIT` | `5` | Max concurrent Claude API calls during scoring |

---

## How the Pipeline Works

```
Fetch Conversations (last 30 days)
        ↓
Filter: Stalled leads only (last inbound >= STALL_DAYS_MIN days ago)
        ↓
Score each lead with Claude AI (0–100)
        ↓
Filter: sellerFinancingImplied = true AND score >= MIN_ENGAGEMENT_SCORE
        ↓
Select top TOP_PERCENT by score
        ↓
Generate personalized SMS for each finalist (Claude AI)
        ↓
Send SMS via GHL (with SMS_DRIP_DELAY_MS between sends)
        ↓
Move contact to target pipeline stage + add note to record
```

### Scoring Logic

Claude analyzes each conversation and returns:
- **score** (0–100) — engagement warmth
- **rationale** — why they scored this way
- **sellerFinancingImplied** — did the contact show openness to seller financing?

Only leads with `sellerFinancingImplied = true` AND `score >= MIN_ENGAGEMENT_SCORE` proceed.

### Message Generation

Claude generates a personalized SMS under 300 characters that:
- References specific details from the conversation
- Is warm and non-pushy
- Highlights relevant seller financing benefits (tax deferral, monthly income, etc.)

---

## Dry Run Mode

Set `DRY_RUN=true` to safely test the full pipeline without:
- Sending any SMS messages
- Moving contacts in your pipeline
- Adding notes to contact records

All actions are logged so you can review what would have happened.

---

## npm Scripts

| Script | Command | Description |
|---|---|---|
| `dev` | `ts-node src/index.ts` | Run agent directly from TypeScript source |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/index.js` | Run compiled agent |
| `lint` | `eslint src/**/*.ts` | Lint source files |

---

## Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Claude API client for scoring and message generation |
| `axios` | HTTP client for GHL REST API calls |
| `dotenv` | Load environment variables from `.env` |
| `p-limit` | Limit concurrent async operations (controls Claude API rate) |

---

## Security Notes

- **Never commit your `.env` file** — it contains live API keys
- `.env` is already in `.gitignore`
- Use `DRY_RUN=true` whenever testing changes
- The agent only reads/writes to contacts within your GHL location

---

## Troubleshooting

**Agent finds 0 stalled conversations**
- Lower `STALL_DAYS_MIN` (try `1` or `2`)
- Check your `GHL_LOCATION_ID` is correct

**All leads filtered out after scoring**
- Lower `MIN_ENGAGEMENT_SCORE` (try `40`)
- Increase `TOP_PERCENT` (try `25`)

**SMS not sending**
- Make sure `DRY_RUN=false`
- Verify your `GHL_API_KEY` has messaging permissions

**Claude API errors**
- Check your `ANTHROPIC_API_KEY` is valid
- Lower `CONCURRENCY_LIMIT` if hitting rate limits

---

## License

Private — internal use only.
