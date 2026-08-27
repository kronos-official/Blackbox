CREATE TABLE `groupMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`membershipStatus` enum('active','left','kicked','unknown') NOT NULL DEFAULT 'active',
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastStatusAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groupMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_members_scope_user_unique` UNIQUE(`groupId`,`telegramUserId`)
);
--> statement-breakpoint
CREATE INDEX `group_members_group_seen_idx` ON `groupMembers` (`groupId`,`lastSeenAt`);