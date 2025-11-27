import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { ApiKeyRollingService } from './api-key-rolling.service';

export interface SceneData {
  order: number;
  imagePrompt: string;
  narration: string;
}

export interface StoryMetadata {
  title: string;
  description: string;
  hashtags: string;
}

export interface NarrationOnly {
  order: number;
  narration: string;
}

export interface ImagePromptData {
  order: number;
  imagePrompt: string;
}

export interface AnimationData {
  animationIn?: string;
  animationShow?: string;
  animationOut?: string;
}

export interface BatchImagePromptResult {
  scenes: Array<{
    order: number;
    imagePrompt: string;
  }>;
}

export interface BatchSSMLResult {
  scenes: Array<{
    order: number;
    ssml: string;
  }>;
}

/**
 * Prosody segment for expressive speech
 * Since edge-tts-universal doesn't support SSML, we split narration into parts
 * with different prosody settings (rate, volume, pitch)
 */
export interface ProsodySegment {
  text: string;
  rate: string; // e.g., '-10%', '+20%', '+0%'
  volume: string; // e.g., '+10%', '-5%', '+0%'
  pitch: string; // e.g., '+10Hz', '-5Hz', '+0Hz'
}

export interface ProsodyData {
  order: number;
  segments: ProsodySegment[];
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly batchSize: number;

  constructor(
    private configService: ConfigService,
    private apiKeyRolling: ApiKeyRollingService,
  ) {
    this.maxRetries = parseInt(
      configService.get<string>('AI_MAX_RETRIES', '3'),
    );
    this.retryDelay = parseInt(
      configService.get<string>('AI_RETRY_DELAY_MS', '10000'),
    );
    this.batchSize = parseInt(configService.get<string>('AI_BATCH_SIZE', '4'));
  }

  async generateStoryMetadata(
    topic: string,
    genre: string,
    language: string,
    provider: 'gemini' | 'openai',
  ): Promise<StoryMetadata> {
    const prompt = `Generate a compelling title, description, and hashtags for a short video about: "${topic}" in ${genre} genre. Language: ${language}.

Return ONLY a JSON object in this exact format:
{
  "title": "engaging title here",
  "description": "brief description here",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3"
}`;

    const response = await this.callAIWithRetry(prompt, provider);
    return JSON.parse(this.extractJSON(response));
  }

  /**
   * Step 1: Generate narrations only
   */
  async generateNarrations(
    topic: string,
    genre: string,
    language: string,
    totalScenes: number,
    narrativeTone: string,
    provider: 'gemini' | 'openai',
  ): Promise<NarrationOnly[]> {
    const toneDescription = narrativeTone
      ? ` with a ${narrativeTone} tone`
      : '';
    const prompt = `Create a story for a ${totalScenes}-scene short video about: "${topic}" in ${genre} genre${toneDescription}. Language: ${language}.

Generate ONLY the narration text for each scene. Make it engaging and suitable for shorts format.

Return ONLY a JSON array in this exact format:
[
  {
    "order": 1,
    "narration": "narration text in ${language}"
  }
]

Create exactly ${totalScenes} narrations.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const narrations = JSON.parse(this.extractJSON(response));

    return narrations.map((item: any, index: number) => ({
      order: item.order || index + 1,
      narration: item.narration,
    }));
  }

  /**
   * Generate narrations from a story prompt (user provides the plot outline)
   */
  async generateNarrationsFromPrompt(
    storyPrompt: string,
    genre: string,
    language: string,
    totalScenes: number,
    narrativeTone: string,
    provider: 'gemini' | 'openai',
  ): Promise<NarrationOnly[]> {
    const toneDescription = narrativeTone
      ? ` with a ${narrativeTone} tone`
      : '';
    const prompt = `Create narrations for a ${totalScenes}-scene short video based on this story outline:

"${storyPrompt}"

Genre: ${genre}
Language: ${language}
Style: ${toneDescription}

Generate ONLY the narration text for each scene. Each narration should be a single paragraph that flows naturally when spoken.
Make it engaging and suitable for shorts format.

Return ONLY a JSON array in this exact format:
[
  {
    "order": 1,
    "narration": "narration text in ${language}"
  }
]

Create exactly ${totalScenes} narrations that tell the complete story.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const narrations = JSON.parse(this.extractJSON(response));

    return narrations.map((item: any, index: number) => ({
      order: item.order || index + 1,
      narration: item.narration,
    }));
  }

  /**
   * Generate character descriptions for consistent imagery across all scenes
   */
  async generateCharacterDescriptions(
    topic: string,
    allNarrations: string,
    imageStyle: string,
    provider: 'gemini' | 'openai',
  ): Promise<string> {
    const styleDescription = imageStyle ? ` in ${imageStyle} style` : '';
    const prompt = `Based on this story topic and narrations, identify and describe ALL characters that appear in the story.

Topic: ${topic}

Narrations:
${allNarrations}

For each character, provide a detailed, consistent visual description${styleDescription} that can be used for AI image generation.

Include:
- Physical appearance (age, height, build, hair, eyes, skin tone)
- Clothing/outfit (be specific and consistent)
- Distinctive features or accessories
- Personality-based visual cues (posture, expression tendency)

Return ONLY a JSON object with character names as keys:
{
  "Main Character Name": "Detailed visual description for consistent imagery...",
  "Another Character": "Their detailed visual description..."
}

Note: Use consistent naming (e.g., if narration says "Ayah", describe as "Ayah (Father)" or just "Father").
The descriptions should be detailed enough to generate consistent images across multiple scenes.`;

    const response = await this.callAIWithRetry(prompt, provider);
    return response;
  }

  /**
   * Step 2: Generate image prompts in batches
   */
  async generateImagePromptsBatch(
    narrations: Array<{ order: number; narration: string }>,
    imageStyle: string,
    provider: 'gemini' | 'openai',
    characterDescriptions?: string,
  ): Promise<ImagePromptData[]> {
    const results: ImagePromptData[] = [];

    // Process in batches
    for (let i = 0; i < narrations.length; i += this.batchSize) {
      const batch = narrations.slice(i, i + this.batchSize);
      this.logger.log(
        `Processing image prompts batch ${Math.floor(i / this.batchSize) + 1}: scenes ${batch.map((n) => n.order).join(', ')}`,
      );

      try {
        const batchResults = await this.generateImagePromptBatch(
          batch,
          imageStyle,
          provider,
          characterDescriptions,
        );

        // Create a map for O(1) lookups
        const resultMap = new Map(batchResults.map((r) => [r.order, r]));

        // Validate batch results and match them back to original narrations
        for (const narration of batch) {
          const result = resultMap.get(narration.order);
          if (result && result.imagePrompt) {
            results.push(result);
          } else {
            // Fallback: generate individually if batch result is missing
            this.logger.warn(
              `Missing result for scene ${narration.order}, generating individually`,
            );
            const singlePrompt = await this.generateImagePrompt(
              narration.narration,
              imageStyle,
              provider,
              characterDescriptions,
            );
            results.push({
              order: narration.order,
              imagePrompt: singlePrompt,
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Batch failed for scenes ${batch.map((n) => n.order).join(', ')}, falling back to individual generation: ${error.message}`,
        );
        // Fallback: generate each one individually
        for (const narration of batch) {
          const singlePrompt = await this.generateImagePrompt(
            narration.narration,
            imageStyle,
            provider,
            characterDescriptions,
          );
          results.push({
            order: narration.order,
            imagePrompt: singlePrompt,
          });
        }
      }
    }

    return results.sort((a, b) => a.order - b.order);
  }

  private async generateImagePromptBatch(
    narrations: Array<{ order: number; narration: string }>,
    imageStyle: string,
    provider: 'gemini' | 'openai',
    characterDescriptions?: string,
  ): Promise<ImagePromptData[]> {
    const styleDescription = imageStyle ? ` in ${imageStyle} style` : '';
    const narrationsText = narrations
      .map((n) => `Scene ${n.order}: "${n.narration}"`)
      .join('\n');

    // Include character descriptions if available for consistent imagery
    const characterContext = characterDescriptions
      ? `\n\nCHARACTER DESCRIPTIONS (use these for consistent character appearances):\n${characterDescriptions}\n`
      : '';

    const prompt = `Based on these narrations, generate detailed image generation prompts${styleDescription}:
${characterContext}
${narrationsText}

For EACH scene listed above, create a prompt that includes:
- Main subject/characters (use the character descriptions above for consistency if they appear in the scene)
- Setting/environment
- Mood/atmosphere
- Visual details
- Composition

IMPORTANT: 
1. You MUST return a result for EACH scene with the EXACT order number specified above.
2. If a character from the character descriptions appears in the scene, use their exact visual description.
3. Keep character appearances consistent across all scenes.

Return ONLY a JSON array in this exact format (one entry for EACH scene):
[
  {
    "order": 1,
    "imagePrompt": "detailed visual description for AI image generation"
  }
]

Generate exactly ${narrations.length} results, one for each scene.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const results = JSON.parse(this.extractJSON(response));

    return results.map((item: any, index: number) => ({
      order: item.order != null ? parseInt(String(item.order), 10) : index + 1,
      imagePrompt: item.imagePrompt || '',
    }));
  }

  /**
   * Step 2b: Generate image prompt for a single narration (fallback)
   */
  async generateImagePrompt(
    narration: string,
    imageStyle: string,
    provider: 'gemini' | 'openai',
    characterDescriptions?: string,
  ): Promise<string> {
    const styleDescription = imageStyle ? ` in ${imageStyle} style` : '';
    const characterContext = characterDescriptions
      ? `\n\nCHARACTER DESCRIPTIONS (use these for consistent character appearances):\n${characterDescriptions}\n`
      : '';

    const prompt = `Based on this narration: "${narration}"
${characterContext}
Generate a detailed image generation prompt${styleDescription} that visually represents this scene.

The prompt should be in English and describe:
- Main subject/characters (use the character descriptions above if they appear in this scene)
- Setting/environment
- Mood/atmosphere
- Visual details
- Composition

Return ONLY the image prompt as plain text, no JSON.`;

    return await this.callAIWithRetry(prompt, provider);
  }

  /**
   * Step 3: Generate prosody segments in batches for expressive speech
   * Edge-tts-universal supports prosody options (rate, volume, pitch) per synthesis call.
   * We split narration into segments with different prosody settings for expressive delivery.
   */
  async generateProsodyBatch(
    narrations: Array<{ order: number; narration: string }>,
    narrativeTone: string,
    provider: 'gemini' | 'openai',
  ): Promise<ProsodyData[]> {
    const results: ProsodyData[] = [];

    // Process in batches
    for (let i = 0; i < narrations.length; i += this.batchSize) {
      const batch = narrations.slice(i, i + this.batchSize);
      this.logger.log(
        `Processing prosody batch ${Math.floor(i / this.batchSize) + 1}: scenes ${batch.map((n) => n.order).join(', ')}`,
      );

      try {
        const batchResults = await this.generateProsodyBatchInternal(
          batch,
          narrativeTone,
          provider,
        );

        // Create a map for O(1) lookups
        const resultMap = new Map(batchResults.map((r) => [r.order, r]));

        // Validate and match back to original narrations
        for (const narration of batch) {
          const result = resultMap.get(narration.order);
          if (result && result.segments && result.segments.length > 0) {
            results.push(result);
          } else {
            // Fallback: create simple prosody data
            this.logger.warn(
              `Missing prosody result for scene ${narration.order}, using default`,
            );
            results.push({
              order: narration.order,
              segments: [
                {
                  text: narration.narration,
                  rate: '+0%',
                  volume: '+0%',
                  pitch: '+0Hz',
                },
              ],
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Prosody batch failed for scenes ${batch.map((n) => n.order).join(', ')}, using defaults: ${error.message}`,
        );
        // Fallback: create simple prosody data for each
        for (const narration of batch) {
          results.push({
            order: narration.order,
            segments: [
              {
                text: narration.narration,
                rate: '+0%',
                volume: '+0%',
                pitch: '+0Hz',
              },
            ],
          });
        }
      }
    }

    return results.sort((a, b) => a.order - b.order);
  }

  private async generateProsodyBatchInternal(
    narrations: Array<{ order: number; narration: string }>,
    narrativeTone: string,
    provider: 'gemini' | 'openai',
  ): Promise<ProsodyData[]> {
    const toneDescription = narrativeTone
      ? ` with a ${narrativeTone} delivery style`
      : '';
    const narrationsText = narrations
      .map((n) => `Scene ${n.order}: "${n.narration}"`)
      .join('\n');

    const prompt = `Split these narrations into expressive speech segments${toneDescription}.

For each narration, analyze the emotional content and split it into parts with appropriate prosody (rate, volume, pitch).

Examples:
- Normal text: rate="+0%", volume="+0%", pitch="+0Hz"
- Excited/surprise (like "Duar!!!"): rate="+10%", volume="+50%", pitch="+10Hz"
- Slow/suspenseful: rate="-20%", volume="-10%", pitch="-5Hz"
- Sad/soft: rate="-10%", volume="-20%", pitch="-10Hz"
- Fast action: rate="+15%", volume="+10%", pitch="+0Hz"
- Whisper/mystery: rate="-15%", volume="-30%", pitch="-5Hz"
- Dramatic pause before: rate="-25%", volume="+0%", pitch="+0Hz"

Narrations:
${narrationsText}

IMPORTANT: You MUST return a result for EACH scene with the EXACT order number specified above.

Return ONLY a JSON array with prosody segments for each scene:
[
  {
    "order": 1,
    "segments": [
      {"text": "first part of narration", "rate": "+0%", "volume": "+0%", "pitch": "+0Hz"},
      {"text": "exciting part!", "rate": "+10%", "volume": "+30%", "pitch": "+5Hz"},
      {"text": "calm ending.", "rate": "-5%", "volume": "+0%", "pitch": "+0Hz"}
    ]
  }
]

Rules:
1. Split based on emotional changes, punctuation, and meaning
2. Each segment should be a complete phrase (don't split mid-word)
3. The combined segments should equal the full narration text
4. Use realistic prosody values (rate: -30% to +30%, volume: -50% to +50%, pitch: -20Hz to +20Hz)
5. Generate exactly ${narrations.length} results, one for each scene.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const results = JSON.parse(this.extractJSON(response));

    return results.map((item: any, index: number) => ({
      order: item.order != null ? parseInt(String(item.order), 10) : index + 1,
      segments: (item.segments || []).map((s: any) => ({
        text: s.text || '',
        rate: s.rate || '+0%',
        volume: s.volume || '+0%',
        pitch: s.pitch || '+0Hz',
      })),
    }));
  }

  /**
   * Legacy SSML generation - kept for backwards compatibility
   * Step 3: Generate SSML in batches
   */
  async generateSSMLBatch(
    narrations: Array<{ order: number; narration: string }>,
    speaker: string,
    provider: 'gemini' | 'openai',
  ): Promise<Array<{ order: number; ssml: string }>> {
    const results: Array<{ order: number; ssml: string }> = [];

    // Process in batches
    for (let i = 0; i < narrations.length; i += this.batchSize) {
      const batch = narrations.slice(i, i + this.batchSize);
      const batchResults = await this.generateSSMLBatchInternal(
        batch,
        speaker,
        provider,
      );
      results.push(...batchResults);
    }

    return results.sort((a, b) => a.order - b.order);
  }

  private async generateSSMLBatchInternal(
    narrations: Array<{ order: number; narration: string }>,
    speaker: string,
    provider: 'gemini' | 'openai',
  ): Promise<Array<{ order: number; ssml: string }>> {
    const narrationsText = narrations
      .map((n) => `Scene ${n.order}: "${n.narration}"`)
      .join('\n');

    const prompt = `Convert these narrations to SSML format with expressive elements for speaker "${speaker}":

${narrationsText}

Add appropriate:
- <break> tags for pauses (short, medium, long)
- <emphasis> tags for important words
- <prosody> tags for rate/pitch variation where needed

Return ONLY a JSON array with SSML for each scene:
[
  {
    "order": 1,
    "ssml": "<speak><voice name=\\"${speaker}\\">...</voice></speak>"
  }
]`;

    const response = await this.callAIWithRetry(prompt, provider);
    const results = JSON.parse(this.extractJSON(response));

    return results.map((item: any) => ({
      order: item.order,
      ssml: item.ssml,
    }));
  }

  /**
   * Step 4: Determine animations for a scene
   * Uses enhanced Ken Burns effects for more engaging video
   */
  async generateAnimations(
    narration: string,
    provider: 'gemini' | 'openai',
  ): Promise<AnimationData> {
    const prompt = `Based on this narration: "${narration}"

Suggest appropriate Ken Burns style animations for the image in this scene. Choose from these options:

- animationIn (entrance): fade, zoom-in, zoom-out, none
- animationShow (main movement - ALWAYS use one of these for engaging video):
  * pan-left: Camera moves from right to left - good for action, movement
  * pan-right: Camera moves from left to right - good for journey, progress
  * pan-up: Camera moves from bottom to top - good for revealing, inspiration
  * pan-down: Camera moves from top to bottom - good for descending, suspense
  * pan-diagonal-left: Diagonal movement top-right to bottom-left - dynamic
  * pan-diagonal-right: Diagonal movement top-left to bottom-right - dynamic
  * zoom-slow: Gentle zoom in - good for focus, intimacy
  * zoom-in: Dramatic zoom in - good for climax, emphasis
  * zoom-out: Zoom out - good for reveal, context
  * zoom-pan-left: Zoom while panning left - very dynamic action
  * zoom-pan-right: Zoom while panning right - very dynamic action
- animationOut (exit): fade, zoom-in, zoom-out, none

IMPORTANT: 
- ALWAYS include animationShow for every scene to keep viewers engaged
- Vary animations between scenes - don't repeat the same animation consecutively
- Match animation to mood: action=pan/zoom-pan, suspense=zoom-slow, reveal=zoom-out, etc.

Return ONLY a JSON object:
{
  "animationIn": "fade",
  "animationShow": "pan-right",
  "animationOut": "fade"
}`;

    const response = await this.callAIWithRetry(prompt, provider);
    const animations = JSON.parse(this.extractJSON(response));

    // Ensure animationShow always has a value for engaging video
    if (
      !animations.animationShow ||
      animations.animationShow === 'none' ||
      animations.animationShow === 'static'
    ) {
      const defaultAnimations = [
        'pan-left',
        'pan-right',
        'pan-up',
        'pan-down',
        'zoom-slow',
        'zoom-in',
      ];
      animations.animationShow =
        defaultAnimations[Math.floor(Math.random() * defaultAnimations.length)];
    }

    return {
      animationIn: animations.animationIn || 'fade',
      animationShow: animations.animationShow,
      animationOut: animations.animationOut || 'fade',
    };
  }

  async generateScenes(
    topic: string,
    genre: string,
    language: string,
    totalImages: number,
    provider: 'gemini' | 'openai',
  ): Promise<SceneData[]> {
    const prompt = `Create a story for a ${totalImages}-scene short video about: "${topic}" in ${genre} genre. Language: ${language}.

For each scene, provide:
1. A detailed image generation prompt (in English, visual description)
2. Narration text (in ${language})

Return ONLY a JSON array in this exact format:
[
  {
    "order": 1,
    "imagePrompt": "detailed visual description for AI image generation",
    "narration": "narration text in ${language}"
  }
]

Create exactly ${totalImages} scenes. Make it engaging and suitable for shorts format.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const scenes = JSON.parse(this.extractJSON(response));

    return scenes.map((scene: any, index: number) => ({
      order: scene.order || index + 1,
      imagePrompt: scene.imagePrompt,
      narration: scene.narration,
    }));
  }

  /**
   * Call AI with retry logic, API key rotation, and model fallback
   */
  private async callAIWithRetry(
    prompt: string,
    provider: 'gemini' | 'openai',
    retryCount: number = 0,
    failedKeys: Set<string> = new Set(),
  ): Promise<string> {
    try {
      if (provider === 'gemini') {
        return await this.callGemini(prompt);
      } else {
        return await this.callOpenAI(prompt);
      }
    } catch (error) {
      const currentProvider = provider;

      // Try with different API key of the same provider
      if (retryCount < this.maxRetries) {
        this.logger.warn(
          `AI call failed with ${currentProvider} (attempt ${retryCount + 1}/${this.maxRetries + 1}): ${error.message}. Retrying with next API key in ${this.retryDelay}ms...`,
        );
        await this.sleep(this.retryDelay);

        // Try with next API key from the same provider
        return this.callAIWithRetry(
          prompt,
          currentProvider,
          retryCount + 1,
          failedKeys,
        );
      }

      // If all retries with current provider failed, try switching to alternate provider
      const alternateProvider =
        currentProvider === 'gemini' ? 'openai' : 'gemini';
      const hasAlternateKeys =
        alternateProvider === 'gemini'
          ? this.apiKeyRolling.hasGeminiKeys()
          : this.apiKeyRolling.hasOpenAIKeys();

      if (hasAlternateKeys && !failedKeys.has(alternateProvider)) {
        this.logger.warn(
          `All ${currentProvider} attempts failed. Switching to ${alternateProvider}...`,
        );
        failedKeys.add(currentProvider);

        try {
          return await this.callAIWithRetry(
            prompt,
            alternateProvider,
            0,
            failedKeys,
          );
        } catch (altError) {
          this.logger.error(
            `Both providers failed. ${currentProvider}: ${error.message}, ${alternateProvider}: ${altError.message}`,
          );
          throw error;
        }
      }

      this.logger.error(
        `AI call failed after ${this.maxRetries + 1} attempts with ${currentProvider}: ${error.message}`,
      );
      throw error;
    }
  }

  private async callGemini(prompt: string): Promise<string> {
    const apiKey = this.apiKeyRolling.getNextGeminiKey();
    // Note: GoogleGenerativeAI doesn't support custom baseURL in current version
    // const baseUrl = this.configService.get<string>('GEMINI_API_URL');
    const modelName = this.configService.get<string>(
      'GEMINI_MODEL',
      'gemini-2.0-flash-exp',
    );

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const apiKey = this.apiKeyRolling.getNextOpenAIKey();
    const baseURL = this.configService.get<string>('OPENAI_API_URL');
    const modelName = this.configService.get<string>(
      'OPENAI_MODEL',
      'gpt-4o-mini',
    );

    const openai = new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
    });

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    return completion.choices[0].message.content || '';
  }

  private extractJSON(text: string): string {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(
      /```(?:json)?\s*(\[[\s\S]*?\]|\{[\s\S]*?\})\s*```/,
    );
    if (jsonMatch) {
      return jsonMatch[1];
    }

    // Try to find JSON array or object in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return arrayMatch[0];
    }

    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return objectMatch[0];
    }

    return text.trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
