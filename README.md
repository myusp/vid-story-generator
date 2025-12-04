# Shorts Story Generator - Backend

Backend API for generating AI-powered short video stories with Azure TTS and Polinations AI image generation.

## Features

- 🤖 AI-powered story generation (Gemini/OpenAI with round-robin API key rotation)
- 🎙️ Text-to-Speech with **Edge TTS** (free) or **Gemini TTS** (premium quality)
- 🖼️ Polinations AI image generation with automatic retry
- 🎬 FFmpeg video rendering pipeline
- 📝 SRT subtitle generation
- 📊 Real-time progress monitoring with SSE
- 📚 Swagger API documentation
- 🔒 API key authentication
- 💾 SQLite database with Prisma ORM
- 🔄 Automatic retry with exponential backoff for network errors

## Tech Stack

- **NestJS** - Backend framework
- **Prisma** - Database ORM
- **SQLite** - Database
- **Swagger** - API documentation
- **Edge TTS** - Free Text-to-Speech (Microsoft)
- **Gemini TTS** - Premium Text-to-Speech (Google)
- **Polinations AI** - Image generation
- **FFmpeg** - Video rendering
- **Google Gemini / OpenAI** - Story generation
- **axios-retry** - Automatic retry with exponential backoff

## Prerequisites

- Node.js 20+
- FFmpeg installed on the system
- **Optional**: Gemini API key for Gemini TTS (premium voices)
- Gemini or OpenAI API keys for story generation

## Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Configure your API keys in .env

# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Build the project
npm run build
```

## Environment Variables

See `.env.example` for all required environment variables.

### TTS Providers

The application supports two TTS providers:

1. **Edge TTS** (default, free) - No API key required, 100+ voices in multiple languages
2. **Gemini TTS** (premium) - Requires Gemini API key, 30 natural-sounding multilingual voices

For detailed information about Gemini TTS setup and usage, see [docs/GEMINI_TTS.md](docs/GEMINI_TTS.md).

## Running the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000`
Swagger documentation at `http://localhost:3000/api`

## API Endpoints

### Stories

- `POST /stories/start` - Start a new story project
- `POST /stories/:id/generate` - Generate scenes and video
- `GET /stories` - List all projects
- `GET /stories/:id` - Get project details
- `GET /stories/:id/scenes` - Get project scenes
- `GET /stories/:id/logs` - Get project logs
- `GET /stories/:id/logs/stream` - Stream logs in real-time (SSE)

### Speakers

- `GET /speakers` - List available Edge TTS speakers
- `GET /speakers/gemini` - List available Gemini TTS speakers
- `GET /speakers/locale?locale=en-US` - Filter speakers by locale
- `GET /speakers/popular` - Get popular/commonly used speakers
- `GET /speakers/preview?speaker=<name>&text=<text>` - Preview speaker voice

## Project Structure

```
src/
├── modules/
│   ├── story/          # Story management
│   ├── scenes/         # Scene management
│   ├── logs/           # Logging and SSE
│   └── speakers/       # TTS speaker info
├── common/
│   ├── ai/             # AI service (Gemini/OpenAI)
│   ├── tts/            # TTS services (Edge TTS & Gemini TTS)
│   ├── image/          # Polinations AI service
│   ├── ffmpeg/         # Video rendering
│   ├── prisma/         # Database service
│   ├── guards/         # API key guard
│   ├── dto/            # Data transfer objects
│   ├── enums/          # Enums
│   └── utils/          # Utilities (SRT generation)
└── main.ts
```

## Storage Structure

```
storage/
├── videos/             # Final rendered videos
├── subtitles/          # SRT subtitle files
├── images/             # Generated images
├── audio/              # TTS audio files
└── tmp/                # Temporary files
```

## Status Flow

1. `PENDING` - Project created
2. `STORY_PROMPT_READY` - Metadata generated
3. `GENERATING_SCENES` - Generating story scenes
4. `GENERATING_IMAGES` - Generating images
5. `GENERATING_TTS` - Generating audio
6. `RENDERING_VIDEO` - Rendering final video
7. `COMPLETED` - Done
8. `FAILED` - Error occurred

## API Key Rolling

The system supports round-robin API key rotation for both Gemini and OpenAI to handle rate limits effectively. Configure multiple keys separated by commas in the environment variables.

## Error Handling & Retry Mechanism

### Image Generation Retry
The image service automatically retries failed requests using `axios-retry` with the following configuration:

- **Retries**: Up to 5 attempts
- **Retry Delay**: Exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Retry Conditions**: 
  - Network errors (ECONNRESET, ETIMEDOUT, etc.)
  - HTTP 5xx status codes (500, 502, 503, 504, etc.)
- **Logging**: Each retry attempt is logged with the error message

This helps handle temporary issues with the Polinations AI service, such as:
- 502 Bad Gateway errors
- Network timeouts
- Service temporary unavailability

### AI Service Retry
The AI service implements intelligent retry logic with model fallback:
- Primary model fails → fallback to secondary model
- Automatic retry with configurable delays
- Batch processing for prosody data

## License

ISC
