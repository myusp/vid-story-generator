# Gemini TTS Integration

This document describes how to use Google's Gemini TTS and Pollinations TTS features in the vid-story-generator.

## Overview

The application now supports three TTS (Text-to-Speech) providers:

1. **Edge TTS** (default, free) - Microsoft Edge Text-to-Speech
2. **Gemini TTS** (requires API key) - Google Gemini AI Text-to-Speech with natural multilingual voices
3. **Pollinations TTS** (free) - Pollinations AI Text-to-Speech powered by OpenAI

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
# Gemini TTS API Keys (comma-separated for round-robin load balancing)
GEMINI_TTS_API_KEYS=your_gemini_tts_key_1,your_gemini_tts_key_2

# Gemini TTS Model (default: gemini-2.5-pro-preview-tts)
GEMINI_TTS_MODEL=gemini-2.5-pro-preview-tts
```

### Getting Gemini API Keys

1. Visit [Google AI Studio](https://ai.google.dev/)
2. Sign in with your Google account
3. Create a new API key
4. Copy the API key and add it to your `.env` file

**Note:** The same Gemini API key can be used for both text generation (`GEMINI_API_KEYS`) and TTS (`GEMINI_TTS_API_KEYS`).

## Available Gemini TTS Voices

Gemini TTS provides 30 multilingual voices with natural-sounding speech:

### Female Voices
- Achernar
- Aoede
- Autonoe
- Callirrhoe
- Despina
- Erinome
- Gacrux
- Kore
- Laomedeia
- Leda
- Pulcherrima
- Sulafat
- Vindemiatrix
- Zephyr

### Male Voices
- Achird
- Algenib
- Algieba
- Alnilam
- Charon
- Enceladus
- Fenrir
- Iapetus
- Orus
- Puck
- Rasalgethi
- Sadachbia
- Sadaltager
- Schedar
- Umbriel
- Zubenelgenubi

For voice samples, visit: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options

## Usage

### API Endpoint

When creating a story project, specify the TTS provider:

```bash
POST /stories/start
Content-Type: application/json

{
  "topic": "A beautiful day",
  "genre": "casual",
  "language": "en",
  "speaker": "Orus",
  "ttsProvider": "gemini-tts",
  "orientation": "PORTRAIT",
  "totalImages": 8,
  "modelProvider": "gemini"
}
```

### TTS Provider Options

- `edge-tts` (default) - Use Microsoft Edge TTS with Edge voice codes (e.g., `id-ID-ArdiNeural`)
- `gemini-tts` - Use Google Gemini TTS with Gemini voice names (e.g., `Orus`, `Achernar`)
- `pollinations-tts` - Use Pollinations TTS with voice names (e.g., `alloy`, `nova`, `shimmer`)

### Listing Available Voices

#### Edge TTS Voices
```bash
GET /speakers
```

#### Gemini TTS Voices
```bash
GET /speakers/gemini
```

#### Pollinations TTS Voices
```bash
GET /speakers/pollinations
```

## Available Pollinations TTS Voices

Pollinations TTS provides 6 multilingual voices powered by OpenAI:

- **alloy** - Neutral, professional
- **echo** - Deep, resonant
- **fable** - Storyteller vibe
- **onyx** - Warm, rich
- **nova** - Bright, friendly
- **shimmer** - Soft, melodic

All voices are multilingual and work well across different languages.

## Features

### Gemini TTS Features
- ✅ Natural-sounding multilingual voices
- ✅ High-quality audio output
- ✅ Streaming support for faster generation
- ✅ Automatic WAV conversion for unsupported formats
- ✅ API key rotation for load balancing
- ❌ Prosody control (rate, pitch, volume) - Not supported yet

### Edge TTS Features
- ✅ Free to use
- ✅ Multiple language support
- ✅ Prosody control (rate, pitch, volume)
- ✅ SSML support
- ✅ Word-level timestamps

## Implementation Details

### Architecture

The TTS system uses a coordinator pattern:

```
TtsCoordinatorService
├── TtsService (Edge TTS)
└── GeminiTtsService (Gemini TTS)
```

The coordinator routes requests to the appropriate provider based on the `ttsProvider` field.

### API Key Rotation

Gemini TTS uses the same API key rotation mechanism as text generation:
- Multiple API keys can be configured (comma-separated)
- Keys are rotated in round-robin fashion
- Provides load balancing and fallback support

### Audio Format

- Gemini TTS returns audio in various formats (typically MP3 or raw PCM)
- Automatic conversion to WAV format when needed
- Output is saved as MP3 for compatibility with video generation

## Troubleshooting

### "No Gemini TTS API keys configured"

**Solution:** Add `GEMINI_TTS_API_KEYS` to your `.env` file.

### "Gemini TTS synthesis failed"

**Possible causes:**
1. Invalid API key
2. API quota exceeded
3. Network connectivity issues

**Solution:**
- Verify API key is correct
- Check API quota in Google Cloud Console
- Check internet connectivity

### Prosody not working with Gemini TTS

Gemini TTS currently doesn't support prosody segments (rate, pitch, volume adjustments). The system will automatically fall back to regular generation and log a warning.

## Comparison: Edge TTS vs Gemini TTS vs Pollinations TTS

| Feature | Edge TTS | Gemini TTS | Pollinations TTS |
|---------|----------|------------|------------------|
| Cost | Free | Paid (API usage) | Free |
| Voice Quality | Good | Excellent | Very Good |
| Languages | 100+ | Multilingual | Multilingual |
| Voice Count | 400+ | 30 | 6 |
| Prosody Control | ✅ Yes | ❌ No | ❌ No |
| Word Timestamps | ✅ Yes | ❌ Limited | ❌ Limited |
| API Key Required | ❌ No | ✅ Yes | ❌ No |
| Setup Difficulty | Easy | Easy | Easy |
| Preview Available | ✅ Yes | 🔄 Coming Soon | ❌ No |

## Best Practices

1. **Use Edge TTS for development/testing** - It's free and works well
2. **Use Gemini TTS for production** - Better voice quality for professional videos
3. **Configure multiple API keys** - For better load balancing and reliability
4. **Monitor API usage** - Keep track of your Gemini API quota
5. **Cache generated audio** - The system already caches audio files to avoid regeneration

## Examples

### Create a story with Gemini TTS

```javascript
const response = await fetch('http://localhost:3000/stories/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    topic: 'A day in the life of a cat',
    genre: 'comedy',
    language: 'en',
    speaker: 'Zephyr',  // Female Gemini voice
    ttsProvider: 'gemini-tts',
    orientation: 'PORTRAIT',
    totalImages: 8,
    modelProvider: 'gemini'
  })
});

const project = await response.json();
console.log('Project ID:', project.id);
```

### Create a story with Pollinations TTS

```javascript
const response = await fetch('http://localhost:3000/stories/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    topic: 'A day in the life of a cat',
    genre: 'comedy',
    language: 'en',
    speaker: 'nova',  // Pollinations voice
    ttsProvider: 'pollinations-tts',
    orientation: 'PORTRAIT',
    totalImages: 8,
    modelProvider: 'gemini'
  })
});

const project = await response.json();
console.log('Project ID:', project.id);
```

```javascript
const response = await fetch('http://localhost:3000/stories/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'your-api-key'
  },
  body: JSON.stringify({
    topic: 'A day in the life of a cat',
    genre: 'comedy',
    language: 'en',
    speaker: 'en-US-JennyNeural',  // Edge TTS voice
    ttsProvider: 'edge-tts',  // or omit this field to use default
    orientation: 'PORTRAIT',
    totalImages: 8,
    modelProvider: 'gemini'
  })
});

const project = await response.json();
console.log('Project ID:', project.id);
```

## Future Enhancements

- [ ] Add prosody support for Gemini TTS
- [ ] Add voice cloning support
- [ ] Add emotion/style controls
- [ ] Add preview endpoint for Gemini voices
- [ ] Add voice-to-voice translation

## Support

For issues or questions:
1. Check the [Google Cloud Text-to-Speech documentation](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)
2. Open an issue on GitHub
3. Check application logs for detailed error messages
