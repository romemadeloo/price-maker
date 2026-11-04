-- CreateTable
CREATE TABLE "draft_versions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "record" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "draft_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "draft_versions_slug_createdAt_idx" ON "draft_versions"("slug", "createdAt");
