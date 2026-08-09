CREATE TABLE `idea` (
	`id` text PRIMARY KEY NOT NULL,
	`source_video_id` text NOT NULL,
	`concept` text NOT NULL,
	`angle` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`notes` text,
	`score_at_creation` real,
	`remix_session_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`remix_session_id`) REFERENCES `remix_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idea_status` ON `idea` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idea_source_active` ON `idea` (`source_video_id`) WHERE status != 'discarded';