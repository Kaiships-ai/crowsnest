CREATE TABLE `remix_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`stage` text NOT NULL,
	`outcome` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`elapsed_ms` integer NOT NULL,
	`detail` text NOT NULL,
	`error_message` text,
	FOREIGN KEY (`session_id`) REFERENCES `remix_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `remix_runs_session_started` ON `remix_runs` (`session_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `layout` text;--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `frames_sampled` integer;--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `frame_model` text;--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `frame_pass_at` text;--> statement-breakpoint
ALTER TABLE `video_analyses` ADD `frame_pass_error` text;