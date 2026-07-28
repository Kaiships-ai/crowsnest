CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_sec` real,
	`storage_path` text NOT NULL,
	`source_url_hash` text,
	`downloaded_at` text NOT NULL,
	`last_verified_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_sha256` ON `media_assets` (`sha256`);--> statement-breakpoint
CREATE TABLE `video_children` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`position` integer NOT NULL,
	`external_id` text NOT NULL,
	`media_type` text NOT NULL,
	`thumbnail_asset_id` text,
	`video_asset_id` text,
	`raw_payload` text,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`video_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_children_video_position` ON `video_children` (`video_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `video_children_video_external` ON `video_children` (`video_id`,`external_id`);--> statement-breakpoint
ALTER TABLE `channels` ADD `avatar_asset_id` text REFERENCES media_assets(id);--> statement-breakpoint
ALTER TABLE `channels` ADD `is_private` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD `sync_error_code` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `channel_id` text REFERENCES channels(id);--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `heartbeat_at` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `lookback_days` integer;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `items_seen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `items_created` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `items_updated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `items_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `items_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `assets_downloaded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `assets_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `stop_reason` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `error_message` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_jobs_channel_running` ON `sync_jobs` (`channel_id`) WHERE "sync_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `sync_jobs_started` ON `sync_jobs` (`started_at`);--> statement-breakpoint
ALTER TABLE `videos` ADD `shortcode` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `media_type` text DEFAULT 'video' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `product_type` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `thumbnail_asset_id` text REFERENCES media_assets(id);--> statement-breakpoint
ALTER TABLE `videos` ADD `video_asset_id` text REFERENCES media_assets(id);--> statement-breakpoint
ALTER TABLE `videos` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `raw_payload` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `raw_fetched_at` text;--> statement-breakpoint
CREATE INDEX `videos_channel_posted` ON `videos` (`channel_id`,`posted_at`);