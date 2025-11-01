# Migration to Mastra Framework

## Overview

This document describes the migration from direct OpenAI API calls to the Mastra framework for handling transcription.

## What Changed

### Dependencies Added
- `@mastra/core@0.23.3` - Core Mastra framework
- `@mastra/voice-openai@0.11.11` - Mastra's OpenAI voice provider

### Files Modified
- `server/server.js` - Updated to import from `mastra-transcription` instead of `transcription`
- `README.md` - Updated documentation to mention Mastra
- `package.json` - Updated test script to run Mastra integration tests

### Files Created
- `server/mastra-transcription.js` - New transcription implementation using Mastra
- `test-mastra.js` - Comprehensive integration tests for Mastra

### Files Removed
- `server/transcription.js` - Original implementation (replaced by mastra-transcription.js)

## Environment Variables

The system now supports both:

1. **OpenAI Hosted API** (recommended for production):
   ```bash
   OPENAI_API_KEY=your-openai-api-key
   ```

2. **Self-hosted Whisper** (for custom deployments):
   ```bash
   WHISPER_API_KEY=your-api-key
   WHISPER_BASE_URL=http://localhost:11434
   ```

Additional settings (unchanged):
```bash
TRANSCRIPT_LANG=en              # Language code (default: en)
TRANSCRIPT_OUTPUT=vtt           # Output format (default: vtt)
TRANSCRIPT_CHUNK_MIN=15         # Chunk size in minutes (default: 15)
```

## Benefits of Mastra

1. **Clean Abstraction**: Mastra provides a higher-level API for working with OpenAI services
2. **Better Configuration**: Centralized client management and configuration
3. **Type Safety**: Better TypeScript support and type definitions
4. **Maintainability**: Easier to update and maintain as APIs evolve
5. **Flexibility**: Easy to switch between hosted and self-hosted endpoints

## Backward Compatibility

The migration maintains 100% backward compatibility:
- All existing API endpoints work unchanged
- Environment variable names are the same (with OPENAI_API_KEY as an alternative)
- VTT output format is preserved
- Chunking and timestamp shifting functionality is identical

## Testing

Run the integration tests:
```bash
npm test
```

The tests verify:
- ✓ Mastra module loading
- ✓ OpenAIVoice initialization
- ✓ Transcription module exports
- ✓ Environment variable configuration

## Security

- ✅ No vulnerabilities found in Mastra dependencies
- ✅ CodeQL security scan passed with 0 alerts
- ✅ All API keys properly secured via environment variables

## Migration Steps (for developers)

If you're running this project:

1. **Update dependencies**:
   ```bash
   npm install
   ```

2. **Set environment variable** (if not already set):
   ```bash
   export OPENAI_API_KEY=your-key-here
   # OR
   export WHISPER_API_KEY=your-key-here
   ```

3. **Build and test**:
   ```bash
   npm run build
   npm test
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

That's it! The system will automatically use Mastra for all transcription operations.
