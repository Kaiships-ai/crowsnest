CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `channel_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`follower_count` integer,
	`median_views` real,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`handle` text NOT NULL,
	`external_id` text,
	`display_name` text,
	`avatar_url` text,
	`follower_count` integer,
	`following_count` integer,
	`media_count` integer,
	`bio` text,
	`is_verified` integer DEFAULT false NOT NULL,
	`sync_error` text,
	`tracked_since` text NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_platform_handle` ON `channels` (`platform`,`handle`);--> statement-breakpoint
CREATE TABLE `fleet_channels` (
	`fleet_id` text NOT NULL,
	`channel_id` text NOT NULL,
	PRIMARY KEY(`fleet_id`, `channel_id`),
	FOREIGN KEY (`fleet_id`) REFERENCES `fleets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fleets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`niche_label` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `remix_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`source_video_id` text NOT NULL,
	`stage` text DEFAULT 'prompt' NOT NULL,
	`topic` text,
	`niche` text,
	`target_length_sec` integer,
	`research_notes` text,
	`hook_options` text,
	`chosen_hook` text,
	`style_vault_item_id` text,
	`outline` text,
	`variants` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`criteria` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_video_id` text,
	`hook_vault_item_id` text,
	`style_vault_item_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hook_vault_item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`style_vault_item_id`) REFERENCES `vault_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`stats` text,
	`gaps` text
);
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`video_id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`language` text,
	`duration_sec` real,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `vault_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`source_video_id` text,
	`title` text NOT NULL,
	`template_text` text NOT NULL,
	`tags` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `video_analyses` (
	`video_id` text PRIMARY KEY NOT NULL,
	`hook_type` text,
	`structure_segments` text,
	`format_tags` text,
	`style_tags` text,
	`why_it_worked` text,
	`model` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `video_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`view_count` integer,
	`like_count` integer,
	`comment_count` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`caption` text,
	`posted_at` text NOT NULL,
	`duration_sec` integer,
	`thumbnail_url` text,
	`video_url` text,
	`view_count` integer,
	`like_count` integer,
	`comment_count` integer,
	`share_count` integer,
	`outlier_score` real,
	`first_seen_at` text NOT NULL,
	`last_refreshed_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_platform_external` ON `videos` (`platform`,`external_id`);