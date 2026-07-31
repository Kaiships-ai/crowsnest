CREATE TABLE `planned_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`planned_date` text,
	`planned_time` text,
	`target_length_sec` integer,
	`script_id` text,
	`remix_session_id` text,
	`source_video_id` text,
	`published_own_post_id` text,
	`script_detached_note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`remix_session_id`) REFERENCES `remix_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `planned_posts_date` ON `planned_posts` (`planned_date`);--> statement-breakpoint
CREATE TABLE `saved_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_posts_video` ON `saved_posts` (`video_id`);--> statement-breakpoint
CREATE INDEX `saved_posts_created` ON `saved_posts` (`created_at`);--> statement-breakpoint
ALTER TABLE `scripts` ADD `remix_session_id` text REFERENCES remix_sessions(id);