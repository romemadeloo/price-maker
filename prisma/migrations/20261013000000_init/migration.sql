-- CreateTable
CREATE TABLE "drafts" (
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "record" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "slug" TEXT NOT NULL,
    "record" TEXT NOT NULL,
    "stamp" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("slug")
);

