CREATE TABLE `own_account_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`external_id` text NOT NULL,
	`username` text NOT NULL,
	`follower_count` integer,
	`follows_count` integer,
	`media_count` integer
);
--> statement-breakpoint
CREATE INDEX `own_account_snapshots_captured` ON `own_account_snapshots` (`captured_at`);--> statement-breakpoint
CREATE TABLE `own_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`own_post_id` text NOT NULL,
	`external_id` text NOT NULL,
	`author` text,
	`text` text NOT NULL,
	`posted_at` text,
	`kind` text NOT NULL,
	`classifier_version` text NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`own_post_id`) REFERENCES `own_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `own_comments_external` ON `own_comments` (`external_id`);--> statement-breakpoint
CREATE TABLE `own_post_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`own_post_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`reach` integer,
	`saved` integer,
	`shares` integer,
	`total_interactions` integer,
	`comments` integer,
	`likes` integer,
	`views` integer,
	`profile_visits` integer,
	`follows_from_post` integer,
	`watch_time_sec` real,
	`fetch_error` text,
	FOREIGN KEY (`own_post_id`) REFERENCES `own_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `own_post_insights_post_captured` ON `own_post_insights` (`own_post_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `own_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`permalink` text NOT NULL,
	`media_type` text NOT NULL,
	`product_type` text,
	`format` text NOT NULL,
	`caption` text,
	`posted_at` text NOT NULL,
	`duration_sec` real,
	`first_seen_at` text NOT NULL,
	`last_measured_at` text,
	`raw_payload` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `own_posts_external` ON `own_posts` (`external_id`);--> statement-breakpoint
CREATE INDEX `own_posts_posted` ON `own_posts` (`posted_at`);--> statement-breakpoint
ALTER TABLE `channels` ADD `is_own` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `channels_single_own` ON `channels` (`is_own`) WHERE "channels"."is_own" = 1;