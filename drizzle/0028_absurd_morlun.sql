CREATE TABLE `groupPolicyVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`policyKey` varchar(96) NOT NULL,
	`value` json NOT NULL,
	`previousValue` json,
	`operation` enum('set','rollback') NOT NULL,
	`sourceVersionId` int,
	`updatedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groupPolicyVersions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `group_policy_versions_scope_created_idx` ON `groupPolicyVersions` (`groupId`,`policyKey`,`createdAt`);--> statement-breakpoint
CREATE INDEX `group_policy_versions_group_idx` ON `groupPolicyVersions` (`groupId`,`createdAt`);