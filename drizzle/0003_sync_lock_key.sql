DROP INDEX `sync_jobs_channel_running`;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `lock_key` text DEFAULT '__library__' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sync_jobs_lock_running` ON `sync_jobs` (`lock_key`) WHERE "sync_jobs"."status" = 'running';