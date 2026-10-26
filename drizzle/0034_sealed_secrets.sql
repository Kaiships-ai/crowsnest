CREATE TABLE `sealed_secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated_at` text NOT NULL
);
