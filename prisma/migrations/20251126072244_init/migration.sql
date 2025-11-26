-- CreateTable
CREATE TABLE "StoryProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "speakerCode" TEXT NOT NULL,
    "orientation" TEXT NOT NULL,
    "totalImages" INTEGER NOT NULL,
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

-- CreateTable
CREATE TABLE "StoryScene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "order" INTEGER NOT NULL,
    "imagePrompt" TEXT,
    "narration" TEXT,
    "imagePath" TEXT,
    "audioPath" TEXT,
    "startTimeMs" INTEGER,
    "endTimeMs" INTEGER,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "StoryScene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StoryProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "StoryLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StoryProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
