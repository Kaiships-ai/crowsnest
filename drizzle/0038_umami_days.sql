CREATE TABLE `umami_days` (
	`day` text PRIMARY KEY NOT NULL,
	`raw` text NOT NULL,
	`clean` text NOT NULL,
	`test_sessions_dropped` integer NOT NULL,
	`final` integer NOT NULL,
	`fetched_at` text NOT NULL
);
