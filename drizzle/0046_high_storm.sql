CREATE TABLE `groupAuthoritySuspensions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`suspendedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `group_authority_suspensions_group_user_unique` UNIQUE(`groupId`,`telegramUserId`)
);
--> statement-breakpoint
CREATE INDEX `group_authority_suspensions_group_idx` ON `groupAuthoritySuspensions` (`groupId`);
