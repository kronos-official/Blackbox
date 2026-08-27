CREATE TABLE `ownerSiteCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(96) NOT NULL,
	`passwordHash` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT 'CURRENT_TIMESTAMP',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `owner_site_credentials_username_unique` ON `ownerSiteCredentials` (`username`);