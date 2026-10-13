CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
