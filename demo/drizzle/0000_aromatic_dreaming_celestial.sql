CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`journey` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`tx` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relay_lock` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`until` integer NOT NULL
);
