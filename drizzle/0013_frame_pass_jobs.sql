CREATE TABLE `frame_pass_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`lock_key` text DEFAULT '__frame_pass__' NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`heartbeat_at` text,
	`frames_sampled` integer,
	`error_code` text,
	`error_message` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `frame_pass_jobs_lock_running` ON `frame_pass_jobs` (`lock_key`) WHERE "frame_pass_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `frame_pass_jobs_video_started` ON `frame_pass_jobs` (`video_id`,`started_at`);