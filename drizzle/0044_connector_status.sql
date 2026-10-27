CREATE TABLE `connector_status` (
	`connector_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`message` text,
	`detail` text,
	`checked_at` text,
	`pulled_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "connector_status_state" CHECK("connector_status"."state" in ('ready', 'partial', 'error'))
);
--> statement-breakpoint
DROP TABLE `daily_pulls`;
