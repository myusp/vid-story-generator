import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsEnum, Min, IsOptional } from 'class-validator';

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

export class StartStoryDto {
  @ApiProperty({
    description: 'Topic of the story',
    example: 'Ayah kurang tidur',
  })
  @IsString()
  topic: string;

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
    description: 'Total number of images/scenes',
    example: 8,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  totalImages: number;

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
}
