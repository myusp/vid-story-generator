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
   * Step 2: Generate image prompts in batches
   */
  async generateImagePromptsBatch(
    narrations: Array<{ order: number; narration: string }>,
    imageStyle: string,
    provider: 'gemini' | 'openai',
  ): Promise<ImagePromptData[]> {
    const results: ImagePromptData[] = [];

    // Process in batches
    for (let i = 0; i < narrations.length; i += this.batchSize) {
      const batch = narrations.slice(i, i + this.batchSize);
      const batchResults = await this.generateImagePromptBatch(
        batch,
        imageStyle,
        provider,
      );
      results.push(...batchResults);
    }

    return results.sort((a, b) => a.order - b.order);
  }

  private async generateImagePromptBatch(
    narrations: Array<{ order: number; narration: string }>,
    imageStyle: string,
    provider: 'gemini' | 'openai',
  ): Promise<ImagePromptData[]> {
    const styleDescription = imageStyle ? ` in ${imageStyle} style` : '';
    const narrationsText = narrations
      .map((n) => `Scene ${n.order}: "${n.narration}"`)
      .join('\n');

    const prompt = `Based on these narrations, generate detailed image generation prompts${styleDescription}:

${narrationsText}

For each scene, create a prompt that includes:
- Main subject/characters
- Setting/environment
- Mood/atmosphere
- Visual details
- Composition

Return ONLY a JSON array in this exact format:
[
  {
    "order": 1,
    "imagePrompt": "detailed visual description for AI image generation"
  }
]`;

    const response = await this.callAIWithRetry(prompt, provider);
    const results = JSON.parse(this.extractJSON(response));

    return results.map((item: any) => ({
      order: item.order,
      imagePrompt: item.imagePrompt,
    }));
  }

  /**
   * Step 2b: Generate image prompt for a single narration (fallback)
   */
  async generateImagePrompt(
    narration: string,
    imageStyle: string,
    provider: 'gemini' | 'openai',
  ): Promise<string> {
    const styleDescription = imageStyle ? ` in ${imageStyle} style` : '';
    const prompt = `Based on this narration: "${narration}"

Generate a detailed image generation prompt${styleDescription} that visually represents this scene.

The prompt should be in English and describe:
- Main subject/characters
- Setting/environment
- Mood/atmosphere
- Visual details
- Composition

Return ONLY the image prompt as plain text, no JSON.`;

    return await this.callAIWithRetry(prompt, provider);
  }

  /**
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
   */
  async generateAnimations(
    narration: string,
    provider: 'gemini' | 'openai',
  ): Promise<AnimationData> {
    const prompt = `Based on this narration: "${narration}"

Suggest appropriate Ken Burns style animations for the image in this scene. Choose from these options:
- animationIn: fade, slide-left, slide-right, slide-up, slide-down, zoom-in, zoom-out, none
- animationShow: pan-left, pan-right, pan-up, pan-down, zoom-slow, static, none  
- animationOut: fade, slide-left, slide-right, slide-up, slide-down, zoom-in, zoom-out, none

Return ONLY a JSON object (animations are optional based on narration mood):
{
  "animationIn": "fade",
  "animationShow": "pan-right",
  "animationOut": "zoom-out"
}

If no animation is needed for a particular transition, you can omit that field.`;

    const response = await this.callAIWithRetry(prompt, provider);
    const animations = JSON.parse(this.extractJSON(response));

    return {
      animationIn: animations.animationIn,
      animationShow: animations.animationShow,
      animationOut: animations.animationOut,
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
   * Call AI with retry logic
   */
  private async callAIWithRetry(
    prompt: string,
    provider: 'gemini' | 'openai',
    retryCount: number = 0,
  ): Promise<string> {
    try {
      if (provider === 'gemini') {
        return await this.callGemini(prompt);
      } else {
        return await this.callOpenAI(prompt);
      }
    } catch (error) {
      if (retryCount < this.maxRetries) {
        this.logger.warn(
          `AI call failed (attempt ${retryCount + 1}/${this.maxRetries + 1}): ${error.message}. Retrying in ${this.retryDelay}ms...`,
        );
        await this.sleep(this.retryDelay);
        return this.callAIWithRetry(prompt, provider, retryCount + 1);
      }
      this.logger.error(
        `AI call failed after ${this.maxRetries + 1} attempts: ${error.message}`,
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
