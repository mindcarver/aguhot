-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_targets" (
    "id" TEXT NOT NULL,
    "user_account_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_hot_event_id" TEXT,
    "target_theme_slug" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial uniques: one follow per (user, kind, target). PostgreSQL treats
-- multiple NULLs as distinct, so each partial index dedupes only the rows where
-- the target column is non-null (hot_event vs theme).
CREATE UNIQUE INDEX "follow_targets_user_account_id_target_kind_target_hot_event__idx"
    ON "follow_targets"("user_account_id", "target_kind", "target_hot_event_id");

CREATE UNIQUE INDEX "follow_targets_user_account_id_target_kind_target_theme_slu_idx"
    ON "follow_targets"("user_account_id", "target_kind", "target_theme_slug");

-- CreateIndex
CREATE INDEX "follow_targets_user_account_id_idx" ON "follow_targets"("user_account_id");

-- AddForeignKey
ALTER TABLE "follow_targets" ADD CONSTRAINT "follow_targets_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
