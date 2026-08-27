CREATE TABLE `vipProtections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`protectMute` boolean NOT NULL DEFAULT true,
	`protectBan` boolean NOT NULL DEFAULT true,
	`protectKick` boolean NOT NULL DEFAULT true,
	`protectDelete` boolean NOT NULL DEFAULT false,
	`ignoreAntiSpam` boolean NOT NULL DEFAULT true,
	`ignoreAntiRaid` boolean NOT NULL DEFAULT true,
	`ignoreFilters` boolean NOT NULL DEFAULT true,
	`ignoreContentLocks` boolean NOT NULL DEFAULT true,
	`ignoreForcedJoin` boolean NOT NULL DEFAULT true,
	`notifyBlockedActions` boolean NOT NULL DEFAULT true,
	`expiresAt` timestamp,
	`updatedByTelegramId` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vipProtections_id` PRIMARY KEY(`id`),
	CONSTRAINT `vip_protections_group_user_unique` UNIQUE(`groupId`,`telegramUserId`)
);
--> statement-breakpoint
CREATE INDEX `vip_protections_expiry_idx` ON `vipProtections` (`expiresAt`);