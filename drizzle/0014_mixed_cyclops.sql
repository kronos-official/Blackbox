CREATE TABLE `statusCardHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerTelegramId` bigint NOT NULL,
	`targetTelegramId` bigint NOT NULL,
	`targetDisplayName` varchar(256) NOT NULL,
	`style` varchar(16) NOT NULL,
	`imageUrl` text NOT NULL,
	`caption` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `statusCardHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `status_card_history_owner_idx` ON `statusCardHistory` (`ownerTelegramId`);--> statement-breakpoint
CREATE INDEX `status_card_history_created_idx` ON `statusCardHistory` (`createdAt`);