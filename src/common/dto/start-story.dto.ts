import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsEnum,
  Min,
  IsOptional,
  IsArray,
} from 'class-validator';

export enum ModelProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
}

export enum VideoOrientation {
  PORTRAIT = 'PORTRAIT',
  LANDSCAPE = 'LANDSCAPE',
}

export enum ImageStyle {
  REALISTIC = 'realistic',
  CARTOON = 'cartoon',
  ANIMATION_90S = 'animation_90s',
  GHIBLI = 'ghibli',
  ANIME = 'anime',
  PIXAR = 'pixar',
  WATERCOLOR = 'watercolor',
}

export enum NarrativeTone {
  CASUAL = 'casual',
  FORMAL = 'formal',
  FUNNY = 'funny',
  DRAMATIC = 'dramatic',
  INSPIRATIONAL = 'inspirational',
  MYSTERIOUS = 'mysterious',
}

// Animation types for video effects
export enum AnimationType {
  PAN_LEFT = 'pan-left',
  PAN_RIGHT = 'pan-right',
  PAN_UP = 'pan-up',
  PAN_DOWN = 'pan-down',
  ZOOM_SLOW = 'zoom-slow',
  ZOOM_IN = 'zoom-in',
  ZOOM_OUT = 'zoom-out',
  STATIC = 'static',
  FADE = 'fade',
  NONE = 'none',
}

// Story creation mode
export enum StoryMode {
  TOPIC = 'topic', // Generate from topic (default)
  PROMPT = 'prompt', // Generate from story prompt
  NARRATIONS = 'narrations', // Use provided narrations
}

export class StartStoryDto {
  @ApiProperty({
    description: 'Topic of the story (required for topic mode)',
    example: 'Ayah kurang tidur',
    required: false,
  })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiProperty({
    description: 'Genre of the story',
    example: 'family_comedy',
  })
  @IsString()
  genre: string;

  @ApiProperty({
    description: 'Language code',
    example: 'id',
  })
  @IsString()
  language: string;

  @ApiProperty({
    description: 'Edge-TTS speaker code',
    example: 'id-ID-ArdiNeural',
  })
  @IsString()
  speaker: string;

  @ApiProperty({
    description: 'Video orientation',
    enum: VideoOrientation,
    example: VideoOrientation.PORTRAIT,
  })
  @IsEnum(VideoOrientation)
  orientation: VideoOrientation;

  @ApiProperty({
    description:
      'Total number of images/scenes (auto-calculated for narrations mode)',
    example: 8,
    minimum: 1,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalImages?: number;

  @ApiProperty({
    description: 'AI model provider',
    enum: ModelProvider,
    example: ModelProvider.GEMINI,
  })
  @IsEnum(ModelProvider)
  modelProvider: ModelProvider;

  @ApiProperty({
    description: 'Image style for generation',
    enum: ImageStyle,
    example: ImageStyle.REALISTIC,
    required: false,
  })
  @IsOptional()
  @IsEnum(ImageStyle)
  imageStyle?: ImageStyle;

  @ApiProperty({
    description: 'Narrative tone/style',
    enum: NarrativeTone,
    example: NarrativeTone.CASUAL,
    required: false,
  })
  @IsOptional()
  @IsEnum(NarrativeTone)
  narrativeTone?: NarrativeTone;

  @ApiProperty({
    description: 'Story creation mode',
    enum: StoryMode,
    example: StoryMode.TOPIC,
    required: false,
  })
  @IsOptional()
  @IsEnum(StoryMode)
  storyMode?: StoryMode;

  @ApiProperty({
    description:
      'Story prompt (for prompt mode - AI will generate narrations from this)',
    example:
      'A father who works too hard and never gets enough sleep learns a valuable lesson about work-life balance when his child teaches him to relax.',
    required: false,
  })
  @IsOptional()
  @IsString()
  storyPrompt?: string;

  @ApiProperty({
    description:
      'Existing narrations (for narrations mode - skip AI generation)',
    example: [
      'Scene 1: Ayah selalu bekerja keras hingga larut malam.',
      'Scene 2: Dia hanya tidur 4 jam sehari.',
      'Scene 3: Suatu hari, anaknya bertanya mengapa ayah selalu lelah.',
    ],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  existingNarrations?: string[];

  @ApiProperty({
    description:
      'Allowed animation types for video (if not specified, all animations are allowed)',
    example: ['pan-left', 'pan-right', 'zoom-slow', 'fade'],
    required: false,
    type: [String],
    enum: AnimationType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedAnimations?: string[];
}
