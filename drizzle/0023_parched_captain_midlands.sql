ALTER TABLE `planned_posts` ADD `video_asset_id` text REFERENCES media_assets(id);--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `caption` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `scheduled_at` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `error_class` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `planned_posts` ADD `dry_run` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `planned_posts_idempotency_key` ON `planned_posts` (`idempotency_key`);