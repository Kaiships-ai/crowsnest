CREATE TABLE `persona` (
	`id` text PRIMARY KEY NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`voice` text DEFAULT '' NOT NULL,
	`do_list` text DEFAULT '' NOT NULL,
	`dont_list` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
