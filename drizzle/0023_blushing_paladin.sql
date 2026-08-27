CREATE TABLE `groupAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`actorTelegramId` bigint,
	`subjectTelegramId` bigint,
	`action` varchar(96) NOT NULL,
	`source` varchar(48) NOT NULL DEFAULT 'telegram',
	`outcome` enum('allowed','denied','completed','failed') NOT NULL,
	`requestId` varchar(96),
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groupAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `groupPolicyOverrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`policyKey` varchar(96) NOT NULL,
	`value` json NOT NULL,
	`updatedByTelegramId` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `groupPolicyOverrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_policy_overrides_scope_key_unique` UNIQUE(`groupId`,`policyKey`)
);
--> statement-breakpoint
CREATE INDEX `group_audit_events_group_created_idx` ON `groupAuditEvents` (`groupId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `group_audit_events_actor_created_idx` ON `groupAuditEvents` (`actorTelegramId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `group_audit_events_action_created_idx` ON `groupAuditEvents` (`action`,`createdAt`);--> statement-breakpoint
CREATE INDEX `group_policy_overrides_group_idx` ON `groupPolicyOverrides` (`groupId`,`updatedAt`);