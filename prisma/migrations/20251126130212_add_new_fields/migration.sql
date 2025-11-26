-- AlterTable
ALTER TABLE "StoryScene" ADD COLUMN "animationIn" TEXT;
ALTER TABLE "StoryScene" ADD COLUMN "animationOut" TEXT;
ALTER TABLE "StoryScene" ADD COLUMN "animationShow" TEXT;
ALTER TABLE "StoryScene" ADD COLUMN "ssml" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoryProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "speakerCode" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "totalImages" INTEGER NOT NULL,
    "modelProvider" TEXT NOT NULL DEFAULT 'gemini',
    "imageStyle" TEXT,
    "narrativeTone" TEXT,
    "titleGenerated" TEXT,
    "descriptionGenerated" TEXT,
    "hashtagsGenerated" TEXT,
    "storyPrompt" TEXT,
    "rawStory" TEXT,
    "videoPath" TEXT,
    "srtPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_StoryProject" ("createdAt", "descriptionGenerated", "genre", "hashtagsGenerated", "id", "language", "orientation", "rawStory", "speakerCode", "srtPath", "status", "storyPrompt", "titleGenerated", "topic", "totalImages", "updatedAt", "videoPath") SELECT "createdAt", "descriptionGenerated", "genre", "hashtagsGenerated", "id", "language", "orientation", "rawStory", "speakerCode", "srtPath", "status", "storyPrompt", "titleGenerated", "topic", "totalImages", "updatedAt", "videoPath" FROM "StoryProject";
DROP TABLE "StoryProject";
ALTER TABLE "new_StoryProject" RENAME TO "StoryProject";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
