import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ScenesService {
  constructor(private prisma: PrismaService) {}

  async getProjectScenes(projectId: string) {
    return this.prisma.storyScene.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
  }
}
