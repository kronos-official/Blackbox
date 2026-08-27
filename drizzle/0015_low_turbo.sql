CREATE TABLE `forcedJoinGroupLocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`locked` boolean NOT NULL DEFAULT false,
	`missingChannelIds` json,
	`lastMembershipCheckAt` timestamp,
	`lastPromptMessageId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `forcedJoinGroupLocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `forced_join_group_locks_group_user_unique` UNIQUE(`groupId`,`telegramUserId`)
);
--> statement-breakpoint
CREATE INDEX `forced_join_group_locks_group_locked_idx` ON `forcedJoinGroupLocks` (`groupId`,`locked`);