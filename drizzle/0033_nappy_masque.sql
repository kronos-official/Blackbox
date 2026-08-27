CREATE TABLE `groupRecentMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`messageId` int NOT NULL,
	`senderTelegramId` bigint,
	`observedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `groupRecentMessages_id` PRIMARY KEY(`id`),
	CONSTRAINT `group_recent_messages_group_message_unique` UNIQUE(`groupId`,`messageId`)
);
--> statement-breakpoint
CREATE INDEX `group_recent_messages_group_message_idx` ON `groupRecentMessages` (`groupId`,`messageId`);