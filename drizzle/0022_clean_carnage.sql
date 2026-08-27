CREATE TABLE `lockPolicySnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`profileKey` varchar(32) NOT NULL,
	`snapshot` json NOT NULL,
	`createdByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lockPolicySnapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `lock_policy_snapshots_group_unique` UNIQUE(`groupId`)
);
