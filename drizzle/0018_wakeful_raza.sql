CREATE TABLE `userNotifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`eventType` varchar(96) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`relatedGroupId` int,
	`relatedRole` varchar(64),
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`readAt` timestamp,
	CONSTRAINT `userNotifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `user_notifications_user_idx` ON `userNotifications` (`telegramUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `user_notifications_unread_idx` ON `userNotifications` (`telegramUserId`,`isRead`,`createdAt`);