ALTER TABLE `sync_jobs` ADD `phase` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `current_channel_handle` text;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `channels_total` integer;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `channels_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `retries` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_jobs` ADD `cancel_requested` integer DEFAULT false NOT NULL;